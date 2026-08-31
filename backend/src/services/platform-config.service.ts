import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { postgresShadowStoreService } from './postgres-shadow-store.service';
import logger from '../utils/logger';
import { encryptSecret, decryptSecret, isSealedSecret } from '../security/secret-encryption';
import type { DetectionChannel } from './detection-engine';

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';
export type NotificationChannelType = 'email' | 'smtp' | 'slack_webhook' | 'generic_webhook';
export type NotificationDeliveryStatus = 'queued' | 'sending' | 'retrying' | 'sent' | 'failed' | 'skipped';
export type AIRoutingMode = 'cloud_only' | 'local_preferred' | 'local_only' | 'hybrid_verify';
export type PrivacyMode = 'off' | 'strict';
export type DetectionAIEscalationMode = 'high_risk_allowed_only';
export type DetectionLearningMode = 'malicious_review_queue';
export type SecurityClassificationLevel = 'standard' | 'elevated' | 'maximum';
export type DeploymentTarget =
  | 'nginx'
  | 'apache'
  | 'caddy'
  | 'docker_compose'
  | 'binary_agent'
  | 'k8s_daemonset';

export interface NotificationChannelConfig {
  id: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  target: string;
  minimumSeverity: SeverityLevel;
  headers: Record<string, string>;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
  };
}

export interface NotificationSettings {
  enabled: boolean;
  dedupeWindowSeconds: number;
  retryDelaysSeconds: number[];
  channels: NotificationChannelConfig[];
}

/**
 * SECURITY FIX (audit 2026-08, AG-B07): sentinel returned in place of secret
 * values when a non-platform-admin reads the config. Chosen to be obviously
 * non-secret and non-empty so UI forms still render a populated field.
 */
export const REDACTED_CONFIG_SECRET = '********';

/**
 * N5-2 (audit 2026-08): notification-channel secrets (smtp.password, every
 * webhook header value) are stored as envelope-encrypted `enc1:` values in
 * `notifications_json` — never plaintext at rest. Sealing happens on write;
 * opening happens on read, server-side only. A masked sentinel round-tripped
 * from the UI form is restored to the CURRENT secret before sealing so a
 * config save cannot clobber real credentials with '********'.
 */
function sealNotificationSecretsForStorage(
  next: NotificationSettings,
  current: NotificationSettings
): NotificationSettings {
  const copy = JSON.parse(JSON.stringify(next ?? { channels: [] })) as NotificationSettings;
  const channels = Array.isArray(copy.channels) ? copy.channels : [];
  const currentChannels = Array.isArray(current?.channels) ? current.channels : [];
  for (const channel of channels) {
    if (!channel || typeof channel !== 'object') {
      continue;
    }
    const currentChannel = currentChannels.find((c) => c && c.id === channel.id);
    if (channel.smtp && typeof channel.smtp === 'object') {
      if (channel.smtp.password === REDACTED_CONFIG_SECRET && currentChannel?.smtp?.password) {
        channel.smtp.password = String(currentChannel.smtp.password);
      }
      if (typeof channel.smtp.password === 'string' && channel.smtp.password) {
        channel.smtp.password = isSealedSecret(channel.smtp.password)
          ? channel.smtp.password
          : encryptSecret(channel.smtp.password);
      }
    }
    if (channel.headers && typeof channel.headers === 'object') {
      for (const key of Object.keys(channel.headers)) {
        if (channel.headers[key] === REDACTED_CONFIG_SECRET && currentChannel?.headers?.[key]) {
          channel.headers[key] = String(currentChannel.headers[key]);
        }
        if (typeof channel.headers[key] === 'string' && channel.headers[key]) {
          channel.headers[key] = isSealedSecret(channel.headers[key])
            ? channel.headers[key]
            : encryptSecret(channel.headers[key]);
        }
      }
    }
  }
  return copy;
}

/**
 * N5-2: open `enc1:` secrets after reading `notifications_json`. A value
 * that fails to decrypt stays sealed — the dispatcher then fails visibly
 * (auth error) instead of silently sending an empty secret.
 */
function openNotificationSecretsFromStorage(notifications: NotificationSettings): NotificationSettings {
  const copy = JSON.parse(JSON.stringify(notifications ?? { channels: [] })) as NotificationSettings;
  for (const channel of Array.isArray(copy.channels) ? copy.channels : []) {
    if (!channel || typeof channel !== 'object') {
      continue;
    }
    if (typeof channel.smtp?.password === 'string' && isSealedSecret(channel.smtp.password)) {
      const opened = decryptSecret(channel.smtp.password);
      if (opened !== null) {
        channel.smtp.password = opened;
      }
    }
    if (channel.headers && typeof channel.headers === 'object') {
      for (const key of Object.keys(channel.headers)) {
        const value = channel.headers[key];
        if (typeof value === 'string' && isSealedSecret(value)) {
          const opened = decryptSecret(value);
          if (opened !== null) {
            channel.headers[key] = opened;
          }
        }
      }
    }
  }
  return copy;
}

/**
 * SECURITY FIX (audit 2026-08, AG-B07): return a deep copy of `config` with
 * notification-channel secrets masked: every channel's `smtp.password` and
 * every webhook `headers` value (webhook headers commonly carry bearer tokens
 * / signing secrets, and the platform cannot know which keys are sensitive —
 * mask all values, keep the keys so the channel shape stays renderable).
 *
 * The input is the service's cached live object, so this ALWAYS clones before
 * masking — callers can mutate the result freely.
 */
export function redactPlatformConfigSecrets(config: PlatformConfig): PlatformConfig {
  const copy = JSON.parse(JSON.stringify(config)) as PlatformConfig;
  const channels = copy?.notifications?.channels;
  if (Array.isArray(channels)) {
    for (const channel of channels) {
      if (!channel || typeof channel !== 'object') {
        continue;
      }
      if (channel.smtp && typeof channel.smtp === 'object' && channel.smtp.password) {
        channel.smtp.password = REDACTED_CONFIG_SECRET;
      }
      if (channel.headers && typeof channel.headers === 'object') {
        for (const key of Object.keys(channel.headers)) {
          if (channel.headers[key]) {
            channel.headers[key] = REDACTED_CONFIG_SECRET;
          }
        }
      }
    }
  }
  return copy;
}

