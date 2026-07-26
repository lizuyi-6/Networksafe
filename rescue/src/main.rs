//! `ag-rescue` CLI. std-only argument parsing (no clap): the rescue plane's
//! dependency set is deliberately minimal.
//!
//! Exit codes: 0 = success/allowed, 2 = usage error, 3 = denied/refused,
//! 4 = error (executed but not confirmed / failed), 5 = locked.

use ag_rescue::auth::provision_key;
use ag_rescue::http;
use ag_rescue::primary::OsExecutor;
use ag_rescue::runtime::{Mode, Runtime, KEY_FILE};
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
ag-rescue — AetherGuard rescue control plane (safe-side only; no release capability)

USAGE:
  ag-rescue <COMMAND> [--config <path>] [--json] [command options]

COMMANDS:
  status                                Print rescue/primary/appliance/audit status
  doctor                                Local self-check with reproducible diagnostics
  isolate --reason <text>               Request appliance interlock_assert (safe side)
  restart-primary --service <name>      Restart an allowlisted primary service
  audit verify                          Verify the local hash chain (+ anchor)
  audit export [--out <path>]           Export audit bundle (stdout or file)
  resync                                Verify chain and emit resync payload
  provision                             Generate the rescue auth key (refuses overwrite)
  serve                                 Serve the local HTTP API + read-only page

Default config path: ./rescue.json (override with --config or AG_RESCUE_CONFIG).
";

struct Cli {
    command: Vec<String>,
    config: PathBuf,
    json: bool,
    options: std::collections::HashMap<String, String>,
}

fn parse_args(args: &[String]) -> Result<Cli, String> {
    let mut command = Vec::new();
    let mut json = false;
    let mut config: Option<PathBuf> = None;
    let mut options = std::collections::HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--json" {
            json = true;
        } else if a == "--config" {
            i += 1;
            config = Some(PathBuf::from(args.get(i).ok_or("--config requires a value")?));
        } else if let Some(name) = a.strip_prefix("--") {
            i += 1;
            let value = args.get(i).ok_or_else(|| format!("--{name} requires a value"))?;
            options.insert(name.to_string(), value.clone());
        } else {
            command.push(a.clone());
        }
        i += 1;
    }
    let config = config
        .or_else(|| std::env::var("AG_RESCUE_CONFIG").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("rescue.json"));
    Ok(Cli {
        command,
        config,
        json,
        options,
    })
}

fn emit(json: bool, value: &serde_json::Value) {
    if json {
        println!("{}", serde_json::to_string(value).unwrap_or_default());
    } else {
        println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
    }
}

