//! AetherGuard Rescue Control Plane (`ag-rescue`).
//!
//! Heterogeneous, low-dependency, fail-closed rescue path. See:
//! - `docs/adr/2026-07-08-heterogeneous-rescue-control-plane.md`
//! - `docs/adr/2026-07-08-rescue-release-policy.md` (NO release capability, by design)
//! - `docs/adr/2026-07-08-rescue-auth-storage-network.md`
//!
//! Invariants:
//! - Safe-side only: the only interlock command this crate can emit is
//!   `interlock_assert`. There is no code path that constructs a release frame.
//! - Fail-closed: missing config => LOCKED mode; unwritable audit log =>
//!   all action commands refused; unknown appliance state => reported as
//!   `unknown`, never inferred.
//! - Independent: no Node.js, Redis, JWT, primary DB or reverse proxy usage.

pub mod appliance;
pub mod audit;
pub mod auth;
pub mod config;
pub mod http;
pub mod primary;
pub mod resync;
pub mod runtime;
pub mod state;

/// Semantic version reported by `status` / `doctor`.
pub const RESCUE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Genesis previous-hash for the audit chain (64 zeros).
pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