export interface AIRoutingSettings {
  mode: AIRoutingMode;
  preferredModelId: string | null;
  localEndpointId: string | null;
  localHotPathEndpointId: string | null;
  cloudEndpointId: string | null;
  fallbackAllowed: boolean;
  redactionEnabled: boolean;
}

export interface DeploymentProfileTemplate {
  port: number;
  serverName: string;
  rateLimit: number;
  upstream: string;
  namespace: string;
  image: string;
}

export interface DeploymentDefaults {
  serverType: DeploymentTarget;
  profileTemplates: Record<DeploymentTarget, DeploymentProfileTemplate>;
}

export interface AuditArchiveSettings {
  bucket: string;
  retentionDays: number;
  objectLockRequired: boolean;
  verifyIntervalMinutes: number;
}

export interface FastpathSettings {
  enabled: boolean;
  baseUrl: string;
  transport: 'tcp' | 'unix';
  socketPath: string | null;
  timeoutMs: number;
  fallbackEnabled: boolean;
  trafficShadowEnabled: boolean;
  trafficShadowSampleRatePct: number;
  trafficMaxBodyBytes: number;
  configCacheTtlMs: number;
}

export interface DetectionPipelineSettings {
  ruleFirstEnabled: boolean;
  aiEscalationMode: DetectionAIEscalationMode;
  classificationLevel: SecurityClassificationLevel;
  blockingDiscussionTimeoutMs: number;
  hotPathRouteMode: AIRoutingMode;
  asyncReviewEnabled: boolean;
  blockingReviewForHighRiskActions: boolean;
  enableHttpApi: boolean;
  enablePacketInterceptor: boolean;
  enableAgentAsyncReview: boolean;
  aiEscalationThreshold: number;
  candidateMinConfidence: number;
  learningMode: DetectionLearningMode;
  learningCloudVerificationEnabled: boolean;
  learningCloudVerificationMode: AIRoutingMode;
  learningCloudVerificationChannels: DetectionChannel[];
  learningCloudVerificationOnSuspicious: boolean;
  learningCloudVerificationOnMissingConfidence: boolean;
  learningFromBlockedEnabled: boolean;
  learningFromBlockedMinSeverity: SeverityLevel;
}

export interface DeviceGatewaySettings {
  primaryPath: string;
  aliases: string[];
  syncMaskApiKeys: boolean;
  firmwareLocalHost: string;
  wifiSSID: string;
  localPort: number;
  firmwareChannel: string;
  firmwareRetentionDays: number;
  statusAliasEnabled: boolean;
}

export interface EdgeAutoProtocolModuleSettings {
  [moduleId: string]: Record<string, any>;
}

export interface EdgeAutoSettings {
  runtimeDefaults: {
    cpuCeilingPct: number;
    sampleIntervalSec: number;
    breachWindowSec: number;
    recoveryWindowSec: number;
    autoReadOnlyBypass: boolean;
  };
  protocolDefaults: {
    modules: EdgeAutoProtocolModuleSettings;
    legacy?: Record<string, any>;
  };
  arm64Enabled: boolean;
}

export interface PlatformConfig {
  antiBot: {
    enabled: boolean;
    requestThreshold: number;
    fastRequestThreshold: number;
    blockDuration: number;
  };
  rateLimit: {
    requestsPerMinute: number;
    windowSeconds: number;
  };
  notifications: NotificationSettings;
  aiRouting: AIRoutingSettings;
  privacyMode: PrivacyMode;
  auditArchive: AuditArchiveSettings;
  fastpath: FastpathSettings;
  detectionPipeline: DetectionPipelineSettings;
  deploymentDefaults: DeploymentDefaults;
  deviceGateway: DeviceGatewaySettings;
  edgeAuto?: EdgeAutoSettings;
}

export interface NotificationDeliveryRecord {
  id: string;
  tenantId: string;
  alertId?: string;
  channelId: string;
  channelType: NotificationChannelType;
  channelLabel: string;
  status: NotificationDeliveryStatus;
  severity: SeverityLevel;
  target: string;
  payload: Record<string, any>;
  response: Record<string, any>;
  error?: string;
  attemptCount: number;
  dedupeKey?: string;
  nextAttemptAt?: string;
  terminalAt?: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_DEPLOYMENT_TEMPLATE: DeploymentProfileTemplate = {
  port: 8080,
  serverName: 'api.example.com',
  rateLimit: 100,
  upstream: 'http://backend:3005',
  namespace: 'aetherguard',
  image: 'ghcr.io/aetherguard/agent:latest'
};

const DEPLOYMENT_TARGETS: DeploymentTarget[] = [
  'nginx',
  'apache',
  'caddy',
  'docker_compose',
  'binary_agent',
  'k8s_daemonset'
];

const DEFAULT_FASTPATH_TRANSPORT: FastpathSettings['transport'] =
  process.platform === 'linux' ? 'unix' : 'tcp';

const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  antiBot: {
    enabled: true,
    requestThreshold: 100,
    fastRequestThreshold: 10,
    blockDuration: 3600
  },
  rateLimit: {
    requestsPerMinute: 60,
    windowSeconds: 60
  },
  notifications: {
    enabled: true,
    dedupeWindowSeconds: 300,
    retryDelaysSeconds: [30, 300, 900],
    channels: []
  },
  aiRouting: {
    mode: 'local_only',
    preferredModelId: null,
    localEndpointId: 'default-laptop',
    localHotPathEndpointId: null,
    cloudEndpointId: null,
    fallbackAllowed: false,
    redactionEnabled: true
  },
  privacyMode: 'off',
  auditArchive: {
    bucket: 'aetherguard-audit-lock',
    retentionDays: 30,
    objectLockRequired: true,
    verifyIntervalMinutes: 60
  },
  fastpath: {
    enabled: true,
    baseUrl: 'http://fastpath:8081',
    transport: DEFAULT_FASTPATH_TRANSPORT,
    socketPath: '/var/run/aetherguard-fastpath.sock',
    timeoutMs: 1500,
    fallbackEnabled: true,
    trafficShadowEnabled: false,
    trafficShadowSampleRatePct: 10,
    trafficMaxBodyBytes: 65536,
    configCacheTtlMs: 30000
  },
  detectionPipeline: {
    ruleFirstEnabled: true,
    aiEscalationMode: 'high_risk_allowed_only',
    classificationLevel: 'standard',
    blockingDiscussionTimeoutMs: 30000,
    hotPathRouteMode: 'local_only',
    asyncReviewEnabled: true,
    blockingReviewForHighRiskActions: true,
    enableHttpApi: true,
    enablePacketInterceptor: true,
    enableAgentAsyncReview: true,
    aiEscalationThreshold: 0.4,
    candidateMinConfidence: 0.85,
    learningMode: 'malicious_review_queue',
    learningCloudVerificationEnabled: true,
    learningCloudVerificationMode: 'cloud_only',
    learningCloudVerificationChannels: ['http_api', 'packet', 'agent'],
    learningCloudVerificationOnSuspicious: true,
    learningCloudVerificationOnMissingConfidence: true,
    learningFromBlockedEnabled: true,
    learningFromBlockedMinSeverity: 'medium'
  },
  deploymentDefaults: {
    serverType: 'nginx',
    profileTemplates: {
      nginx: { ...DEFAULT_DEPLOYMENT_TEMPLATE },
      apache: { ...DEFAULT_DEPLOYMENT_TEMPLATE },
      caddy: { ...DEFAULT_DEPLOYMENT_TEMPLATE },
      docker_compose: { ...DEFAULT_DEPLOYMENT_TEMPLATE },
      binary_agent: { ...DEFAULT_DEPLOYMENT_TEMPLATE },
      k8s_daemonset: { ...DEFAULT_DEPLOYMENT_TEMPLATE }
    }
  },
  deviceGateway: {
    primaryPath: '/ws/device',
    aliases: ['/ws/status'],
    syncMaskApiKeys: true,
    firmwareLocalHost: '192.168.4.1',
    wifiSSID: 'AetherGuard-Setup',
    localPort: 8080,
    firmwareChannel: 'stable',
    firmwareRetentionDays: 30,
    statusAliasEnabled: true
  }
};

