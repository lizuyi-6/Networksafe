//! Primary control-plane probing and allowlisted restart.
//!
//! - Probe: minimal HTTP/1.0 GET over std TcpStream (no HTTP client dep).
//! - Restart: exact-argv allowlist from config (`primary_services`). A name
//!   not on the allowlist is refused; argv is passed verbatim to the OS with
//!   NO shell, so config values cannot be shell-injected.

use crate::config::PrimaryService;
use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PrimaryStatus {
    /// "up" | "down" | "unknown"
    pub status: String,
    pub detail: Option<String>,
}

/// Probe `http://host:port/path`. Any HTTP status line at all counts as the
/// process being up (liveness); the body/semantics are the primary's business.
pub fn probe_health(url: &str, timeout: Duration) -> PrimaryStatus {
    let (host_port, path) = match parse_http_url(url) {
        Ok(v) => v,
        Err(e) => {
            return PrimaryStatus {
                status: "unknown".to_string(),
                detail: Some(e),
            }
        }
    };
    let attempt = || -> std::io::Result<String> {
        use std::net::ToSocketAddrs;
        let addr = host_port
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| std::io::Error::other("no address"))?;
        let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        write!(
            stream,
            "GET {path} HTTP/1.0\r\nHost: {host_port}\r\nConnection: close\r\n\r\n"
        )?;
        let mut buf = [0u8; 256];
        let n = stream.read(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf[..n]).to_string())
    };
    match attempt() {
        Ok(head) if head.starts_with("HTTP/") => PrimaryStatus {
            status: "up".to_string(),
            detail: head.lines().next().map(String::from),
        },
        Ok(_) => PrimaryStatus {
            status: "unknown".to_string(),
            detail: Some("non-HTTP response".to_string()),
        },
        Err(e) => PrimaryStatus {
            status: "down".to_string(),
            detail: Some(e.to_string()),
        },
    }
}

fn parse_http_url(url: &str) -> Result<(String, String), String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("only http:// probe URLs supported, got '{url}'"))?;
    let (host_port, path) = match rest.split_once('/') {
        Some((hp, p)) => (hp.to_string(), format!("/{p}")),
        None => (rest.to_string(), "/".to_string()),
    };
    if host_port.is_empty() {
        return Err("empty host".to_string());
    }
    Ok((host_port, path))
}

#[derive(Debug, PartialEq)]
pub enum RestartDecision {
    /// Exact argv to execute (from the allowlist entry).
    Allowed(Vec<String>),
    NotAllowlisted,
}

/// Pure decision function: name must match an allowlisted service exactly.
pub fn restart_decision(allowlist: &[PrimaryService], name: &str) -> RestartDecision {
    match allowlist.iter().find(|s| s.name == name) {
        Some(svc) if !svc.restart_argv.is_empty() => RestartDecision::Allowed(svc.restart_argv.clone()),
        _ => RestartDecision::NotAllowlisted,
    }
}

/// Executor seam: tests record argv; production spawns the process (no shell).
pub trait RestartExecutor {
    fn execute(&mut self, argv: &[String]) -> Result<i32, String>;
}

pub struct OsExecutor;

impl RestartExecutor for OsExecutor {
    fn execute(&mut self, argv: &[String]) -> Result<i32, String> {
        let (prog, args) = argv.split_first().ok_or("empty argv")?;
        let status = std::process::Command::new(prog)
            .args(args)
            .status()
            .map_err(|e| format!("spawn '{prog}' failed: {e}"))?;
        Ok(status.code().unwrap_or(-1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowlist() -> Vec<PrimaryService> {
        vec![PrimaryService {
            name: "backend".to_string(),
            restart_argv: vec!["systemctl".into(), "restart".into(), "aetherguard-backend".into()],
        }]
    }

    #[test]
    fn allowlisted_name_yields_exact_argv() {
        match restart_decision(&allowlist(), "backend") {
            RestartDecision::Allowed(argv) => {
                assert_eq!(argv, vec!["systemctl", "restart", "aetherguard-backend"]);
            }
            other => panic!("expected Allowed, got {other:?}"),
        }
    }

    #[test]
    fn unknown_name_is_refused() {
        assert_eq!(restart_decision(&allowlist(), "redis"), RestartDecision::NotAllowlisted);
        // Injection-shaped names must fail by NOT matching, not by sanitization.
        assert_eq!(
            restart_decision(&allowlist(), "backend; rm -rf /"),
            RestartDecision::NotAllowlisted
        );
        assert_eq!(restart_decision(&allowlist(), ""), RestartDecision::NotAllowlisted);
    }

    #[test]
    fn empty_argv_entry_is_refused() {
        let bad = vec![PrimaryService {
            name: "ghost".to_string(),
            restart_argv: vec![],
        }];
        assert_eq!(restart_decision(&bad, "ghost"), RestartDecision::NotAllowlisted);
    }

    #[test]
    fn probe_down_when_nothing_listens() {
        // Port 1 on loopback: reserved, nothing listens in test envs.
        let st = probe_health("http://127.0.0.1:1/health", Duration::from_millis(300));
        assert_eq!(st.status, "down");
    }

    #[test]
    fn probe_up_against_local_mock() {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (ready_sender, ready_receiver) = std::sync::mpsc::sync_channel(0);
        let handle = std::thread::spawn(move || {
            ready_sender.send(()).unwrap();
            if let Ok((mut s, _)) = listener.accept() {
                // Read until the HTTP/1.0 request head is fully received ("\r\n\r\n"). The
                // probe sends the whole request in one write, but a single read() may return
                // 0 (not-yet-arrived) or a partial head; responding too early lets our
                // shutdown(Write) RST the probe mid-write (observed as "Broken pipe (os
                // error 32)" on the probe -> flaky "down"). Blocking until the terminator
                // makes the exchange deterministic.
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let mut req = Vec::new();
                let mut buf = [0u8; 512];
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) => break,           // peer closed without a full request
                        Ok(n) => req.extend_from_slice(&buf[..n]),
                        Err(_) => break,          // timeout / closed: respond anyway below
                    }
                    if req.len() > 8192 {
                        break;
                    }
                }
                let _ = s.write_all(b"HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\nok");
                let _ = s.flush();
                let _ = s.shutdown(std::net::Shutdown::Write);
            }
        });
        ready_receiver.recv_timeout(Duration::from_secs(2)).unwrap();
        let st = probe_health(&format!("http://{addr}/health"), Duration::from_secs(5));
        handle.join().unwrap();
        assert_eq!(st.status, "up", "probe detail: {:?}", st.detail);
        assert_eq!(st.detail.as_deref(), Some("HTTP/1.0 200 OK"));
    }

    #[test]
    fn https_url_is_reported_unknown_not_probed() {
        let st = probe_health("https://127.0.0.1/health", Duration::from_millis(100));
        assert_eq!(st.status, "unknown");
    }
}
