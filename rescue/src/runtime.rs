//! Shared action layer for CLI and HTTP: mode gating (LOCKED vs READY),
//! audit-before-execute, honest status assembly.
//!
//! Ordering invariant: every action appends an intent record to the audit
//! chain BEFORE side effects, and an outcome record after. If the intent
//! append fails (log unwritable), the action is refused — fail-closed.

use crate::appliance::{self, ApplianceStatus, TcpTransport};
use crate::audit::{core_event, AuditLog, ChainReport};
use crate::auth::{AuthState, Authenticator};
use crate::config::{ConfigError, RescueConfig};
use crate::primary::{self, PrimaryStatus, RestartDecision, RestartExecutor};
use crate::resync::{prepare_resync, ResyncEvent, ResyncOutcome};
use crate::state::{epoch_s, load_snapshot, store_snapshot, RescueSnapshot, SnapshotLoad};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const APPLIANCE_TIMEOUT: Duration = Duration::from_secs(5);
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

pub const EVENTS_FILE: &str = "rescue-events.log";
pub const SNAPSHOT_FILE: &str = "rescue-state.json";
pub const KEY_FILE: &str = "rescue-keyring/rescue-auth.key";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Ready,
    /// Config missing/invalid: read-only diagnostics only.
    Locked,
    /// Config OK but snapshot corrupt or auth locked: actions restricted.
    ReadOnly,
}

pub struct Runtime {
    pub config: Option<RescueConfig>,
    pub config_error: Option<String>,
    pub snapshot: RescueSnapshot,
    pub snapshot_error: Option<String>,
    pub auth: Authenticator,
}

#[derive(Debug, Serialize)]
pub struct StatusReport {
    pub rescue: RescueSelf,
    pub primary: PrimaryStatus,
    pub appliance: ApplianceStatus,
    pub audit: ChainReport,
}

#[derive(Debug, Serialize)]
pub struct RescueSelf {
    pub version: &'static str,
    pub mode: Mode,
    pub status: &'static str,
    pub config_error: Option<String>,
    pub snapshot_error: Option<String>,
    pub auth: String,
}

#[derive(Debug, Serialize)]
pub struct ActionOutcome {
    pub decision: String,
    pub reason: String,
    pub appliance: Option<ApplianceStatus>,
    pub exit_code: Option<i32>,
    pub audit_event_ids: Vec<u64>,
}

impl Runtime {
    pub fn load(config_path: &Path) -> Runtime {
        let (config, config_error) = match RescueConfig::load(config_path) {
            Ok(c) => (Some(c), None),
            Err(e @ ConfigError::Missing(_))
            | Err(e @ ConfigError::Unreadable(_, _))
            | Err(e @ ConfigError::Invalid(_, _)) => (None, Some(e.to_string())),
        };
        let (snapshot, snapshot_error) = match &config {
            Some(cfg) => match load_snapshot(&cfg.data_path(SNAPSHOT_FILE)) {
                SnapshotLoad::Fresh(s) | SnapshotLoad::Ok(s) => (s, None),
                SnapshotLoad::Corrupt(e) => (RescueSnapshot::default(), Some(e)),
            },
            None => (RescueSnapshot::default(), None),
        };
        let auth = match &config {
            Some(cfg) => Authenticator::from_key_file(&cfg.data_path(KEY_FILE)),
            // No config => point at a path that cannot exist; auth is locked.
            None => Authenticator::from_key_file(Path::new("")),
        };
        Runtime {
            config,
            config_error,
            snapshot,
            snapshot_error,
            auth,
        }
    }

    pub fn mode(&self) -> Mode {
        if self.config.is_none() {
            return Mode::Locked;
        }
        if self.snapshot_error.is_some() || self.auth.state() != AuthState::Ready {
            return Mode::ReadOnly;
        }
        Mode::Ready
    }

    fn events_path(&self) -> Option<PathBuf> {
        self.config.as_ref().map(|c| c.data_path(EVENTS_FILE))
    }

    fn snapshot_path(&self) -> Option<PathBuf> {
        self.config.as_ref().map(|c| c.data_path(SNAPSHOT_FILE))
    }

