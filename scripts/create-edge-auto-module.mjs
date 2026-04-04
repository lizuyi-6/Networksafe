#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const args = process.argv.slice(2);

function readArg(flag, fallback = '') {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() : fallback;
}

function sanitizeModuleId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, '_')
    .replace(/-+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toTitle(value) {
  return value
    .split(/[_/-]+/)
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

function writeIfMissing(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    return { target, created: false };
  }
  fs.writeFileSync(target, content, 'utf8');
  return { target, created: true };
}

const kind = readArg('--kind', 'protocol');
const rawModuleId = sanitizeModuleId(readArg('--module', readArg('--name', '')));

if (!['protocol', 'node_capability', 'device_command_pack'].includes(kind)) {
  console.error(`Unsupported kind: ${kind}`);
  process.exit(1);
}

if (!rawModuleId) {
  console.error('Usage: node scripts/create-edge-auto-module.mjs --kind <protocol|node_capability|device_command_pack> --module <module_id> [--display-name "My Module"]');
  process.exit(1);
}

const displayName = readArg('--display-name', toTitle(rawModuleId));
const className = `${displayName.replace(/[^A-Za-z0-9]+/g, '')}Module`;
const protocolName = kind === 'protocol' ? rawModuleId : 'template_protocol';

const outputs = [];

outputs.push(writeIfMissing(
  path.join(root, 'docs', 'edge-auto', 'modules', `${kind}-${rawModuleId}.md`),
  `# ${displayName}\n\n- kind: \`${kind}\`\n- moduleId: \`${rawModuleId}\`\n- status: scaffold_only\n\n## Registration Points\n\n- Backend registry: \`backend/src/services/protocol-module-registry.service.ts\`\n- Agent adapter registry: \`backend/src/agent/agent.ts\`\n- Rust plugin registry: \`rust-fastpath/src/protocols/registry.rs\`\n- Frontend manifest source: \`GET /api/edge-auto/modules\` and demo fixture in \`frontend/src/services/demo-data.ts\`\n\n## Next Steps\n\n1. Fill the runtime adapter or evaluator stub.\n2. Register the manifest and adapter in the three runtime registries above.\n3. Add fixtures and tests without changing the shared aggregation flow.\n`
));

outputs.push(writeIfMissing(
  path.join(root, 'examples', 'edge-auto', `${kind}-${rawModuleId}.json`),
  JSON.stringify({
    kind,
    moduleId: rawModuleId,
    version: '1.0.0',
    displayName,
    defaultEnabled: false,
    supportedNodeKinds: ['edge', 'vehicle'],
    supportedArchitectures: ['x86_64', 'aarch64', 'unknown'],
    policySchema: {},
    statsSchema: {},
    uiSections: ['platform_settings', 'agent_detail', 'dashboard'],
    capabilities: ['template']
  }, null, 2) + '\n'
));

outputs.push(writeIfMissing(
  path.join(root, 'backend', 'src', 'modules', 'edge-auto', 'generated', kind, `${rawModuleId}.ts`),
  `export const ${className}Manifest = {\n  kind: '${kind}',\n  moduleId: '${rawModuleId}',\n  version: '1.0.0',\n  displayName: '${displayName}',\n  defaultEnabled: false,\n  supportedNodeKinds: ['edge', 'vehicle'],\n  supportedArchitectures: ['x86_64', 'aarch64', 'unknown'],\n  policySchema: {},\n  statsSchema: {},\n  uiSections: ['platform_settings', 'agent_detail', 'dashboard'],\n  capabilities: ['template'],\n} as const;\n\nexport function normalize${className}Policy(raw: Record<string, any> = {}) {\n  return { ...raw };\n}\n`
));

outputs.push(writeIfMissing(
  path.join(root, 'frontend', 'src', 'modules', 'edge-auto', 'generated', kind, `${rawModuleId}.ts`),
  `export const ${className}UiManifest = {\n  moduleId: '${rawModuleId}',\n  displayName: '${displayName}',\n  kind: '${kind}',\n  policySchema: {},\n  statsSchema: {},\n  uiSections: ['platform_settings', 'agent_detail', 'dashboard'],\n} as const;\n`
));

outputs.push(writeIfMissing(
  path.join(root, 'backend', 'src', 'agent', 'generated', `${rawModuleId}.ts`),
  `export function observe${className}(_input: Record<string, any>) {\n  return {\n    moduleId: '${rawModuleId}',\n    status: 'scaffold_only',\n  };\n}\n`
));

if (kind === 'protocol') {
  outputs.push(writeIfMissing(
    path.join(root, 'rust-fastpath', 'src', 'protocols', 'generated', `${rawModuleId}.rs`),
    `use serde_json::json;\n\nuse crate::{ProtocolCostMetrics, ProtocolEvaluateRequest, ProtocolEvaluateResponse};\nuse crate::protocols::traits::ProtocolPlugin;\n\npub struct ${className}ProtocolPlugin;\n\nimpl ProtocolPlugin for ${className}ProtocolPlugin {\n    fn id(&self) -> &'static str {\n        "${protocolName}"\n    }\n\n    fn display_name(&self) -> &'static str {\n        "${displayName}"\n    }\n\n    fn default_policy(&self) -> serde_json::Value {\n        json!({ "enabled": false })\n    }\n\n    fn empty_stats(&self) -> serde_json::Value {\n        json!({ "evaluations": 0, "findings": 0 })\n    }\n\n    fn validate(&self, _input: &ProtocolEvaluateRequest) -> Result<(), String> {\n        Ok(())\n    }\n\n    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String> {\n        Ok(ProtocolEvaluateResponse {\n            protocol: input.protocol.clone(),\n            verdict: "allow".to_string(),\n            action: "inspect".to_string(),\n            matched_rule: None,\n            findings: Vec::new(),\n            decision_source: "rust-fastpath-generated-template".to_string(),\n            processing_time_micros: 0,\n            cost_metrics: ProtocolCostMetrics::default(),\n        })\n    }\n}\n`
  ));

  outputs.push(writeIfMissing(
    path.join(root, 'rust-fastpath', 'tests', 'fixtures', `${rawModuleId}.json`),
    JSON.stringify({
      tenantId: 'global',
      requestId: `fixture-${rawModuleId}-1`,
      protocol: rawModuleId,
      direction: 'internal',
      sourceRef: 'agent-1',
      destRef: 'edge-node',
      channel: `${rawModuleId}/channel`,
      headers: {},
      metadata: {},
      payloadBase64: '',
      truncated: false,
      timestamp: '2026-03-22T00:00:00Z'
    }, null, 2) + '\n'
  ));

  outputs.push(writeIfMissing(
    path.join(root, 'backend', 'src', '__tests__', 'edge-auto-generated', `${rawModuleId}.test.ts`),
    `describe('${rawModuleId} scaffold', () => {\n  it('documents the generated module id', () => {\n    expect('${rawModuleId}').toBe('${rawModuleId}');\n  });\n});\n`
  ));
}

const created = outputs.filter((item) => item.created);
const skipped = outputs.filter((item) => !item.created);

console.log(`Edge Auto scaffold prepared for ${kind}:${rawModuleId}`);
console.log(`Created: ${created.length}`);
created.forEach((item) => console.log(`  + ${path.relative(root, item.target)}`));
if (skipped.length > 0) {
  console.log(`Skipped existing: ${skipped.length}`);
  skipped.forEach((item) => console.log(`  = ${path.relative(root, item.target)}`));
}
console.log('Next: register the manifest in backend/src/services/protocol-module-registry.service.ts, backend/src/agent/agent.ts, and rust-fastpath/src/protocols/registry.rs.');
