import { getDatabase } from '../config/database';
import auditLogger from '../security/audit-logger.service';
import { postgresShadowStoreService } from './postgres-shadow-store.service';
import { securityOperationsService } from './security-operations.service';
import { scannerTaskService } from './scanner-task.service';

type TimelineCategory = 'auth' | 'agent' | 'command' | 'firewall' | 'system' | 'scanner' | 'alert' | 'action' | 'validation' | 'deployment';

interface TenantFilters {
  tenantId: string;
  userId?: string;
  category?: string;
  from?: string;
  to?: string;
  limit?: number;
}

class TenantOversightService {
  private schemaReady = false;

  private ensureSchema(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_dispute_exports (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        json_payload TEXT NOT NULL,
        csv_payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_dispute_exports_tenant
      ON admin_dispute_exports(tenant_id, requested_at DESC);
    `);

    this.schemaReady = true;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) {
      return fallback;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private severityWeight(value?: string): number {
    switch (String(value || '').toLowerCase()) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
      default:
        return 0;
    }
  }

  private buildWindow(range?: string): { from?: string; to?: string } {
    if (!range || range === 'all') {
      return {};
    }

    const now = Date.now();
    const days = Number(range);
    if (!Number.isFinite(days) || days <= 0) {
      return {};
    }

    return {
      from: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString()
    };
  }

  private getUserRow(userId: string) {
    const db = getDatabase();
    return db.prepare(`
      SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(userId) as any;
  }

  private async getUserRowView(userId: string) {
    if (!postgresShadowStoreService.canServeReads()) {
      return this.getUserRow(userId);
    }

    return await postgresShadowStoreService.queryOne<any>(`
      SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `, [userId]);
  }

  private async getTenantUsersView(tenantId: string) {
    if (!postgresShadowStoreService.canServeReads()) {
      const db = getDatabase();
      return db.prepare(`
        SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
        FROM users
        WHERE tenant_id = ?
        ORDER BY created_at DESC
      `).all(tenantId) as any[];
    }

    return await postgresShadowStoreService.queryAll<any>(`
      SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
      FROM users
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `, [tenantId]);
  }

  private getDeploymentRows(tenantId: string, limit = 50) {
    return getDatabase().prepare(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
  }

  private withinWindow(timestamp: string | undefined, filters: TenantFilters): boolean {
    if (!timestamp) {
      return true;
    }
    if (filters.from && timestamp < filters.from) {
      return false;
    }
    if (filters.to && timestamp > filters.to) {
      return false;
    }
    return true;
  }

  private matchesUser(user: any, filters: TenantFilters, actorId?: string, actorEmail?: string): boolean {
    if (!filters.userId) {
      return true;
    }
    if (!user) {
      return actorId === filters.userId;
    }
    return actorId === filters.userId || actorEmail === user.email;
  }

  private toTimelineEvent(input: {
    id: string;
    tenantId: string;
    category: TimelineCategory;
    action: string;
    status: string;
    timestamp: string;
    actor?: Record<string, any>;
    target?: Record<string, any>;
    details?: Record<string, any>;
    source: string;
    severity?: string;
    evidenceRefs?: string[];
  }) {
    return {
      ...input,
      severity: input.severity || 'info',
      evidenceRefs: input.evidenceRefs || []
    };
  }

  listTenants() {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT
        tenant_id,
        COUNT(*) AS user_count,
        MAX(created_at) AS created_at,
        MAX(COALESCE(last_login, created_at)) AS last_active_at,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_users
      FROM users
      WHERE tenant_id IS NOT NULL
      GROUP BY tenant_id
      ORDER BY last_active_at DESC
    `).all() as any[];

    return rows.map((row) => {
      const summary = securityOperationsService.getDashboardSummary(row.tenant_id);
      const riskLevel = summary.activeAlerts > 0 || summary.failedValidations > 0 || Number(row.suspended_users || 0) > 0
        ? 'high'
        : summary.pendingActions > 0 || summary.runningScans > 0
          ? 'medium'
          : 'low';

      return {
        tenantId: row.tenant_id,
        tenantName: `Tenant ${String(row.tenant_id).slice(0, 8)}`,
        status: Number(row.suspended_users || 0) > 0 ? 'attention' : 'active',
        userCount: Number(row.user_count || 0),
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        openHighAlerts: summary.activeAlerts,
        failedValidations: summary.failedValidations,
        riskLevel
      };
    });
  }

  async listTenantsView() {
    this.ensureSchema();

    if (!postgresShadowStoreService.canServeReads()) {
      return this.listTenants();
    }

    const rows = await postgresShadowStoreService.queryAll<any>(`
      SELECT
        tenant_id,
        COUNT(*) AS user_count,
        MAX(created_at) AS created_at,
        MAX(COALESCE(last_login, created_at)) AS last_active_at,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_users
      FROM users
      WHERE tenant_id IS NOT NULL
      GROUP BY tenant_id
      ORDER BY last_active_at DESC
    `);

    return await Promise.all(rows.map(async (row) => {
      const summary = await securityOperationsService.getDashboardSummaryView(row.tenant_id);
      const riskLevel = summary.activeAlerts > 0 || summary.failedValidations > 0 || Number(row.suspended_users || 0) > 0
        ? 'high'
        : summary.pendingActions > 0 || summary.runningScans > 0
          ? 'medium'
          : 'low';

      return {
        tenantId: row.tenant_id,
        tenantName: `Tenant ${String(row.tenant_id).slice(0, 8)}`,
        status: Number(row.suspended_users || 0) > 0 ? 'attention' : 'active',
        userCount: Number(row.user_count || 0),
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        openHighAlerts: summary.activeAlerts,
        failedValidations: summary.failedValidations,
        riskLevel
      };
    }));
  }

  getTenantSummary(tenantId: string, userId?: string) {
    this.ensureSchema();
    const db = getDatabase();
    const users = db.prepare(`
      SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
      FROM users
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(tenantId) as any[];
    const filteredUsers = userId ? users.filter((user) => user.id === userId) : users;
    const summary = securityOperationsService.getDashboardSummary(tenantId);
    const recentTimeline = this.listTimeline({ tenantId, userId, limit: 12 });
    const recentAuth = auditLogger.getLogs({ tenantId, category: 'auth', limit: 10 });
    const deploymentRows = db.prepare(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(tenantId) as any[];

    return {
      tenant: {
        tenantId,
        tenantName: `Tenant ${String(tenantId).slice(0, 8)}`,
        userCount: users.length,
        lastActiveAt: filteredUsers.reduce((latest: string | null, row) => {
          const next = row.last_login || row.created_at;
          return !latest || next > latest ? next : latest;
        }, null)
      },
      users: filteredUsers,
      metrics: summary,
      recentTimeline,
      recentAuth,
      recentDeployments: deploymentRows,
      recentActions: securityOperationsService.listActions(tenantId, 10),
      recentValidations: securityOperationsService.listValidationRuns(tenantId, 10)
    };
  }

  async getTenantSummaryView(tenantId: string, userId?: string) {
    this.ensureSchema();

    if (!postgresShadowStoreService.canServeReads()) {
      return this.getTenantSummary(tenantId, userId);
    }

    const users = await this.getTenantUsersView(tenantId);
    const filteredUsers = userId ? users.filter((user) => user.id === userId) : users;
    const [summary, recentTimeline, recentAuth, recentActions, recentValidations] = await Promise.all([
      securityOperationsService.getDashboardSummaryView(tenantId),
      this.listTimelineView({ tenantId, userId, limit: 12 }),
      auditLogger.getLogsView({ tenantId, category: 'auth', limit: 10 }),
      securityOperationsService.listActionsView(tenantId, 10),
      securityOperationsService.listValidationRunsView(tenantId, 10)
    ]);
    const recentDeployments = this.getDeploymentRows(tenantId, 10);

    return {
      tenant: {
        tenantId,
        tenantName: `Tenant ${String(tenantId).slice(0, 8)}`,
        userCount: users.length,
        lastActiveAt: filteredUsers.reduce((latest: string | null, row) => {
          const next = row.last_login || row.created_at;
          return !latest || next > latest ? next : latest;
        }, null)
      },
      users: filteredUsers,
      metrics: summary,
      recentTimeline,
      recentAuth,
      recentDeployments,
      recentActions,
      recentValidations
    };
  }

  listTimeline(filters: TenantFilters) {
    this.ensureSchema();
    const user = filters.userId ? this.getUserRow(filters.userId) : null;
    const category = filters.category && filters.category !== 'all' ? filters.category : undefined;
    const auditEvents = auditLogger.getLogs({
      tenantId: filters.tenantId,
      category,
      actorId: filters.userId,
      from: filters.from,
      to: filters.to,
      limit: Math.max(filters.limit || 100, 100)
    });

    const items = auditEvents.map((event) =>
      this.toTimelineEvent({
        id: `audit:${event.id}`,
        tenantId: filters.tenantId,
        category: event.category,
        action: event.action,
        status: event.status,
        timestamp: event.timestamp,
        actor: event.actor,
        target: event.target,
        details: event.details,
        source: 'audit',
        severity: event.severity,
        evidenceRefs: [event.id]
      })
    );

    if (!category || category === 'scanner') {
      scannerTaskService.getHistory(filters.tenantId, 50).forEach((task) => {
        if (!this.withinWindow(task.createdAt, filters)) {
          return;
        }
        if (!this.matchesUser(user, filters, undefined, task.createdBy)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `scan:${task.id}`,
          tenantId: filters.tenantId,
          category: 'scanner',
          action: task.phase || 'scan_run',
          status: task.status,
          timestamp: task.createdAt,
          actor: { type: 'user', id: task.createdBy || 'system', email: task.createdBy || undefined },
          target: { type: 'scan', id: task.id },
          details: {
            progress: task.progress,
            enginePolicy: task.enginePolicy,
            findings: task.summary?.findings || {}
          },
          source: 'scanner',
          severity: task.status === 'failed' ? 'warning' : 'info'
        }));
      });
    }

    if (!category || category === 'alert') {
      securityOperationsService.listAlerts(filters.tenantId, { limit: 50 }).forEach((alert) => {
        if (!this.withinWindow(alert.timestamp, filters)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `alert:${alert.id}`,
          tenantId: filters.tenantId,
          category: 'alert',
          action: alert.type,
          status: alert.status,
          timestamp: alert.timestamp,
          target: { type: 'alert', id: alert.id },
          details: {
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            source: alert.source
          },
          source: 'security-ops',
          severity: alert.severity
        }));
      });
    }

