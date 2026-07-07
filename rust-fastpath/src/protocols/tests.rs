use std::collections::HashMap;

use super::{
    registry::{default_policy_map, empty_stats_map, evaluate_protocol_request, manifests},
    template::TemplateProtocolPlugin,
    traits::ProtocolPlugin,
};
use crate::ProtocolEvaluateRequest;
use serde_json::json;

#[test]
fn registry_exposes_builtin_protocols() {
    let ids = manifests().into_iter().map(|manifest| manifest.id).collect::<Vec<_>>();
    assert!(ids.contains(&"http"));
    assert!(ids.contains(&"mqtt"));
    assert!(ids.contains(&"ros2_cyberrt"));
    assert!(ids.contains(&"canbus"));
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
fn mqtt_blocks_invalid_base64_payload_before_suppression() {
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "mqtt-invalid-base64-1".to_string(),
        protocol: "mqtt".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: Some("vehicle/heartbeat".to_string()),
        headers: None,
        metadata: Some(HashMap::from([
            ("suppressHighFrequency".to_string(), json!(true)),
            ("observedIntervalMs".to_string(), json!(100u64)),
            ("heartbeatMinIntervalMs".to_string(), json!(1000u64)),
        ])),
        payload_base64: Some("!!!not-base64!!!".to_string()),
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert_eq!(response.protocol, "mqtt");
    assert_eq!(response.verdict, "block");
    assert_eq!(response.action, "block");
    assert!(response
        .findings
        .iter()
        .any(|finding| finding.code == "mqtt_invalid_base64_payload"));
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

#[test]
fn canbus_blocks_unauthorized_diagnostic_frame() {
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "can-diag-1".to_string(),
        protocol: "canbus".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: None,
        headers: None,
        metadata: Some(HashMap::from([
            ("canId".to_string(), json!(0x7DF)),
            ("canDlc".to_string(), json!(8u64)),
        ])),
        payload_base64: None,
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert_eq!(response.protocol, "canbus");
    assert_eq!(response.verdict, "block");
    assert!(response.findings.iter().any(|f| f.code == "CAN_DIAGNOSTIC_FRAME"));
}

#[test]
fn canbus_allows_normal_frame() {
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "can-normal-1".to_string(),
        protocol: "canbus".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: None,
        headers: None,
        metadata: Some(HashMap::from([
            ("canId".to_string(), json!(0x123)),
            ("canDlc".to_string(), json!(4u64)),
        ])),
        payload_base64: None,
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert_eq!(response.verdict, "allow");
    assert!(response.findings.is_empty());
}

#[test]
fn canbus_policy_disabled_allows_diagnostic_frame() {
    // Operator policy enabled=false must skip all inspection, even for an
    // unauthorized diagnostic frame. Fail-closed default (enabled defaults true)
    // is covered by canbus_blocks_unauthorized_diagnostic_frame above.
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "can-disabled-1".to_string(),
        protocol: "canbus".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: None,
        headers: None,
        metadata: Some(HashMap::from([
            ("canId".to_string(), json!(0x7DF)),
            ("canDlc".to_string(), json!(8u64)),
            ("enabled".to_string(), json!(false)),
        ])),
        payload_base64: None,
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert_eq!(response.verdict, "allow");
    assert!(response.findings.iter().all(|f| f.code != "CAN_DIAGNOSTIC_FRAME"));
}

#[test]
fn canbus_block_diagnostic_false_allows_uds() {
    // blockDiagnosticFrames=false is the operator escape hatch for trusted UDS
    // traffic: a 0x7E0 physical-diagnostic frame must not be flagged.
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "can-uds-allow-1".to_string(),
        protocol: "canbus".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: None,
        headers: None,
        metadata: Some(HashMap::from([
            ("canId".to_string(), json!(0x7E0)),
            ("canDlc".to_string(), json!(8u64)),
            ("blockDiagnosticFrames".to_string(), json!(false)),
        ])),
        payload_base64: None,
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert!(response.findings.iter().all(|f| f.code != "CAN_DIAGNOSTIC_FRAME"));
    assert_ne!(response.verdict, "block");
}

#[test]
fn canbus_blocks_invalid_base64_payload() {
    // A non-empty payload that is not valid base64 must NOT be silently allowed.
    // Previously this set can_id/dlc to None, skipped every check, and emitted
    // verdict "allow" — contradicting the malformed-frame intent.
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "can-bad-b64-1".to_string(),
        protocol: "canbus".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: None,
        headers: None,
        metadata: None,
        payload_base64: Some("!!!not-base64!!!".to_string()),
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert!(response.findings.iter().any(|f| f.code == "CAN_MALFORMED_FRAME"));
    assert_eq!(response.verdict, "block");
}

#[test]
fn canbus_blocks_short_frame() {
    // A decoded payload shorter than the 4-byte CAN id is a malformed frame.
    let request = ProtocolEvaluateRequest {
        tenant_id: "global".to_string(),
        request_id: "can-short-1".to_string(),
        protocol: "canbus".to_string(),
        direction: None,
        source_ref: None,
        dest_ref: None,
        channel: None,
        headers: None,
        metadata: None,
        // base64 of 2 bytes — too short to carry a CAN id.
        payload_base64: Some("AAA=".to_string()),
        truncated: None,
        timestamp: None,
    };
    let response = evaluate_protocol_request(&request).expect("evaluation");
    assert!(response.findings.iter().any(|f| f.code == "CAN_MALFORMED_FRAME"));
    assert_eq!(response.verdict, "block");
}
