use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde_json::json;

use crate::{
    metadata_bool, metadata_string_list, metadata_u64, ProtocolCostMetrics, ProtocolEvaluateRequest,
    ProtocolEvaluateResponse, ProtocolFinding,
};

use super::traits::ProtocolPlugin;

pub struct MqttProtocolPlugin;

impl ProtocolPlugin for MqttProtocolPlugin {
    fn id(&self) -> &'static str {
        "mqtt"
    }

    fn display_name(&self) -> &'static str {
        "MQTT Relay Governance"
    }

    fn default_policy(&self) -> serde_json::Value {
        json!({
            "relayEnabled": false,
            "suppressHighFrequency": false,
            "heartbeatTopics": ["heartbeat", "keepalive", "telemetry/heartbeat", "vehicle/heartbeat"],
            "heartbeatMinIntervalMs": 1000
        })
    }

    fn empty_stats(&self) -> serde_json::Value {
        json!({
            "evaluations": 0,
            "findings": 0,
            "suppressedMessages": 0,
            "savedBytes": 0
        })
    }

    fn validate(&self, input: &ProtocolEvaluateRequest) -> Result<(), String> {
        if input.channel.as_deref().unwrap_or("").trim().is_empty() {
            return Err("mqtt channel is required".to_string());
        }
        Ok(())
    }

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
        let topic = input.channel.clone().unwrap_or_default();
        let topic_lower = topic.to_lowercase();
        let interval_ms = metadata_u64(input.metadata.as_ref(), "observedIntervalMs")
            .or_else(|| metadata_u64(input.metadata.as_ref(), "intervalMs"))
            .unwrap_or(0);
        let heartbeat_min_interval_ms = metadata_u64(input.metadata.as_ref(), "heartbeatMinIntervalMs").unwrap_or(1000);
        let configured_heartbeat_topics = metadata_string_list(input.metadata.as_ref(), "heartbeatTopics");
        let heartbeat_topics = if configured_heartbeat_topics.is_empty() {
            vec![
                "heartbeat".to_string(),
                "keepalive".to_string(),
                "telemetry/heartbeat".to_string(),
                "vehicle/heartbeat".to_string(),
            ]
        } else {
            configured_heartbeat_topics
        };
        let suppress_high_frequency = metadata_bool(input.metadata.as_ref(), "suppressHighFrequency");
        let is_heartbeat = heartbeat_topics.iter().any(|pattern| topic_lower.contains(&pattern.to_lowercase()));
        let payload_bytes = input
            .payload_base64
            .as_deref()
            .and_then(|body| BASE64_STANDARD.decode(body.as_bytes()).ok())
            .map(|body| body.len() as u64)
            .unwrap_or(0);

        if metadata_bool(input.metadata.as_ref(), "block") {
            return Ok(ProtocolEvaluateResponse {
                protocol: "mqtt".to_string(),
                verdict: "block".to_string(),
                action: "block".to_string(),
                matched_rule: Some("fast_path:mqtt_blocked_topic".to_string()),
                findings: vec![ProtocolFinding {
                    code: "mqtt_policy_block".to_string(),
                    severity: "high".to_string(),
                    message: "MQTT topic matched a block policy.".to_string(),
                    metadata: None,
                }],
                decision_source: "rust-fastpath-protocol-mqtt".to_string(),
                processing_time_micros: 0,
                cost_metrics: ProtocolCostMetrics::default(),
            });
        }

        if suppress_high_frequency && is_heartbeat && interval_ms > 0 && interval_ms < heartbeat_min_interval_ms {
            return Ok(ProtocolEvaluateResponse {
                protocol: "mqtt".to_string(),
                verdict: "allow".to_string(),
                action: "suppress".to_string(),
                matched_rule: Some("fast_path:mqtt_high_frequency_heartbeat".to_string()),
                findings: vec![ProtocolFinding {
                    code: "mqtt_high_frequency_heartbeat".to_string(),
                    severity: "low".to_string(),
                    message: "High-frequency heartbeat suppressed at the edge relay.".to_string(),
                    metadata: None,
                }],
                decision_source: "rust-fastpath-protocol-mqtt".to_string(),
                processing_time_micros: 0,
                cost_metrics: ProtocolCostMetrics {
                    saved_bytes: payload_bytes + topic.len() as u64,
                    suppressed_messages: 1,
                },
            });
        }

        Ok(ProtocolEvaluateResponse {
            protocol: "mqtt".to_string(),
            verdict: "allow".to_string(),
            action: "forward".to_string(),
            matched_rule: None,
            findings: Vec::new(),
            decision_source: "rust-fastpath-protocol-mqtt".to_string(),
            processing_time_micros: 0,
            cost_metrics: ProtocolCostMetrics::default(),
        })
    }
}
