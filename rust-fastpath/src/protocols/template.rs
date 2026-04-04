use serde_json::json;

use crate::{ProtocolCostMetrics, ProtocolEvaluateRequest, ProtocolEvaluateResponse};

use super::traits::ProtocolPlugin;

pub struct TemplateProtocolPlugin;

impl ProtocolPlugin for TemplateProtocolPlugin {
    fn id(&self) -> &'static str {
        "template_protocol"
    }

    fn display_name(&self) -> &'static str {
        "Template Protocol Plugin"
    }

    fn default_policy(&self) -> serde_json::Value {
        json!({
            "enabled": false,
            "allowlist": []
        })
    }

    fn empty_stats(&self) -> serde_json::Value {
        json!({
            "evaluations": 0,
            "findings": 0
        })
    }

    fn validate(&self, input: &ProtocolEvaluateRequest) -> Result<(), String> {
        if input.request_id.trim().is_empty() {
            return Err("requestId is required".to_string());
        }
        Ok(())
    }

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
        Ok(ProtocolEvaluateResponse {
            protocol: input.protocol.clone(),
            verdict: "allow".to_string(),
            action: "inspect".to_string(),
            matched_rule: None,
            findings: Vec::new(),
            decision_source: "rust-fastpath-template".to_string(),
            processing_time_micros: 0,
            cost_metrics: ProtocolCostMetrics::default(),
        })
    }
}