export function cloneDefaultConfig(): PlatformConfig {
  return JSON.parse(JSON.stringify(DEFAULT_PLATFORM_CONFIG)) as PlatformConfig;
}

function parseJson<T>(value: any, fallback: T): T {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeNumber(value: any, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(numeric), min), max);
}

export function normalizeBoolean(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(lowered)) {
      return false;
    }
  }
  return fallback;
}

export function normalizeString(value: any, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function normalizeSeverity(value: any, fallback: SeverityLevel = 'medium'): SeverityLevel {
  const normalized = String(value || fallback).toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return fallback;
}

export function severityRank(value: SeverityLevel): number {
  switch (value) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

export function isSeverityAtLeast(value: SeverityLevel, minimum: SeverityLevel): boolean {
  return severityRank(value) >= severityRank(minimum);
}

export function normalizeHeaders(input: any): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  return Object.entries(input).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!key) {
      return acc;
    }
    acc[String(key)] = String(value ?? '');
    return acc;
  }, {});
}

export function normalizeChannel(raw: any, index: number): NotificationChannelConfig {
  const type = String(raw?.type || 'generic_webhook') as NotificationChannelType;
  const safeType: NotificationChannelType = ['email', 'smtp', 'slack_webhook', 'generic_webhook'].includes(type)
    ? type
    : 'generic_webhook';

  return {
    id: normalizeString(raw?.id, `channel-${index + 1}-${randomUUID().slice(0, 8)}`),
    name: normalizeString(raw?.name, `Channel ${index + 1}`),
    type: safeType,
    enabled: normalizeBoolean(raw?.enabled, true),
    target: normalizeString(raw?.target, ''),
    minimumSeverity: normalizeSeverity(raw?.minimumSeverity, 'high'),
    headers: normalizeHeaders(raw?.headers),
    smtp: {
      host: normalizeString(raw?.smtp?.host, ''),
      port: normalizeNumber(raw?.smtp?.port, 587, 1, 65535),
      secure: normalizeBoolean(raw?.smtp?.secure, false),
      username: normalizeString(raw?.smtp?.username, ''),
      password: normalizeString(raw?.smtp?.password, ''),
      from: normalizeString(raw?.smtp?.from, '')
    }
  };
}

export function normalizeNotifications(raw: any): NotificationSettings {
  const defaults = cloneDefaultConfig().notifications;
  const retryDelays = Array.isArray(raw?.retryDelaysSeconds)
    ? raw.retryDelaysSeconds
        .map((value: unknown) => normalizeNumber(value, 0, 0, 86400))
        .filter((value: number, index: number, arr: number[]) => value > 0 && arr.indexOf(value) === index)
    : defaults.retryDelaysSeconds;

  return {
    enabled: normalizeBoolean(raw?.enabled, defaults.enabled),
    dedupeWindowSeconds: normalizeNumber(raw?.dedupeWindowSeconds, defaults.dedupeWindowSeconds, 0, 86400),
    retryDelaysSeconds: retryDelays.length > 0 ? retryDelays : defaults.retryDelaysSeconds,
    channels: Array.isArray(raw?.channels)
      ? raw.channels.map((channel: any, index: number) => normalizeChannel(channel, index))
      : defaults.channels
  };
}

export function normalizeRoutingMode(value: any, fallback: AIRoutingMode = 'cloud_only'): AIRoutingMode {
  const normalized = String(value || fallback).toLowerCase();
  if (normalized === 'cloud_only' || normalized === 'local_preferred' || normalized === 'local_only' || normalized === 'hybrid_verify') {
    return normalized;
  }
  return fallback;
}

export function normalizeAiRouting(raw: any, current?: AIRoutingSettings): AIRoutingSettings {
  const defaults = current || cloneDefaultConfig().aiRouting;
  return {
    mode: normalizeRoutingMode(raw?.mode, defaults.mode),
    preferredModelId: normalizeString(raw?.preferredModelId, defaults.preferredModelId || '') || null,
    localEndpointId: normalizeString(raw?.localEndpointId, defaults.localEndpointId || '') || null,
    localHotPathEndpointId: normalizeString(raw?.localHotPathEndpointId, defaults.localHotPathEndpointId || '') || null,
    cloudEndpointId: normalizeString(raw?.cloudEndpointId, defaults.cloudEndpointId || '') || null,
    fallbackAllowed: normalizeBoolean(raw?.fallbackAllowed, defaults.fallbackAllowed),
    redactionEnabled: normalizeBoolean(raw?.redactionEnabled, defaults.redactionEnabled)
  };
}

export function normalizePrivacyMode(value: any, fallback: PrivacyMode = 'off'): PrivacyMode {
  if (value === 'strict') {
    return 'strict';
  }
  if (value === 'off') {
    return 'off';
  }
  return fallback;
}

