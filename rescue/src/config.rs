//! Minimal JSON config. Missing or invalid config => LOCKED mode (fail-closed).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// One allowlisted primary service and the exact argv used to restart it.
/// No shell interpolation ever happens: argv is passed verbatim to the OS.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrimaryService {
    pub name: String,
    /// Exact restart argv, e.g. ["systemctl", "restart", "aetherguard-backend"].
    pub restart_argv: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct RescueConfig {
    /// Data directory holding rescue-events.log / rescue-state.json / keyring.
    pub data_dir: String,
    /// HTTP listen address. Default (None) => "127.0.0.1:7801".
    #[serde(default)]
    pub listen_addr: Option<String>,
    /// Must be explicitly true to bind anything that is not loopback.
    #[serde(default)]
    pub allow_non_loopback: bool,
    /// Gateway Appliance newline-JSON endpoint (host:port). None => appliance status "unknown".
    #[serde(default)]
    pub appliance_endpoint: Option<String>,
    /// Primary control-plane health URL (e.g. http://127.0.0.1:3005/health).
    #[serde(default)]
    pub primary_health_url: Option<String>,
    /// Allowlisted primary services for restart-primary.
    #[serde(default)]
    pub primary_services: Vec<PrimaryService>,
    /// Primary audit ingest endpoint for resync. None => resync verifies + exports only.
    #[serde(default)]
    pub resync_endpoint: Option<String>,
}

#[derive(Debug)]
pub enum ConfigError {
    Missing(PathBuf),
    Unreadable(PathBuf, std::io::Error),
    Invalid(PathBuf, String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Missing(p) => write!(f, "config missing: {}", p.display()),
            ConfigError::Unreadable(p, e) => write!(f, "config unreadable: {}: {e}", p.display()),
            ConfigError::Invalid(p, e) => write!(f, "config invalid: {}: {e}", p.display()),
        }
    }
}

impl RescueConfig {
    /// Load config. Any failure is surfaced (caller enters LOCKED mode).
    pub fn load(path: &Path) -> Result<RescueConfig, ConfigError> {
        if !path.exists() {
            return Err(ConfigError::Missing(path.to_path_buf()));
        }
        let raw = std::fs::read_to_string(path)
            .map_err(|e| ConfigError::Unreadable(path.to_path_buf(), e))?;
        let cfg: RescueConfig = serde_json::from_str(&raw)
            .map_err(|e| ConfigError::Invalid(path.to_path_buf(), e.to_string()))?;
        if cfg.data_dir.trim().is_empty() {
            return Err(ConfigError::Invalid(
                path.to_path_buf(),
                "data_dir must be a non-empty path".to_string(),
            ));
        }
        Ok(cfg)
    }

    pub fn listen_addr(&self) -> &str {
        self.listen_addr.as_deref().unwrap_or("127.0.0.1:7801")
    }

    pub fn data_path(&self, file: &str) -> PathBuf {
        Path::new(&self.data_dir).join(file)
    }
}

/// Bind-address policy: loopback always allowed; non-loopback requires the
/// explicit flag; the unspecified addresses (0.0.0.0 / ::) are refused
/// unconditionally — writing them in config still refuses to serve HTTP.
pub fn validate_bind_addr(addr: &str, allow_non_loopback: bool) -> Result<(), String> {
    let host = addr.rsplit_once(':').map(|(h, _)| h).unwrap_or(addr);
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host == "0.0.0.0" || host == "::" || host.is_empty() {
        return Err(format!(
            "refusing to bind unspecified address '{host}': rescue plane must never listen on all interfaces"
        ));
    }
    let is_loopback = matches!(host, "127.0.0.1" | "::1" | "localhost");
    if !is_loopback && !allow_non_loopback {
        return Err(format!(
            "refusing non-loopback bind '{host}' without explicit allow_non_loopback=true"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_is_error_not_default() {
        let err = RescueConfig::load(Path::new("Z:/definitely/not/here/rescue.json"));
        assert!(matches!(err, Err(ConfigError::Missing(_))));
    }

    #[test]
    fn invalid_json_is_error() {
        let dir = std::env::temp_dir().join("ag-rescue-test-cfg-invalid");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("rescue.json");
        std::fs::write(&p, "{ not json").unwrap();
        assert!(matches!(RescueConfig::load(&p), Err(ConfigError::Invalid(_, _))));
    }

    #[test]
    fn unknown_fields_are_rejected() {
        let dir = std::env::temp_dir().join("ag-rescue-test-cfg-unknown");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("rescue.json");
        std::fs::write(&p, r#"{"data_dir":"d","enable_release":true}"#).unwrap();
        // A typo'd or hostile config key must not be silently ignored.
        assert!(matches!(RescueConfig::load(&p), Err(ConfigError::Invalid(_, _))));
    }

    #[test]
    fn bind_policy_refuses_wildcard_even_when_allowed() {
        assert!(validate_bind_addr("0.0.0.0:7801", true).is_err());
        assert!(validate_bind_addr("[::]:7801", true).is_err());
    }

    #[test]
    fn bind_policy_refuses_non_loopback_by_default() {
        assert!(validate_bind_addr("192.168.1.10:7801", false).is_err());
        assert!(validate_bind_addr("192.168.1.10:7801", true).is_ok());
        assert!(validate_bind_addr("127.0.0.1:7801", false).is_ok());
    }
}
