//! Append-only, hash-chained local audit log (`rescue-events.log`).
//!
//! One JSON record per line. `eventHash = SHA-256(previousHash || "\n" || canonical_core_json)`
//! where `canonical_core_json` is the serde serialization of the typed core
//! struct (field order fixed by the struct, independent of on-disk formatting).
//! Genesis previousHash is 64 zeros. Actions must be audited BEFORE they are
//! executed; if the log is unwritable, the action is refused (fail-closed).

use crate::state::RescueSnapshot;
use crate::GENESIS_HASH;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, Write};
use std::path::Path;

/// PRD §9.2 audit fields (minus the two chain fields, which live on the record).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditCore {
    pub event_id: u64,
    /// Epoch seconds.
    pub timestamp: u64,
    pub actor: String,
    pub auth_method: String,
    pub command: String,
    pub target: String,
    pub before_state: String,
    pub after_state: String,
    /// "allowed" | "denied" | "error"
    pub decision: String,
    pub reason: String,
    pub hardware_state: String,
    pub policy_digest: Option<String>,
    pub monotonic_counter: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    #[serde(flatten)]
    pub core: AuditCore,
    pub previous_hash: String,
    pub event_hash: String,
}

pub fn compute_event_hash(previous_hash: &str, core: &AuditCore) -> String {
    let canonical = serde_json::to_string(core).expect("audit core serializes");
    let mut hasher = Sha256::new();
    hasher.update(previous_hash.as_bytes());
    hasher.update(b"\n");
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChainReport {
    pub chain_valid: bool,
    pub events: u64,
    pub last_event_hash: Option<String>,
    /// None when no anchor was supplied; Some(false) means the snapshot anchor
    /// does not match the log tail (truncation or rewrite).
    pub anchor_matched: Option<bool>,
    pub error: Option<String>,
}

pub struct AuditLog<'a> {
    path: &'a Path,
}

impl<'a> AuditLog<'a> {
    pub fn new(path: &'a Path) -> Self {
        AuditLog { path }
    }

    fn tail(&self) -> std::io::Result<(u64, String)> {
        if !self.path.exists() {
            return Ok((0, GENESIS_HASH.to_string()));
        }
        let f = std::fs::File::open(self.path)?;
        let mut count = 0u64;
        let mut last = GENESIS_HASH.to_string();
        for line in std::io::BufReader::new(f).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let rec: AuditRecord = serde_json::from_str(&line).map_err(|e| {
                std::io::Error::other(format!("audit log line {} unparseable: {e}", count + 1))
            })?;
            count += 1;
            last = rec.event_hash;
        }
        Ok((count, last))
    }

    /// Append one event. `event_id`/`previous_hash`/`event_hash` are assigned
    /// here from the current chain tail; the caller supplies everything else.
    pub fn append(&self, mut core: AuditCore) -> std::io::Result<AuditRecord> {
        let (count, prev) = self.tail()?;
        core.event_id = count + 1;
        let event_hash = compute_event_hash(&prev, &core);
        let rec = AuditRecord {
            core,
            previous_hash: prev,
            event_hash,
        };
        let line = serde_json::to_string(&rec).map_err(std::io::Error::other)?;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path)?;
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
        Ok(rec)
    }

    /// Verify the whole chain; optionally cross-check the snapshot anchor to
    /// detect tail truncation (a truncated log is otherwise a valid prefix).
    pub fn verify(&self, anchor: Option<&RescueSnapshot>) -> ChainReport {
        let mut report = ChainReport {
            chain_valid: true,
            events: 0,
            last_event_hash: None,
            anchor_matched: None,
            error: None,
        };
        if self.path.exists() {
            let f = match std::fs::File::open(self.path) {
                Ok(f) => f,
                Err(e) => {
                    report.chain_valid = false;
                    report.error = Some(format!("audit log unreadable: {e}"));
                    return report;
                }
            };
            let mut prev = GENESIS_HASH.to_string();
            for (idx, line) in std::io::BufReader::new(f).lines().enumerate() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        report.chain_valid = false;
                        report.error = Some(format!("read failed at line {}: {e}", idx + 1));
                        return report;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }
                let rec: AuditRecord = match serde_json::from_str(&line) {
                    Ok(r) => r,
                    Err(e) => {
                        report.chain_valid = false;
                        report.error = Some(format!("unparseable record at line {}: {e}", idx + 1));
                        return report;
                    }
                };
                if rec.previous_hash != prev {
                    report.chain_valid = false;
                    report.error = Some(format!(
                        "chain break at event {}: previousHash mismatch",
                        rec.core.event_id
                    ));
                    return report;
                }
                let expect = compute_event_hash(&prev, &rec.core);
                if expect != rec.event_hash {
                    report.chain_valid = false;
                    report.error = Some(format!(
                        "chain break at event {}: eventHash does not recompute",
                        rec.core.event_id
                    ));
                    return report;
                }
                prev = rec.event_hash.clone();
                report.events += 1;
                report.last_event_hash = Some(rec.event_hash);
            }
        }
        if let Some(anchor) = anchor {
            let matched = anchor.last_event_hash == report.last_event_hash
                && anchor.event_count == report.events;
            report.anchor_matched = Some(matched);
            if !matched {
                report.chain_valid = false;
                report.error = Some(
                    "anchor mismatch: log tail does not match snapshot anchor (possible truncation)"
                        .to_string(),
                );
            }
        }
        report
    }

    /// Read all records (for export / resync). Fails on any unparseable line.
    pub fn read_all(&self) -> std::io::Result<Vec<AuditRecord>> {
        let mut out = Vec::new();
        if !self.path.exists() {
            return Ok(out);
        }
        let f = std::fs::File::open(self.path)?;
        for line in std::io::BufReader::new(f).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            out.push(serde_json::from_str(&line).map_err(std::io::Error::other)?);
        }
        Ok(out)
    }
}

