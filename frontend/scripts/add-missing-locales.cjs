/**
 * One-time script: add missing locale keys to zh.json and en.json
 */
const fs = require('fs');
const path = require('path');

const zhPath = path.join(__dirname, '../src/locales/zh.json');
const enPath = path.join(__dirname, '../src/locales/en.json');

const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// ─── platformSettings ─────────────────────────────────────────────
const platformSettingsZh = {
  "platformControl": "平台控制",
  "loadingControlPlane": "正在加载控制平面",
  "loadingPlatformSettings": "正在加载平台设置...",
  "guardrailsSubtitle": "流量防护、AI 路由和检测管线配置",
  "save": "保存",
  "configSaved": "配置已保存",
  "notificationTestSent": "通知测试已发送",
  "newChannel": "新通知渠道",
  "trafficGuardrails": "流量防护",
  "antiBotEnabled": "反机器人已启用",
  "requestsPerMinute": "每分钟请求数",
  "requestThreshold": "请求阈值",
  "fastRequestThreshold": "快速请求阈值",
  "aiRouting": "AI 路由",
  "routingMode": "路由模式",
  "privacyMode": "隐私模式",
  "localEndpoint": "本地端点",
  "localHotPathEndpoint": "本地热路径端点",
  "cloudEndpoint": "云端端点",
  "notSelected": "未选择",
  "platformDefault": "平台默认",
  "allowFallback": "允许回退",
  "cloudRedaction": "云端脱敏",
  "detectionPipeline": "检测管线",
  "ruleFirstMode": "规则优先模式",
  "aiEscalationMode": "AI 升级模式",
  "escalationThreshold": "升级阈值",
  "candidateConfidence": "候选置信度",
  "learningMode": "学习模式",
  "httpApi": "HTTP API",
  "packetInterceptor": "数据包拦截器",
  "agentAsyncReview": "智能体异步审查",
  "auditArchive": "审计归档",
  "auditBucket": "审计存储桶",
  "retentionDays": "保留天数",
  "verifyIntervalMin": "验证间隔（分钟）",
  "requireObjectLock": "需要对象锁",
  "fastpath": "快速路径",
  "baseUrl": "基础 URL",
  "transport": "传输方式",
  "timeoutMs": "超时（毫秒）",
  "unixSocketPath": "Unix 套接字路径",
  "configCacheTtlMs": "配置缓存 TTL（毫秒）",
  "shadowSamplePct": "影子采样 %",
  "maxBodyBytes": "最大主体字节数",
  "fastpathEnabled": "快速路径已启用",
  "trafficShadow": "流量影子",
  "deploymentDeviceNotifications": "部署、设备与通知",
  "deploymentSubtitle": "默认部署配置、设备网关别名和外部通知渠道",
  "addChannel": "添加渠道",
  "deploymentDefaults": "部署默认配置",
  "defaultTarget": "默认目标",
  "upstream": "上游",
  "listenPort": "监听端口",
  "serverName": "服务器名称",
  "deviceGateway": "设备网关",
  "primaryPath": "主路径",
  "aliases": "别名",
  "setupSSID": "设置 SSID",
  "firmwareHost": "固件主机",
  "localPort": "本地端口",
  "firmwareChannel": "固件频道",
  "firmwareRetentionDays": "固件保留天数",
  "enableStatusAlias": "启用 /ws/status 别名",
  "notificationsEnabled": "通知已启用",
  "dedupeWindow": "去重窗口（秒）",
  "retryDelays": "重试延迟（秒）",
  "noChannels": "未配置通知渠道。",
  "webhookTarget": "Webhook 目标",
  "smtpHost": "SMTP 主机",
  "test": "测试",
  "remove": "移除",
  "recentDeliveries": "最近投递",
  "noDeliveries": "暂无投递记录。",
  "attempts": "尝试次数",
  "nextRetry": "下次重试",
  "terminalAt": "终止于"
};

