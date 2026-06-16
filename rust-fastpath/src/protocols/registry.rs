use std::{collections::HashMap, time::Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::{
    HttpTrafficEvaluateRequest, HttpTrafficEvaluateResponse, HttpTrafficThreat, ProtocolEvaluateRequest,
    ProtocolEvaluateResponse,
};

use super::{
    generated::canbus::CanbusModuleProtocolPlugin,
    http::HttpProtocolPlugin,
    mqtt::MqttProtocolPlugin,
    ros2_cyberrt::Ros2CyberRtProtocolPlugin,
    traits::{ProtocolPlugin, ProtocolPluginManifest},
};

static PLUGINS: Lazy<Vec<Box<dyn ProtocolPlugin>>> = Lazy::new(|| {
    vec![
        Box::new(HttpProtocolPlugin),
        Box::new(MqttProtocolPlugin),
        Box::new(Ros2CyberRtProtocolPlugin),
        Box::new(CanbusModuleProtocolPlugin),
    ]
});

fn plugin_for(protocol: &str) -> Option<&'static dyn ProtocolPlugin> {
    let normalized = protocol.trim().to_lowercase();
    PLUGINS
        .iter()
        .find(|plugin| plugin.id() == normalized)
        .map(|plugin| plugin.as_ref())
}

pub fn manifests() -> Vec<ProtocolPluginManifest> {
    PLUGINS.iter().map(|plugin| plugin.manifest()).collect()
}

pub fn empty_stats_map() -> HashMap<String, Value> {
    PLUGINS
        .iter()
        .map(|plugin| (plugin.id().to_string(), plugin.empty_stats()))
        .collect()
}

pub fn default_policy_map() -> HashMap<String, Value> {
    PLUGINS
        .iter()
        .map(|plugin| (plugin.id().to_string(), plugin.default_policy()))
        .collect()
}

pub fn evaluate_protocol_request(input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {
    let started_at = Instant::now();
    let plugin = plugin_for(&input.protocol).ok_or_else(|| format!("unsupported protocol: {}", input.protocol))?;
    plugin.validate(input)?;
    let mut response = plugin.evaluate(input)?;
    response.processing_time_micros = started_at.elapsed().as_micros() as u64;
    Ok(response)
}

#[allow(dead_code)]
pub fn evaluate_http_compat_request(input: &HttpTrafficEvaluateRequest) -> Result<HttpTrafficEvaluateResponse, String> {
    let metadata = HashMap::from([
        ("method".to_string(), json!(input.method)),
        ("url".to_string(), json!(input.url)),
        ("httpVersion".to_string(), json!(input.http_version)),
        ("sourceIp".to_string(), json!(input.source_ip.clone().unwrap_or_default())),
    ]);

    let protocol_request = ProtocolEvaluateRequest {
        tenant_id: input.tenant_id.clone(),
        request_id: input.request_id.clone(),
        protocol: "http".to_string(),
        direction: Some("ingress".to_string()),
        source_ref: input.source_ip.clone(),
        dest_ref: None,
        channel: Some(input.url.clone()),
        headers: Some(input.headers.clone()),
        metadata: Some(metadata),
        payload_base64: Some(input.body_base64.clone()),
        truncated: Some(input.truncated),
        timestamp: None,
    };

    let protocol_response = evaluate_protocol_request(&protocol_request)?;
    Ok(HttpTrafficEvaluateResponse {
        protocol: "http",
        verdict: if protocol_response.verdict == "block" { "block" } else { "allow" },
        matched_rule: protocol_response.matched_rule,
        threats: protocol_response
            .findings
            .into_iter()
            .map(|finding| HttpTrafficThreat {
                kind: finding.code,
                severity: finding.severity,
                description: finding.message,
            })
            .collect(),
        truncated: input.truncated,
        decision_source: "rust-fastpath-traffic-http",
        processing_time_micros: protocol_response.processing_time_micros,
    })
}
