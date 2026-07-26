//! Minimal hand-rolled HTTP/1.1 server for the local rescue API + embedded
//! read-only status page. No web framework by design (ADR: dependency
//! minimization). Loopback-only unless explicitly configured; wildcard binds
//! are refused by `config::validate_bind_addr` before we ever get here.
//!
//! Auth: POST actions require `X-Rescue-Auth: <nonce>:<hmac_hex>` where the
//! nonce came from `GET /rescue/challenge` (single-use, 60s TTL).

use crate::config::validate_bind_addr;
use crate::primary::OsExecutor;
use crate::runtime::Runtime;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_BODY_BYTES: usize = 8 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(5);

pub struct Request {
    pub method: String,
    pub path: String,
    pub auth_header: Option<String>,
    #[allow(dead_code)]
    pub body: Vec<u8>,
}

pub struct Response {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Response {
    fn json(status: u16, value: &serde_json::Value) -> Response {
        Response {
            status,
            content_type: "application/json",
            body: serde_json::to_vec(value).unwrap_or_default(),
        }
    }
}

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        423 => "Locked",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

/// Parse one request from the stream with hard size limits.
fn read_request(stream: &mut TcpStream) -> Result<Request, u16> {
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(|_| 500u16)?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|_| 500u16)?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|_| 400u16)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(400u16)?.to_string();
    let path = parts.next().ok_or(400u16)?.to_string();
    let mut auth_header = None;
    let mut content_length = 0usize;
    let mut header_bytes = request_line.len();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|_| 400u16)?;
        header_bytes += line.len();
        if header_bytes > MAX_HEADER_BYTES {
            return Err(413);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            if name == "x-rescue-auth" {
                auth_header = Some(value.to_string());
            } else if name == "content-length" {
                content_length = value.parse().map_err(|_| 400u16)?;
            }
        }
    }
    if content_length > MAX_BODY_BYTES {
        return Err(413);
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).map_err(|_| 400u16)?;
    }
    Ok(Request {
        method,
        path,
        auth_header,
        body,
    })
}

fn write_response(stream: &mut TcpStream, resp: &Response) {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        resp.status,
        status_text(resp.status),
        resp.content_type,
        resp.body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&resp.body);
    let _ = stream.flush();
}

/// Verify the auth header against a pending challenge. Any failure is audited
/// upstream by returning the reason.
fn check_auth(rt: &mut Runtime, req: &Request) -> Result<(), &'static str> {
    let header = req.auth_header.as_deref().ok_or("missing_auth_header")?;
    let (nonce, mac) = header.split_once(':').ok_or("malformed_auth_header")?;
    rt.auth.verify(nonce.trim(), mac.trim())
}

/// Route one request. Public so tests can drive it without sockets.
pub fn route(rt: &mut Runtime, req: &Request) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/rescue/health") => Response::json(
            200,
            &serde_json::json!({
                "process": "alive",
                "note": "process liveness only; NOT a safety-state statement",
                "mode": rt.mode(),
            }),
        ),
        ("GET", "/rescue/status") => match serde_json::to_value(rt.status()) {
            Ok(v) => Response::json(200, &v),
            Err(e) => Response::json(500, &serde_json::json!({ "error": e.to_string() })),
        },
        ("GET", "/rescue/challenge") => match rt.auth.issue_challenge() {
            Some(nonce) => Response::json(200, &serde_json::json!({ "nonce": nonce, "ttlSeconds": 60 })),
            None => Response::json(423, &serde_json::json!({ "error": "auth_locked" })),
        },
        ("GET", "/rescue/audit/export") => match rt.export_audit() {
            Ok(bundle) => Response::json(200, &bundle),
            Err(e) => Response::json(423, &serde_json::json!({ "error": e })),
        },
        ("GET", "/") | ("GET", "/rescue") => Response {
            status: 200,
            content_type: "text/html; charset=utf-8",
            body: render_status_page(rt).into_bytes(),
        },
        ("POST", "/rescue/interlock/assert") => {
            if let Err(reason) = check_auth(rt, req) {
                return Response::json(401, &serde_json::json!({ "decision": "denied", "reason": reason }));
            }
            let reason = body_field(req, "reason").unwrap_or_else(|| "http_operator_request".to_string());
            let out = rt.isolate("http-operator", "hmac-challenge", &reason);
            let code = if out.decision == "denied" { 423 } else { 200 };
            Response::json(code, &serde_json::to_value(&out).unwrap_or_default())
        }
        ("POST", "/rescue/services/restart-primary") => {
            if let Err(reason) = check_auth(rt, req) {
                return Response::json(401, &serde_json::json!({ "decision": "denied", "reason": reason }));
            }
            let service = match body_field(req, "service") {
                Some(s) => s,
                None => return Response::json(400, &serde_json::json!({ "error": "body must be {\"service\": \"<name>\"}" })),
            };
            let mut exec = OsExecutor;
            let out = rt.restart_primary("http-operator", "hmac-challenge", &service, &mut exec);
            let code = if out.decision == "denied" { 423 } else { 200 };
            Response::json(code, &serde_json::to_value(&out).unwrap_or_default())
        }
        ("POST", "/rescue/resync") => {
            if let Err(reason) = check_auth(rt, req) {
                return Response::json(401, &serde_json::json!({ "decision": "denied", "reason": reason }));
            }
            let (outcome, payload) = rt.resync();
            let code = if outcome.accepted { 200 } else { 423 };
            Response::json(
                code,
                &serde_json::json!({
                    "outcome": outcome,
                    "payload": payload,
                    "delivery": "not_implemented: primary ingest endpoint pending (see work ledger gap)",
                }),
            )
        }
        (m, p) if p.starts_with("/rescue") => {
            if m == "GET" || m == "POST" {
                Response::json(404, &serde_json::json!({ "error": "not_found" }))
            } else {
                Response::json(405, &serde_json::json!({ "error": "method_not_allowed" }))
            }
        }
        _ => Response::json(404, &serde_json::json!({ "error": "not_found" })),
    }
}

