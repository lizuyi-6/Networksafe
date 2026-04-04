use serde_json::json;

use crate::{
    evaluate_http_traffic_request, metadata_string, HttpTrafficEvaluateRequest, ProtocolEvaluateRequest,
    ProtocolEvaluateResponse, ProtocolFinding, ProtocolCostMetrics,
};

use super::traits::ProtocolPlugin;

pub struct HttpProtocolPlugin;

impl ProtocolPlugin for HttpProtocolPlugin {
    fn id(&self) -> &'static str {
        "http"
    }

    fn display_name(&self) -> &'static str {
        "HTTP API Shield"
    }

    fn default_policy(&self) -> serde_json::Value {
        json!({})
    }

    fn empty_stats(&self) -> serde_json::Value {
        json!({
            "evaluations": 0,
            "findings": 0,
            "blockedRequests": 0
        })
    }

    fn validate(&self, _input: &ProtocolEvaluateRequest) -> Result<(), String> {
        Ok(())
    }

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
        let request = HttpTrafficEvaluateRequest {
            tenant_id: input.tenant_id.clone(),
            request_id: input.request_id.clone(),
            method: metadata_string(input.metadata.as_ref(), "method").unwrap_or_else(|| "GET".to_string()),
            url: input.channel.clone()
                .or_else(|| metadata_string(input.metadata.as_ref(), "url"))
                .unwrap_or_else(|| "/".to_string()),
            http_version: metadata_string(input.metadata.as_ref(), "httpVersion").unwrap_or_else(|| "HTTP/1.1".to_string()),
            headers: input.headers.clone().unwrap_or_default(),
            body_base64: input.payload_base64.clone().unwrap_or_default(),
            source_ip: metadata_string(input.metadata.as_ref(), "sourceIp"),
            truncated: input.truncated.unwrap_or(false),
        };

        let http_response = evaluate_http_traffic_request(&request)?;
        Ok(ProtocolEvaluateResponse {
            protocol: "http".to_string(),
            verdict: http_response.verdict.to_string(),
            action: if http_response.verdict == "block" {
                "block".to_string()
            } else {
                "inspect".to_string()
            },
            matched_rule: http_response.matched_rule,
            findings: http_response
                .threats
                .into_iter()
                .map(|threat| ProtocolFinding {
                    code: threat.kind,
                    severity: threat.severity,
                    message: threat.description,
                    metadata: None,
                })
                .collect(),
            decision_source: "rust-fastpath-protocol-http".to_string(),
            processing_time_micros: http_response.processing_time_micros,
            cost_metrics: ProtocolCostMetrics::default(),
        })
    }
}
