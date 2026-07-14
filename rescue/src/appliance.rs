//! Gateway Appliance client — SAFE-SIDE ONLY.
//!
//! Frame shapes mirror `backend/src/companion/gateway-daemon.ts`
//! (`DaemonFrame` / `ControllerFrame`), newline-delimited JSON.
//!
//! Release-policy ADR invariant: this module can emit exactly two commands,
//! `hello` (status query) and `interlock_assert` (drive to isolated). There is
//! no constructor for a release frame anywhere in this crate; the source-level
//! guard `scripts/guards/check-rescue-no-release.mjs` enforces this.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

/// Commands the rescue plane is allowed to emit. Deliberately closed enum.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SafeCommand {
    Hello,
    InterlockAssert,
}

#[derive(Debug, Clone, Serialize)]
pub struct RescueFrame {
    #[serde(rename = "type")]
    pub frame_type: &'static str,
    pub command: SafeCommand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub ts: u64,
}

/// Incoming appliance/controller frame (subset we read; unknown fields ignored).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ApplianceFrame {
    #[serde(rename = "type")]
    pub frame_type: String,
    #[serde(rename = "interlockState")]
    pub interlock_state: Option<String>,
    #[serde(rename = "feedbackOk")]
    pub feedback_ok: Option<bool>,
    #[serde(rename = "secureElementPresent")]
    pub secure_element_present: Option<bool>,
    pub ts: Option<u64>,
}

/// Normalized view for `status`. Anything not positively confirmed is `unknown`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ApplianceStatus {
    /// "isolated" | "released" | "armed" | "unknown"
    pub bridge_state: String,
    pub secure_element_present: Option<bool>,
    pub feedback_ok: Option<bool>,
    pub reachable: bool,
    pub detail: Option<String>,
}

impl ApplianceStatus {
    pub fn unknown(detail: &str) -> ApplianceStatus {
        ApplianceStatus {
            bridge_state: "unknown".to_string(),
            secure_element_present: None,
            feedback_ok: None,
            reachable: false,
            detail: Some(detail.to_string()),
        }
    }
}

