use super::{
    registry::{default_policy_map, empty_stats_map, evaluate_protocol_request, manifests},
    template::TemplateProtocolPlugin,
    traits::ProtocolPlugin,
};
use crate::ProtocolEvaluateRequest;

#[test]
fn registry_exposes_builtin_protocols() {
    let ids = manifests().into_iter().map(|manifest| manifest.id).collect::<Vec<_>>();
    assert!(ids.contains(&"http"));
    assert!(ids.contains(&"mqtt"));
    assert!(ids.contains(&"ros2_cyberrt"));
}

#[test]
fn registry_default_policy_and_stats_maps_include_mqtt() {
    let policies = default_policy_map();
    let stats = empty_stats_map();
    assert!(policies.contains_key("mqtt"));
    assert!(stats.contains_key("mqtt"));
}

#[test]
fn fixture_based_mqtt_request_suppresses_heartbeat() {
    let request: ProtocolEvaluateRequest = serde_json::from_str(include_str!("../../tests/fixtures/mqtt-heartbeat.json"))
        .expect("fixture json");
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert_eq!(response.protocol, "mqtt");
    assert_eq!(response.action, "suppress");
}

#[test]
fn template_plugin_compiles_and_validates() {
    let plugin = TemplateProtocolPlugin;
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "template-1".to_string(),
        protocol: "template_protocol".to_string(),
        direction: Some("internal".to_string()),
        source_ref: Some("agent-1".to_string()),
        dest_ref: None,
        channel: Some("template/channel".to_string()),
        headers: None,
        metadata: None,
        payload_base64: None,
        truncated: Some(false),
        timestamp: None,
    };
    plugin.validate(&request).expect("validate");
    let response = plugin.evaluate(&request).expect("evaluate");
    assert_eq!(response.action, "inspect");
}
