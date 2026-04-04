use serde_json::json;

use crate::{ProtocolCostMetrics, ProtocolEvaluateRequest, ProtocolEvaluateResponse};
use crate::protocols::traits::ProtocolPlugin;

pub struct CanbusModuleProtocolPlugin;

impl ProtocolPlugin for CanbusModuleProtocolPlugin {
    fn id(&self) -> &'static str {
        "canbus"
    }

    fn display_name(&self) -> &'static str {
        "Canbus"
    }

    fn default_policy(&self) -> serde_json::Value {
        json!({ "enabled": false })
    }

    fn empty_stats(&self) -> serde_json::Value {
        json!({ "evaluations": 0, "findings": 0 })
    }

    fn validate(&self, _input: &ProtocolEvaluateRequest) -> Result<(), String> {
        Ok(())
    }

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
        Ok(ProtocolEvaluateResponse {
            protocol: input.protocol.clone(),
            verdict: "allow".to_string(),
            action: "inspect".to_string(),
            matched_rule: None,
            findings: Vec::new(),
            decision_source: "rust-fastpath-generated-template".to_string(),
            processing_time_micros: 0,
            cost_metrics: ProtocolCostMetrics::default(),
        })
    }
}