export function normalizeAuditArchive(raw: any): AuditArchiveSettings {
  const defaults = cloneDefaultConfig().auditArchive;
  return {
    bucket: normalizeString(raw?.bucket, defaults.bucket) || defaults.bucket,
    retentionDays: normalizeNumber(raw?.retentionDays, defaults.retentionDays, 1, 3650),
    objectLockRequired: normalizeBoolean(raw?.objectLockRequired, defaults.objectLockRequired),
    verifyIntervalMinutes: normalizeNumber(raw?.verifyIntervalMinutes, defaults.verifyIntervalMinutes, 1, 1440)
  };
}

export function normalizeFastpath(raw: any): FastpathSettings {
  const defaults = cloneDefaultConfig().fastpath;
  const transport = String(raw?.transport || defaults.transport).toLowerCase();
  return {
    enabled: normalizeBoolean(raw?.enabled, defaults.enabled),
    baseUrl: normalizeString(raw?.baseUrl, defaults.baseUrl) || defaults.baseUrl,
    transport: transport === 'unix' ? 'unix' : 'tcp',
    socketPath: normalizeString(raw?.socketPath, defaults.socketPath || '') || defaults.socketPath,
    timeoutMs: normalizeNumber(raw?.timeoutMs, defaults.timeoutMs, 100, 30000),
    fallbackEnabled: normalizeBoolean(raw?.fallbackEnabled, defaults.fallbackEnabled),
    trafficShadowEnabled: normalizeBoolean(raw?.trafficShadowEnabled, defaults.trafficShadowEnabled),
    trafficShadowSampleRatePct: normalizeNumber(raw?.trafficShadowSampleRatePct, defaults.trafficShadowSampleRatePct, 0, 100),
    trafficMaxBodyBytes: normalizeNumber(raw?.trafficMaxBodyBytes, defaults.trafficMaxBodyBytes, 0, 1024 * 1024),
    configCacheTtlMs: normalizeNumber(raw?.configCacheTtlMs, defaults.configCacheTtlMs, 1000, 300000)
  };
}

export function normalizeDetectionAIEscalationMode(
  value: any,
  fallback: DetectionAIEscalationMode = 'high_risk_allowed_only'
): DetectionAIEscalationMode {
  return String(value || fallback).toLowerCase() === 'high_risk_allowed_only'
    ? 'high_risk_allowed_only'
    : fallback;
}

export function normalizeDetectionLearningMode(
  value: any,
  fallback: DetectionLearningMode = 'malicious_review_queue'
): DetectionLearningMode {
  return String(value || fallback).toLowerCase() === 'malicious_review_queue'
    ? 'malicious_review_queue'
    : fallback;
}

export function normalizeSecurityClassificationLevel(
  value: any,
  fallback: SecurityClassificationLevel = 'standard'
): SecurityClassificationLevel {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === 'standard' || normalized === 'elevated' || normalized === 'maximum') {
    return normalized;
  }
  return fallback;
}

export function normalizeDetectionChannels(value: any, fallback: DetectionChannel[]): DetectionChannel[] {
  const allowed: DetectionChannel[] = ['http_api', 'packet', 'agent'];
  const normalized = Array.isArray(value)
    ? value
        .map((entry) => String(entry || '').toLowerCase())
        .filter((entry, index, entries) => allowed.includes(entry as DetectionChannel) && entries.indexOf(entry) === index)
    : [];

  return normalized.length > 0 ? (normalized as DetectionChannel[]) : fallback;
}

export function normalizeDetectionPipeline(raw: any): DetectionPipelineSettings {
  const defaults = cloneDefaultConfig().detectionPipeline;
  const normalizeThreshold = (value: any, fallback: number): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(Math.max(Number(numeric.toFixed(2)), 0), 1);
  };

  return {
    ruleFirstEnabled: normalizeBoolean(raw?.ruleFirstEnabled, defaults.ruleFirstEnabled),
    aiEscalationMode: normalizeDetectionAIEscalationMode(raw?.aiEscalationMode, defaults.aiEscalationMode),
    classificationLevel: normalizeSecurityClassificationLevel(
      raw?.classificationLevel,
      defaults.classificationLevel
    ),
    blockingDiscussionTimeoutMs: normalizeNumber(
      raw?.blockingDiscussionTimeoutMs,
      defaults.blockingDiscussionTimeoutMs,
      1000,
      120000
    ),
    hotPathRouteMode: normalizeRoutingMode(raw?.hotPathRouteMode, defaults.hotPathRouteMode),
    asyncReviewEnabled: normalizeBoolean(raw?.asyncReviewEnabled, defaults.asyncReviewEnabled),
    blockingReviewForHighRiskActions: normalizeBoolean(
      raw?.blockingReviewForHighRiskActions,
      defaults.blockingReviewForHighRiskActions
    ),
    enableHttpApi: normalizeBoolean(raw?.enableHttpApi, defaults.enableHttpApi),
    enablePacketInterceptor: normalizeBoolean(raw?.enablePacketInterceptor, defaults.enablePacketInterceptor),
    enableAgentAsyncReview: normalizeBoolean(raw?.enableAgentAsyncReview, defaults.enableAgentAsyncReview),
    aiEscalationThreshold: normalizeThreshold(raw?.aiEscalationThreshold, defaults.aiEscalationThreshold),
    candidateMinConfidence: normalizeThreshold(raw?.candidateMinConfidence, defaults.candidateMinConfidence),
    learningMode: normalizeDetectionLearningMode(raw?.learningMode, defaults.learningMode),
    learningCloudVerificationEnabled: normalizeBoolean(
      raw?.learningCloudVerificationEnabled,
      defaults.learningCloudVerificationEnabled
    ),
    learningCloudVerificationMode: normalizeRoutingMode(
      raw?.learningCloudVerificationMode,
      defaults.learningCloudVerificationMode
    ),
    learningCloudVerificationChannels: normalizeDetectionChannels(
      raw?.learningCloudVerificationChannels,
      defaults.learningCloudVerificationChannels
    ),
    learningCloudVerificationOnSuspicious: normalizeBoolean(
      raw?.learningCloudVerificationOnSuspicious,
      defaults.learningCloudVerificationOnSuspicious
    ),
    learningCloudVerificationOnMissingConfidence: normalizeBoolean(
      raw?.learningCloudVerificationOnMissingConfidence,
      defaults.learningCloudVerificationOnMissingConfidence
    ),
    learningFromBlockedEnabled: normalizeBoolean(
      raw?.learningFromBlockedEnabled,
      defaults.learningFromBlockedEnabled
    ),
    learningFromBlockedMinSeverity: normalizeSeverity(
      raw?.learningFromBlockedMinSeverity,
      defaults.learningFromBlockedMinSeverity
    )
  };
}

