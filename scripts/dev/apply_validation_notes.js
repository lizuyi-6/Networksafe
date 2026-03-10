const fs = require('fs');
const path = require('path');

function insertAfterFirstMatch(filePath, pattern, insertText) {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, 'utf8');
  if (content.includes(insertText.trim())) {
    return;
  }

  const updated = content.replace(pattern, (match) => `${match}\n${insertText}\n`);
  if (updated === content) {
    throw new Error(`Failed to insert note into ${filePath}`);
  }

  fs.writeFileSync(resolved, updated, 'utf8');
}

insertAfterFirstMatch(
  'README.md',
  /^# .*?\r?\n/,
  `## Validated Status (2026-03-08)

This repository now includes a stronger capability baseline, but the validated status is mixed rather than "all strong claims passed".

- Verified in the current workspace: Docker runtime, object-lock audit archive, notification outbox with retry tracking, persistent AI endpoint/config routing, \`caddy\` / \`docker_compose\` / \`binary_agent\` / \`k8s_daemonset\` bundle generation, Rust fastpath sidecar wiring, \`/ws/device\` plus \`/ws/status\` compatibility, OTA plus physical-confirmation smoke flow for \`esp32-smoke\`.
- Current benchmark evidence in this workspace does not justify the historical strongest claims. Latest smoke benchmark recorded about \`1329.79 QPS\`, \`p95 21ms\`, \`agent CPU 6.22%\`, \`agent memory 99.64MB\`, and no local Ollama latency because \`127.0.0.1:11434\` was unavailable.
- Physical ESP32 board flashing, external Linux binary install/rollback, and \`100,000+ QPS\` / \`<10ms local AI\` / \`<2% CPU\` / \`<50MB\` remain unvalidated here.

See [\`docs/reports/validated-capability-status-2026-03-08.md\`](docs/reports/validated-capability-status-2026-03-08.md) for the current evidence-backed status.`
);

insertAfterFirstMatch(
  'docs/product_whitepaper.md',
  /---\r?\n/,
  `> Validation Note (2026-03-08): This document contains historical strong-claim wording. The current evidence-backed status is tracked in \`docs/reports/validated-capability-status-2026-03-08.md\`. In this workspace, Docker runtime, locked audit archive, notification outbox, AI routing config, deployment bundle generation, and \`/ws/device\` + \`/ws/status\` device flows are validated. \`100,000+ QPS\`, \`<10ms local AI\`, \`<2% CPU\`, \`<50MB\`, physical ESP32 board flashing, and external Linux binary rollout are not yet validated here.`
);

insertAfterFirstMatch(
  'docs/product_manual.md',
  /(## 1\.[^\r\n]*\r?\n.*?\r?\n)/,
  `> Validation Note (2026-03-08): Deployment target generation now covers \`nginx\`, \`apache\`, \`caddy\`, \`docker_compose\`, \`binary_agent\`, and \`k8s_daemonset\`, but only Docker runtime is fully validated in this workspace. Notification outbox, audit archive with object lock, and device OTA/physical-confirmation smoke are validated. Historical performance and hardware production claims should be treated as unvalidated unless they are repeated in \`docs/reports/validated-capability-status-2026-03-08.md\`.`
);

insertAfterFirstMatch(
  'docs/技术实施手册.md',
  /---\r?\n/,
  `> Validation Note (2026-03-08): The current implementation validates object-lock audit archive, notification outbox/retry, AI routing config persistence, Rust fastpath sidecar wiring, and the \`/ws/status\` compatibility path with OTA plus physical-confirmation smoke for \`esp32-smoke\`. This workspace does not yet validate physical ESP32 board flashing, external Linux binary installation, or the strongest historical performance numbers.`
);

insertAfterFirstMatch(
  'docs/01_产品功能介绍.md',
  /---\r?\n/,
  `> Validation Note (2026-03-08): The feature list below contains both validated capabilities and historical strong-claim language. Current evidence-backed status is summarized in \`docs/reports/validated-capability-status-2026-03-08.md\`. Verified now: deployment bundle generation, object-lock audit archive, notification outbox, AI routing config persistence, and device OTA plus GPIO15 confirmation smoke over \`/ws/status\`.`
);

insertAfterFirstMatch(
  'docs/客户产品介绍.md',
  /(2\.0 \|.*\r?\n)/,
  `> Validation Note (2026-03-08): Use \`docs/reports/validated-capability-status-2026-03-08.md\` as the authoritative current-status attachment when this document is shared externally. In the current workspace, Docker runtime, locked audit archive, notification outbox/retry, deployment bundle generation, and simulated ESP32 OTA plus physical confirmation are validated. The historical strongest performance and hardware-production claims are not yet validated here.`
);

insertAfterFirstMatch(
  'docs/答辩PPT插页文案.md',
  /^# .*?\r?\n/,
  `> Validation Note (2026-03-08): When preparing the defense deck, use \`docs/reports/validated-capability-status-2026-03-08.md\` as the source of truth for current capability claims. The strongest historical claims around \`100,000+ QPS\`, \`<10ms local AI\`, \`<2% CPU\`, \`<50MB\`, and fully proven physical hardware rollout should not be presented as completed in the current workspace.`
);