/// Convenience constructor for a core event with the chain fields left to
/// `append`. `event_id` is a placeholder overwritten by `append`.
#[allow(clippy::too_many_arguments)]
pub fn core_event(
    actor: &str,
    auth_method: &str,
    command: &str,
    target: &str,
    before_state: &str,
    after_state: &str,
    decision: &str,
    reason: &str,
    hardware_state: &str,
) -> AuditCore {
    AuditCore {
        event_id: 0,
        timestamp: crate::state::epoch_s(),
        actor: actor.to_string(),
        auth_method: auth_method.to_string(),
        command: command.to_string(),
        target: target.to_string(),
        before_state: before_state.to_string(),
        after_state: after_state.to_string(),
        decision: decision.to_string(),
        reason: reason.to_string(),
        hardware_state: hardware_state.to_string(),
        policy_digest: None,
        monotonic_counter: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_log(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ag-rescue-audit-{tag}"));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("rescue-events.log");
        let _ = std::fs::remove_file(&p);
        p
    }

    fn ev(cmd: &str) -> AuditCore {
        core_event("op", "cli", cmd, "appliance", "isolated", "isolated", "allowed", "test", "isolated")
    }

    #[test]
    fn chain_appends_and_verifies() {
        let p = tmp_log("ok");
        let log = AuditLog::new(&p);
        let r1 = log.append(ev("status")).unwrap();
        let r2 = log.append(ev("isolate")).unwrap();
        assert_eq!(r1.previous_hash, GENESIS_HASH);
        assert_eq!(r2.previous_hash, r1.event_hash);
        assert_eq!(r2.core.event_id, 2);
        let report = log.verify(None);
        assert!(report.chain_valid);
        assert_eq!(report.events, 2);
        assert_eq!(report.last_event_hash, Some(r2.event_hash));
    }

    #[test]
    fn tampered_field_breaks_chain() {
        let p = tmp_log("tamper");
        let log = AuditLog::new(&p);
        log.append(ev("status")).unwrap();
        log.append(ev("isolate")).unwrap();
        // Flip decision "allowed" -> "denied " in the first record on disk.
        let raw = std::fs::read_to_string(&p).unwrap();
        let tampered = raw.replacen("\"decision\":\"allowed\"", "\"decision\":\"denied\"", 1);
        assert_ne!(raw, tampered, "tamper substitution must apply");
        std::fs::write(&p, tampered).unwrap();
        let report = log.verify(None);
        assert!(!report.chain_valid);
        assert!(report.error.unwrap().contains("does not recompute"));
    }

    #[test]
    fn truncation_is_caught_by_anchor() {
        let p = tmp_log("trunc");
        let log = AuditLog::new(&p);
        log.append(ev("status")).unwrap();
        let r2 = log.append(ev("isolate")).unwrap();
        // Truncate: keep only the first line. Without an anchor this is a
        // valid-looking prefix; the anchor must catch it.
        let raw = std::fs::read_to_string(&p).unwrap();
        let first_line = raw.lines().next().unwrap().to_string() + "\n";
        std::fs::write(&p, first_line).unwrap();
        let no_anchor = log.verify(None);
        assert!(no_anchor.chain_valid, "prefix alone still verifies (expected)");
        let anchor = RescueSnapshot {
            last_event_hash: Some(r2.event_hash),
            event_count: 2,
            last_bridge_state: None,
            updated_at_epoch_s: 0,
        };
        let with_anchor = log.verify(Some(&anchor));
        assert!(!with_anchor.chain_valid);
        assert_eq!(with_anchor.anchor_matched, Some(false));
    }

    #[test]
    fn reordered_records_break_chain() {
        let p = tmp_log("reorder");
        let log = AuditLog::new(&p);
        log.append(ev("a")).unwrap();
        log.append(ev("b")).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        let mut lines: Vec<&str> = raw.lines().collect();
        lines.reverse();
        std::fs::write(&p, lines.join("\n") + "\n").unwrap();
        assert!(!log.verify(None).chain_valid);
    }
}
