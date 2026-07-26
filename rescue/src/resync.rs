//! Resync: replay rescue-local audit into the primary audit archive AFTER the
//! chain (and truncation anchor) verifies. A broken chain refuses resync
//! outright — no partial or "best effort" sync of a tampered log.
//!
//! The primary-side ingest endpoint is a separate backend deliverable; until
//! it exists, `build_payload` is the contract and `resync` can only run in
//! verify/export mode (an explicitly declared gap, see the work ledger).

use crate::audit::{AuditLog, AuditRecord, ChainReport};
use crate::state::RescueSnapshot;
use serde::Serialize;
use std::path::Path;

pub const RESYNC_SOURCE: &str = "rescue-control-plane";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ResyncEvent {
    /// Fixed provenance marker (PRD §9.3 item 3).
    pub source: &'static str,
    /// Original rescue event hash, preserved verbatim (PRD §9.3 item 4).
    pub original_event_hash: String,
    pub original_previous_hash: String,
    #[serde(flatten)]
    pub record: crate::audit::AuditCore,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ResyncOutcome {
    pub accepted: bool,
    pub reason: String,
    pub events: u64,
    pub chain: ChainReport,
}

pub fn build_payload(records: &[AuditRecord]) -> Vec<ResyncEvent> {
    records
        .iter()
        .map(|r| ResyncEvent {
            source: RESYNC_SOURCE,
            original_event_hash: r.event_hash.clone(),
            original_previous_hash: r.previous_hash.clone(),
            record: r.core.clone(),
        })
        .collect()
}

/// Verify then build. `accepted=false` + zero payload on ANY chain defect.
pub fn prepare_resync(
    log_path: &Path,
    anchor: Option<&RescueSnapshot>,
) -> (ResyncOutcome, Vec<ResyncEvent>) {
    let log = AuditLog::new(log_path);
    let chain = log.verify(anchor);
    if !chain.chain_valid {
        let reason = chain
            .error
            .clone()
            .unwrap_or_else(|| "chain invalid".to_string());
        return (
            ResyncOutcome {
                accepted: false,
                reason,
                events: 0,
                chain,
            },
            Vec::new(),
        );
    }
    let records = match log.read_all() {
        Ok(r) => r,
        Err(e) => {
            return (
                ResyncOutcome {
                    accepted: false,
                    reason: format!("log read failed after verify: {e}"),
                    events: 0,
                    chain,
                },
                Vec::new(),
            )
        }
    };
    let payload = build_payload(&records);
    (
        ResyncOutcome {
            accepted: true,
            reason: "chain_valid".to_string(),
            events: payload.len() as u64,
            chain,
        },
        payload,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::core_event;

    fn tmp_log(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ag-rescue-resync-{tag}"));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("rescue-events.log");
        let _ = std::fs::remove_file(&p);
        p
    }

    fn seed(p: &Path, n: usize) -> Vec<AuditRecord> {
        let log = AuditLog::new(p);
        (0..n)
            .map(|i| {
                log.append(core_event(
                    "op", "cli", &format!("cmd{i}"), "t", "isolated", "isolated", "allowed", "r",
                    "isolated",
                ))
                .unwrap()
            })
            .collect()
    }

    #[test]
    fn valid_chain_resyncs_with_provenance() {
        let p = tmp_log("ok");
        let recs = seed(&p, 3);
        let (outcome, payload) = prepare_resync(&p, None);
        assert!(outcome.accepted);
        assert_eq!(outcome.events, 3);
        assert_eq!(payload.len(), 3);
        assert_eq!(payload[0].source, "rescue-control-plane");
        assert_eq!(payload[2].original_event_hash, recs[2].event_hash);
    }

    #[test]
    fn tampered_log_refuses_resync() {
        let p = tmp_log("tampered");
        seed(&p, 3);
        let raw = std::fs::read_to_string(&p).unwrap();
        let tampered = raw.replacen("\"command\":\"cmd1\"", "\"command\":\"cmdX\"", 1);
        assert_ne!(raw, tampered);
        std::fs::write(&p, tampered).unwrap();
        let (outcome, payload) = prepare_resync(&p, None);
        assert!(!outcome.accepted);
        assert_eq!(payload.len(), 0);
        assert!(outcome.reason.contains("does not recompute"));
    }

    #[test]
    fn truncated_log_refuses_resync_via_anchor() {
        let p = tmp_log("trunc");
        let recs = seed(&p, 3);
        let raw = std::fs::read_to_string(&p).unwrap();
        let two_lines: String = raw.lines().take(2).collect::<Vec<_>>().join("\n") + "\n";
        std::fs::write(&p, two_lines).unwrap();
        let anchor = RescueSnapshot {
            last_event_hash: Some(recs[2].event_hash.clone()),
            event_count: 3,
            last_bridge_state: None,
            updated_at_epoch_s: 0,
        };
        let (outcome, payload) = prepare_resync(&p, Some(&anchor));
        assert!(!outcome.accepted);
        assert!(payload.is_empty());
        assert!(outcome.reason.contains("anchor mismatch"));
    }
}
