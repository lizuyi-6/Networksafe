//! Offline HMAC-SHA256 challenge-response auth.
//!
//! - Key: 256-bit hex in `rescue-keyring/rescue-auth.key`, provisioned once.
//!   No derivation from any primary-system secret (JWT_SECRET etc.).
//! - Challenge: random nonce, single-use, 60s expiry.
//! - Verify: constant-time compare (`subtle`). Missing key file => `Locked`,
//!   every action is refused (fail-closed); read-only status is unaffected.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

pub const CHALLENGE_TTL: Duration = Duration::from_secs(60);
const KEY_LEN_BYTES: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub enum AuthState {
    Ready,
    /// Key missing/unreadable/malformed — actions refused.
    Locked(String),
}

pub struct Authenticator {
    key: Option<Vec<u8>>,
    locked_reason: Option<String>,
    pending: HashMap<String, Instant>,
}

impl Authenticator {
    pub fn from_key_file(path: &Path) -> Authenticator {
        let load = || -> Result<Vec<u8>, String> {
            let raw = std::fs::read_to_string(path)
                .map_err(|e| format!("auth key unreadable: {}: {e}", path.display()))?;
            let key = hex::decode(raw.trim())
                .map_err(|e| format!("auth key is not valid hex: {e}"))?;
            if key.len() != KEY_LEN_BYTES {
                return Err(format!(
                    "auth key must be {KEY_LEN_BYTES} bytes, got {}",
                    key.len()
                ));
            }
            Ok(key)
        };
        match load() {
            Ok(key) => Authenticator {
                key: Some(key),
                locked_reason: None,
                pending: HashMap::new(),
            },
            Err(reason) => Authenticator {
                key: None,
                locked_reason: Some(reason),
                pending: HashMap::new(),
            },
        }
    }

    pub fn state(&self) -> AuthState {
        match &self.locked_reason {
            None => AuthState::Ready,
            Some(r) => AuthState::Locked(r.clone()),
        }
    }

    /// Issue a single-use challenge nonce (hex). Locked => None.
    pub fn issue_challenge(&mut self) -> Option<String> {
        self.key.as_ref()?;
        self.sweep_expired();
        let nonce = hex::encode(random_bytes());
        self.pending.insert(nonce.clone(), Instant::now());
        Some(nonce)
    }

    /// Verify `mac_hex == HMAC-SHA256(key, nonce)`. The nonce is consumed on
    /// ANY verification attempt (success or failure) — replay never succeeds.
    pub fn verify(&mut self, nonce: &str, mac_hex: &str) -> Result<(), &'static str> {
        let key = match &self.key {
            Some(k) => k,
            None => return Err("auth_locked"),
        };
        let issued = match self.pending.remove(nonce) {
            Some(t) => t,
            None => return Err("unknown_or_used_challenge"),
        };
        if issued.elapsed() > CHALLENGE_TTL {
            return Err("challenge_expired");
        }
        let presented = match hex::decode(mac_hex.trim()) {
            Ok(m) => m,
            Err(_) => return Err("malformed_mac"),
        };
        let mut mac = HmacSha256::new_from_slice(key).expect("hmac accepts 32-byte key");
        mac.update(nonce.as_bytes());
        let expected = mac.finalize().into_bytes();
        if presented.len() != expected.len() {
            return Err("auth_failed");
        }
        if bool::from(presented.as_slice().ct_eq(expected.as_slice())) {
            Ok(())
        } else {
            Err("auth_failed")
        }
    }

    fn sweep_expired(&mut self) {
        self.pending.retain(|_, t| t.elapsed() <= CHALLENGE_TTL);
    }
}

/// Compute the client-side response for a nonce (used by the CLI and tests).
pub fn respond(key_hex: &str, nonce: &str) -> Result<String, String> {
    let key = hex::decode(key_hex.trim()).map_err(|e| format!("bad key hex: {e}"))?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|e| format!("bad key: {e}"))?;
    mac.update(nonce.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

/// Provision a fresh 256-bit key file. Refuses to overwrite an existing key.
pub fn provision_key(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!(
            "refusing to overwrite existing key at {}",
            path.display()
        ));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let key_hex = hex::encode(random_bytes());
    std::fs::write(path, &key_hex).map_err(|e| e.to_string())?;
    restrict_permissions(path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {
    // Windows ACL tightening is handled by the installer (runbook step);
    // the key directory itself must not be world-readable.
}

/// 32 bytes straight from the OS CSPRNG (BCryptGenRandom / getrandom(2)).
fn random_bytes() -> [u8; 32] {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("OS CSPRNG unavailable — cannot provision or challenge");
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_file(tag: &str, contents: Option<&str>) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ag-rescue-auth-{tag}"));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("rescue-auth.key");
        let _ = std::fs::remove_file(&p);
        if let Some(c) = contents {
            std::fs::write(&p, c).unwrap();
        }
        p
    }

    const KEY: &str = "3f2a9b1c4d5e6f708192a3b4c5d6e7f80112233445566778899aabbccddeeff0";

    #[test]
    fn valid_response_is_accepted_once_only() {
        let p = key_file("ok", Some(KEY));
        let mut auth = Authenticator::from_key_file(&p);
        assert_eq!(auth.state(), AuthState::Ready);
        let nonce = auth.issue_challenge().unwrap();
        let mac = respond(KEY, &nonce).unwrap();
        assert_eq!(auth.verify(&nonce, &mac), Ok(()));
        // Replay with the same nonce+mac must fail.
        assert_eq!(auth.verify(&nonce, &mac), Err("unknown_or_used_challenge"));
    }

    #[test]
    fn wrong_mac_is_denied_and_consumes_nonce() {
        let p = key_file("wrong", Some(KEY));
        let mut auth = Authenticator::from_key_file(&p);
        let nonce = auth.issue_challenge().unwrap();
        let bad = "00".repeat(32);
        assert_eq!(auth.verify(&nonce, &bad), Err("auth_failed"));
        let mac = respond(KEY, &nonce).unwrap();
        assert_eq!(auth.verify(&nonce, &mac), Err("unknown_or_used_challenge"));
    }

    #[test]
    fn missing_key_locks_auth() {
        let p = key_file("missing", None);
        let mut auth = Authenticator::from_key_file(&p);
        assert!(matches!(auth.state(), AuthState::Locked(_)));
        assert!(auth.issue_challenge().is_none());
        assert_eq!(auth.verify("n", "m"), Err("auth_locked"));
    }

    #[test]
    fn malformed_key_locks_auth() {
        let p = key_file("malformed", Some("not-hex"));
        let auth = Authenticator::from_key_file(&p);
        assert!(matches!(auth.state(), AuthState::Locked(_)));
    }

    #[test]
    fn short_key_locks_auth() {
        let p = key_file("short", Some("aabbcc"));
        let auth = Authenticator::from_key_file(&p);
        assert!(matches!(auth.state(), AuthState::Locked(_)));
    }

    #[test]
    fn provision_refuses_overwrite() {
        let p = key_file("prov", Some(KEY));
        assert!(provision_key(&p).is_err());
        let fresh = key_file("prov-fresh", None);
        assert!(provision_key(&fresh).is_ok());
        let written = std::fs::read_to_string(&fresh).unwrap();
        assert_eq!(hex::decode(written.trim()).unwrap().len(), 32);
    }
}