fn body_field(req: &Request, field: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(&req.body).ok()?;
    v.get(field)?.as_str().map(String::from)
}

/// Embedded read-only status page: zero external references, zero scripts
/// beyond none at all (static HTML), no action buttons (PRD AG-RESCUE-006).
fn render_status_page(rt: &Runtime) -> String {
    let report = rt.status();
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AetherGuard Rescue — read-only</title>\
         <style>body{{font-family:monospace;margin:2rem;background:#111;color:#ddd}}\
         td,th{{padding:.3rem .8rem;border:1px solid #444;text-align:left}}</style></head><body>\
         <h1>AetherGuard Rescue Control Plane (read-only)</h1>\
         <p>This page performs no actions. Actions require the authenticated CLI/API.</p>\
         <table>\
         <tr><th>rescue.mode</th><td>{:?}</td></tr>\
         <tr><th>rescue.version</th><td>{}</td></tr>\
         <tr><th>primary.status</th><td>{}</td></tr>\
         <tr><th>appliance.bridgeState</th><td>{}</td></tr>\
         <tr><th>appliance.secureElementPresent</th><td>{:?}</td></tr>\
         <tr><th>audit.chainValid</th><td>{}</td></tr>\
         <tr><th>audit.events</th><td>{}</td></tr>\
         </table></body></html>",
        report.rescue.mode,
        esc(report.rescue.version),
        esc(&report.primary.status),
        esc(&report.appliance.bridge_state),
        report.appliance.secure_element_present,
        report.audit.chain_valid,
        report.audit.events,
    )
}

/// Serve forever. Returns an error instead of serving if the bind address
/// violates policy (wildcard, or non-loopback without the explicit flag).
pub fn serve(rt: Runtime) -> Result<(), String> {
    let (addr, allow_non_loopback) = match &rt.config {
        Some(cfg) => (cfg.listen_addr().to_string(), cfg.allow_non_loopback),
        None => ("127.0.0.1:7801".to_string(), false),
    };
    validate_bind_addr(&addr, allow_non_loopback)?;
    let listener = TcpListener::bind(&addr).map_err(|e| format!("bind {addr} failed: {e}"))?;
    eprintln!("ag-rescue: serving on http://{addr} (read-only page at /, API under /rescue)");
    let shared = Arc::new(Mutex::new(rt));
    for stream in listener.incoming() {
        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let shared = Arc::clone(&shared);
        std::thread::spawn(move || {
            let resp = match read_request(&mut stream) {
                Ok(req) => {
                    let mut rt = match shared.lock() {
                        Ok(g) => g,
                        Err(_) => {
                            write_response(
                                &mut stream,
                                &Response::json(500, &serde_json::json!({"error":"state_poisoned"})),
                            );
                            return;
                        }
                    };
                    route(&mut rt, &req)
                }
                Err(code) => Response::json(code, &serde_json::json!({ "error": status_text(code) })),
            };
            write_response(&mut stream, &resp);
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{provision_key, respond};
    use crate::runtime::KEY_FILE;

    fn setup(tag: &str) -> (std::path::PathBuf, Runtime, String) {
        let root = std::env::temp_dir().join(format!("ag-rescue-http-{tag}"));
        let _ = std::fs::remove_dir_all(&root);
        let data_dir = root.join("data");
        std::fs::create_dir_all(&data_dir).unwrap();
        provision_key(&data_dir.join(KEY_FILE)).unwrap();
        let key_hex = std::fs::read_to_string(data_dir.join(KEY_FILE)).unwrap();
        let cfg = serde_json::json!({ "data_dir": data_dir.to_string_lossy() });
        let cfg_path = root.join("rescue.json");
        std::fs::write(&cfg_path, cfg.to_string()).unwrap();
        (root, Runtime::load(&cfg_path), key_hex)
    }

    fn req(method: &str, path: &str, auth: Option<String>, body: &str) -> Request {
        Request {
            method: method.to_string(),
            path: path.to_string(),
            auth_header: auth,
            body: body.as_bytes().to_vec(),
        }
    }

    fn json_body(resp: &Response) -> serde_json::Value {
        serde_json::from_slice(&resp.body).unwrap()
    }

    #[test]
    fn health_never_claims_safety() {
        let (_r, mut rt, _) = setup("health");
        let resp = route(&mut rt, &req("GET", "/rescue/health", None, ""));
        assert_eq!(resp.status, 200);
        let v = json_body(&resp);
        assert!(v["note"].as_str().unwrap().contains("NOT a safety-state"));
    }

    #[test]
    fn post_without_auth_is_401_denied() {
        let (_r, mut rt, _) = setup("noauth");
        let resp = route(&mut rt, &req("POST", "/rescue/interlock/assert", None, "{}"));
        assert_eq!(resp.status, 401);
        assert_eq!(json_body(&resp)["decision"], "denied");
        assert_eq!(json_body(&resp)["reason"], "missing_auth_header");
    }

    #[test]
    fn post_with_wrong_mac_is_401() {
        let (_r, mut rt, _) = setup("wrongmac");
        let ch = route(&mut rt, &req("GET", "/rescue/challenge", None, ""));
        let nonce = json_body(&ch)["nonce"].as_str().unwrap().to_string();
        let bad = format!("{nonce}:{}", "00".repeat(32));
        let resp = route(&mut rt, &req("POST", "/rescue/interlock/assert", Some(bad), "{}"));
        assert_eq!(resp.status, 401);
        assert_eq!(json_body(&resp)["reason"], "auth_failed");
    }

    #[test]
    fn authorized_isolate_flows_to_runtime() {
        let (_r, mut rt, key) = setup("okmac");
        let ch = route(&mut rt, &req("GET", "/rescue/challenge", None, ""));
        let nonce = json_body(&ch)["nonce"].as_str().unwrap().to_string();
        let mac = respond(&key, &nonce).unwrap();
        let auth = format!("{nonce}:{mac}");
        let resp = route(
            &mut rt,
            &req("POST", "/rescue/interlock/assert", Some(auth), r#"{"reason":"drill"}"#),
        );
        // No appliance configured => action runs but is honest about it:
        // decision "error" (sent-not-confirmed), never a fake success.
        assert_eq!(resp.status, 200);
        let v = json_body(&resp);
        assert_eq!(v["decision"], "error");
        assert_eq!(v["appliance"]["bridge_state"], "unknown");
    }

    #[test]
    fn challenge_is_single_use_via_http() {
        let (_r, mut rt, key) = setup("single");
        let ch = route(&mut rt, &req("GET", "/rescue/challenge", None, ""));
        let nonce = json_body(&ch)["nonce"].as_str().unwrap().to_string();
        let mac = respond(&key, &nonce).unwrap();
        let auth = format!("{nonce}:{mac}");
        let first = route(&mut rt, &req("POST", "/rescue/interlock/assert", Some(auth.clone()), "{}"));
        assert_eq!(first.status, 200);
        let replay = route(&mut rt, &req("POST", "/rescue/interlock/assert", Some(auth), "{}"));
        assert_eq!(replay.status, 401);
        assert_eq!(json_body(&replay)["reason"], "unknown_or_used_challenge");
    }

    #[test]
    fn status_page_has_no_action_forms_or_scripts() {
        let (_r, mut rt, _) = setup("page");
        let resp = route(&mut rt, &req("GET", "/", None, ""));
        assert_eq!(resp.status, 200);
        let html = String::from_utf8(resp.body).unwrap();
        assert!(!html.contains("<form"));
        assert!(!html.contains("<script"));
        assert!(!html.contains("http://") && !html.contains("https://"), "no external refs");
    }

    #[test]
    fn export_is_get_and_returns_chain() {
        let (_r, mut rt, _) = setup("export");
        let resp = route(&mut rt, &req("GET", "/rescue/audit/export", None, ""));
        assert_eq!(resp.status, 200);
        let v = json_body(&resp);
        assert_eq!(v["chain"]["chain_valid"], true);
    }

    #[test]
    fn unknown_route_is_404() {
        let (_r, mut rt, _) = setup("404");
        let resp = route(&mut rt, &req("GET", "/rescue/nope", None, ""));
        assert_eq!(resp.status, 404);
    }
}