export function normalizeDeploymentTarget(value: any, fallback: DeploymentTarget = 'nginx'): DeploymentTarget {
  return DEPLOYMENT_TARGETS.includes(value as DeploymentTarget) ? (value as DeploymentTarget) : fallback;
}

export function normalizeDeploymentTemplate(raw: any): DeploymentProfileTemplate {
  return {
    port: normalizeNumber(raw?.port, DEFAULT_DEPLOYMENT_TEMPLATE.port, 1, 65535),
    serverName: normalizeString(raw?.serverName, DEFAULT_DEPLOYMENT_TEMPLATE.serverName),
    rateLimit: normalizeNumber(raw?.rateLimit, DEFAULT_DEPLOYMENT_TEMPLATE.rateLimit, 1, 100000),
    upstream: normalizeString(raw?.upstream, DEFAULT_DEPLOYMENT_TEMPLATE.upstream),
    namespace: normalizeString(raw?.namespace, DEFAULT_DEPLOYMENT_TEMPLATE.namespace),
    image: normalizeString(raw?.image, DEFAULT_DEPLOYMENT_TEMPLATE.image)
  };
}

export function normalizeDeploymentDefaults(raw: any): DeploymentDefaults {
  const templates = DEPLOYMENT_TARGETS.reduce<Record<DeploymentTarget, DeploymentProfileTemplate>>((acc, target) => {
    acc[target] = normalizeDeploymentTemplate(raw?.profileTemplates?.[target]);
    return acc;
  }, {} as Record<DeploymentTarget, DeploymentProfileTemplate>);

  return {
    serverType: normalizeDeploymentTarget(raw?.serverType, 'nginx'),
    profileTemplates: templates
  };
}

export function normalizeDeviceGateway(raw: any): DeviceGatewaySettings {
  const defaults = cloneDefaultConfig().deviceGateway;
  const aliases = Array.isArray(raw?.aliases)
    ? raw.aliases
        .map((value: any) => normalizeString(value, ''))
        .filter((value: string, index: number, arr: string[]) => value && arr.indexOf(value) === index)
    : defaults.aliases;

  return {
    primaryPath: normalizeString(raw?.primaryPath, defaults.primaryPath) || defaults.primaryPath,
    aliases: aliases.length > 0 ? aliases : defaults.aliases,
    syncMaskApiKeys: normalizeBoolean(raw?.syncMaskApiKeys, defaults.syncMaskApiKeys),
    firmwareLocalHost: normalizeString(raw?.firmwareLocalHost, defaults.firmwareLocalHost) || defaults.firmwareLocalHost,
    wifiSSID: normalizeString(raw?.wifiSSID, defaults.wifiSSID) || defaults.wifiSSID,
    localPort: normalizeNumber(raw?.localPort, defaults.localPort, 1, 65535),
    firmwareChannel: normalizeString(raw?.firmwareChannel, defaults.firmwareChannel) || defaults.firmwareChannel,
    firmwareRetentionDays: normalizeNumber(raw?.firmwareRetentionDays, defaults.firmwareRetentionDays, 1, 3650),
    statusAliasEnabled: normalizeBoolean(raw?.statusAliasEnabled, defaults.statusAliasEnabled)
  };
}

export function normalizePlatformConfig(raw: any, current?: PlatformConfig): PlatformConfig {
  const base = current || cloneDefaultConfig();
  return {
    antiBot: {
      enabled: normalizeBoolean(raw?.antiBot?.enabled, base.antiBot.enabled),
      requestThreshold: normalizeNumber(raw?.antiBot?.requestThreshold, base.antiBot.requestThreshold, 1, 100000),
      fastRequestThreshold: normalizeNumber(raw?.antiBot?.fastRequestThreshold, base.antiBot.fastRequestThreshold, 1, 100000),
      blockDuration: normalizeNumber(raw?.antiBot?.blockDuration, base.antiBot.blockDuration, 1, 86400 * 30)
    },
    rateLimit: {
      requestsPerMinute: normalizeNumber(raw?.rateLimit?.requestsPerMinute, base.rateLimit.requestsPerMinute, 1, 100000),
      windowSeconds: normalizeNumber(raw?.rateLimit?.windowSeconds, base.rateLimit.windowSeconds, 1, 3600)
    },
    notifications: normalizeNotifications(raw?.notifications ?? base.notifications),
    aiRouting: normalizeAiRouting(raw?.aiRouting, base.aiRouting),
    privacyMode: normalizePrivacyMode(raw?.privacyMode, base.privacyMode),
    auditArchive: normalizeAuditArchive(raw?.auditArchive ?? base.auditArchive),
    fastpath: normalizeFastpath(raw?.fastpath ?? base.fastpath),
    detectionPipeline: normalizeDetectionPipeline(raw?.detectionPipeline ?? base.detectionPipeline),
    deploymentDefaults: normalizeDeploymentDefaults(raw?.deploymentDefaults ?? base.deploymentDefaults),
    deviceGateway: normalizeDeviceGateway(raw?.deviceGateway ?? base.deviceGateway)
  };
}