fn decision_exit(decision: &str) -> ExitCode {
    match decision {
        "allowed" => ExitCode::from(0),
        "denied" => ExitCode::from(3),
        _ => ExitCode::from(4),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cli = match parse_args(&args) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    if cli.command.is_empty() {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }

    match cli.command[0].as_str() {
        "provision" => {
            // Provision needs the config only for the data_dir; allow a
            // fallback --data-dir so first-time setup can bootstrap.
            let data_dir = match ag_rescue::config::RescueConfig::load(&cli.config) {
                Ok(cfg) => PathBuf::from(cfg.data_dir),
                Err(_) => match cli.options.get("data-dir") {
                    Some(d) => PathBuf::from(d),
                    None => {
                        eprintln!("error: no readable config; pass --data-dir for bootstrap provision");
                        return ExitCode::from(2);
                    }
                },
            };
            let key_path = data_dir.join(KEY_FILE);
            match provision_key(&key_path) {
                Ok(()) => {
                    emit(cli.json, &serde_json::json!({
                        "provisioned": true,
                        "keyPath": key_path.to_string_lossy(),
                        "note": "key printed nowhere; distribute via your secret channel by copying the file",
                    }));
                    ExitCode::from(0)
                }
                Err(e) => {
                    emit(cli.json, &serde_json::json!({ "provisioned": false, "error": e }));
                    ExitCode::from(4)
                }
            }
        }
        "status" => {
            let rt = Runtime::load(&cli.config);
            let report = rt.status();
            emit(cli.json, &serde_json::to_value(&report).unwrap_or_default());
            ExitCode::from(0)
        }
        "doctor" => {
            let rt = Runtime::load(&cli.config);
            let mode = rt.mode();
            let report = rt.status();
            let checks = serde_json::json!({
                "configPath": cli.config.to_string_lossy(),
                "mode": mode,
                "configError": report.rescue.config_error,
                "snapshotError": report.rescue.snapshot_error,
                "auth": report.rescue.auth,
                "auditChainValid": report.audit.chain_valid,
                "auditEvents": report.audit.events,
                "auditAnchorMatched": report.audit.anchor_matched,
                "applianceReachable": report.appliance.reachable,
                "primaryStatus": report.primary.status,
                "verdict": if mode == Mode::Ready && report.audit.chain_valid { "ready" } else { "restricted" },
            });
            emit(cli.json, &checks);
            if mode == Mode::Ready && report.audit.chain_valid {
                ExitCode::from(0)
            } else {
                ExitCode::from(5)
            }
        }
        "isolate" => {
            let reason = match cli.options.get("reason") {
                Some(r) => r.clone(),
                None => {
                    eprintln!("error: isolate requires --reason <text>");
                    return ExitCode::from(2);
                }
            };
            let mut rt = Runtime::load(&cli.config);
            let out = rt.isolate("cli-operator", "cli-keyfile", &reason);
            emit(cli.json, &serde_json::to_value(&out).unwrap_or_default());
            decision_exit(&out.decision)
        }
        "restart-primary" => {
            let service = match cli.options.get("service") {
                Some(s) => s.clone(),
                None => {
                    eprintln!("error: restart-primary requires --service <name>");
                    return ExitCode::from(2);
                }
            };
            let mut rt = Runtime::load(&cli.config);
            let mut exec = OsExecutor;
            let out = rt.restart_primary("cli-operator", "cli-keyfile", &service, &mut exec);
            emit(cli.json, &serde_json::to_value(&out).unwrap_or_default());
            decision_exit(&out.decision)
        }
        "audit" => match cli.command.get(1).map(String::as_str) {
            Some("verify") => {
                let rt = Runtime::load(&cli.config);
                let report = rt.status();
                emit(cli.json, &serde_json::to_value(&report.audit).unwrap_or_default());
                if report.audit.chain_valid {
                    ExitCode::from(0)
                } else {
                    ExitCode::from(4)
                }
            }
            Some("export") => {
                let rt = Runtime::load(&cli.config);
                match rt.export_audit() {
                    Ok(bundle) => {
                        if let Some(out_path) = cli.options.get("out") {
                            match std::fs::write(out_path, serde_json::to_vec_pretty(&bundle).unwrap_or_default()) {
                                Ok(()) => {
                                    emit(cli.json, &serde_json::json!({ "exported": true, "path": out_path }));
                                    ExitCode::from(0)
                                }
                                Err(e) => {
                                    emit(cli.json, &serde_json::json!({ "exported": false, "error": e.to_string() }));
                                    ExitCode::from(4)
                                }
                            }
                        } else {
                            emit(cli.json, &bundle);
                            ExitCode::from(0)
                        }
                    }
                    Err(e) => {
                        emit(cli.json, &serde_json::json!({ "exported": false, "error": e }));
                        ExitCode::from(5)
                    }
                }
            }
            _ => {
                eprintln!("error: audit requires a subcommand: verify | export\n\n{USAGE}");
                ExitCode::from(2)
            }
        },
        "resync" => {
            let rt = Runtime::load(&cli.config);
            let (outcome, payload) = rt.resync();
            emit(
                cli.json,
                &serde_json::json!({
                    "outcome": outcome,
                    "payloadEvents": payload.len(),
                    "delivery": "not_implemented: primary ingest endpoint pending (declared gap)",
                }),
            );
            if outcome.accepted {
                ExitCode::from(0)
            } else {
                ExitCode::from(4)
            }
        }
        "serve" => {
            let rt = Runtime::load(&cli.config);
            match http::serve(rt) {
                Ok(()) => ExitCode::from(0),
                Err(e) => {
                    eprintln!("error: {e}");
                    ExitCode::from(4)
                }
            }
        }
        other => {
            eprintln!("error: unknown command '{other}'\n\n{USAGE}");
            ExitCode::from(2)
        }
    }
}