    /// Assemble the honest status view. Every unprobeable dimension reports
    /// "unknown" with a detail, never a guess.
    pub fn status(&self) -> StatusReport {
        let mode = self.mode();
        let primary = match self.config.as_ref().and_then(|c| c.primary_health_url.clone()) {
            Some(url) => primary::probe_health(&url, PROBE_TIMEOUT),
            None => PrimaryStatus {
                status: "unknown".to_string(),
                detail: Some("primary_health_url not configured".to_string()),
            },
        };
        let appliance_status = match self.config.as_ref().and_then(|c| c.appliance_endpoint.clone()) {
            Some(ep) => match TcpTransport::connect(&ep, APPLIANCE_TIMEOUT) {
                Ok(mut t) => appliance::query_status(&mut t),
                Err(e) => ApplianceStatus::unknown(&format!("appliance connect failed: {e}")),
            },
            None => ApplianceStatus::unknown("appliance_endpoint not configured"),
        };
        let audit = match self.events_path() {
            Some(p) => AuditLog::new(&p).verify(Some(&self.snapshot)),
            None => ChainReport {
                chain_valid: false,
                events: 0,
                last_event_hash: None,
                anchor_matched: None,
                error: Some("locked: no config, no audit path".to_string()),
            },
        };
        StatusReport {
            rescue: RescueSelf {
                version: crate::RESCUE_VERSION,
                status: if mode == Mode::Ready { "ready" } else { "restricted" },
                mode,
                config_error: self.config_error.clone(),
                snapshot_error: self.snapshot_error.clone(),
                auth: match self.auth.state() {
                    AuthState::Ready => "ready".to_string(),
                    AuthState::Locked(r) => format!("locked: {r}"),
                },
            },
            primary,
            appliance: appliance_status,
            audit,
        }
    }

    /// Gate for every action: READY mode + intent audited first.
    #[allow(clippy::result_large_err)] // Err carries the full refusal outcome by design
    fn gate_action(
        &self,
        actor: &str,
        auth_method: &str,
        command: &str,
        target: &str,
        reason: &str,
    ) -> Result<(PathBuf, u64), ActionOutcome> {
        let refuse = |why: &str| ActionOutcome {
            decision: "denied".to_string(),
            reason: why.to_string(),
            appliance: None,
            exit_code: None,
            audit_event_ids: vec![],
        };
        match self.mode() {
            Mode::Ready => {}
            Mode::Locked => return Err(refuse("locked_no_config")),
            Mode::ReadOnly => return Err(refuse("read_only_mode")),
        }
        let events = self.events_path().expect("Ready implies config");
        let before = self
            .snapshot
            .last_bridge_state
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let intent = AuditLog::new(&events).append(core_event(
            actor,
            auth_method,
            command,
            target,
            &before,
            "pending",
            "allowed",
            reason,
            &before,
        ));
        match intent {
            Ok(rec) => Ok((events, rec.core.event_id)),
            Err(e) => Err(refuse(&format!("audit_unwritable_action_refused: {e}"))),
        }
    }

    #[allow(clippy::too_many_arguments)] // mirrors the fixed PRD §9.2 audit field set
    fn audit_outcome(
        &mut self,
        events: &Path,
        actor: &str,
        auth_method: &str,
        command: &str,
        target: &str,
        after: &str,
        decision: &str,
        reason: &str,
    ) -> Option<u64> {
        let before = self
            .snapshot
            .last_bridge_state
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let rec = AuditLog::new(events)
            .append(core_event(
                actor, auth_method, command, target, &before, after, decision, reason, after,
            ))
            .ok()?;
        // Update the truncation anchor after every append.
        if let Some(snap_path) = self.snapshot_path() {
            self.snapshot.last_event_hash = Some(rec.event_hash.clone());
            self.snapshot.event_count = rec.core.event_id;
            self.snapshot.updated_at_epoch_s = epoch_s();
            let _ = store_snapshot(&snap_path, &self.snapshot);
        }
        Some(rec.core.event_id)
    }