const platformSettingsEn = {
  "platformControl": "Platform Control",
  "loadingControlPlane": "Loading control plane",
  "loadingPlatformSettings": "Loading platform settings...",
  "guardrailsSubtitle": "Traffic guardrails, AI routing and detection pipeline configuration",
  "save": "Save",
  "configSaved": "Configuration saved",
  "notificationTestSent": "Notification test sent",
  "newChannel": "New Channel",
  "trafficGuardrails": "Traffic Guardrails",
  "antiBotEnabled": "Anti-Bot Enabled",
  "requestsPerMinute": "Requests per minute",
  "requestThreshold": "Request threshold",
  "fastRequestThreshold": "Fast request threshold",
  "aiRouting": "AI Routing",
  "routingMode": "Routing mode",
  "privacyMode": "Privacy mode",
  "localEndpoint": "Local endpoint",
  "localHotPathEndpoint": "Local hot-path endpoint",
  "cloudEndpoint": "Cloud endpoint",
  "notSelected": "Not selected",
  "platformDefault": "Platform default",
  "allowFallback": "Allow fallback",
  "cloudRedaction": "Cloud redaction",
  "detectionPipeline": "Detection Pipeline",
  "ruleFirstMode": "Rule-first mode",
  "aiEscalationMode": "AI escalation mode",
  "escalationThreshold": "Escalation threshold",
  "candidateConfidence": "Candidate confidence",
  "learningMode": "Learning mode",
  "httpApi": "HTTP API",
  "packetInterceptor": "Packet interceptor",
  "agentAsyncReview": "Agent async review",
  "auditArchive": "Audit Archive",
  "auditBucket": "Audit bucket",
  "retentionDays": "Retention days",
  "verifyIntervalMin": "Verify interval (min)",
  "requireObjectLock": "Require object lock",
  "fastpath": "Fastpath",
  "baseUrl": "Base URL",
  "transport": "Transport",
  "timeoutMs": "Timeout (ms)",
  "unixSocketPath": "Unix socket path",
  "configCacheTtlMs": "Config cache TTL (ms)",
  "shadowSamplePct": "Shadow sample %",
  "maxBodyBytes": "Max body bytes",
  "fastpathEnabled": "Fastpath enabled",
  "trafficShadow": "Traffic shadow",
  "deploymentDeviceNotifications": "Deployment, Device And Notifications",
  "deploymentSubtitle": "Default rollout profile, device gateway aliases and external notification channels",
  "addChannel": "Add channel",
  "deploymentDefaults": "Deployment Defaults",
  "defaultTarget": "Default target",
  "upstream": "Upstream",
  "listenPort": "Listen port",
  "serverName": "Server name",
  "deviceGateway": "Device Gateway",
  "primaryPath": "Primary path",
  "aliases": "Aliases",
  "setupSSID": "Setup SSID",
  "firmwareHost": "Firmware host",
  "localPort": "Local port",
  "firmwareChannel": "Firmware channel",
  "firmwareRetentionDays": "Firmware retention days",
  "enableStatusAlias": "Enable /ws/status alias",
  "notificationsEnabled": "Notifications enabled",
  "dedupeWindow": "Dedupe window (s)",
  "retryDelays": "Retry delays (s)",
  "noChannels": "No channels configured.",
  "webhookTarget": "Webhook target",
  "smtpHost": "SMTP host",
  "test": "Test",
  "remove": "Remove",
  "recentDeliveries": "Recent deliveries",
  "noDeliveries": "No delivery records yet.",
  "attempts": "Attempts",
  "nextRetry": "Next retry",
  "terminalAt": "Terminal"
};

// ─── aiEndpoint ───────────────────────────────────────────────────
const aiEndpointZh = {
  "title": "AI 端点设置",
  "addEndpoint": "添加端点",
  "priorityNote": "端点按优先级顺序使用。如果一个失败，将使用下一个已启用的端点。",
  "platformProof": "内置平台 AI 验证",
  "platformProofDesc": "运行一次确定性云端模型检查，期望返回 AETHERGUARD_REMOTE_AI_OK。",
  "verifyPlatformAI": "验证平台 AI",
  "platformProofSuccess": "平台路由返回了实时响应。",
  "model": "模型",
  "latency": "延迟",
  "route": "路由",
  "provider": "提供者",
  "path": "路径",
  "requestId": "请求 ID",
  "status": "状态",
  "name": "名称",
  "type": "类型",
  "purpose": "用途",
  "endpointUrl": "端点 URL *",
  "modelLabel": "模型",
  "apiKey": "API 密钥",
  "cancel": "取消",
  "add": "添加",
  "loading": "加载中...",
  "noEndpoints": "未配置 AI 端点。",
  "test": "测试",
  "disable": "禁用",
  "enable": "启用",
  "delete": "删除"
};