export function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class PlatformConfigService {
  private schemaReady = false;
  private readonly configCache = new Map<string, { value: PlatformConfig; expiresAt: number }>();

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_config (
        tenant_id TEXT PRIMARY KEY,
        anti_bot_enabled INTEGER NOT NULL DEFAULT 1,
        anti_bot_request_threshold INTEGER NOT NULL DEFAULT 100,
        anti_bot_fast_request_threshold INTEGER NOT NULL DEFAULT 10,
        anti_bot_block_duration INTEGER NOT NULL DEFAULT 3600,
        rate_limit_requests_per_minute INTEGER NOT NULL DEFAULT 60,
        rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,
        notifications_json TEXT NOT NULL DEFAULT '{}',
        ai_routing_json TEXT NOT NULL DEFAULT '{}',
        privacy_mode TEXT NOT NULL DEFAULT 'off',
        audit_archive_json TEXT NOT NULL DEFAULT '{}',
        fastpath_json TEXT NOT NULL DEFAULT '{}',
        detection_pipeline_json TEXT NOT NULL DEFAULT '{}',
        deployment_defaults_json TEXT NOT NULL DEFAULT '{}',
        device_gateway_json TEXT NOT NULL DEFAULT '{}',
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        alert_id TEXT,
        channel_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_label TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        target TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        response_json TEXT,
        error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        dedupe_key TEXT,
        next_attempt_at TEXT,
        terminal_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_tenant ON notification_deliveries(tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS audit_segments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        segment_key TEXT NOT NULL,
        chain_hash TEXT NOT NULL,
        object_key TEXT,
        lock_mode TEXT NOT NULL DEFAULT 'hash_chain',
        status TEXT NOT NULL DEFAULT 'pending',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_segments_tenant ON audit_segments(tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        scenario TEXT NOT NULL,
        qps REAL,
        p95_latency_ms REAL,
        agent_cpu_pct REAL,
        agent_memory_mb REAL,
        local_ai_latency_ms REAL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_benchmark_runs_tenant ON benchmark_runs(tenant_id, created_at DESC);
    `);

    const migrations = [
      `ALTER TABLE platform_config ADD COLUMN notifications_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE platform_config ADD COLUMN ai_routing_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE platform_config ADD COLUMN privacy_mode TEXT NOT NULL DEFAULT 'off'`,
      `ALTER TABLE platform_config ADD COLUMN audit_archive_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE platform_config ADD COLUMN fastpath_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE platform_config ADD COLUMN detection_pipeline_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE platform_config ADD COLUMN deployment_defaults_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE platform_config ADD COLUMN device_gateway_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE notification_deliveries ADD COLUMN dedupe_key TEXT`,
      `ALTER TABLE notification_deliveries ADD COLUMN next_attempt_at TEXT`,
      `ALTER TABLE notification_deliveries ADD COLUMN terminal_at TEXT`
    ];

    for (const migration of migrations) {
      try {
        db.exec(migration);
      } catch (error: any) {
        if (!String(error?.message || '').includes('duplicate column name')) {
          throw error;
        }
      }
    }

    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(status, next_attempt_at, created_at)`);
    } catch (error: any) {
      logger.warn('Failed to create notification due index', { error: error?.message });
    }

    this.schemaReady = true;
  }

  private assertPrepared(): void {
    if (this.schemaReady) {
      return;
    }

    if (process.env.NODE_ENV === 'test') {
      this.prepare();
      return;
    }

    throw new Error('Platform config schema not initialized. Call platformConfigService.prepare() during bootstrap.');
  }

  async getConfig(tenantId: string): Promise<PlatformConfig> {
    this.assertPrepared();
    const cached = this.getCachedConfig(tenantId);
    if (cached) {
      return cached;
    }

    const row = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT *
          FROM platform_config
          WHERE tenant_id = $1
          LIMIT 1
        `, [tenantId])
      : getDatabase().prepare(`
          SELECT *
          FROM platform_config
          WHERE tenant_id = ?
          LIMIT 1
        `).get(tenantId) as any;

    const defaults = cloneDefaultConfig();
    if (!row) {
      this.cacheConfig(tenantId, defaults);
      return cloneConfig(defaults);
    }

    const normalized = normalizePlatformConfig({
      antiBot: {
        enabled: Boolean(row.anti_bot_enabled),
        requestThreshold: Number(row.anti_bot_request_threshold || defaults.antiBot.requestThreshold),
        fastRequestThreshold: Number(row.anti_bot_fast_request_threshold || defaults.antiBot.fastRequestThreshold),
        blockDuration: Number(row.anti_bot_block_duration || defaults.antiBot.blockDuration)
      },
      rateLimit: {
        requestsPerMinute: Number(row.rate_limit_requests_per_minute || defaults.rateLimit.requestsPerMinute),
        windowSeconds: Number(row.rate_limit_window_seconds || defaults.rateLimit.windowSeconds)
      },
      notifications: openNotificationSecretsFromStorage(parseJson(row.notifications_json, defaults.notifications)),
      aiRouting: parseJson(row.ai_routing_json, defaults.aiRouting),
      privacyMode: normalizePrivacyMode(row.privacy_mode, defaults.privacyMode),
      auditArchive: parseJson(row.audit_archive_json, defaults.auditArchive),
      fastpath: parseJson(row.fastpath_json, defaults.fastpath),
      detectionPipeline: parseJson(row.detection_pipeline_json, defaults.detectionPipeline),
      deploymentDefaults: parseJson(row.deployment_defaults_json, defaults.deploymentDefaults),
      deviceGateway: parseJson(row.device_gateway_json, defaults.deviceGateway)
    }, defaults);
    this.cacheConfig(tenantId, normalized);
    return cloneConfig(normalized);
  }

  async saveConfig(tenantId: string, rawConfig: any, actorId: string): Promise<PlatformConfig> {
    this.assertPrepared();
    const current = await this.getConfig(tenantId);
    const merged = normalizePlatformConfig(rawConfig, current);
    // N5-2: seal channel secrets for at-rest storage (sentinel values from
    // the masked UI form are restored to the current secret first).
    const notificationsForStorage = sealNotificationSecretsForStorage(merged.notifications, current.notifications);
    const now = new Date().toISOString();
    const existing = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT created_at
          FROM platform_config
          WHERE tenant_id = $1
          LIMIT 1
        `, [tenantId])
      : getDatabase().prepare(`
          SELECT created_at
          FROM platform_config
          WHERE tenant_id = ?
          LIMIT 1
        `).get(tenantId) as { created_at?: string } | undefined;

    const payload = {
      tenant_id: tenantId,
      anti_bot_enabled: merged.antiBot.enabled ? 1 : 0,
      anti_bot_request_threshold: merged.antiBot.requestThreshold,
      anti_bot_fast_request_threshold: merged.antiBot.fastRequestThreshold,
      anti_bot_block_duration: merged.antiBot.blockDuration,
      rate_limit_requests_per_minute: merged.rateLimit.requestsPerMinute,
      rate_limit_window_seconds: merged.rateLimit.windowSeconds,
      notifications_json: JSON.stringify(notificationsForStorage),
      ai_routing_json: JSON.stringify(merged.aiRouting),
      privacy_mode: merged.privacyMode,
      audit_archive_json: JSON.stringify(merged.auditArchive),
      fastpath_json: JSON.stringify(merged.fastpath),
      detection_pipeline_json: JSON.stringify(merged.detectionPipeline),
      deployment_defaults_json: JSON.stringify(merged.deploymentDefaults),
      device_gateway_json: JSON.stringify(merged.deviceGateway),
      updated_by: actorId,
      updated_at: now,
      created_at: existing?.created_at || now
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        INSERT INTO platform_config (
          tenant_id,
          anti_bot_enabled,
          anti_bot_request_threshold,
          anti_bot_fast_request_threshold,
          anti_bot_block_duration,
          rate_limit_requests_per_minute,
          rate_limit_window_seconds,
          notifications_json,
          ai_routing_json,
          privacy_mode,
          audit_archive_json,
          fastpath_json,
          detection_pipeline_json,
          deployment_defaults_json,
          device_gateway_json,
          updated_by,
          updated_at,
          created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          anti_bot_enabled = EXCLUDED.anti_bot_enabled,
          anti_bot_request_threshold = EXCLUDED.anti_bot_request_threshold,
          anti_bot_fast_request_threshold = EXCLUDED.anti_bot_fast_request_threshold,
          anti_bot_block_duration = EXCLUDED.anti_bot_block_duration,
          rate_limit_requests_per_minute = EXCLUDED.rate_limit_requests_per_minute,
          rate_limit_window_seconds = EXCLUDED.rate_limit_window_seconds,
          notifications_json = EXCLUDED.notifications_json,
          ai_routing_json = EXCLUDED.ai_routing_json,
          privacy_mode = EXCLUDED.privacy_mode,
          audit_archive_json = EXCLUDED.audit_archive_json,
          fastpath_json = EXCLUDED.fastpath_json,
          detection_pipeline_json = EXCLUDED.detection_pipeline_json,
          deployment_defaults_json = EXCLUDED.deployment_defaults_json,
          device_gateway_json = EXCLUDED.device_gateway_json,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
      `, [
        payload.tenant_id,
        payload.anti_bot_enabled,
        payload.anti_bot_request_threshold,
        payload.anti_bot_fast_request_threshold,
        payload.anti_bot_block_duration,
        payload.rate_limit_requests_per_minute,
        payload.rate_limit_window_seconds,
        payload.notifications_json,
        payload.ai_routing_json,
        payload.privacy_mode,
        payload.audit_archive_json,
        payload.fastpath_json,
        payload.detection_pipeline_json,
        payload.deployment_defaults_json,
        payload.device_gateway_json,
        payload.updated_by,
        payload.updated_at,
        payload.created_at
      ]);
    }

    getDatabase().prepare(`
      INSERT INTO platform_config (
        tenant_id,
        anti_bot_enabled,
        anti_bot_request_threshold,
        anti_bot_fast_request_threshold,
        anti_bot_block_duration,
        rate_limit_requests_per_minute,
        rate_limit_window_seconds,
        notifications_json,
        ai_routing_json,
        privacy_mode,
        audit_archive_json,
        fastpath_json,
        detection_pipeline_json,
        deployment_defaults_json,
        device_gateway_json,
        updated_by,
        updated_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        anti_bot_enabled = excluded.anti_bot_enabled,
        anti_bot_request_threshold = excluded.anti_bot_request_threshold,
        anti_bot_fast_request_threshold = excluded.anti_bot_fast_request_threshold,
        anti_bot_block_duration = excluded.anti_bot_block_duration,
        rate_limit_requests_per_minute = excluded.rate_limit_requests_per_minute,
        rate_limit_window_seconds = excluded.rate_limit_window_seconds,
        notifications_json = excluded.notifications_json,
        ai_routing_json = excluded.ai_routing_json,
        privacy_mode = excluded.privacy_mode,
        audit_archive_json = excluded.audit_archive_json,
        fastpath_json = excluded.fastpath_json,
        detection_pipeline_json = excluded.detection_pipeline_json,
        deployment_defaults_json = excluded.deployment_defaults_json,
        device_gateway_json = excluded.device_gateway_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      payload.tenant_id,
      payload.anti_bot_enabled,
      payload.anti_bot_request_threshold,
      payload.anti_bot_fast_request_threshold,
      payload.anti_bot_block_duration,
      payload.rate_limit_requests_per_minute,
      payload.rate_limit_window_seconds,
      payload.notifications_json,
      payload.ai_routing_json,
      payload.privacy_mode,
      payload.audit_archive_json,
      payload.fastpath_json,
      payload.detection_pipeline_json,
      payload.deployment_defaults_json,
      payload.device_gateway_json,
      payload.updated_by,
      payload.updated_at,
      payload.created_at
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('platform_config', payload);
    }

    this.cacheConfig(tenantId, merged);
    return cloneConfig(merged);
  }

  async createNotificationDelivery(input: {
    tenantId: string;
    alertId?: string;
    channelId: string;
    channelType: NotificationChannelType;
    channelLabel: string;
    status: NotificationDeliveryStatus;
    severity: SeverityLevel;
    target: string;
    payload: Record<string, any>;
    response?: Record<string, any>;
    error?: string;
    attemptCount?: number;
    dedupeKey?: string;
    nextAttemptAt?: string;
    terminalAt?: string;
  }): Promise<NotificationDeliveryRecord> {
    this.assertPrepared();
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      alert_id: input.alertId || null,
      channel_id: input.channelId,
      channel_type: input.channelType,
      channel_label: input.channelLabel,
      status: input.status,
      severity: input.severity,
      target: input.target,
      payload_json: JSON.stringify(input.payload || {}),
      response_json: JSON.stringify(input.response || {}),
      error: input.error || null,
      attempt_count: normalizeNumber(input.attemptCount, 0, 0, 100),
      dedupe_key: input.dedupeKey || null,
      next_attempt_at: input.nextAttemptAt || null,
      terminal_at: input.terminalAt || null,
      created_at: now,
      updated_at: now
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        INSERT INTO notification_deliveries (
          id, tenant_id, alert_id, channel_id, channel_type, channel_label, status,
          severity, target, payload_json, response_json, error, attempt_count, dedupe_key, next_attempt_at, terminal_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `, [
        row.id,
        row.tenant_id,
        row.alert_id,
        row.channel_id,
        row.channel_type,
        row.channel_label,
        row.status,
        row.severity,
        row.target,
        row.payload_json,
        row.response_json,
        row.error,
        row.attempt_count,
        row.dedupe_key,
        row.next_attempt_at,
        row.terminal_at,
        row.created_at,
        row.updated_at
      ]);
    }

    getDatabase().prepare(`
      INSERT INTO notification_deliveries (
        id, tenant_id, alert_id, channel_id, channel_type, channel_label, status,
        severity, target, payload_json, response_json, error, attempt_count, dedupe_key, next_attempt_at, terminal_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.alert_id,
      row.channel_id,
      row.channel_type,
      row.channel_label,
      row.status,
      row.severity,
      row.target,
      row.payload_json,
      row.response_json,
      row.error,
      row.attempt_count,
      row.dedupe_key,
      row.next_attempt_at,
      row.terminal_at,
      row.created_at,
      row.updated_at
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('notification_deliveries', row);
    }

    return this.mapDeliveryRow(row);
  }

  async updateNotificationDelivery(
    tenantId: string,
    id: string,
    patch: Partial<Pick<NotificationDeliveryRecord, 'status' | 'response' | 'error' | 'attemptCount' | 'nextAttemptAt' | 'terminalAt'>>
  ): Promise<NotificationDeliveryRecord | null> {
    this.assertPrepared();
    const existing = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT *
          FROM notification_deliveries
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1
        `, [tenantId, id])
      : getDatabase().prepare(`
          SELECT *
          FROM notification_deliveries
          WHERE tenant_id = ? AND id = ?
          LIMIT 1
        `).get(tenantId, id) as any;

    if (!existing) {
      return null;
    }

    const row = {
      ...existing,
      status: patch.status || existing.status,
      response_json: JSON.stringify(patch.response ?? parseJson(existing.response_json, {})),
      error: patch.error ?? existing.error ?? null,
      attempt_count: normalizeNumber(patch.attemptCount, Number(existing.attempt_count || 0), 0, 100),
      next_attempt_at: patch.nextAttemptAt !== undefined ? patch.nextAttemptAt || null : existing.next_attempt_at || null,
      terminal_at: patch.terminalAt !== undefined ? patch.terminalAt || null : existing.terminal_at || null,
      updated_at: new Date().toISOString()
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        UPDATE notification_deliveries
        SET status = $1, response_json = $2, error = $3, attempt_count = $4, next_attempt_at = $5, terminal_at = $6, updated_at = $7
        WHERE tenant_id = $8 AND id = $9
      `, [
        row.status,
        row.response_json,
        row.error,
        row.attempt_count,
        row.next_attempt_at,
        row.terminal_at,
        row.updated_at,
        tenantId,
        id
      ]);
    }

    getDatabase().prepare(`
      UPDATE notification_deliveries
      SET status = ?, response_json = ?, error = ?, attempt_count = ?, next_attempt_at = ?, terminal_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `).run(
      row.status,
      row.response_json,
      row.error,
      row.attempt_count,
      row.next_attempt_at,
      row.terminal_at,
      row.updated_at,
      tenantId,
      id
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('notification_deliveries', row);
    }

    return this.mapDeliveryRow(row);
  }

  async listNotificationDeliveries(tenantId: string, limit = 20): Promise<NotificationDeliveryRecord[]> {
    this.assertPrepared();
    const rows = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryAll<any>(`
          SELECT *
          FROM notification_deliveries
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `, [tenantId, limit])
      : getDatabase().prepare(`
          SELECT *
          FROM notification_deliveries
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(tenantId, limit) as any[];

    return rows.map((row) => this.mapDeliveryRow(row));
  }

  async listDueNotificationDeliveries(limit = 50): Promise<NotificationDeliveryRecord[]> {
    this.assertPrepared();
    const now = new Date().toISOString();
    const rows = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryAll<any>(`
          SELECT *
          FROM notification_deliveries
          WHERE status IN ('queued', 'retrying')
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
          ORDER BY created_at ASC
          LIMIT $2
        `, [now, limit])
      : getDatabase().prepare(`
          SELECT *
          FROM notification_deliveries
          WHERE status IN ('queued', 'retrying')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY created_at ASC
          LIMIT ?
        `).all(now, limit) as any[];

    return rows.map((row) => this.mapDeliveryRow(row));
  }

  async findNotificationDeliveryByDedupe(tenantId: string, dedupeKey: string, afterIso: string): Promise<NotificationDeliveryRecord | null> {
    this.assertPrepared();
    const row = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT *
          FROM notification_deliveries
          WHERE tenant_id = $1
            AND dedupe_key = $2
            AND created_at >= $3
            AND status IN ('queued', 'sending', 'retrying', 'sent')
          ORDER BY created_at DESC
          LIMIT 1
        `, [tenantId, dedupeKey, afterIso])
      : getDatabase().prepare(`
          SELECT *
          FROM notification_deliveries
          WHERE tenant_id = ?
            AND dedupe_key = ?
            AND created_at >= ?
            AND status IN ('queued', 'sending', 'retrying', 'sent')
          ORDER BY created_at DESC
          LIMIT 1
        `).get(tenantId, dedupeKey, afterIso) as any;

    return row ? this.mapDeliveryRow(row) : null;
  }

  private mapDeliveryRow(row: any): NotificationDeliveryRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      alertId: row.alert_id || undefined,
      channelId: row.channel_id,
      channelType: row.channel_type,
      channelLabel: row.channel_label,
      status: row.status,
      severity: normalizeSeverity(row.severity, 'medium'),
      target: row.target,
      payload: parseJson(row.payload_json, {}),
      response: parseJson(row.response_json, {}),
      error: row.error || undefined,
      attemptCount: Number(row.attempt_count || 0),
      dedupeKey: row.dedupe_key || undefined,
      nextAttemptAt: row.next_attempt_at || undefined,
      terminalAt: row.terminal_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private getCachedConfig(tenantId: string): PlatformConfig | null {
    const cached = this.configCache.get(tenantId);
    if (!cached) {
      return null;
    }
    if (Date.now() >= cached.expiresAt) {
      this.configCache.delete(tenantId);
      return null;
    }
    return cloneConfig(cached.value);
  }

  private cacheConfig(tenantId: string, config: PlatformConfig): void {
    const ttl = Math.max(1000, Number(config.fastpath?.configCacheTtlMs || 30000));
    this.configCache.set(tenantId, {
      value: cloneConfig(config),
      expiresAt: Date.now() + ttl
    });
  }
}

export const platformConfigService = new PlatformConfigService();