    /// Safe-side isolate. Sends `interlock_assert`; reports confirmed state
    /// only when both the normalized state and physical feedback prove isolation.
    pub fn isolate(&mut self, actor: &str, auth_method: &str, reason: &str) -> ActionOutcome {
        let (events, intent_id) = match self.gate_action(actor, auth_method, "isolate", "appliance", reason) {
            Ok(v) => v,
            Err(o) => return o,
        };
        let endpoint = self
            .config
            .as_ref()
            .and_then(|c| c.appliance_endpoint.clone());
        let status = match endpoint {
            Some(ep) => match TcpTransport::connect(&ep, APPLIANCE_TIMEOUT) {
                Ok(mut t) => appliance::assert_isolated(&mut t, reason),
                Err(e) => ApplianceStatus::unknown(&format!("appliance connect failed: {e}")),
            },
            None => ApplianceStatus::unknown("appliance_endpoint not configured"),
        };
        let confirmed = status.bridge_state == "isolated" && status.feedback_ok == Some(true);
        if confirmed {
            self.snapshot.last_bridge_state = Some("isolated".to_string());
        }
        let decision = if confirmed { "allowed" } else { "error" };
        let out_reason = if confirmed {
            "interlock_assert_confirmed".to_string()
        } else {
            format!(
                "interlock_assert_sent_not_confirmed: bridge_state={} feedback_ok={:?} {}",
                status.bridge_state,
                status.feedback_ok,
                status.detail.clone().unwrap_or_default()
            )
        };
        let outcome_id = self.audit_outcome(
            &events,
            actor,
            auth_method,
            "isolate",
            "appliance",
            &status.bridge_state,
            decision,
            &out_reason,
        );
        ActionOutcome {
            decision: decision.to_string(),
            reason: out_reason,
            appliance: Some(status),
            exit_code: None,
            audit_event_ids: [Some(intent_id), outcome_id].into_iter().flatten().collect(),
        }
    }

    pub fn restart_primary(
        &mut self,
        actor: &str,
        auth_method: &str,
        service: &str,
        executor: &mut dyn RestartExecutor,
    ) -> ActionOutcome {
        let allowlist = self
            .config
            .as_ref()
            .map(|c| c.primary_services.clone())
            .unwrap_or_default();
        // Allowlist decision BEFORE the audit gate so a refused name is also
        // audited as denied (if audit is writable) but never executed.
        let decision = primary::restart_decision(&allowlist, service);
        let (events, intent_id) = match self.gate_action(
            actor,
            auth_method,
            "restart-primary",
            service,
            "operator requested primary restart",
        ) {
            Ok(v) => v,
            Err(o) => return o,
        };
        match decision {
            RestartDecision::NotAllowlisted => {
                let outcome_id = self.audit_outcome(
                    &events,
                    actor,
                    auth_method,
                    "restart-primary",
                    service,
                    "unchanged",
                    "denied",
                    "service_not_allowlisted",
                );
                ActionOutcome {
                    decision: "denied".to_string(),
                    reason: "service_not_allowlisted".to_string(),
                    appliance: None,
                    exit_code: None,
                    audit_event_ids: [Some(intent_id), outcome_id].into_iter().flatten().collect(),
                }
            }
            RestartDecision::Allowed(argv) => {
                let result = executor.execute(&argv);
                let (decision, reason, code) = match result {
                    Ok(0) => ("allowed".to_string(), "restart_exit_0".to_string(), Some(0)),
                    Ok(c) => ("error".to_string(), format!("restart_exit_{c}"), Some(c)),
                    Err(e) => ("error".to_string(), format!("restart_spawn_failed: {e}"), None),
                };
                let outcome_id = self.audit_outcome(
                    &events,
                    actor,
                    auth_method,
                    "restart-primary",
                    service,
                    "restarted",
                    &decision,
                    &reason,
                );
                ActionOutcome {
                    decision,
                    reason,
                    appliance: None,
                    exit_code: code,
                    audit_event_ids: [Some(intent_id), outcome_id].into_iter().flatten().collect(),
                }
            }
        }
    }