    if (!category || category === 'action') {
      securityOperationsService.listActions(filters.tenantId, 50).forEach((action) => {
        if (!this.withinWindow(action.updatedAt, filters)) {
          return;
        }
        if (!this.matchesUser(user, filters, undefined, action.operator)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `action:${action.actionId}`,
          tenantId: filters.tenantId,
          category: 'action',
          action: action.title,
          status: action.status,
          timestamp: action.updatedAt,
          actor: { type: 'user', id: action.operator, email: action.operator },
          target: { type: 'action', id: action.actionId },
          details: {
            assetId: action.assetId,
            findingId: action.findingId,
            alertId: action.alertId
          },
          source: 'security-ops',
          severity: action.status === 'failed' ? 'warning' : 'info'
        }));
      });
    }

    if (!category || category === 'validation') {
      securityOperationsService.listValidationRuns(filters.tenantId, 50).forEach((run) => {
        if (!this.withinWindow(run.completedAt, filters)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `validation:${run.validationRunId}`,
          tenantId: filters.tenantId,
          category: 'validation',
          action: run.attackName,
          status: run.verdict,
          timestamp: run.completedAt,
          target: { type: 'validation', id: run.validationRunId },
          details: run.result,
          source: 'security-ops',
          severity: run.severity
        }));
      });
    }

    if (!category || category === 'deployment') {
      const rows = getDatabase().prepare(`
        SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
        FROM deployment_profiles
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(filters.tenantId) as any[];

      rows.forEach((row) => {
        if (!this.withinWindow(row.created_at, filters)) {
          return;
        }
        if (!this.matchesUser(user, filters, undefined, row.created_by)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `deployment:${row.id}`,
          tenantId: filters.tenantId,
          category: 'deployment',
          action: row.name || row.server_type,
          status: 'saved',
          timestamp: row.created_at,
          actor: { type: 'user', id: row.created_by, email: row.created_by },
          target: { type: 'deployment', id: row.id },
          details: {
            siteId: row.site_id,
            checksum: row.checksum,
            version: row.version
          },
          source: 'deployment',
          severity: 'info'
        }));
      });
    }

    return items
      .sort((a, b) => {
        if (a.timestamp === b.timestamp) {
          return this.severityWeight(b.severity) - this.severityWeight(a.severity);
        }
        return String(b.timestamp).localeCompare(String(a.timestamp));
      })
      .slice(0, filters.limit || 100);
  }

  async listTimelineView(filters: TenantFilters) {
    this.ensureSchema();

    if (!postgresShadowStoreService.canServeReads()) {
      return this.listTimeline(filters);
    }

    const user = filters.userId ? await this.getUserRowView(filters.userId) : null;
    const category = filters.category && filters.category !== 'all' ? filters.category : undefined;
    const auditEvents = await auditLogger.getLogsView({
      tenantId: filters.tenantId,
      category,
      actorId: filters.userId,
      from: filters.from,
      to: filters.to,
      limit: Math.max(filters.limit || 100, 100)
    });

    const items = auditEvents.map((event) =>
      this.toTimelineEvent({
        id: `audit:${event.id}`,
        tenantId: filters.tenantId,
        category: event.category as TimelineCategory,
        action: event.action,
        status: event.status,
        timestamp: event.timestamp,
        actor: event.actor,
        target: event.target,
        details: event.details,
        source: 'audit',
        severity: event.severity,
        evidenceRefs: [event.id]
      })
    );

    if (!category || category === 'scanner') {
      const scanHistory = await scannerTaskService.getHistoryView(filters.tenantId, 50);
      scanHistory.forEach((task) => {
        if (!this.withinWindow(task.createdAt, filters)) {
          return;
        }
        if (!this.matchesUser(user, filters, undefined, task.createdBy)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `scan:${task.id}`,
          tenantId: filters.tenantId,
          category: 'scanner',
          action: task.phase || 'scan_run',
          status: task.status,
          timestamp: task.createdAt,
          actor: { type: 'user', id: task.createdBy || 'system', email: task.createdBy || undefined },
          target: { type: 'scan', id: task.id },
          details: {
            progress: task.progress,
            enginePolicy: task.enginePolicy,
            findings: task.summary?.findings || {}
          },
          source: 'scanner',
          severity: task.status === 'failed' ? 'warning' : 'info'
        }));
      });
    }

    if (!category || category === 'alert') {
      const alerts = await securityOperationsService.listAlertsView(filters.tenantId, { limit: 50 });
      alerts.forEach((alert) => {
        if (!this.withinWindow(alert.timestamp, filters)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `alert:${alert.id}`,
          tenantId: filters.tenantId,
          category: 'alert',
          action: alert.type,
          status: alert.status,
          timestamp: alert.timestamp,
          target: { type: 'alert', id: alert.id },
          details: {
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            source: alert.source
          },
          source: 'security-ops',
          severity: alert.severity.toLowerCase()
        }));
      });
    }

    if (!category || category === 'action') {
      const actions = await securityOperationsService.listActionsView(filters.tenantId, 50);
      actions.forEach((action) => {
        if (!this.withinWindow(action.updatedAt, filters)) {
          return;
        }
        if (!this.matchesUser(user, filters, undefined, action.operator)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `action:${action.actionId}`,
          tenantId: filters.tenantId,
          category: 'action',
          action: action.title,
          status: action.status,
          timestamp: action.updatedAt,
          actor: { type: 'user', id: action.operator, email: action.operator },
          target: { type: 'action', id: action.actionId },
          details: {
            assetId: action.assetId,
            findingId: action.findingId,
            alertId: action.alertId
          },
          source: 'security-ops',
          severity: action.status === 'failed' ? 'warning' : 'info'
        }));
      });
    }

    if (!category || category === 'validation') {
      const runs = await securityOperationsService.listValidationRunsView(filters.tenantId, 50);
      runs.forEach((run) => {
        if (!this.withinWindow(run.completedAt, filters)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `validation:${run.validationRunId}`,
          tenantId: filters.tenantId,
          category: 'validation',
          action: run.attackName,
          status: run.verdict,
          timestamp: run.completedAt,
          target: { type: 'validation', id: run.validationRunId },
          details: run.result,
          source: 'security-ops',
          severity: run.severity
        }));
      });
    }

    if (!category || category === 'deployment') {
      this.getDeploymentRows(filters.tenantId, 50).forEach((row) => {
        if (!this.withinWindow(row.created_at, filters)) {
          return;
        }
        if (!this.matchesUser(user, filters, undefined, row.created_by)) {
          return;
        }
        items.push(this.toTimelineEvent({
          id: `deployment:${row.id}`,
          tenantId: filters.tenantId,
          category: 'deployment',
          action: row.name || row.server_type,
          status: 'saved',
          timestamp: row.created_at,
          actor: { type: 'user', id: row.created_by, email: row.created_by },
          target: { type: 'deployment', id: row.id },
          details: {
            siteId: row.site_id,
            checksum: row.checksum,
            version: row.version
          },
          source: 'deployment',
          severity: 'info'
        }));
      });
    }

    return items
      .sort((a, b) => {
        if (a.timestamp === b.timestamp) {
          return this.severityWeight(b.severity) - this.severityWeight(a.severity);
        }
        return String(b.timestamp).localeCompare(String(a.timestamp));
      })
      .slice(0, filters.limit || 100);
  }

  listEvidence(filters: TenantFilters) {
    const timeline = this.listTimeline({ ...filters, limit: Math.max(filters.limit || 100, 100) });
    const auditLogs = auditLogger.getLogs({
      tenantId: filters.tenantId,
      actorId: filters.userId,
      category: filters.category && filters.category !== 'all' ? filters.category : undefined,
      from: filters.from,
      to: filters.to,
      limit: Math.max(filters.limit || 100, 100)
    });

    return auditLogs.map((log) => {
      const related = timeline.find((item) => item.evidenceRefs.includes(log.id));
      return {
        logId: log.id,
        tenantId: log.tenantId || filters.tenantId,
        timestamp: log.timestamp,
        category: log.category,
        action: log.action,
        status: log.status,
        actor: log.actor,
        target: log.target,
        details: log.details,
        integrity: auditLogger.verifyIntegrity(log.id) ? 'valid' : 'invalid',
        relatedEventId: related?.id || null
      };
    });
  }

  async listEvidenceView(filters: TenantFilters) {
    if (!postgresShadowStoreService.canServeReads()) {
      return this.listEvidence(filters);
    }

    const [timeline, auditLogs] = await Promise.all([
      this.listTimelineView({ ...filters, limit: Math.max(filters.limit || 100, 100) }),
      auditLogger.getLogsView({
        tenantId: filters.tenantId,
        actorId: filters.userId,
        category: filters.category && filters.category !== 'all' ? filters.category : undefined,
        from: filters.from,
        to: filters.to,
        limit: Math.max(filters.limit || 100, 100)
      })
    ]);

    return await Promise.all(auditLogs.map(async (log) => {
      const related = timeline.find((item) => item.evidenceRefs.includes(log.id));
      return {
        logId: log.id,
        tenantId: log.tenantId || filters.tenantId,
        timestamp: log.timestamp,
        category: log.category,
        action: log.action,
        status: log.status,
        actor: log.actor,
        target: log.target,
        details: log.details,
        integrity: await auditLogger.verifyIntegrityView(log.id) ? 'valid' : 'invalid',
        relatedEventId: related?.id || null
      };
    }));
  }

  getUserTimeline(userId: string, extra?: Omit<TenantFilters, 'tenantId' | 'userId'>) {
    const user = this.getUserRow(userId);
    if (!user?.tenant_id) {
      return [];
    }
    return this.listTimeline({
      tenantId: user.tenant_id,
      userId,
      category: extra?.category,
      from: extra?.from,
      to: extra?.to,
      limit: extra?.limit
    });
  }

  async getUserTimelineView(userId: string, extra?: Omit<TenantFilters, 'tenantId' | 'userId'>) {
    const user = await this.getUserRowView(userId);
    if (!user?.tenant_id) {
      return [];
    }
    return this.listTimelineView({
      tenantId: user.tenant_id,
      userId,
      category: extra?.category,
      from: extra?.from,
      to: extra?.to,
      limit: extra?.limit
    });
  }

  getEventDetail(tenantId: string, eventId: string) {
    const [source, rawId] = eventId.split(':');
    if (!source || !rawId) {
      return null;
    }

    if (source === 'audit') {
      const log = auditLogger.getLogs({ tenantId, limit: 500 }).find((item) => item.id === rawId);
      if (!log) return null;
      return {
        summary: log,
        timeline: [log],
        evidence: [log],
        relatedAssets: [],
        relatedAlerts: [],
        relatedActions: []
      };
    }

    if (source === 'alert') {
      const alert = securityOperationsService.getAlertById(tenantId, rawId);
      if (!alert) return null;
      return {
        summary: alert,
        timeline: [alert],
        evidence: alert.findingId ? [securityOperationsService.getFindingById(tenantId, alert.findingId)].filter(Boolean) : [],
        relatedAssets: alert.assetId ? [securityOperationsService.getAssetById(tenantId, alert.assetId)].filter(Boolean) : [],
        relatedAlerts: [],
        relatedActions: alert.findingId ? securityOperationsService.listActions(tenantId, 50).filter((item) => item.findingId === alert.findingId) : []
      };
    }

    if (source === 'action') {
      const action = securityOperationsService.getActionById(tenantId, rawId);
      if (!action) return null;
      return {
        summary: action,
        timeline: action.runLog,
        evidence: action.runLog,
        relatedAssets: action.assetId ? [securityOperationsService.getAssetById(tenantId, action.assetId)].filter(Boolean) : [],
        relatedAlerts: action.alertId ? [securityOperationsService.getAlertById(tenantId, action.alertId)].filter(Boolean) : [],
        relatedActions: []
      };
    }

    if (source === 'validation') {
      const run = securityOperationsService.listValidationRuns(tenantId, 100).find((item) => item.validationRunId === rawId);
      if (!run) return null;
      return {
        summary: run,
        timeline: [run.result],
        evidence: [run.result],
        relatedAssets: [],
        relatedAlerts: [],
        relatedActions: []
      };
    }

    if (source === 'scan') {
      const task = scannerTaskService.getTask(rawId);
      if (!task || task.tenantId !== tenantId) return null;
      const results = scannerTaskService.getTaskResults(rawId);
      return {
        summary: task,
        timeline: results?.timeline || [],
        evidence: results?.findings || [],
        relatedAssets: [],
        relatedAlerts: [],
        relatedActions: []
      };
    }

    return null;
  }

  async getEventDetailView(tenantId: string, eventId: string) {
    if (!postgresShadowStoreService.canServeReads()) {
      return this.getEventDetail(tenantId, eventId);
    }

    const [source, rawId] = eventId.split(':');
    if (!source || !rawId) {
      return null;
    }

    if (source === 'audit') {
      const log = await auditLogger.getLogByIdView(rawId);
      if (!log || (log.tenantId && log.tenantId !== tenantId)) {
        return null;
      }
      return {
        summary: log,
        timeline: [log],
        evidence: [log],
        relatedAssets: [],
        relatedAlerts: [],
        relatedActions: []
      };
    }

    if (source === 'alert') {
      const alert = await securityOperationsService.getAlertByIdView(tenantId, rawId);
      if (!alert) return null;
      const [finding, asset, actions] = await Promise.all([
        alert.findingId ? securityOperationsService.getFindingByIdView(tenantId, alert.findingId) : Promise.resolve(null),
        alert.assetId ? securityOperationsService.getAssetByIdView(tenantId, alert.assetId) : Promise.resolve(null),
        alert.findingId
          ? securityOperationsService.listActionsView(tenantId, 100).then((items) => items.filter((item) => item.findingId === alert.findingId))
          : Promise.resolve([])
      ]);
      return {
        summary: alert,
        timeline: [alert],
        evidence: [finding].filter(Boolean),
        relatedAssets: [asset].filter(Boolean),
        relatedAlerts: [],
        relatedActions: actions
      };
    }

    if (source === 'action') {
      const action = (await securityOperationsService.listActionsView(tenantId, 100)).find((item) => item.actionId === rawId);
      if (!action) return null;
      const [asset, alert] = await Promise.all([
        action.assetId ? securityOperationsService.getAssetByIdView(tenantId, action.assetId) : Promise.resolve(null),
        action.alertId ? securityOperationsService.getAlertByIdView(tenantId, action.alertId) : Promise.resolve(null)
      ]);
      return {
        summary: action,
        timeline: action.runLog,
        evidence: action.runLog,
        relatedAssets: [asset].filter(Boolean),
        relatedAlerts: [alert].filter(Boolean),
        relatedActions: []
      };
    }

    if (source === 'validation') {
      const run = await securityOperationsService.getValidationRunByIdView(tenantId, rawId);
      if (!run) return null;
      return {
        summary: run,
        timeline: [run.result],
        evidence: [run.result],
        relatedAssets: [],
        relatedAlerts: [],
        relatedActions: []
      };
    }

    if (source === 'scan') {
      const task = await scannerTaskService.getTaskView(rawId);
      if (!task || task.tenantId !== tenantId) return null;
      const results = await scannerTaskService.getTaskResultsView(rawId);
      return {
        summary: task,
        timeline: results?.timeline || [],
        evidence: results?.findings || [],
        relatedAssets: results?.assetGroups || [],
        relatedAlerts: results?.relatedAlerts || [],
        relatedActions: results?.relatedActions || []
      };
    }

    return null;
  }

  createExport(input: {
    tenantId: string;
    requestedBy: string;
    filters?: Record<string, any>;
  }) {
    this.ensureSchema();
    const db = getDatabase();
    const id = `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = this.now();
    const filters = input.filters || {};
    const timeline = this.listTimeline({
      tenantId: input.tenantId,
      userId: filters.userId,
      category: filters.category,
      from: filters.from,
      to: filters.to,
      limit: 500
    });
    const evidence = this.listEvidence({
      tenantId: input.tenantId,
      userId: filters.userId,
      category: filters.category,
      from: filters.from,
      to: filters.to,
      limit: 500
    });
    const summary = this.getTenantSummary(input.tenantId, filters.userId);

    const jsonPayload = JSON.stringify({
      exportedAt: createdAt,
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      filters,
      summary,
      timeline,
      evidence
    }, null, 2);

    const csvPayload = [
      'timestamp,category,action,status,actor,target,severity',
      ...timeline.map((item) => [
        item.timestamp,
        item.category,
        `"${String(item.action || '').replace(/"/g, '""')}"`,
        item.status,
        `"${String(item.actor?.email || item.actor?.id || '').replace(/"/g, '""')}"`,
        `"${String(item.target?.id || '').replace(/"/g, '""')}"`,
        item.severity || ''
      ].join(','))
    ].join('\n');

    db.prepare(`
      INSERT INTO admin_dispute_exports (
        id, tenant_id, requested_by, requested_at, filters_json, summary_json, json_payload, csv_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.tenantId,
      input.requestedBy,
      createdAt,
      JSON.stringify(filters),
      JSON.stringify(summary),
      jsonPayload,
      csvPayload
    );

    return this.getExport(id);
  }

  async createExportView(input: {
    tenantId: string;
    requestedBy: string;
    filters?: Record<string, any>;
  }) {
    this.ensureSchema();

    if (!postgresShadowStoreService.canServeReads()) {
      return this.createExport(input);
    }

    const db = getDatabase();
    const id = `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = this.now();
    const filters = input.filters || {};
    const [timeline, evidence, summary] = await Promise.all([
      this.listTimelineView({
        tenantId: input.tenantId,
        userId: filters.userId,
        category: filters.category,
        from: filters.from,
        to: filters.to,
        limit: 500
      }),
      this.listEvidenceView({
        tenantId: input.tenantId,
        userId: filters.userId,
        category: filters.category,
        from: filters.from,
        to: filters.to,
        limit: 500
      }),
      this.getTenantSummaryView(input.tenantId, filters.userId)
    ]);

    const jsonPayload = JSON.stringify({
      exportedAt: createdAt,
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      filters,
      summary,
      timeline,
      evidence
    }, null, 2);

    const csvPayload = [
      'timestamp,category,action,status,actor,target,severity',
      ...timeline.map((item) => [
        item.timestamp,
        item.category,
        `"${String(item.action || '').replace(/"/g, '""')}"`,
        item.status,
        `"${String(item.actor?.email || item.actor?.id || '').replace(/"/g, '""')}"`,
        `"${String(item.target?.id || '').replace(/"/g, '""')}"`,
        item.severity || ''
      ].join(','))
    ].join('\n');

    await postgresShadowStoreService.execute(`
      INSERT INTO admin_dispute_exports (
        id, tenant_id, requested_by, requested_at, filters_json, summary_json, json_payload, csv_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id)
      DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        requested_by = EXCLUDED.requested_by,
        requested_at = EXCLUDED.requested_at,
        filters_json = EXCLUDED.filters_json,
        summary_json = EXCLUDED.summary_json,
        json_payload = EXCLUDED.json_payload,
        csv_payload = EXCLUDED.csv_payload
    `, [
      id,
      input.tenantId,
      input.requestedBy,
      createdAt,
      JSON.stringify(filters),
      JSON.stringify(summary),
      jsonPayload,
      csvPayload
    ]);

    db.prepare(`
      INSERT INTO admin_dispute_exports (
        id, tenant_id, requested_by, requested_at, filters_json, summary_json, json_payload, csv_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.tenantId,
      input.requestedBy,
      createdAt,
      JSON.stringify(filters),
      JSON.stringify(summary),
      jsonPayload,
      csvPayload
    );

    return this.getExportView(id);
  }

  listExports(tenantId: string) {
    this.ensureSchema();
    const rows = getDatabase().prepare(`
      SELECT id, tenant_id, requested_by, requested_at, filters_json, summary_json
      FROM admin_dispute_exports
      WHERE tenant_id = ?
      ORDER BY requested_at DESC
      LIMIT 50
    `).all(tenantId) as any[];

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      filters: this.parseJson(row.filters_json, {}),
      summary: this.parseJson(row.summary_json, {})
    }));
  }

  async listExportsView(tenantId: string) {
    this.ensureSchema();

    if (!postgresShadowStoreService.canServeReads()) {
      return this.listExports(tenantId);
    }

    const rows = await postgresShadowStoreService.queryAll<any>(`
      SELECT id, tenant_id, requested_by, requested_at, filters_json, summary_json
      FROM admin_dispute_exports
      WHERE tenant_id = $1
      ORDER BY requested_at DESC
      LIMIT 50
    `, [tenantId]);

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      filters: this.parseJson(row.filters_json, {}),
      summary: this.parseJson(row.summary_json, {})
    }));
  }

  getExport(exportId: string) {
    this.ensureSchema();
    const row = getDatabase().prepare(`
      SELECT *
      FROM admin_dispute_exports
      WHERE id = ?
      LIMIT 1
    `).get(exportId) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      filters: this.parseJson(row.filters_json, {}),
      summary: this.parseJson(row.summary_json, {}),
      jsonPayload: row.json_payload,
      csvPayload: row.csv_payload
    };
  }

  async getExportView(exportId: string) {
    this.ensureSchema();

    if (!postgresShadowStoreService.canServeReads()) {
      return this.getExport(exportId);
    }

    const row = await postgresShadowStoreService.queryOne<any>(`
      SELECT *
      FROM admin_dispute_exports
      WHERE id = $1
      LIMIT 1
    `, [exportId]);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      filters: this.parseJson(row.filters_json, {}),
      summary: this.parseJson(row.summary_json, {}),
      jsonPayload: row.json_payload,
      csvPayload: row.csv_payload
    };
  }

  resolveRange(range?: string) {
    return this.buildWindow(range);
  }
}

export const tenantOversightService = new TenantOversightService();
