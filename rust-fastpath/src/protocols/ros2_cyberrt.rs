use serde_json::json;

use crate::{
    metadata_string, metadata_string_list, ProtocolCostMetrics, ProtocolEvaluateRequest,
    ProtocolEvaluateResponse, ProtocolFinding,
};

use super::traits::ProtocolPlugin;

pub struct Ros2CyberRtProtocolPlugin;

impl ProtocolPlugin for Ros2CyberRtProtocolPlugin {
    fn id(&self) -> &'static str {
        "ros2_cyberrt"
    }

    fn display_name(&self) -> &'static str {
        "ROS2 / Cyber RT Observer"
    }

    fn default_policy(&self) -> serde_json::Value {
        json!({
            "observerEnabled": false,
            "allowlist": []
        })
    }

    fn empty_stats(&self) -> serde_json::Value {
        json!({
            "evaluations": 0,
            "findings": 0,
            "unauthorizedRpcFindings": 0
        })
    }

    fn validate(&self, _input: &ProtocolEvaluateRequest) -> Result<(), String> {
        Ok(())
    }

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
        let service = metadata_string(input.metadata.as_ref(), "service")
            .or_else(|| metadata_string(input.metadata.as_ref(), "rpc"))
            .or_else(|| input.channel.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let allowlist = metadata_string_list(input.metadata.as_ref(), "allowlist");
        let unauthorized = !allowlist.is_empty() && !allowlist.iter().any(|item| item == &service);

        Ok(ProtocolEvaluateResponse {
            protocol: "ros2_cyberrt".to_string(),
            verdict: if unauthorized {
                "monitor".to_string()
            } else {
                "allow".to_string()
            },
            action: "inspect".to_string(),
            matched_rule: if unauthorized {
                Some("fast_path:unauthorized_vehicle_rpc".to_string())
            } else {
                None
            },
            findings: if unauthorized {
                vec![ProtocolFinding {
                    code: "unauthorized_vehicle_rpc".to_string(),
                    severity: "high".to_string(),
                    message: format!("Observed RPC `{}` outside the configured allowlist.", service),
                    metadata: None,
                }]
            } else {
                Vec::new()
            },
            decision_source: "rust-fastpath-protocol-ros2-cyberrt".to_string(),
            processing_time_micros: 0,
            cost_metrics: ProtocolCostMetrics::default(),
        })
    }
}