/// Mirror of `normalizeInterlockState` (`backend/src/security/final-defense-policy.ts`):
/// trim + lowercase; legacy `asserted` maps to `isolated`; unknown values => `unknown`.
pub fn normalize_interlock_state(raw: Option<&str>) -> String {
    let v = raw.unwrap_or("").trim().to_ascii_lowercase();
    match v.as_str() {
        "asserted" | "isolated" => "isolated".to_string(),
        "released" => "released".to_string(),
        "armed" => "armed".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Transport abstraction so serial / console modes can plug in later and so
/// tests can inject a mock without sockets.
pub trait ApplianceTransport {
    fn send_line(&mut self, line: &str) -> std::io::Result<()>;
    fn read_line(&mut self) -> std::io::Result<Option<String>>;
}

pub struct TcpTransport {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
}

impl TcpTransport {
    pub fn connect(endpoint: &str, timeout: Duration) -> std::io::Result<TcpTransport> {
        use std::net::ToSocketAddrs;
        let addr = endpoint
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| std::io::Error::other("endpoint resolved to no address"))?;
        let stream = TcpStream::connect_timeout(&addr, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        let writer = stream.try_clone()?;
        Ok(TcpTransport {
            reader: BufReader::new(stream),
            writer,
        })
    }
}

impl ApplianceTransport for TcpTransport {
    fn send_line(&mut self, line: &str) -> std::io::Result<()> {
        self.writer.write_all(line.as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()
    }

    fn read_line(&mut self) -> std::io::Result<Option<String>> {
        let mut buf = String::new();
        match self.reader.read_line(&mut buf) {
            Ok(0) => Ok(None),
            Ok(_) => Ok(Some(buf.trim_end_matches(['\r', '\n']).to_string())),
            Err(e) => Err(e),
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn status_from_frame(frame: &ApplianceFrame) -> ApplianceStatus {
    ApplianceStatus {
        bridge_state: normalize_interlock_state(frame.interlock_state.as_deref()),
        secure_element_present: frame.secure_element_present,
        feedback_ok: frame.feedback_ok,
        reachable: true,
        detail: None,
    }
}

fn read_status_frame(t: &mut dyn ApplianceTransport) -> ApplianceStatus {
    loop {
        match t.read_line() {
            Ok(Some(line)) => {
                let frame: ApplianceFrame = match serde_json::from_str(&line) {
                    Ok(f) => f,
                    Err(e) => {
                        // A frame we cannot parse is NOT evidence of any state.
                        return ApplianceStatus::unknown(&format!("unparseable frame: {e}"));
                    }
                };
                match frame.frame_type.as_str() {
                    "state" | "interlock_result" => return status_from_frame(&frame),
                    "heartbeat" => continue, // keep waiting for a state frame
                    "alert" => {
                        let mut s = status_from_frame(&frame);
                        s.detail = Some("appliance raised alert".to_string());
                        return s;
                    }
                    other => {
                        return ApplianceStatus::unknown(&format!("unexpected frame type '{other}'"))
                    }
                }
            }
            Ok(None) => return ApplianceStatus::unknown("appliance closed connection"),
            Err(e) => return ApplianceStatus::unknown(&format!("appliance read failed: {e}")),
        }
    }
}

/// Query appliance state (`hello` -> wait for `state`/`interlock_result`).
pub fn query_status(t: &mut dyn ApplianceTransport) -> ApplianceStatus {
    let frame = RescueFrame {
        frame_type: "command",
        command: SafeCommand::Hello,
        reason: None,
        ts: now_ms(),
    };
    let line = serde_json::to_string(&frame).expect("frame serializes");
    if let Err(e) = t.send_line(&line) {
        return ApplianceStatus::unknown(&format!("appliance write failed: {e}"));
    }
    read_status_frame(t)
}

/// Drive the appliance to isolated. Returns the post-command status; the
/// caller reports honestly whether isolation was CONFIRMED by a frame or the
/// command was merely sent (unknown).
pub fn assert_isolated(t: &mut dyn ApplianceTransport, reason: &str) -> ApplianceStatus {
    let frame = RescueFrame {
        frame_type: "command",
        command: SafeCommand::InterlockAssert,
        reason: Some(reason.to_string()),
        ts: now_ms(),
    };
    let line = serde_json::to_string(&frame).expect("frame serializes");
    if let Err(e) = t.send_line(&line) {
        return ApplianceStatus::unknown(&format!("appliance write failed: {e}"));
    }
    read_status_frame(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct MockTransport {
        sent: Vec<String>,
        replies: VecDeque<Option<String>>,
    }

    impl MockTransport {
        fn new(replies: Vec<Option<&str>>) -> MockTransport {
            MockTransport {
                sent: Vec::new(),
                replies: replies.into_iter().map(|r| r.map(String::from)).collect(),
            }
        }
    }

    impl ApplianceTransport for MockTransport {
        fn send_line(&mut self, line: &str) -> std::io::Result<()> {
            self.sent.push(line.to_string());
            Ok(())
        }
        fn read_line(&mut self) -> std::io::Result<Option<String>> {
            match self.replies.pop_front() {
                Some(r) => Ok(r),
                None => Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "timeout")),
            }
        }
    }

    #[test]
    fn wire_format_matches_daemon_frame_shape() {
        let mut t = MockTransport::new(vec![Some(
            r#"{"type":"state","interlockState":"isolated","feedbackOk":true,"secureElementPresent":true}"#,
        )]);
        let status = assert_isolated(&mut t, "rescue_drill");
        // Exact wire assertion: same keys the M1 daemon consumes.
        let sent: serde_json::Value = serde_json::from_str(&t.sent[0]).unwrap();
        assert_eq!(sent["type"], "command");
        assert_eq!(sent["command"], "interlock_assert");
        assert_eq!(sent["reason"], "rescue_drill");
        assert_eq!(status.bridge_state, "isolated");
        assert_eq!(status.feedback_ok, Some(true));
        assert!(status.reachable);
    }

    #[test]
    fn legacy_asserted_normalizes_to_isolated_not_armed() {
        assert_eq!(normalize_interlock_state(Some("Asserted ")), "isolated");
        assert_eq!(normalize_interlock_state(Some("RELEASED")), "released");
        assert_eq!(normalize_interlock_state(Some("garbage")), "unknown");
        assert_eq!(normalize_interlock_state(None), "unknown");
    }

    #[test]
    fn unparseable_frame_reports_unknown_never_guesses() {
        let mut t = MockTransport::new(vec![Some("!!not json!!")]);
        let status = query_status(&mut t);
        assert_eq!(status.bridge_state, "unknown");
        assert!(!status.reachable);
    }

    #[test]
    fn closed_connection_reports_unknown() {
        let mut t = MockTransport::new(vec![None]);
        let status = query_status(&mut t);
        assert_eq!(status.bridge_state, "unknown");
        assert!(status.detail.unwrap().contains("closed connection"));
    }

    #[test]
    fn heartbeat_frames_are_skipped_until_state_arrives() {
        let mut t = MockTransport::new(vec![
            Some(r#"{"type":"heartbeat","ts":1}"#),
            Some(r#"{"type":"state","interlockState":"released","feedbackOk":true}"#),
        ]);
        let status = query_status(&mut t);
        assert_eq!(status.bridge_state, "released");
    }

    #[test]
    fn safe_command_enum_has_no_release_variant() {
        // Compile-time closed set; runtime double-check of the wire strings.
        let hello = serde_json::to_string(&SafeCommand::Hello).unwrap();
        let assert_cmd = serde_json::to_string(&SafeCommand::InterlockAssert).unwrap();
        assert_eq!(hello, "\"hello\"");
        assert_eq!(assert_cmd, "\"interlock_assert\"");
    }
}