const aiEndpointEn = {
  "title": "AI Endpoint Settings",
  "addEndpoint": "Add Endpoint",
  "priorityNote": "Endpoints are used by priority order. If one fails, the next enabled endpoint is used.",
  "platformProof": "Built-in Platform AI Proof",
  "platformProofDesc": "Runs one deterministic cloud-model check and expects AETHERGUARD_REMOTE_AI_OK.",
  "verifyPlatformAI": "Verify Platform AI",
  "platformProofSuccess": "Platform route returned a live response.",
  "model": "Model",
  "latency": "Latency",
  "route": "Route",
  "provider": "Provider",
  "path": "Path",
  "requestId": "Request ID",
  "status": "Status",
  "name": "Name",
  "type": "Type",
  "purpose": "Purpose",
  "endpointUrl": "Endpoint URL *",
  "modelLabel": "Model",
  "apiKey": "API Key",
  "cancel": "Cancel",
  "add": "Add",
  "loading": "Loading...",
  "noEndpoints": "No configured AI endpoints.",
  "test": "Test",
  "disable": "Disable",
  "enable": "Enable",
  "delete": "Delete"
};

// ─── modelSelector ────────────────────────────────────────────────
const modelSelectorZh = {
  "title": "AI 模型中心",
  "loadingConfig": "正在加载 AI 模型配置...",
  "currentPlan": "当前计划",
  "modelsAvailable": "个模型可用",
  "customPolicy": "已启用自定义模型策略",
  "partner": "合作伙伴",
  "upgradeRequired": "需要升级",
  "retry": "重试"
};

const modelSelectorEn = {
  "title": "AI Model Center",
  "loadingConfig": "Loading AI model configuration...",
  "currentPlan": "Current plan",
  "modelsAvailable": "models available",
  "customPolicy": "Custom model policy enabled",
  "partner": "Partner",
  "upgradeRequired": "Upgrade required",
  "retry": "Retry"
};

// ─── Missing attackSimulator keys (en.json missing some) ──────────
const attackSimulatorMissingEn = {
  "selectAndRunDesc": "Select attack types from the left panel and run a simulation to see live analysis.",
  "recentDrillSummary": "Recent drill summary",
  "attackResultLog": "Attack result log",
  "recentDrillBatches": "Recent drill batches"
};

const attackSimulatorMissingZh = {
};

// ─── Missing attackSimulator keys (zh.json missing some) ──────────
// Check what zh might be missing vs en - nothing expected

// ─── Apply all additions ──────────────────────────────────────────
function ensureSection(obj, section, keys) {
  if (!obj[section]) {
    obj[section] = {};
  }
  for (const [key, value] of Object.entries(keys)) {
    if (!obj[section][key]) {
      obj[section][key] = value;
    }
  }
}

ensureSection(zh, 'platformSettings', platformSettingsZh);
ensureSection(en, 'platformSettings', platformSettingsEn);
ensureSection(zh, 'aiEndpoint', aiEndpointZh);
ensureSection(en, 'aiEndpoint', aiEndpointEn);
ensureSection(zh, 'modelSelector', modelSelectorZh);
ensureSection(en, 'modelSelector', modelSelectorEn);

// Add missing attackSimulator keys to en.json
for (const [key, value] of Object.entries(attackSimulatorMissingEn)) {
  if (!en.attackSimulator[key]) {
    en.attackSimulator[key] = value;
  }
}

// ─── Write back ───────────────────────────────────────────────────
fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2) + '\n', 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

console.log('Done! Added keys:');
console.log('  platformSettings: ' + Object.keys(platformSettingsZh).length + ' keys');
console.log('  aiEndpoint: ' + Object.keys(aiEndpointZh).length + ' keys');
console.log('  modelSelector: ' + Object.keys(modelSelectorZh).length + ' keys');
console.log('  attackSimulator (en): ' + Object.keys(attackSimulatorMissingEn).length + ' keys');
