use serde_json::json;

use crate::protocols::traits::ProtocolPlugin;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

use crate::{
    metadata_u64, ProtocolCostMetrics, ProtocolEvaluateRequest, ProtocolEvaluateResponse, ProtocolFinding,
};

/// CAN-bus protocol plugin. Inspects a decoded CAN frame (id + up to 8 data
/// bytes, or 64 for CAN-FD) for industrial-vehicle abuse signals. Detects
/// unauthorized diagnostic frame access (0x7DF / 0x7E0-0x7E7) and oversize
/// payloads (classic CAN > 8 bytes). The frame is supplied as base64 of raw
/// bytes (id BE then data) or via metadata fields { canId, canDlc }.
pub struct CanbusModuleProtocolPlugin;

// Read a policy boolean from request metadata with an explicit default. The
// crate's `metadata_bool` helper defaults missing keys to false, but CAN-bus
// policy defaults are fail-closed (inspection ON, diagnostic blocking ON), so
// we resolve those here with default = true.
fn policy_bool_or(
    metadata: Option<&std::collections::HashMap<String, serde_json::Value>>,
    key: &str,
    default: bool,
) -> bool {
    metadata
        .and_then(|map| map.get(key))
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

impl ProtocolPlugin for CanbusModuleProtocolPlugin {
    fn id(&self) -> &'static str {
        "canbus"
    }

    fn display_name(&self) -> &'static str {
        "CAN-bus"
    }

    fn default_policy(&self) -> serde_json::Value {
        // Advertised policy MUST match evaluate()'s defaults. evaluate() defaults
        // fail-closed: inspection ON (enabled: true) and diagnostic-frame blocking
        // ON (blockDiagnosticFrames: true) unless an operator overrides them via
        // request metadata. Advertising enabled:false here while executing with
        // enabled:true would mislead operators who read /v1/protocols/policies
        // into believing CAN inspection is off when it is not.
        json!({ "enabled": true, "blockDiagnosticFrames": true })
    }

    fn empty_stats(&self) -> serde_json::Value {
        json!({ "evaluations": 0, "findings": 0, "blockedDiagnostic": 0 })
    }

    fn validate(&self, input: &ProtocolEvaluateRequest) -> Result<(), String> {
        if input.request_id.trim().is_empty() {
            return Err("requestId is required".to_string());
        }
        Ok(())
    }

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
        // Honor operator policy from request metadata, defaulting fail-closed:
        // inspection is ON and diagnostic-frame blocking is ON unless explicitly
        // disabled. `enabled: false` skips all inspection; `blockDiagnosticFrames:
        // false` permits legitimate UDS diagnostic traffic while oversize/malformed
        // frames are still caught.
        if !policy_bool_or(input.metadata.as_ref(), "enabled", true) {
            return Ok(ProtocolEvaluateResponse {
                protocol: "canbus".to_string(),
                verdict: "allow".to_string(),
                action: "inspect".to_string(),
                matched_rule: None,
                findings: Vec::new(),
                decision_source: "rust-fastpath-protocol-canbus".to_string(),
                processing_time_micros: 0,
                cost_metrics: ProtocolCostMetrics::default(),
            });
        }
        let block_diagnostic = policy_bool_or(input.metadata.as_ref(), "blockDiagnosticFrames", true);

        let mut findings: Vec<ProtocolFinding> = Vec::new();

        // Decode the base64 payload once. An empty payload with no metadata is a
        // normal "no frame" probe (allow). But a non-empty payload that fails to
        // base64-decode, or decodes to fewer than the 4 bytes needed for a CAN id,
        // is a malformed/injection frame — fail-closed (block) rather than silently
        // allowed. Previously such frames set can_id/dlc to None and skipped every
        // check, emitting verdict "allow" — contradicting the malformed-frame intent.
        let raw_payload = input.payload_base64.as_deref().unwrap_or("");
        let decoded: Option<Vec<u8>> = if raw_payload.trim().is_empty() {
            None
        } else {
            match BASE64_STANDARD.decode(raw_payload) {
                Ok(b) => Some(b),
                Err(_) => {
                    findings.push(ProtocolFinding {
                        code: "CAN_MALFORMED_FRAME".to_string(),
                        severity: "high".to_string(),
                        message: "CAN payload is not valid base64".to_string(),
                        metadata: None,
                    });
                    None
                }
            }
        };
        let short_frame = decoded.as_ref().is_some_and(|b| b.len() < 4);
        if short_frame {
            findings.push(ProtocolFinding {
                code: "CAN_MALFORMED_FRAME".to_string(),
                severity: "high".to_string(),
                message: format!(
                    "CAN frame is {} bytes; a valid frame needs at least the 4-byte id",
                    decoded.as_ref().map_or(0, |b| b.len())
                ),
                metadata: Some(json!({ "decodedBytes": decoded.as_ref().map_or(0, |b| b.len()) })),
            });
        }

        // Resolve the CAN identifier. Prefer explicit metadata, else the decoded
        // payload's first 4 bytes as a big-endian CAN id (only when fully decoded).
        let can_id = metadata_u64(input.metadata.as_ref(), "canId").or_else(|| {
            decoded.as_ref().and_then(|bytes| {
                if bytes.len() >= 4 {
                    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as u64)
                } else {
                    None
                }
            })
        });

        let dlc = metadata_u64(input.metadata.as_ref(), "canDlc").or_else(|| {
            decoded.as_ref().map(|bytes| bytes.len().saturating_sub(4) as u64)
        });

        if let (Some(id), Some(dlc)) = (can_id, dlc) {
            // Unauthorized diagnostic access: functional (0x7DF) or physical (0x7E0-0x7E7) UDS.
            // Gated on the blockDiagnosticFrames policy so a trusted diagnostic
            // tool can be allow-listed while oversize/malformed checks still fire.
            let is_diagnostic = id == 0x7DF || (0x7E0..=0x7E7).contains(&id);
            if block_diagnostic && is_diagnostic {
                findings.push(ProtocolFinding {
                    code: "CAN_DIAGNOSTIC_FRAME".to_string(),
                    severity: "high".to_string(),
                    message: format!("Unauthorized CAN diagnostic frame 0x{:04X} access", id),
                    metadata: Some(json!({ "canId": format!("0x{:04X}", id) })),
                });
            }
            // Classic CAN frames carry at most 8 data bytes; more is malformed/injection.
            if dlc > 8 {
                findings.push(ProtocolFinding {
                    code: "CAN_OVERSIZE_PAYLOAD".to_string(),
                    severity: "medium".to_string(),
                    message: format!("CAN payload {} bytes exceeds the 8-byte classic limit", dlc),
                    metadata: Some(json!({ "canDlc": dlc })),
                });
            }
        }

        let verdict = if findings.iter().any(|f| f.severity == "high" || f.severity == "critical") {
            "block"
        } else if findings.is_empty() {
            "allow"
        } else {
            "monitor"
        };

        Ok(ProtocolEvaluateResponse {
            protocol: "canbus".to_string(),
            verdict: verdict.to_string(),
            action: if verdict == "block" { "block".to_string() } else { "inspect".to_string() },
            matched_rule: None,
            findings,
            decision_source: "rust-fastpath-protocol-canbus".to_string(),
            processing_time_micros: 0,
            cost_metrics: ProtocolCostMetrics::default(),
        })
    }
}