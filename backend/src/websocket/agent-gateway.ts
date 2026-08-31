/**
 * WebSocket Agent Gateway - SECURE VERSION
 *
 * SECURITY FIXES:
 * - Server-side agent authentication
 * - Command signing with HMAC
 * - Comprehensive audit logging
 * - Rate limiting (Redis-backed with memory fallback)
 * - Strict IP validation
 * - Redis degradation support
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { isIPv4, isIPv6 } from 'net';
import logger from '../utils/logger';
import { AgentStatus, ThreatAlert } from '../agent';
import { verifyTokenAsyncDetailed, AuthenticatedRequest } from '../middleware/auth.middleware';
import agentAuthService from '../security/agent-auth.service';
import {
  verifyInboundEnvelope,
  INBOUND_ENVELOPE_TEST_SECRET
} from '../security/inbound-envelope';
import commandSigningService from '../security/command-signing.service';
import auditLogger from '../security/audit-logger.service';
import { getTrafficStats } from '../services/traffic-stats.service';
import { getAgentSystem } from '../services/agent-system.service';
import {
  isTestRuntime,
  wsTestAgentAdapter,
  wsTestDashboardUserAdapter
} from '../testing/test-runtime-adapter';
import { commandDispatcherService } from '../services/command-dispatcher.service';
import { socketRateLimitService } from '../services/socket-rate-limit.service';
import { detectionPipelineService } from '../services/detection-pipeline.service';
import type { TenantContext } from '../core/tenant/tenant-context';
import {
  buildPlatformTenantContext,
  resolveAgentTenantContext,
  resolveUserTenantContext,
  PLATFORM_TENANT_ID
} from '../core/tenant/tenant-context';
import type {
  AgentClientToServerEvents,
  AgentServerToClientEvents
} from './socket-events';
import {
  validateAgentHeartbeatPayload,
  validateAgentRegisterPayload,
  validateDashboardAgentCommandPayload,
  validateDashboardIpCommandPayload
} from './socket-payload-validator';
import { normalizeRole } from '../security/permissions';

// SECURITY (audit 2026-08, P0): per-message authorization for dashboard
// commands. The REST routes for scan/block/unblock are requireRole('admin');
// the WebSocket handlers previously only checked tenant access, so a
// viewer/auditor could do over WS what REST rejects. Mirror the REST role
// contract exactly — authentication and tenant match are NOT permissions.
function isDashboardAgentCommandAuthorized(user: { role?: string } | undefined): boolean {
  return normalizeRole(user?.role) === 'platform_admin';
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;
const USER_RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_USER_REQUESTS_PER_WINDOW = 150; // Slightly higher than per-socket limit
const DEFAULT_DASHBOARD_SESSION_REVALIDATE_MS = 60_000;

function resolveDashboardSessionRevalidateMs(): number {
  const parsed = Number(process.env.WS_DASHBOARD_SESSION_REVALIDATE_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return process.env.NODE_ENV === 'test'
      ? Math.max(1, Math.floor(parsed))
      : Math.max(5_000, Math.floor(parsed));
  }
  return DEFAULT_DASHBOARD_SESSION_REVALIDATE_MS;
}

const DEFAULT_AGENT_SESSION_REVALIDATE_MS = 60_000;
const DEFAULT_AGENT_HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_AGENT_HEARTBEAT_SWEEP_MS = 30_000;

function resolveAgentSessionRevalidateMs(): number {
  const parsed = Number(process.env.WS_AGENT_SESSION_REVALIDATE_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return process.env.NODE_ENV === 'test'
      ? Math.max(1, Math.floor(parsed))
      : Math.max(5_000, Math.floor(parsed));
  }
  return DEFAULT_AGENT_SESSION_REVALIDATE_MS;
}

function resolveAgentHeartbeatTimeoutMs(): number {
  const parsed = Number(process.env.WS_AGENT_HEARTBEAT_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return process.env.NODE_ENV === 'test'
      ? Math.max(1, Math.floor(parsed))
      : Math.max(30_000, Math.floor(parsed));
  }
  return DEFAULT_AGENT_HEARTBEAT_TIMEOUT_MS;
}

function resolveAgentHeartbeatSweepMs(): number {
  const parsed = Number(process.env.WS_AGENT_HEARTBEAT_SWEEP_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return process.env.NODE_ENV === 'test'
      ? Math.max(1, Math.floor(parsed))
      : Math.max(1_000, Math.floor(parsed));
  }
  return DEFAULT_AGENT_HEARTBEAT_SWEEP_MS;
}

/**
 * SECURITY (Sprint 5 Wave 2 · F5): per-agent-event rate limits. Each
 * inbound agent event has its own budget so a noisy emitter on one
 * channel (e.g. traffic_stats) cannot drown out a critical channel
 * (e.g. threat). The composite key is .
 */
const AGENT_EVENT_LIMITS: Record<string, number> = {
  'agent:heartbeat': 100,
  'agent:traffic_stats': 200,
  'agent:threat': 30,
  'agent:scan_result': 30,
  'agent:command_ack': 30,
  'agent:command_failed': 30,
  'agent:log': 60,
  'agent:review_sample': 60
};

function isDetectionBootstrapError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('database not initialized')
    || message.includes('call initdatabase() first')
    || message.includes('detection pipeline storage not initialized');
}

/**
 * SECURITY (Sprint 5 Wave 2 · F5): enforce a per-agent-event rate limit
 * for one of the 8 inbound agent events. Returns true when the event is
 * allowed to proceed, false when it was rate-limited (in which case the
 * socket has already been sent a  frame and a
 * tamper-evident audit row recorded).
 */
async function enforceAgentEventRateLimit(
  socket: Socket,
  agentId: string,
  eventName: string,
  tenantId: string
): Promise<boolean> {
  const limit = AGENT_EVENT_LIMITS[eventName];
  if (!limit) {
    return true; // event has no per-event budget configured
  }
  const result = await socketRateLimitService.check({
    tenantId,
    key: `agent-event:${agentId}:${eventName}`,
    windowMs: RATE_LIMIT_WINDOW,
    limit,
    sourceIp: socket.handshake.address,
    sessionId: socket.id,
    headers: socket.handshake.headers as Record<string, any>,
    protocol: 'ws-agent'
  });
  if (!result.allowed) {
    socket.emit('rate_limit_exceeded', {
      event: eventName,
      limit,
      windowMs: RATE_LIMIT_WINDOW,
      retryAfterMs: Math.max(0, (result.resetAtMs || 0) - Date.now()),
      remaining: result.remaining ?? 0
    });
    auditLogger.log({
      eventType: 'rate_limit_exceeded',
      category: 'agent',
      severity: 'warning',
      actor: { type: 'agent', id: agentId },
      action: "agent_event_rate_limit",
      details: {
        event: eventName,
        limit,
        windowMs: RATE_LIMIT_WINDOW,
        decisionSource: result.decisionSource,
        riskFlags: result.riskFlags
      },
      status: 'failure'
    });
    return false;
  }
  return true;
}

/**
 * SECURITY FIX CVE-2026-301: User-level rate limiting
 * Prevents bypass by opening multiple connections
 * Now uses Redis-backed rate limiter
 */
async function checkUserRateLimit(userId: string, tenantId: string, socket: Socket): Promise<boolean> {
  const result = await socketRateLimitService.check({
    tenantId,
    key: `user:${userId}`,
    windowMs: USER_RATE_LIMIT_WINDOW,
    limit: MAX_USER_REQUESTS_PER_WINDOW,
    sourceIp: socket.handshake.address,
    sessionId: socket.id,
    headers: socket.handshake.headers as Record<string, any>,
    protocol: 'ws-agent'
  });

  if (!result.allowed) {
    auditLogger.log({
      eventType: 'rate_limit_exceeded',
      category: 'auth',
      severity: 'warning',
      actor: { type: 'user', id: userId },
      action: 'rate_limit_check',
      details: {
        limit: MAX_USER_REQUESTS_PER_WINDOW,
        window: USER_RATE_LIMIT_WINDOW,
        decisionSource: result.decisionSource,
        riskFlags: result.riskFlags
      },
      status: 'failure'
    });
  }

  return result.allowed;
}

/**
 * Socket-level rate limiting (for individual connections)
 */
async function checkSocketRateLimit(socket: Socket, tenantId: string): Promise<boolean> {
  const result = await socketRateLimitService.check({
    tenantId,
    key: `socket:${socket.id}`,
    windowMs: RATE_LIMIT_WINDOW,
    limit: MAX_REQUESTS_PER_WINDOW,
    sourceIp: socket.handshake.address,
    sessionId: socket.id,
    headers: socket.handshake.headers as Record<string, any>,
    protocol: 'ws-agent'
  });
  return result.allowed;
}

/**
 * SECURITY FIX CVE-2026-300: Enhanced IP address validation
 * Uses Node's built-in net module for comprehensive validation
 */
