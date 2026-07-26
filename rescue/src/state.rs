//! `rescue-state.json`: last-known snapshot + audit-chain anchor.
//! Written atomically (temp file + rename). A corrupt snapshot is discarded
//! and the plane degrades to read-only reporting — never guessed state.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct RescueSnapshot {
    /// Anchor: hash of the last audit event. Used to detect log truncation
    /// (a truncated log is a valid-looking prefix; the anchor breaks that).
    #[serde(default)]
    pub last_event_hash: Option<String>,
    #[serde(default)]
    pub event_count: u64,
    /// Last observed appliance bridge state ("isolated"/"released"/"armed"/"unknown").
    #[serde(default)]
    pub last_bridge_state: Option<String>,
    #[serde(default)]
    pub updated_at_epoch_s: u64,
}

#[derive(Debug)]
pub enum SnapshotLoad {
    /// File absent: fresh install, empty snapshot is legitimate.
    Fresh(RescueSnapshot),
    Ok(RescueSnapshot),
    /// Present but unreadable/corrupt: caller must degrade to read-only.
    Corrupt(String),
}

pub fn load_snapshot(path: &Path) -> SnapshotLoad {
    if !path.exists() {
        return SnapshotLoad::Fresh(RescueSnapshot::default());
    }
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<RescueSnapshot>(&raw) {
            Ok(s) => SnapshotLoad::Ok(s),
            Err(e) => SnapshotLoad::Corrupt(format!("snapshot parse failed: {e}")),
        },
        Err(e) => SnapshotLoad::Corrupt(format!("snapshot read failed: {e}")),
    }
}

/// Atomic write: serialize to `<path>.tmp`, fsync, rename over target.
pub fn store_snapshot(path: &Path, snap: &RescueSnapshot) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(snap).map_err(std::io::Error::other)?;
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(body.as_bytes())?;
        f.sync_all()?;
    }
    // On Windows, rename fails if the target exists; remove-then-rename is the
    // accepted pattern (worst case the previous snapshot is lost for one cycle,
    // which degrades to Fresh — a conservative outcome, not a fail-open one).
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(&tmp, path)
}

pub fn epoch_s() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ag-rescue-state-{tag}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn roundtrip_snapshot() {
        let p = tmp_dir("rt").join("rescue-state.json");
        let snap = RescueSnapshot {
            last_event_hash: Some("abc".into()),
            event_count: 3,
            last_bridge_state: Some("isolated".into()),
            updated_at_epoch_s: 42,
        };
        store_snapshot(&p, &snap).unwrap();
        match load_snapshot(&p) {
            SnapshotLoad::Ok(s) => assert_eq!(s, snap),
            other => panic!("expected Ok, got {other:?}"),
        }
    }

    #[test]
    fn corrupt_snapshot_is_reported_not_defaulted() {
        let p = tmp_dir("corrupt").join("rescue-state.json");
        std::fs::write(&p, "{{{").unwrap();
        assert!(matches!(load_snapshot(&p), SnapshotLoad::Corrupt(_)));
    }

    #[test]
    fn absent_snapshot_is_fresh() {
        let p = tmp_dir("fresh").join("nope.json");
        let _ = std::fs::remove_file(&p);
        assert!(matches!(load_snapshot(&p), SnapshotLoad::Fresh(_)));
    }
}