    /// Export bundle: full records + chain report + snapshot. Read-only; works
    /// in ReadOnly mode too (diagnostics must survive degradation).
    pub fn export_audit(&self) -> Result<serde_json::Value, String> {
        let events = self.events_path().ok_or("locked_no_config")?;
        let log = AuditLog::new(&events);
        let chain = log.verify(Some(&self.snapshot));
        let records = log.read_all().map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "exportedAtEpochS": epoch_s(),
            "rescueVersion": crate::RESCUE_VERSION,
            "chain": chain,
            "snapshot": self.snapshot,
            "events": records,
        }))
    }

    pub fn resync(&self) -> (ResyncOutcome, Vec<ResyncEvent>) {
        match self.events_path() {
            Some(events) => prepare_resync(&events, Some(&self.snapshot)),
            None => (
                ResyncOutcome {
                    accepted: false,
                    reason: "locked_no_config".to_string(),
                    events: 0,
                    chain: ChainReport {
                        chain_valid: false,
                        events: 0,
                        last_event_hash: None,
                        anchor_matched: None,
                        error: Some("locked".to_string()),
                    },
                },
                Vec::new(),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::provision_key;
    use std::io::Write as _;

    struct RecordingExecutor {
        argv: Vec<Vec<String>>,
        result: Result<i32, String>,
    }

    impl RestartExecutor for RecordingExecutor {
        fn execute(&mut self, argv: &[String]) -> Result<i32, String> {
            self.argv.push(argv.to_vec());
            self.result.clone()
        }
    }

    fn setup(tag: &str, appliance_endpoint: Option<String>) -> (std::path::PathBuf, Runtime) {
        let root = std::env::temp_dir().join(format!("ag-rescue-rt-{tag}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let data_dir = root.join("data");
        std::fs::create_dir_all(&data_dir).unwrap();
        provision_key(&data_dir.join(KEY_FILE)).unwrap();
        let cfg = RescueConfig {
            data_dir: data_dir.to_string_lossy().to_string(),
            listen_addr: None,
            allow_non_loopback: false,
            appliance_endpoint,
            primary_health_url: None,
            primary_services: vec![crate::config::PrimaryService {
                name: "backend".to_string(),
                restart_argv: vec!["noop".to_string()],
            }],
            resync_endpoint: None,
        };
        let cfg_path = root.join("rescue.json");
        std::fs::write(&cfg_path, serde_json::to_string(&cfg).unwrap()).unwrap();
        let rt = Runtime::load(&cfg_path);
        (root, rt)
    }

    /// Mock appliance: replies with the supplied state frame to one command.
    fn mock_appliance_with_frame(
        frame: &'static str,
    ) -> (std::net::SocketAddr, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let mut received = Vec::new();
            if let Ok((stream, _)) = listener.accept() {
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if std::io::BufRead::read_line(&mut reader, &mut line).is_ok() {
                    received.push(line.trim().to_string());
                    let mut w = stream;
                    let _ = writeln!(w, "{frame}");
                }
            }
            received
        });
        (addr, handle)
    }

    fn mock_appliance() -> (std::net::SocketAddr, std::thread::JoinHandle<Vec<String>>) {
        mock_appliance_with_frame(
            r#"{"type":"interlock_result","interlockState":"isolated","feedbackOk":true,"secureElementPresent":true}"#,
        )
    }

    #[test]
    fn missing_config_is_locked_and_actions_refused() {
        let mut rt = Runtime::load(Path::new("Z:/no/such/rescue.json"));
        assert_eq!(rt.mode(), Mode::Locked);
        let out = rt.isolate("op", "cli", "drill");
        assert_eq!(out.decision, "denied");
        assert_eq!(out.reason, "locked_no_config");
        assert!(out.audit_event_ids.is_empty());
    }

    #[test]
    fn missing_auth_key_makes_read_only_and_refuses_actions() {
        let (root, _) = setup("noauth", None);
        // Remove the key => ReadOnly.
        std::fs::remove_file(root.join("data").join(KEY_FILE)).unwrap();
        let mut rt = Runtime::load(&root.join("rescue.json"));
        assert_eq!(rt.mode(), Mode::ReadOnly);
        let out = rt.isolate("op", "cli", "drill");
        assert_eq!(out.decision, "denied");
        assert_eq!(out.reason, "read_only_mode");
    }

    #[test]
    fn isolate_confirmed_by_mock_appliance_and_audited() {
        let (addr, handle) = mock_appliance();
        let (root, mut rt) = setup("isolate", Some(addr.to_string()));
        assert_eq!(rt.mode(), Mode::Ready);
        let out = rt.isolate("op", "cli", "drill_isolation");
        let sent = handle.join().unwrap();
        assert_eq!(out.decision, "allowed");
        assert_eq!(out.reason, "interlock_assert_confirmed");
        let st = out.appliance.unwrap();
        assert_eq!(st.bridge_state, "isolated");
        assert_eq!(st.feedback_ok, Some(true));
        // Wire: exactly one frame, and it is interlock_assert.
        assert_eq!(sent.len(), 1);
        let frame: serde_json::Value = serde_json::from_str(&sent[0]).unwrap();
        assert_eq!(frame["command"], "interlock_assert");
        // Audit: intent + outcome both recorded, chain valid with anchor.
        assert_eq!(out.audit_event_ids, vec![1, 2]);
        let report = Runtime::load(&root.join("rescue.json")).status();
        assert!(report.audit.chain_valid);
        assert_eq!(report.audit.events, 2);
        assert_eq!(report.audit.anchor_matched, Some(true));
    }

    #[test]
    fn isolate_with_unreachable_appliance_is_error_not_fake_success() {
        let (_root, mut rt) = setup("unreach", Some("127.0.0.1:1".to_string()));
        let out = rt.isolate("op", "cli", "drill");
        assert_eq!(out.decision, "error");
        assert!(out.reason.starts_with("interlock_assert_sent_not_confirmed"));
        assert_eq!(out.appliance.unwrap().bridge_state, "unknown");
    }

    #[test]
    fn isolate_with_isolated_state_but_negative_feedback_is_error() {
        let (addr, handle) = mock_appliance_with_frame(
            r#"{"type":"interlock_result","interlockState":"isolated","feedbackOk":false}"#,
        );
        let (_root, mut rt) = setup("feedback-false", Some(addr.to_string()));
        let out = rt.isolate("op", "cli", "feedback_mismatch");
        handle.join().unwrap();

        assert_eq!(out.decision, "error");
        assert!(out.reason.contains("bridge_state=isolated"));
        assert!(out.reason.contains("feedback_ok=Some(false)"));
        let status = out.appliance.unwrap();
        assert_eq!(status.bridge_state, "isolated");
        assert_eq!(status.feedback_ok, Some(false));
        assert_ne!(rt.snapshot.last_bridge_state.as_deref(), Some("isolated"));
    }

    #[test]
    fn isolate_with_isolated_state_but_missing_feedback_is_error() {
        let (addr, handle) = mock_appliance_with_frame(
            r#"{"type":"interlock_result","interlockState":"isolated"}"#,
        );
        let (_root, mut rt) = setup("feedback-missing", Some(addr.to_string()));
        let out = rt.isolate("op", "cli", "feedback_missing");
        handle.join().unwrap();

        assert_eq!(out.decision, "error");
        assert!(out.reason.contains("feedback_ok=None"));
        let status = out.appliance.unwrap();
        assert_eq!(status.bridge_state, "isolated");
        assert_eq!(status.feedback_ok, None);
        assert_ne!(rt.snapshot.last_bridge_state.as_deref(), Some("isolated"));
    }

    #[test]
    fn restart_refuses_non_allowlisted_and_audits_denial() {
        let (_root, mut rt) = setup("restart-deny", None);
        let mut exec = RecordingExecutor { argv: vec![], result: Ok(0) };
        let out = rt.restart_primary("op", "cli", "not-a-service", &mut exec);
        assert_eq!(out.decision, "denied");
        assert_eq!(out.reason, "service_not_allowlisted");
        assert!(exec.argv.is_empty(), "executor must never run for refused names");
        assert_eq!(out.audit_event_ids.len(), 2);
    }

    #[test]
    fn restart_allowlisted_runs_exact_argv() {
        let (_root, mut rt) = setup("restart-ok", None);
        let mut exec = RecordingExecutor { argv: vec![], result: Ok(0) };
        let out = rt.restart_primary("op", "cli", "backend", &mut exec);
        assert_eq!(out.decision, "allowed");
        assert_eq!(out.exit_code, Some(0));
        assert_eq!(exec.argv, vec![vec!["noop".to_string()]]);
    }

    #[test]
    fn unwritable_audit_refuses_action() {
        let (root, mut rt) = setup("rofs", None);
        // Replace the events log with a DIRECTORY: append must fail.
        let events = root.join("data").join(EVENTS_FILE);
        std::fs::create_dir_all(&events).unwrap();
        let out = rt.isolate("op", "cli", "drill");
        assert_eq!(out.decision, "denied");
        assert!(out.reason.starts_with("audit_unwritable_action_refused"));
    }

    #[test]
    fn status_reports_unknown_without_config_endpoints() {
        let (_root, rt) = setup("status", None);
        let report = rt.status();
        assert_eq!(report.appliance.bridge_state, "unknown");
        assert_eq!(report.primary.status, "unknown");
        assert!(report.audit.chain_valid);
        assert_eq!(report.rescue.status, "ready");
    }
}