function isValidIPAddress(ip: string): boolean {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  // Trim whitespace
  ip = ip.trim();

  // Check for reasonable length limits
  if (ip.length > 45) { // Max IPv6 with zone index
    return false;
  }

  // Handle IPv4-mapped IPv6 addresses (::ffff:192.0.2.1)
  if (ip.startsWith('::ffff:')) {
    const ipv4Part = ip.substring(7);
    return isIPv4(ipv4Part);
  }

  // Use Node's built-in validation
  if (isIPv4(ip) || isIPv6(ip)) {
    // Additional check: prevent injection attempts
    // Reject if contains shell metacharacters or suspicious patterns
    const dangerousPatterns = [
      /\n/, /\r/, /\t/, // Control characters
      /\\$/, // Trailing backslash (escape attempt)
      /\$\(/, // Command substitution
      /`/, // Backtick command substitution
      /\|\s*\w/, // Pipe with command
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(ip)) {
        logger.warn(`Suspicious pattern detected in IP address`, { ip });
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * SECURITY FIX: Check for shell metacharacters
 */
function containsShellMetacharacters(input: string): boolean {
  const dangerousChars = /[;&|`$(){}[\]<>'"!#%^*?\n\r\t\\]/;
  return dangerousChars.test(input);
}

function extractCookieNames(cookieHeader: string | undefined): string[] {
  if (!cookieHeader) {
    return [];
  }
  return cookieHeader
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim() || '')
    .filter((name) => Boolean(name))
    .slice(0, 20);
}

/**
 * SECURITY (R2-F001): never persist raw cookie values into the audit trail.
 * A dashboard client that still carries a live refreshToken cookie (the
 * 24h-7d window after the accessToken cookie expires) but no accessToken
 * used to leak the full refresh token JWT via this audit entry.
 *
 * The audit key deliberately avoids the substring "cookie": recursiveSanitize
 * redacts any field whose name contains it (REDACT_FIELDS 'cookie'), which
 * would blank the presence/name diagnostics this structure exists for. The
 * payload is value-free (names only, capped at 20) so nothing secret can
 * leak through the renamed key.
 */
function auditCookiePresence(cookieHeader: string | undefined): { present: boolean; cookieNames: string[] } {
  return {
    present: Boolean(cookieHeader),
    cookieNames: extractCookieNames(cookieHeader)
  };
}

/**
 * SECURITY (audit 2026-08, AUD-03-4): inbound envelope enforcement for
 * HIGH-severity agent events. Returns the verified payload body, or null
 * after emitting an error + writing a tamper-evident rejection audit.
 * Wire shape: `{ envelope: {...}, ...payload }` — the digest is computed
 * over the payload WITHOUT the envelope field.
 */
async function enforceAgentInboundEnvelope(
    socket: Socket,
    agentId: string,
    eventType: string,
    data: any
): Promise<Record<string, any> | null> {
    if (!data || typeof data !== 'object' || !data.envelope) {
        try {
            await auditLogger.log({
                eventType: 'inbound_envelope_rejected',
                category: 'agent',
                severity: 'warning',
                actor: { type: 'agent', id: agentId },
                action: eventType,
                details: { reason: 'envelope_missing', eventType },
                status: 'failure'
            });
        } catch {
            // rejection audit is non-blocking
        }
        socket.emit('error', { message: 'backend.inbound_envelope_required', reason: 'envelope_missing' });
        return null;
    }
    const { envelope, ...body } = data;
    const secret = isTestRuntime()
        ? INBOUND_ENVELOPE_TEST_SECRET
        : agentAuthService.getAgentSecretKey(agentId);
    const verification = await verifyInboundEnvelope(body, envelope, {
        secret,
        expectedEventType: eventType,
        expectedSessionId: socket.id
    });
    if (!verification.ok) {
        try {
            await auditLogger.log({
                eventType: 'inbound_envelope_rejected',
                category: 'agent',
                severity: verification.reason === 'nonce_replay' ? 'critical' : 'warning',
                actor: { type: 'agent', id: agentId },
                action: eventType,
                details: { reason: verification.reason, eventType },
                status: 'failure'
            });
        } catch {
            // rejection audit is non-blocking
        }
        socket.emit('error', { message: 'backend.inbound_envelope_rejected', reason: verification.reason });
        return null;
    }
    return body;
}

interface ConnectedAgent {
  socketId: string;
  agentId: string;
  hostname: string;
  platform: string;
  tenantId: string;
  /**
   * SECURITY (audit 2026-08, batch 3): server-side connection generation.
   * Every successful (re)connection for the same agentId produces a new
   * generation; the superseded socket is explicitly disconnected. Handlers
   * must verify socket ownership (socketId === registry entry) before any
   * state mutation, and disconnect must only clean up when the departing
   * socket still owns the registry entry.
   */
  generation: number;
  registration?: any;
  authenticated: boolean;
  lastHeartbeat: Date;
  status: AgentStatus | null;
  /** AUD-08-1: telemetry provenance — last accepted monotonic event seq. */
  lastTelemetrySeq?: number;
  isSynthetic?: boolean;
  commandHandler?: (command: { type: string; payload?: any; userId?: string; metadata?: any }) => boolean;
}

/**
 * AUD-08-1: telemetry provenance. Agent-reported telemetry carries
 * `sourceTrust: 'agent_reported'` end-to-end so downstream consumers never
 * mistake self-reported signals for control-plane-verified facts, and a
 * monotonic per-agent sequence (`seq`) demotes regression/replayed
 * telemetry instead of letting it overwrite newer state.
 */
function telemetrySeqClaim(data: any): number | undefined {
  const seq = data?.seq;
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 ? seq : undefined;
}

function isStaleTelemetrySeq(agent: ConnectedAgent | undefined, seq: number | undefined): boolean {
  if (seq === undefined || !agent) return false;
  return agent.lastTelemetrySeq !== undefined && seq <= agent.lastTelemetrySeq;
}

interface DashboardClient {
  userId: string;
  socketId: string;
  tenantId: string;
}

export class AgentGateway {
  private io: SocketIOServer<AgentClientToServerEvents, AgentServerToClientEvents>;
  private agents: Map<string, ConnectedAgent> = new Map();
  // SECURITY (audit 2026-08, batch 3): monotonic server-side connection
  // generation counter, bumped on every (re)connection of the same agent.
  private connectionGeneration = 0;
  private dashboardClients: Map<string, DashboardClient> = new Map();
  private heartbeatSweepTimer: ReturnType<typeof setInterval>;
  private sessionRevalidationTimers = new Set<ReturnType<typeof setInterval>>();
  private testOnlineCounter = 0;
  // SECURITY FIX D22: per-IP connection cap using Set<socketId> rather
  // than a counter, so two concurrent connects cannot both read
  // count=N and both pass the threshold check (TOCTOU). The set is
  // keyed by socket.id so disconnect cleanly removes the entry.
  private ipConnectionCounts: Map<string, Set<string>> = new Map();
  // SECURITY: the per-IP cap. A single source IP should never open
  // more than 10 simultaneous sockets to the gateway — a higher number
  // is either a misconfigured client (loop) or a credential-spray attempt.
  public static readonly MAX_CONNECTIONS_PER_IP = 10;

  /**
   * Broadcast audit log to dashboard clients
   */
  public broadcastAuditLog(log: any): void {
    this.broadcastToDashboards('audit:log', log, { tenantId: log?.tenantId });
  }

  constructor(httpServer: HttpServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      maxHttpBufferSize: 1e6, // 1MB
      // SECURITY FIX: Disable per-message deflate to prevent zip-bomb attacks via
      // crafted compressed WebSocket frames. With maxHttpBufferSize=1MB the
      // decompressed stream is already capped, but explicit perMessageDeflate:false
      // prevents a future regression if the buffer size is ever increased.
      perMessageDeflate: false
    });

    this.setupAuthentication();
    this.setupEventHandlers();
    this.heartbeatSweepTimer = setInterval(() => {
      this.sweepStaleAgents();
    }, resolveAgentHeartbeatSweepMs());
    this.heartbeatSweepTimer.unref?.();

    logger.info('Agent Gateway initialized with secure authentication');
  }

  /**
   * SECURITY FIX: Enhanced authentication middleware
   */
  private setupAuthentication(): void {
    this.io.use(async (socket, next) => {
      const clientType = socket.handshake.auth.type || 'dashboard';
      const clientIp = socket.handshake.address;

      // SECURITY FIX D22: per-IP connection cap. Use Set<socketId> so
      // two simultaneous connects from the same IP cannot both read
      // size=N and both pass the threshold check. The set is keyed
      // by socket.id which is unique per connection.
      if (!this.ipConnectionCounts.has(clientIp)) {
        this.ipConnectionCounts.set(clientIp, new Set());
      }
      const ipSet = this.ipConnectionCounts.get(clientIp)!;
      if (ipSet.size >= AgentGateway.MAX_CONNECTIONS_PER_IP) {
        return next(new Error('backend.too_many_connections_from_ip'));
      }
      ipSet.add(socket.id);
      // Register a one-time cleanup so disconnect is reliable
      // even if the auth flow rejects the connection later.
      socket.once('disconnect', () => {
        const s = this.ipConnectionCounts.get(clientIp);
        if (s) {
          s.delete(socket.id);
          if (s.size === 0) this.ipConnectionCounts.delete(clientIp);
        }
      });

      try {
        if (isTestRuntime()) {
          if (clientType === 'agent') {
            const agent = wsTestAgentAdapter(socket.handshake.auth, socket.id);
            socket.data.agent = agent;
            socket.data.clientType = 'agent';
            socket.data.tenantContext =
              resolveAgentTenantContext(agent.tenantId, 'test-agent') ||
              buildPlatformTenantContext('test-agent');
            return next();
          }

          const user = wsTestDashboardUserAdapter(socket.handshake.auth);
          socket.data.user = user;
          socket.data.clientType = 'dashboard';
          socket.data.tenantContext = resolveUserTenantContext(user, {
            allowAdminPlatformFallback: user.role === 'admin'
          }) || buildPlatformTenantContext('test-dashboard');
          return next();
        }

        // Agent authentication
        if (clientType === 'agent') {
          const agentId = socket.handshake.auth.agentId;
          const apiKey = socket.handshake.auth.apiKey;

          if (!agentId || !apiKey) {
            await auditLogger.logAgent({
              action: 'connect',
              agentId: agentId || 'unknown',
              ip: clientIp,
              success: false,
              details: { reason: 'Missing credentials' }
            });
            return next(new Error('backend.agent_id_and_api_key_required'));
          }

          // Verify agent against database
          const authenticatedAgent = await agentAuthService.verifyAgent(agentId, apiKey);

          if (!authenticatedAgent) {
            await auditLogger.logAgent({
              action: 'connect',
              agentId,
              ip: clientIp,
              success: false,
              details: { reason: 'Invalid credentials' }
            });
            return next(new Error('backend.invalid_agent_credentials'));
          }

          // Attach to socket
          const tenantContext = resolveAgentTenantContext(authenticatedAgent.tenantId, 'agent-auth');
          if (!tenantContext) {
            await auditLogger.logAgent({
              action: 'connect',
              agentId,
              ip: clientIp,
              success: false,
              details: { reason: 'tenant_not_resolved' }
            });
            return next(new Error('backend.agent_tenant_not_resolved'));
          }

          socket.data.agent = authenticatedAgent;
          socket.data.clientType = 'agent';
          socket.data.tenantContext = tenantContext;

          try {
            await auditLogger.logAgent({
              action: 'connect',
              agentId: authenticatedAgent.agentId,
              ip: clientIp,
              success: true,
              details: { hostname: authenticatedAgent.hostname }
            });
          } catch (auditError: any) {
            logger.error('Audit log failed on agent connect (non-blocking)', { error: auditError?.message, agentId: authenticatedAgent.agentId });
          }

          // SECURITY: start periodic revalidation so a revoked agent's API key
          // disconnects its live socket (revokeAgent flips status='revoked' in
          // the DB; this timer polls getAgentStatus directly, bypassing the
          // Redis auth cache that revokeAgent clears). See revalidateAgentSession.
          this.startAgentSessionRevalidation(socket, authenticatedAgent.agentId);

          return next();
        }

        // Dashboard authentication
        // Try to get token from auth.token first, then from cookies
        let token = socket.handshake.auth.token;

        // If no token in auth, try to get from cookie
        if (!token && socket.handshake.headers.cookie) {
          const cookies = socket.handshake.headers.cookie;
          // Parse cookies - handle multiple formats
          const cookiePairs = cookies.split(';').map(c => c.trim());
          for (const pair of cookiePairs) {
            const [name, value] = pair.split('=');
            if (name === 'accessToken' && value) {
              token = value;
              break;
            }
          }
        }

        if (!token) {
          await auditLogger.log({
            eventType: 'dashboard_connection',
            category: 'auth',
            severity: 'warning',
            actor: { type: 'user', id: 'unknown', ip: clientIp },
            action: 'connect',
            details: { reason: 'No token provided', handshakeCookieAudit: auditCookiePresence(socket.handshake.headers.cookie) },
            status: 'failure'
          });
          return next(new Error('backend.authentication_token_required'));
        }

        // Verify JWT
        const verification = await verifyTokenAsyncDetailed(token);
        const user = verification.user;

        if (!user) {
          await auditLogger.log({
            eventType: 'dashboard_connection',
            category: 'auth',
            severity: 'warning',
            actor: { type: 'user', id: 'unknown', ip: clientIp },
            action: 'connect',
            details: { reason: 'Invalid token' },
            status: 'failure'
          });
          return next(new Error(
            verification.failureReason === 'redis_unavailable' ||
            verification.failureReason === 'blacklist_check_failed'
              ? 'backend.auth_blacklist_check_unavailable'
              : 'backend.invalid_or_expired_token'
          ));
        }

        // Attach to socket
        const tenantContext = resolveUserTenantContext(user, {
          allowAdminPlatformFallback: user.role === 'admin'
        });
        if (!tenantContext) {
          await auditLogger.log({
            eventType: 'dashboard_connection',
            category: 'auth',
            severity: 'warning',
            actor: { type: 'user', id: user.userId, ip: clientIp },
            action: 'connect',
            details: { reason: 'tenant_not_resolved', email: user.email },
            status: 'failure'
          });
          return next(new Error('backend.dashboard_tenant_not_resolved'));
        }

        socket.data.user = user;
        socket.data.clientType = 'dashboard';
        socket.data.tenantContext = tenantContext;
        socket.data.authToken = token;

        try {
          await auditLogger.log({
            eventType: 'dashboard_connection',
            category: 'auth',
            severity: 'info',
            actor: { type: 'user', id: user.userId, ip: clientIp },
            action: 'connect',
            details: { email: user.email },
            status: 'success'
          });
        } catch (auditError: any) {
          logger.error('Audit log failed on dashboard connect (non-blocking)', { error: auditError?.message, userId: user.userId });
        }

        next();
      } catch (error: any) {
        logger.error('Authentication error', { error, clientIp });
        return next(new Error('backend.authentication_failed'));
      }
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const clientType = socket.data.clientType;

      logger.info(`Client connected: ${socket.id} (${clientType})`);

      if (clientType === 'agent') {
        this.handleAgentConnection(socket);
      } else {
        this.handleDashboardConnection(socket);
      }

      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  /**
   * SECURITY FIX: Enhanced agent connection handler
   */
  private handleAgentConnection(socket: Socket): void {
    const agent = socket.data.agent;
    const tenantContext = socket.data.tenantContext as TenantContext | undefined;
    if (!agent || !tenantContext) {
      socket.emit('error', { message: 'backend.agent_context_not_available', reason: 'tenant_required' });
      socket.disconnect();
      return;
    }

    // SECURITY (audit 2026-08, batch 3): a new authenticated connection for
    // an already-connected agent SUPERSEDES the old one. The registry entry
    // is swapped to the new socket FIRST (so the old socket's disconnect
    // handler observes stale ownership and leaves the entry alone), and the
    // superseded socket is then force-disconnected with an audit trail — a
    // stale socket can never keep mutating the agent's registry entry or
    // intercept commands after a replacement connection is live.
    const existing = this.agents.get(agent.agentId);
    if (existing && !existing.isSynthetic && existing.socketId !== socket.id) {
      this.connectionGeneration += 1;
      const supersededGeneration = this.connectionGeneration;
      logger.warn('Agent connection superseded by a newer authenticated connection', {
        agentId: agent.agentId,
        oldSocketId: existing.socketId,
        newSocketId: socket.id,
        generation: supersededGeneration
      });
      void Promise.resolve()
        .then(() => auditLogger.logAgent({
          action: 'connection_superseded',
          agentId: agent.agentId,
          success: true,
          details: { oldSocketId: existing.socketId, newSocketId: socket.id, generation: supersededGeneration }
        }))
        .catch((auditError: any) => {
          logger.error('Audit log failed on agent connection supersede (non-blocking)', {
            error: auditError?.message,
            agentId: agent.agentId
          });
        });
    }

    this.connectionGeneration += 1;
    const connectedAgent: ConnectedAgent = {
      socketId: socket.id,
      agentId: agent.agentId,
      hostname: agent.hostname,
      platform: agent.platform,
      tenantId: tenantContext.tenantId,
      generation: this.connectionGeneration,
      authenticated: true,
      lastHeartbeat: new Date(),
      status: null
    };

    this.agents.set(agent.agentId, connectedAgent);

    // Force-disconnect the superseded socket only AFTER the registry swap.
    const supersededSocket = existing && existing.socketId !== socket.id
      ? this.io.sockets.sockets.get(existing.socketId)
      : undefined;
    if (supersededSocket) {
      supersededSocket.disconnect(true);
    }
    if (isTestRuntime()) {
      this.testOnlineCounter += 1;
    }
    this.broadcastAgentListUpdates(tenantContext.tenantId);

    // Send confirmation to agent
    socket.emit('agent:authenticated', {
      agentId: agent.agentId,
      timestamp: Date.now()
    });

    // Broadcast to dashboards
    this.broadcastToDashboards('agent:online', {
      agentId: agent.agentId,
      hostname: agent.hostname,
      platform: agent.platform,
      tenantId: tenantContext.tenantId
    }, { tenantId: tenantContext.tenantId });

    void this.syncDetectionRulesToAgent(agent.agentId, tenantContext.tenantId);

    // Legacy registration event used by tests and older agents.
    socket.on('agent:register', (registration: any) => {
      // Batch 3: superseded sockets are inert.
      if (!this.isCurrentAgentSocket(socket, agent.agentId)) return;
      const connectedAgent = this.agents.get(agent.agentId);
      if (!connectedAgent) return;
      const validatedRegistration = validateAgentRegisterPayload(registration);
      if (!validatedRegistration) {
        socket.emit('error', { message: 'backend.invalid_agent_registration_payload', reason: 'invalid_payload' });
        return;
      }

      connectedAgent.registration = validatedRegistration;
      connectedAgent.hostname = validatedRegistration.hostname || connectedAgent.hostname;
      connectedAgent.platform = validatedRegistration.platform || connectedAgent.platform;
      connectedAgent.lastHeartbeat = new Date();

      this.broadcastToDashboards('agent:registered', {
        agentId: connectedAgent.agentId,
        registration: connectedAgent.registration,
        tenantId: connectedAgent.tenantId
      }, { tenantId: connectedAgent.tenantId });
    });

    // Heartbeat handler
    // SECURITY FIX CVE-2026-201: Validate heartbeat comes from authenticated agent
    socket.on('agent:heartbeat', async (status: AgentStatus) => {
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:heartbeat', tenantContext.tenantId))) return;
      // Batch 3: superseded sockets are inert.
      if (!this.isCurrentAgentSocket(socket, agent.agentId)) return;
      const validatedStatus = validateAgentHeartbeatPayload(status);
      if (!validatedStatus) {
        socket.emit('error', { message: 'backend.invalid_agent_heartbeat_payload', reason: 'invalid_payload' });
        return;
      }

      // SECURITY FIX: Verify heartbeat agentId matches authenticated agent
      if (validatedStatus.agentId && validatedStatus.agentId !== agent.agentId) {
        logger.warn('Heartbeat agent ID mismatch', {
          socketId: socket.id,
          expected: agent.agentId,
          received: validatedStatus.agentId
        });

        await auditLogger.log({
          eventType: 'heartbeat_spoofing_attempt',
          category: 'agent',
          severity: 'warning',
          actor: { type: 'agent', id: agent.agentId },
          action: 'heartbeat',
          details: { reason: 'Agent ID mismatch', expected: agent.agentId, received: validatedStatus.agentId },
          status: 'failure'
        });

        return; // Reject the heartbeat
      }

      const connectedAgent = this.agents.get(agent.agentId);
      const seqClaim = telemetrySeqClaim(validatedStatus as any);
      if (isStaleTelemetrySeq(connectedAgent, seqClaim)) {
        await auditLogger.log({
          eventType: 'telemetry_sequence_regression',
          category: 'agent',
          severity: 'warning',
          actor: { type: 'agent', id: agent.agentId },
          action: 'heartbeat',
          details: { claimedSeq: seqClaim, lastSeq: connectedAgent?.lastTelemetrySeq },
          status: 'failure'
        });
        return;
      }
      if (connectedAgent) {
        connectedAgent.lastHeartbeat = new Date();
        connectedAgent.status = validatedStatus as AgentStatus;
        if (seqClaim !== undefined) {
          connectedAgent.lastTelemetrySeq = seqClaim;
        }

        // Update last seen in database
        if (!isTestRuntime()) {
          await agentAuthService.updateLastSeen(agent.agentId);
        }
      }

      this.broadcastToDashboards('agent:status', {
        ...validatedStatus,
        agentId: agent.agentId,
        sourceTrust: 'agent_reported',
        tenantId: connectedAgent?.tenantId || tenantContext.tenantId
      }, { tenantId: connectedAgent?.tenantId || tenantContext.tenantId });
    });

    // Traffic stats handler (added for real data loop)
    socket.on('agent:traffic_stats', async (data: { agentId: string, stats: any, timestamp: string }) => {
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:traffic_stats', tenantContext.tenantId))) return;
      // Batch 3: superseded sockets are inert.
      if (!this.isCurrentAgentSocket(socket, agent.agentId)) return;
      if (data?.agentId && data.agentId !== agent.agentId) return;

      const globalStats = getTrafficStats();
      const probeStats = data.stats;

      if (probeStats) {
        globalStats.packetsProcessed += probeStats.packetsProcessed || 0;
        globalStats.packetsAllowed += probeStats.packetsAllowed || 0;
        globalStats.packetsBlocked += probeStats.packetsBlocked || 0;
        globalStats.packetsInspected += probeStats.packetsInspected || 0;
        globalStats.bytesProcessed += probeStats.bytesProcessed || 0;

        if (Array.isArray(probeStats.activeFlows)) {
          // Merge active flows
          const newFlows = probeStats.activeFlows.filter((pf: any) =>
            !globalStats.activeFlows.find((gf: any) => gf.id === pf.id)
          );
          globalStats.activeFlows.unshift(...newFlows);

          while (globalStats.activeFlows.length > 100) {
            globalStats.activeFlows.pop();
          }
        }

        // Broadcast real multi-agent telemetry (no synthetic injection). The
        // previous implementation fabricated socrates/plato/aristotle heartbeats
        // with Math.random(); dashboards now consume the actual orchestrator /
        // message-bus / model-router / synthesis stats emitted by the live system.
        try {
          const aiSystem = getAgentSystem();
          if (aiSystem && aiSystem.isInitialized()) {
            // getStats() returns { orchestrator, messageBus, traceManager,
            // modelRouter, synthesis } — spread at the top level so subscribers
            // receive each subsystem directly (not nested under orchestrator).
            const stats = (aiSystem as any).getStats?.() ?? {};
            this.broadcastToDashboards('ai-system:stats', {
              ...stats,
              health: (aiSystem as any).getHealthStatus?.() ?? null,
              recentCascadeTraces: (typeof (aiSystem as any).getRecentCascadeTraces === 'function'
                ? (aiSystem as any).getRecentCascadeTraces()
                : []),
              source: 'agent-gateway',
              timestamp: new Date().toISOString()
            }, { tenantId: tenantContext.tenantId });
          }
        } catch (err: any) {
          logger.debug('Skipped ai-system stats broadcast', { error: err?.message });
        }
      }

      this.broadcastToDashboards('traffic:updated', {
        agentId: agent.agentId,
        stats: probeStats,
        tenantId: tenantContext.tenantId
      }, { tenantId: tenantContext.tenantId });
    });

    // Threat alert handler
    socket.on('agent:threat', async (data: { threat: ThreatAlert }) => {
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:threat', tenantContext.tenantId))) return;
      const threat = data?.threat;
      if (!threat || typeof threat !== 'object') {
        socket.emit('error', { message: 'backend.invalid_threat_payload', reason: 'invalid_payload' });
        return;
      }

      try {
        await auditLogger.log({
          eventType: 'threat_detected',
          category: 'agent',
          severity: 'critical',
          actor: { type: 'agent', id: agent.agentId },
          action: 'threat_alert',
          details: threat,
          status: 'success'
        });
      } catch (auditError: any) {
        logger.error('Audit log failed for threat event (non-blocking, broadcast continues)', { error: auditError?.message, agentId: agent.agentId });
      }

      try {
        await detectionPipelineService.recordBlockedThreat({
          tenantId: tenantContext.tenantId,
          channel: 'agent',
          requestId: `${agent.agentId}:${Date.now()}:${threat.ruleId || 'threat'}`,
          timestamp: new Date().toISOString(),
          sourceIp: threat.sourceIP || socket.handshake.address || 'unknown',
          method: 'EVENT',
          path: threat.description || '/',
          headers: {},
          body: threat.evidence || '',
          evidence: threat.evidence || '',
          protocol: 'agent-threat',
          rawPayload: JSON.stringify(threat),
          metadata: {
            agentId: agent.agentId,
            severity: threat.severity,
            description: threat.description
          }
        }, [String(threat.ruleId || 'agent-threat')], threat.severity, threat.description || 'Agent threat detected');
      } catch (err: any) {
        logger.warn('Failed to persist blocked threat into detection pipeline', { error: err.message });
      }

      this.broadcastToDashboards('threat:detected', {
        agentId: agent.agentId,
        threat,
        tenantId: tenantContext.tenantId
      }, { tenantId: tenantContext.tenantId });
    });

    socket.on('agent:review_sample', async (data: any) => {
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:review_sample', tenantContext.tenantId))) return;
      // Batch 3: superseded sockets are inert.
      if (!this.isCurrentAgentSocket(socket, agent.agentId)) return;
      // AUD-03-4: envelope-verified HIGH event.
      const body = await enforceAgentInboundEnvelope(socket, agent.agentId, 'agent:review_sample', data);
      if (!body) return;
      const sample = (body as any).sample;
      if (!sample || typeof sample !== 'object') {
        socket.emit('error', { message: 'backend.invalid_review_sample_payload', reason: 'invalid_payload' });
        return;
      }

      try {
        const decision = await detectionPipelineService.reviewAgentSample({
          tenantId: tenantContext.tenantId,
          channel: 'agent',
          requestId: String(sample.requestId || `${agent.agentId}:${Date.now()}`),
          timestamp: String(sample.timestamp || data?.timestamp || new Date().toISOString()),
          sourceIp: typeof sample.sourceIp === 'string' ? sample.sourceIp : socket.handshake.address || 'unknown',
          method: typeof sample.method === 'string' ? sample.method : 'EVENT',
          path: typeof sample.path === 'string' ? sample.path : '/',
          headers: sample.headers && typeof sample.headers === 'object' ? sample.headers : {},
          body: typeof sample.body === 'string' ? sample.body : '',
          userAgent: typeof sample.userAgent === 'string' ? sample.userAgent : '',
          evidence: typeof sample.evidence === 'string' ? sample.evidence : '',
          protocol: typeof sample.protocol === 'string' ? sample.protocol : 'agent',
          rawPayload: typeof sample.rawPayload === 'string' ? sample.rawPayload : '',
          existingSignals: Array.isArray(sample.existingSignals) ? sample.existingSignals : [],
          metadata: {
            ...(sample.metadata && typeof sample.metadata === 'object' ? sample.metadata : {}),
            agentId: agent.agentId,
            localRiskScore: Number(sample.riskScore || 0),
            localMatchedRuleIds: Array.isArray(sample.matchedRuleIds) ? sample.matchedRuleIds : [],
            localDecisionSource: String(sample.decisionSource || 'agent-local')
          }
        });

        if (decision.aiVerdict === 'malicious' || decision.candidateId) {
          this.broadcastToDashboards('threat:detected', {
            agentId: agent.agentId,
            tenantId: tenantContext.tenantId,
            threat: {
              type: decision.attackFamily,
              severity: decision.aiVerdict === 'malicious' ? 'high' : 'medium',
              sourceIP: typeof sample.sourceIp === 'string' ? sample.sourceIp : socket.handshake.address || 'unknown',
              description: `Async agent review ${decision.aiVerdict || 'monitor'} (${decision.attackFamily})`,
              evidence: typeof sample.evidence === 'string' ? sample.evidence : '',
              ruleId: decision.candidateId || decision.matchedRuleIds[0] || 'agent-review',
              autoBlock: false
            },
            asyncReview: true,
            candidateId: decision.candidateId || null
          }, { tenantId: tenantContext.tenantId });
        }
      } catch (error: any) {
        logger.warn('Async agent review failed', {
          agentId: agent.agentId,
          error: error?.message
        });
      }
    });

    // Scan result handler
    socket.on('agent:scan_result', async (data: any) => {
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:scan_result', tenantContext.tenantId))) return;
      // AUD-03-4: envelope-verified HIGH event.
      const body = await enforceAgentInboundEnvelope(socket, agent.agentId, 'agent:scan_result', data);
      if (!body) return;
      await auditLogger.log({
        eventType: 'scan_completed',
        category: 'agent',
        severity: 'info',
        actor: { type: 'agent', id: agent.agentId },
        action: 'scan_result',
        details: body,
        status: 'success'
      });

      this.broadcastToDashboards('scan:result', {
        agentId: agent.agentId,
        ...body,
        tenantId: tenantContext.tenantId
      }, { tenantId: tenantContext.tenantId });
    });

    // Agent log handler
    socket.on('agent:log', async (data: any) => {
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:log', tenantContext.tenantId))) return;
      this.broadcastToDashboards('agent:log', {
        agentId: agent.agentId,
        ...data,
        tenantId: tenantContext.tenantId
      }, { tenantId: tenantContext.tenantId });
    });

    socket.on('agent:command_ack', async (data: any) => {
      // N4-1: a superseded socket (its connection was replaced by a newer
      // authenticated one) must not mutate command state or broadcast.
      if (!this.isCurrentAgentSocket(socket, agent.agentId)) return;
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:command_ack', tenantContext.tenantId))) return;
      // N4-2: the dashboard "completed" broadcast and the success audit may
      // only fire when the dispatcher actually ACCEPTED the transition
      // (running -> completed). A rejected ack (replay, mismatched tenant/
      // target, wrong prior state) is audited as a warning and never
      // reported to dashboards as completion.
      const accepted = commandDispatcherService.handleAgentCommandAck(agent.agentId, tenantContext.tenantId, data || {});
      await auditLogger.log({
        eventType: 'command_ack',
        category: 'agent',
        severity: accepted ? 'info' : 'warning',
        actor: { type: 'agent', id: agent.agentId },
        action: 'command_ack',
        details: { accepted, ...(data || {}) },
        status: accepted ? 'success' : 'failure'
      });
      if (!accepted) return;
      this.broadcastToDashboards('agent:command:ack', {
        agentId: agent.agentId,
        ...data,
        tenantId: tenantContext.tenantId
      }, { tenantId: tenantContext.tenantId });
    });

    socket.on('agent:command_failed', async (data: any) => {
      // N4-1: same ownership guard as command_ack.
      if (!this.isCurrentAgentSocket(socket, agent.agentId)) return;
      if (!(await enforceAgentEventRateLimit(socket, agent.agentId, 'agent:command_failed', tenantContext.tenantId))) return;
      const accepted = commandDispatcherService.handleAgentCommandFailure(agent.agentId, tenantContext.tenantId, data || {});
      await auditLogger.log({
        eventType: 'command_failed',
        category: 'agent',
        severity: accepted ? 'warning' : 'warning',
        actor: { type: 'agent', id: agent.agentId },
        action: 'command_failed',
        details: { accepted, ...(data || {}) },
        status: accepted ? 'failure' : 'failure'
      });
      if (!accepted) return;
      this.broadcastToDashboards('agent:command:failed', {
        agentId: agent.agentId,
        ...data,
        tenantId: tenantContext.tenantId
      }, { tenantId: tenantContext.tenantId });
    });
  }

  /**
   * SECURITY FIX: Enhanced dashboard connection handler with rate limiting
   */
  private handleDashboardConnection(socket: Socket): void {
    const user = socket.data.user;
    const tenantContext = socket.data.tenantContext as TenantContext | undefined;
    if (!user || !tenantContext) {
      socket.emit('error', { message: 'backend.dashboard_context_not_available', reason: 'tenant_required' });
      socket.disconnect();
      return;
    }

    this.dashboardClients.set(socket.id, {
      userId: user.userId,
      socketId: socket.id,
      tenantId: tenantContext.tenantId
    });

    this.startDashboardSessionRevalidation(socket, user, tenantContext);

    // Send current agent list
    this.emitAgentListToDashboard(socket.id, tenantContext.tenantId);

    // Scan request - SECURITY FIX CVE-2026-301: Check both user and socket rate limits
    socket.on('request:scan', async (data: { agentId: string }) => {
      const payload = validateDashboardAgentCommandPayload(data);
      if (!payload) {
        socket.emit('error', { message: 'backend.invalid_agent_command_payload', reason: 'invalid_payload' });
        return;
      }

      if (!isDashboardAgentCommandAuthorized(user)) {
        socket.emit('error', { message: 'backend.insufficient_permissions', reason: 'forbidden' });
        await auditLogger.log({
          eventType: 'ws_command_denied',
          category: 'command',
          severity: 'warning',
          actor: { type: 'user', id: user.userId },
          action: 'scan',
          target: { type: 'agent', id: payload.agentId },
          details: { reason: 'role_not_permitted', channel: 'websocket' },
          status: 'failure'
        });
        return;
      }

      // SECURITY FIX CVE-2026-301: Check user-level rate limit first
      if (!(await checkUserRateLimit(user.userId, tenantContext.tenantId, socket))) {
        socket.emit('error', { message: 'backend.user_rate_limit_exceeded', reason: 'rate_limit_exceeded' });
        return;
      }

      if (!(await checkSocketRateLimit(socket, tenantContext.tenantId))) {
        socket.emit('error', { message: 'backend.connection_rate_limit_exceeded', reason: 'rate_limit_exceeded' });
        return;
      }

      const targetAgent = this.agents.get(payload.agentId);
      if (!targetAgent) {
        socket.emit('error', { message: 'backend.agent_not_found', reason: 'agent_not_found' });
        return;
      }

      if (!this.canAccessTenant(tenantContext.tenantId, targetAgent.tenantId)) {
        socket.emit('error', { message: 'backend.cannot_access_resources_from_another_tenant', reason: 'tenant_mismatch' });
        return;
      }

      try {
        await this.auditCommandDispatchAttempt('scan', payload.agentId, user.userId);
      } catch (auditError: any) {
        logger.error('Command pre-dispatch audit failed; command not sent', {
          commandType: 'scan',
          agentId: payload.agentId,
          error: auditError?.message
        });
        socket.emit('error', { message: 'backend.command_not_delivered', reason: 'audit_unavailable' });
        return;
      }

      const sent = this.sendSignedCommand(payload.agentId, 'scan', undefined, user.userId, {
        tenantId: tenantContext.tenantId
      });
      try {
        await auditLogger.logCommand({
          commandType: 'scan',
          agentId: payload.agentId,
          userId: user.userId,
          success: sent
        });
      } catch (auditError: any) {
        logger.error('Command outcome audit failed after dispatch decision', {
          commandType: 'scan',
          agentId: payload.agentId,
          sent,
          error: auditError?.message
        });
        socket.emit('error', sent
          ? { message: 'backend.command_delivery_audit_failed', reason: 'command_may_have_been_delivered' }
          : { message: 'backend.command_not_delivered', reason: 'agent_offline_or_rejected', auditStatus: 'failed' });
        return;
      }
      if (!sent) {
        socket.emit('error', { message: 'backend.command_not_delivered', reason: 'agent_offline_or_rejected' });
      }
    });

    // Block IP request - SECURITY FIX CVE-2026-301: Validate and audit with user-level rate limiting
    socket.on('request:block_ip', async (data: { agentId: string; ip: string }) => {
      const payload = validateDashboardIpCommandPayload(data);
      if (!payload) {
        socket.emit('error', { message: 'backend.invalid_agent_command_payload', reason: 'invalid_payload' });
        return;
      }

      if (!isDashboardAgentCommandAuthorized(user)) {
        socket.emit('error', { message: 'backend.insufficient_permissions', reason: 'forbidden' });
        await auditLogger.log({
          eventType: 'ws_command_denied',
          category: 'firewall',
          severity: 'warning',
          actor: { type: 'user', id: user.userId },
          action: 'block_ip',
          target: { type: 'agent', id: payload.agentId },
          details: { reason: 'role_not_permitted', channel: 'websocket' },
          status: 'failure'
        });
        return;
      }

      // SECURITY FIX CVE-2026-301: Check user-level rate limit first
      if (!(await checkUserRateLimit(user.userId, tenantContext.tenantId, socket))) {
        socket.emit('error', { message: 'backend.user_rate_limit_exceeded', reason: 'rate_limit_exceeded' });
        return;
      }

      if (!(await checkSocketRateLimit(socket, tenantContext.tenantId))) {
        socket.emit('error', { message: 'backend.connection_rate_limit_exceeded', reason: 'rate_limit_exceeded' });
        return;
      }

      const targetAgent = this.agents.get(payload.agentId);
      if (!targetAgent) {
        socket.emit('error', { message: 'backend.agent_not_found', reason: 'agent_not_found' });
        return;
      }

      if (!this.canAccessTenant(tenantContext.tenantId, targetAgent.tenantId)) {
        socket.emit('error', { message: 'backend.cannot_access_resources_from_another_tenant', reason: 'tenant_mismatch' });
        return;
      }

      // Validate IP
      if (!isValidIPAddress(payload.ip)) {
        await auditLogger.logFirewall({
          action: 'block_ip',
          agentId: payload.agentId,
          ip: payload.ip,
          userId: user.userId,
          success: false,
          details: { reason: 'Invalid IP format' }
        });
        socket.emit('error', { message: 'backend.invalid_ip_address_format', reason: 'invalid_ip' });
        return;
      }

      if (containsShellMetacharacters(payload.ip)) {
        await auditLogger.log({
          eventType: 'command_injection_attempt',
          category: 'firewall',
          severity: 'critical',
          actor: { type: 'user', id: user.userId },
          action: 'block_ip',
          target: { type: 'server', id: payload.agentId },
          details: { ip: payload.ip, reason: 'Shell characters detected' },
          status: 'failure'
        });
        socket.emit('error', { message: 'backend.invalid_characters_in_ip_address', reason: 'invalid_ip' });
        return;
      }

      try {
        await this.auditCommandDispatchAttempt('block_ip', payload.agentId, user.userId, { ip: payload.ip });
      } catch (auditError: any) {
        logger.error('Command pre-dispatch audit failed; command not sent', {
          commandType: 'block_ip',
          agentId: payload.agentId,
          error: auditError?.message
        });
        socket.emit('error', { message: 'backend.command_not_delivered', reason: 'audit_unavailable' });
        return;
      }

      const sent = this.sendSignedCommand(payload.agentId, 'block_ip', { ip: payload.ip }, user.userId, {
        tenantId: tenantContext.tenantId
      });
      try {
        await auditLogger.logFirewall({
          action: 'block_ip',
          agentId: payload.agentId,
          ip: payload.ip,
          userId: user.userId,
          success: sent
        });
      } catch (auditError: any) {
        logger.error('Command outcome audit failed after dispatch decision', {
          commandType: 'block_ip',
          agentId: payload.agentId,
          sent,
          error: auditError?.message
        });
        socket.emit('error', sent
          ? { message: 'backend.command_delivery_audit_failed', reason: 'command_may_have_been_delivered' }
          : { message: 'backend.command_not_delivered', reason: 'agent_offline_or_rejected', auditStatus: 'failed' });
        return;
      }
      if (!sent) {
        socket.emit('error', { message: 'backend.command_not_delivered', reason: 'agent_offline_or_rejected' });
      }
    });

    // Unblock IP request - SECURITY FIX CVE-2026-301: Validate and audit with user-level rate limiting
    socket.on('request:unblock_ip', async (data: { agentId: string; ip: string }) => {
      const payload = validateDashboardIpCommandPayload(data);
      if (!payload) {
        socket.emit('error', { message: 'backend.invalid_agent_command_payload', reason: 'invalid_payload' });
        return;
      }

      if (!isDashboardAgentCommandAuthorized(user)) {
        socket.emit('error', { message: 'backend.insufficient_permissions', reason: 'forbidden' });
        await auditLogger.log({
          eventType: 'ws_command_denied',
          category: 'firewall',
          severity: 'warning',
          actor: { type: 'user', id: user.userId },
          action: 'unblock_ip',
          target: { type: 'agent', id: payload.agentId },
          details: { reason: 'role_not_permitted', channel: 'websocket' },
          status: 'failure'
        });
        return;
      }

      // SECURITY FIX CVE-2026-301: Check user-level rate limit first
      if (!(await checkUserRateLimit(user.userId, tenantContext.tenantId, socket))) {
        socket.emit('error', { message: 'backend.user_rate_limit_exceeded', reason: 'rate_limit_exceeded' });
        return;
      }

      if (!(await checkSocketRateLimit(socket, tenantContext.tenantId))) {
        socket.emit('error', { message: 'backend.connection_rate_limit_exceeded', reason: 'rate_limit_exceeded' });
        return;
      }

      const targetAgent = this.agents.get(payload.agentId);
      if (!targetAgent) {
        socket.emit('error', { message: 'backend.agent_not_found', reason: 'agent_not_found' });
        return;
      }

      if (!this.canAccessTenant(tenantContext.tenantId, targetAgent.tenantId)) {
        socket.emit('error', { message: 'backend.cannot_access_resources_from_another_tenant', reason: 'tenant_mismatch' });
        return;
      }

      // Validate IP
      if (!isValidIPAddress(payload.ip)) {
        await auditLogger.logFirewall({
          action: 'unblock_ip',
          agentId: payload.agentId,
          ip: payload.ip,
          userId: user.userId,
          success: false,
          details: { reason: 'Invalid IP format' }
        });
        socket.emit('error', { message: 'backend.invalid_ip_address_format', reason: 'invalid_ip' });
        return;
      }

      try {
        await this.auditCommandDispatchAttempt('unblock_ip', payload.agentId, user.userId, { ip: payload.ip });
      } catch (auditError: any) {
        logger.error('Command pre-dispatch audit failed; command not sent', {
          commandType: 'unblock_ip',
          agentId: payload.agentId,
          error: auditError?.message
        });
        socket.emit('error', { message: 'backend.command_not_delivered', reason: 'audit_unavailable' });
        return;
      }

      const sent = this.sendSignedCommand(payload.agentId, 'unblock_ip', { ip: payload.ip }, user.userId, {
        tenantId: tenantContext.tenantId
      });
      try {
        await auditLogger.logFirewall({
          action: 'unblock_ip',
          agentId: payload.agentId,
          ip: payload.ip,
          userId: user.userId,
          success: sent
        });
      } catch (auditError: any) {
        logger.error('Command outcome audit failed after dispatch decision', {
          commandType: 'unblock_ip',
          agentId: payload.agentId,
          sent,
          error: auditError?.message
        });
        socket.emit('error', sent
          ? { message: 'backend.command_delivery_audit_failed', reason: 'command_may_have_been_delivered' }
          : { message: 'backend.command_not_delivered', reason: 'agent_offline_or_rejected', auditStatus: 'failed' });
        return;
      }
      if (!sent) {
        socket.emit('error', { message: 'backend.command_not_delivered', reason: 'agent_offline_or_rejected' });
      }
    });
  }

  private async auditCommandDispatchAttempt(
    commandType: string,
    agentId: string,
    userId: string,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    if (process.env.AUDIT_LOG_FAIL_CLOSED !== 'true') {
      return;
    }

    await auditLogger.log({
      eventType: 'command_dispatch_attempt',
      category: 'command',
      severity: 'warning',
      actor: { type: 'user', id: userId },
      action: commandType,
      target: { type: 'agent', id: agentId },
      details: { phase: 'pre_dispatch', ...details },
      status: 'attempt'
    });
  }

  private startDashboardSessionRevalidation(
    socket: Socket,
    user: AuthenticatedRequest['user'],
    tenantContext: TenantContext
  ): void {
    const token = socket.data.authToken;
    if (!token || !user) {
      return;
    }

    const timer = setInterval(() => {
      void this.revalidateDashboardSession(socket, token, user, tenantContext);
    }, resolveDashboardSessionRevalidateMs());
    this.sessionRevalidationTimers.add(timer);
    timer.unref?.();

    socket.once('disconnect', () => {
      clearInterval(timer);
      this.sessionRevalidationTimers.delete(timer);
    });
  }

  /**
   * SECURITY: periodically re-check the agent's registration status and
   * disconnect the live socket when revokeAgent (or any status change away
   * from 'approved') takes effect. Mirrors startDashboardSessionRevalidation
   * but for API-key-authenticated agents.
   */
  private startAgentSessionRevalidation(socket: Socket, agentId: string): void {
    const timer = setInterval(() => {
      void this.revalidateAgentSession(socket, agentId);
    }, resolveAgentSessionRevalidateMs());
    this.sessionRevalidationTimers.add(timer);
    timer.unref?.();

    socket.once('disconnect', () => {
      clearInterval(timer);
      this.sessionRevalidationTimers.delete(timer);
    });
  }

  private async revalidateAgentSession(socket: Socket, agentId: string): Promise<void> {
    if (!socket.connected) {
      return;
    }

    let status: string | null = null;
    let definitive = false;
    try {
      if (typeof agentAuthService.getAgentStatus !== 'function') {
        // Incomplete test mock — skip rather than crash. Production always has it.
        return;
      }
      status = agentAuthService.getAgentStatus(agentId);
      definitive = true;
    } catch (error: any) {
      // Transient DB error: do NOT disconnect. A blip must not mass-kick agents.
      logger.warn('Agent session revalidation status check failed (non-disconnecting)', {
        agentId,
        error: error?.message
      });
      return;
    }

    if (!definitive) {
      return;
    }

    if (status !== 'approved') {
      try {
        await auditLogger.logAgent({
          action: 'disconnect',
          agentId,
          ip: socket.handshake.address,
          success: false,
          details: { reason: 'agent_revoked_during_session', status: status ?? 'missing' }
        });
      } catch (auditError: any) {
        logger.error('Audit log failed on agent revalidation disconnect (non-blocking)', {
          error: auditError?.message,
          agentId
        });
      }
      socket.emit('error', {
        message: 'backend.agent_session_revoked',
        reason: status ? `status_${status}` : 'agent_removed'
      });
      socket.disconnect(true);
    }
  }

  private async revalidateDashboardSession(
    socket: Socket,
    token: string,
    originalUser: NonNullable<AuthenticatedRequest['user']>,
    originalTenantContext: TenantContext
  ): Promise<void> {
    if (!socket.connected) {
      return;
    }

    try {
      const verification = await verifyTokenAsyncDetailed(token);
      const refreshedUser = verification.user;
      const refreshedTenantContext = refreshedUser
        ? resolveUserTenantContext(refreshedUser, {
          allowAdminPlatformFallback: refreshedUser.role === 'admin'
        })
        : null;

      if (
        !refreshedUser ||
        refreshedUser.userId !== originalUser.userId ||
        !refreshedTenantContext ||
        refreshedTenantContext.tenantId !== originalTenantContext.tenantId
      ) {
        await auditLogger.log({
          eventType: 'dashboard_session_revalidation',
          category: 'auth',
          severity: 'warning',
          actor: { type: 'user', id: originalUser.userId, ip: socket.handshake.address },
          action: 'revalidate_websocket_session',
          details: {
            reason: verification.failureReason || 'identity_or_tenant_changed',
            socketId: socket.id
          },
          status: 'failure'
        });
        socket.emit('error', {
          message: verification.failureReason === 'redis_unavailable' ||
            verification.failureReason === 'blacklist_check_failed'
            ? 'backend.auth_blacklist_check_unavailable'
            : 'backend.websocket_session_invalidated',
          reason: verification.failureReason || 'session_invalidated'
        });
        socket.disconnect(true);
        return;
      }

      socket.data.user = refreshedUser;
      socket.data.tenantContext = refreshedTenantContext;
    } catch (error: any) {
      logger.error('Dashboard WebSocket session revalidation failed', {
        socketId: socket.id,
        userId: originalUser.userId,
        error: error?.message
      });
      socket.emit('error', { message: 'backend.websocket_session_revalidation_failed', reason: 'revalidation_failed' });
      socket.disconnect(true);
    }
  }

  /**
   * SECURITY FIX: Send signed command to agent
   * SECURITY FIX CVE-200: Remove sensitive information from logs
   */
  private sendSignedCommand(agentId: string, commandType: string, payload?: any, userId?: string, metadata?: any): boolean {
    const agent = this.agents.get(agentId);

    if (!agent) {
      logger.warn(`Agent not found: ${agentId}`);
      return false;
    }

    if (agent.status?.isOnline === false) {
      logger.warn(`Agent is offline: ${agentId}`);
      return false;
    }

    const resolvedTenantId = metadata?.tenantId || agent.tenantId || PLATFORM_TENANT_ID;

    try {
      if (agent.commandHandler) {
        const accepted = agent.commandHandler({
          type: commandType,
          payload,
          userId,
          metadata
        });

        if (!accepted) {
          logger.warn(`Synthetic agent rejected command ${commandType}`, { agentId });
          return false;
        }

        logger.info(`Command accepted by synthetic agent ${agentId}: ${commandType}`);
        this.broadcastToDashboards('agent:command:ack', {
          agentId,
          actionId: metadata?.actionId || payload?.actionId,
          tenantId: resolvedTenantId,
          message: `Synthetic agent accepted ${commandType}.`
        });
        commandDispatcherService.handleAgentCommandAck(agentId, resolvedTenantId, {
          actionId: metadata?.actionId || payload?.actionId,
          message: `Synthetic agent accepted ${commandType}.`
        });
        return true;
      }

      if (isTestRuntime()) {
        this.io.to(agent.socketId).emit('command', { type: commandType, payload, metadata });
        return true;
      }

      // Sign the command
      const signedCommand = commandSigningService.signCommand(agentId, commandType, payload);

      // Send signed command
      this.io.to(agent.socketId).emit('command', { ...signedCommand, metadata });

      // SECURITY FIX CVE-200: Don't log nonce or timestamp in production
      logger.info(`Command sent to ${agentId}: ${commandType}`);

      return true;
    } catch (error: any) {
      logger.error(`Failed to send signed command to ${agentId}`, { error: error.message });
      auditLogger.log({
        eventType: 'command_send_failed',
        category: 'command',
        severity: 'warning',
        actor: { type: 'user', id: userId || 'system' },
        action: 'send_command',
        target: { type: 'agent', id: agentId },
        details: { commandType, error: error.message },
        status: 'failure'
      });
      return false;
    }
  }

  /**
   * SECURITY (audit 2026-08, batch 3): socket ownership check for agent
   * event handlers. After a superseding connection takes over the registry
   * entry, any frame from the OLD socket must be inert — handlers verify
   * the emitting socket still owns the entry before mutating shared state.
   */
  private isCurrentAgentSocket(socket: Socket, agentId: string): boolean {
    return this.agents.get(agentId)?.socketId === socket.id;
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket): void {
    const clientType = socket.data.clientType;

    if (clientType === 'agent') {
      const agent = socket.data.agent;
      const tenantContext = socket.data.tenantContext as TenantContext | undefined;
      if (agent && tenantContext) {
        // SECURITY (audit 2026-08, batch 3): only the socket that still
        // OWNS the registry entry may clean it up. A stale socket losing a
        // supersede race must not delete the new connection's entry or
        // broadcast agent:offline for a live agent.
        if (!this.isCurrentAgentSocket(socket, agent.agentId)) {
          logger.info('Stale agent socket disconnected after supersede; registry entry left intact', {
            agentId: agent.agentId,
            socketId: socket.id,
            currentSocketId: this.agents.get(agent.agentId)?.socketId
          });
          return;
        }

        this.agents.delete(agent.agentId);
        this.broadcastAgentListUpdates(tenantContext.tenantId);

        this.broadcastToDashboards('agent:offline', {
          agentId: agent.agentId,
          tenantId: tenantContext.tenantId
        }, { tenantId: tenantContext.tenantId });

        void Promise.resolve()
          .then(() => auditLogger.logAgent({
            action: 'disconnect',
            agentId: agent.agentId,
            success: true
          }))
          .catch((auditError: any) => {
            logger.error('Audit log failed on agent disconnect (non-blocking)', {
              error: auditError?.message,
              agentId: agent.agentId
            });
          });

        logger.info(`Agent disconnected: ${agent.agentId}`);
      }
    } else {
      this.dashboardClients.delete(socket.id);
      logger.info(`Dashboard client disconnected: ${socket.id}`);
    }
  }

  private sweepStaleAgents(nowMs: number = Date.now()): void {
    const timeoutMs = resolveAgentHeartbeatTimeoutMs();
    for (const agent of this.agents.values()) {
      if (agent.isSynthetic) {
        continue;
      }

      const heartbeatAgeMs = nowMs - agent.lastHeartbeat.getTime();
      if (!Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs <= timeoutMs) {
        continue;
      }

      logger.warn('Agent heartbeat timed out; disconnecting stale session', {
        agentId: agent.agentId,
        heartbeatAgeMs,
        timeoutMs
      });
      void Promise.resolve()
        .then(() => auditLogger.logAgent({
          action: 'disconnect',
          agentId: agent.agentId,
          success: false,
          details: { reason: 'heartbeat_timeout', heartbeatAgeMs, timeoutMs }
        }))
        .catch((auditError: any) => {
          logger.error('Audit log failed for stale-agent disconnect (non-blocking)', {
            error: auditError?.message,
            agentId: agent.agentId
          });
        });

      const socket = this.io.sockets.sockets.get(agent.socketId);
      if (socket) {
        socket.emit('error', {
          message: 'backend.agent_heartbeat_stale',
          reason: 'heartbeat_timeout'
        });
        socket.disconnect(true);
        continue;
      }

      this.agents.delete(agent.agentId);
      this.broadcastToDashboards('agent:offline', {
        agentId: agent.agentId,
        tenantId: agent.tenantId,
        reason: 'heartbeat_timeout'
      }, { tenantId: agent.tenantId });
      this.broadcastAgentListUpdates(agent.tenantId);
    }
  }

  /**
   * Broadcast to all dashboard clients
   */
  public broadcastToDashboards(event: string, data: any, options: { tenantId?: string } = {}): void {
    const targetTenantId = options.tenantId || data?.tenantId;
    if (!targetTenantId) {
      logger.warn('Dashboard broadcast dropped because tenant scope is missing', { event });
      return;
    }
    for (const [socketId, client] of this.dashboardClients) {
      if (!this.canAccessTenant(client.tenantId, targetTenantId)) {
        continue;
      }
      this.io.to(socketId).emit(event as keyof AgentServerToClientEvents, data);
    }
  }

  /**
   * Backward compatible helper used by REST routes.
   */
  public sendCommandToAgent(agentId: string, command: { type: string; payload?: any; metadata?: any }, userId?: string): boolean {
    return this.sendSignedCommand(agentId, command.type, command.payload, userId, command.metadata);
  }

  public async syncTenantDetectionRules(tenantId: string): Promise<{ attempted: number; succeeded: number }> {
    const agents = Array.from(this.agents.values()).filter((agent) => agent.tenantId === tenantId && !agent.isSynthetic);
    let succeeded = 0;

    await Promise.all(agents.map(async (agent) => {
      const synced = await this.syncDetectionRulesToAgent(agent.agentId, tenantId);
      if (synced) {
        succeeded += 1;
      }
    }));

    return {
      attempted: agents.length,
      succeeded
    };
  }

  public upsertSyntheticAgent(input: {
    agentId: string;
    hostname: string;
    platform: string;
    tenantId?: string;
    registration?: any;
    lastHeartbeat?: Date;
    status?: AgentStatus | null;
    commandHandler?: (command: { type: string; payload?: any; userId?: string; metadata?: any }) => boolean;
  }): void {
    const existing = this.agents.get(input.agentId);
    const nextAgent: ConnectedAgent = {
      socketId: existing?.socketId || `synthetic:${input.agentId}`,
      agentId: input.agentId,
      hostname: input.hostname,
      platform: input.platform,
      tenantId: input.tenantId || existing?.tenantId || PLATFORM_TENANT_ID,
      generation: (existing?.generation ?? this.connectionGeneration) + 1,
      registration: input.registration ?? existing?.registration,
      authenticated: true,
      lastHeartbeat: input.lastHeartbeat || existing?.lastHeartbeat || new Date(),
      status: input.status ?? existing?.status ?? null,
      isSynthetic: true,
      commandHandler: input.commandHandler ?? existing?.commandHandler
    };

    const isNew = !existing;
    this.agents.set(input.agentId, nextAgent);

    if (isNew) {
      logger.info(`Synthetic agent registered: ${input.agentId}`);
      this.broadcastToDashboards('agent:online', {
        agentId: nextAgent.agentId,
        hostname: nextAgent.hostname,
        platform: nextAgent.platform,
        synthetic: true,
        tenantId: nextAgent.tenantId
      }, { tenantId: nextAgent.tenantId });
    }

    if (nextAgent.status) {
      this.broadcastToDashboards('agent:status', {
        ...nextAgent.status,
        agentId: nextAgent.agentId,
        synthetic: true,
        tenantId: nextAgent.tenantId
      }, { tenantId: nextAgent.tenantId });
    }

    this.broadcastAgentListUpdates(nextAgent.tenantId);
  }

  public removeSyntheticAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.isSynthetic) {
      return;
    }

    this.agents.delete(agentId);
    this.broadcastToDashboards('agent:offline', {
      agentId,
      synthetic: true,
      tenantId: agent.tenantId
    }, { tenantId: agent.tenantId });
    this.broadcastAgentListUpdates(agent.tenantId);
  }

  /**
   * Get all agents
   */
  getAgentList(): any[] {
    return Array.from(this.agents.values()).map(agent => ({
      agentId: agent.agentId,
      hostname: agent.hostname,
      platform: agent.platform,
      tenantId: agent.tenantId,
      registration: agent.registration,
      lastHeartbeat: agent.lastHeartbeat,
      status: agent.status,
      isOnline: agent.status?.isOnline ?? true,
      synthetic: Boolean(agent.isSynthetic)
    }));
  }

  private canAccessTenant(clientTenantId: string, targetTenantId?: string): boolean {
    if (!targetTenantId) {
      return true;
    }

    return clientTenantId === PLATFORM_TENANT_ID || clientTenantId === targetTenantId;
  }

  private getAgentListForTenant(tenantId: string): any[] {
    return Array.from(this.agents.values())
      .filter((agent) => this.canAccessTenant(tenantId, agent.tenantId))
      .map(agent => ({
        agentId: agent.agentId,
        hostname: agent.hostname,
        platform: agent.platform,
        tenantId: agent.tenantId,
        registration: agent.registration,
        lastHeartbeat: agent.lastHeartbeat,
        status: agent.status,
        isOnline: agent.status?.isOnline ?? true,
        synthetic: Boolean(agent.isSynthetic)
      }));
  }

  private emitAgentListToDashboard(socketId: string, tenantId: string): void {
    this.io.to(socketId).emit('agents:list', this.getAgentListForTenant(tenantId));
  }

  private async syncDetectionRulesToAgent(agentId: string, tenantId: string): Promise<boolean> {
    try {
      const rules = await detectionPipelineService.listDynamicRules(tenantId, 'agent');
      return this.sendSignedCommand(agentId, 'update_rules', {
        rules
      }, 'system', {
        tenantId,
        source: 'detection-pipeline'
      });
    } catch (error: any) {
      if (process.env.NODE_ENV === 'test' && isDetectionBootstrapError(error)) {
        logger.debug('Skipping detection rule sync before test database bootstrap', {
          agentId,
          tenantId
        });
        return false;
      }

      logger.warn('Failed to sync detection rules to agent', {
        agentId,
        tenantId,
        error: error?.message
      });
      return false;
    }
  }

  private broadcastAgentListUpdates(targetTenantId?: string): void {
    for (const client of this.dashboardClients.values()) {
      if (targetTenantId && !this.canAccessTenant(client.tenantId, targetTenantId)) {
        continue;
      }

      this.emitAgentListToDashboard(client.socketId, client.tenantId);
    }
  }

  /**
   * Get specific agent
   */
  getAgent(agentId: string): ConnectedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get online count
   */
  getOnlineCount(): number {
    if (isTestRuntime()) {
      return this.testOnlineCounter;
    }
    return this.getAgentList().filter((agent) => agent.isOnline).length;
  }

  getDashboardConnectionCount(): number {
    return this.dashboardClients.size;
  }

  /**
   * Close gateway
   */
  async close(): Promise<void> {
    clearInterval(this.heartbeatSweepTimer);
    for (const timer of this.sessionRevalidationTimers) {
      clearInterval(timer);
    }
    this.sessionRevalidationTimers.clear();
    await this.io.close();
    logger.info('Agent Gateway closed');
  }
}

export default AgentGateway;
