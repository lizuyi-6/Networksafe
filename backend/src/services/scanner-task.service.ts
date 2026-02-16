import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { getDatabase } from '../config/database';
import { OptimizationEngine } from '../scanner/optimization-engine';
import { NucleiScanner } from '../scanner/nuclei-scanner';

type ScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type ScanPhase = 'queued' | 'url-scan' | 'host-scan' | 'nuclei-scan' | 'finalizing' | 'done';

export interface ScanTaskInput {
  tenantId: string;
  createdBy: string;
  targets: {
    urls: string[];
    host: {
      mode: 'local';
      includeSystem: boolean;
      includeWeb: boolean;
      includePorts: boolean;
    };
  };
  enginePolicy: 'opt_then_nuclei';
}

export interface ScanTaskState {
  id: string;
  tenantId: string;
  createdBy: string;
  status: ScanStatus;
  phase: ScanPhase;
  progress: number;
  enginePolicy: 'opt_then_nuclei';
  targets: ScanTaskInput['targets'];
  summary: Record<string, any>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

type BroadcastFn = (event: string, data: any) => void;

const DEFAULT_SUMMARY = {
  urlTargets: 0,
  hostEnabled: false,
  findings: {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  },
  nuclei: 'not_run'
};

class ScannerTaskService {
  private tasks = new Map<string, ScanTaskState>();
  private cancelled = new Set<string>();
  private broadcaster: BroadcastFn = () => {};
  private optimizationEngine = new OptimizationEngine();
  private nucleiScanner = new NucleiScanner();
  private schemaReady = false;

  setBroadcaster(fn: BroadcastFn): void {
    this.broadcaster = fn;
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress INTEGER NOT NULL,
        engine_policy TEXT NOT NULL,
        targets_json TEXT NOT NULL,
        summary_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        evidence_json TEXT,
        source_engine TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.schemaReady = true;
  }

  private nowISO(): string {
    return new Date().toISOString();
  }

  private persistTask(task: ScanTaskState): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_tasks
      (id, tenant_id, created_by, status, phase, progress, engine_policy, targets_json, summary_json, error, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.tenantId,
      task.createdBy,
      task.status,
      task.phase,
      task.progress,
      task.enginePolicy,
      JSON.stringify(task.targets),
      JSON.stringify(task.summary || {}),
      task.error || null,
      task.createdAt,
      task.startedAt || null,
      task.completedAt || null
    );
  }

  private emitEvent(task: ScanTaskState, eventType: string, payload: any): void {
    const data = {
      taskId: task.id,
      tenantId: task.tenantId,
      timestamp: this.nowISO(),
      payload
    };
    const db = getDatabase();
    db.prepare(`
      INSERT INTO scan_events (task_id, tenant_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(task.id, task.tenantId, eventType, JSON.stringify(payload || {}), this.nowISO());
    this.broadcaster(eventType, data);
  }

  private upsertTask(task: ScanTaskState, eventType?: string, payload?: any): void {
    this.tasks.set(task.id, task);
    this.persistTask(task);
    if (eventType) {
      this.emitEvent(task, eventType, payload ?? {
        status: task.status,
        phase: task.phase,
        progress: task.progress
      });
    }
  }

  private addFinding(
    task: ScanTaskState,
    targetType: 'url' | 'host' | 'nuclei',
    target: string,
    severity: 'critical' | 'high' | 'medium' | 'low',
    title: string,
    description: string,
    evidence: any,
    sourceEngine: string
  ): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO scan_findings (task_id, tenant_id, target_type, target, severity, title, description, evidence_json, source_engine, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.tenantId,
      targetType,
      target,
      severity,
      title,
      description,
      JSON.stringify(evidence || {}),
      sourceEngine,
      this.nowISO()
    );

    task.summary.findings[severity] = (task.summary.findings[severity] || 0) + 1;
  }

  private isTaskCancelled(taskId: string): boolean {
    return this.cancelled.has(taskId);
  }

  private async scanUrl(task: ScanTaskState, url: string): Promise<void> {
    let response: Response | null = null;
    try {
      response = await fetch(url, { method: 'GET', redirect: 'follow' });
    } catch (error: any) {
      this.addFinding(
        task,
        'url',
        url,
        'high',
        'Target Unreachable',
        `Failed to connect to URL: ${error.message}`,
        { error: error.message },
        'url_probe'
      );
      this.emitEvent(task, 'scanner:task:log', { level: 'warn', message: `URL unreachable: ${url}` });
      return;
    }

    const headers = response.headers;
    const status = response.status;
    if (status >= 500) {
      this.addFinding(
        task,
        'url',
        url,
        'medium',
        'Server Error Response',
        `Target returned status ${status}`,
        { status },
        'url_probe'
      );
    }

    const requiredHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'content-security-policy'
    ];
    for (const h of requiredHeaders) {
      if (!headers.get(h)) {
        this.addFinding(
          task,
          'url',
          url,
          'medium',
          'Missing Security Header',
          `Missing header: ${h}`,
          { header: h },
          'url_probe'
        );
      }
    }

    const server = headers.get('server');
    if (server && /apache\/2\.2|nginx\/1\.[0-9]\b/i.test(server)) {
      this.addFinding(
        task,
        'url',
        url,
        'high',
        'Potentially Outdated Server Version',
        `Server header indicates older version: ${server}`,
        { server },
        'url_probe'
      );
    }
  }

  private async runNuclei(task: ScanTaskState, urls: string[]): Promise<void> {
    const available = await this.nucleiScanner.checkAvailability();
    if (!available) {
      task.summary.nuclei = 'skipped';
      this.emitEvent(task, 'scanner:task:log', { level: 'info', message: 'Nuclei unavailable, skipping nuclei phase' });
      return;
    }
    task.summary.nuclei = 'running';
    for (const url of urls) {
      if (this.isTaskCancelled(task.id)) return;
      try {
        const findings = await this.nucleiScanner.quickScan(url, (p) => {
          this.emitEvent(task, 'scanner:task:progress', {
            phase: task.phase,
            progress: task.progress,
            detail: `Nuclei ${url}: ${p.progress}%`
          });
        });
        for (const finding of findings) {
          const sev = (finding.severity || 'medium').toLowerCase() as 'critical' | 'high' | 'medium' | 'low';
          this.addFinding(
            task,
            'nuclei',
            url,
            ['critical', 'high', 'medium', 'low'].includes(sev) ? sev : 'medium',
            finding.name || 'Nuclei finding',
            finding.description || finding.matched || 'Nuclei detected vulnerability',
            finding,
            'nuclei'
          );
        }
      } catch (error: any) {
        this.emitEvent(task, 'scanner:task:log', { level: 'warn', message: `Nuclei failed for ${url}: ${error.message}` });
      }
    }
    task.summary.nuclei = 'completed';
  }

  private async runHostScan(task: ScanTaskState): Promise<void> {
    const host = task.targets.host;
    if (!host || !host.mode) return;
    const result = await this.optimizationEngine.runFullScan({
      scanPorts: host.includePorts,
      scanSystem: host.includeSystem,
      scanWebServer: host.includeWeb
    });
    for (const rec of result.recommendations || []) {
      this.addFinding(
        task,
        'host',
        'local',
        rec.priority,
        rec.title,
        rec.description,
        rec,
        'optimization_engine'
      );
    }
  }

  async createTask(input: ScanTaskInput): Promise<ScanTaskState> {
    this.ensureSchema();
    const running = this.getRunningTaskByTenant(input.tenantId);
    if (running) {
      const error: any = new Error('A scan task is already running for this tenant');
      error.code = 'TENANT_TASK_RUNNING';
      throw error;
    }

    const task: ScanTaskState = {
      id: randomUUID(),
      tenantId: input.tenantId,
      createdBy: input.createdBy,
      status: 'pending',
      phase: 'queued',
      progress: 0,
      enginePolicy: input.enginePolicy,
      targets: input.targets,
      summary: {
        ...DEFAULT_SUMMARY,
        urlTargets: input.targets.urls.length,
        hostEnabled: !!input.targets.host
      },
      createdAt: this.nowISO()
    };

    this.upsertTask(task, 'scanner:task:created', { status: task.status, phase: task.phase });

    // Run asynchronously after response
    setImmediate(() => {
      this.runTask(task.id).catch((err) => {
        logger.error('Scanner task execution failed', { taskId: task.id, error: err.message });
      });
    });

    return task;
  }

  getRunningTaskByTenant(tenantId: string): ScanTaskState | null {
    for (const task of this.tasks.values()) {
      if (task.tenantId === tenantId && (task.status === 'pending' || task.status === 'running')) {
        return task;
      }
    }
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM scan_tasks
      WHERE tenant_id = ? AND status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(tenantId) as any;
    if (!row) return null;
    return this.mapTaskRow(row);
  }

  private mapTaskRow(row: any): ScanTaskState {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      createdBy: row.created_by,
      status: row.status,
      phase: row.phase,
      progress: row.progress,
      enginePolicy: row.engine_policy,
      targets: JSON.parse(row.targets_json),
      summary: row.summary_json ? JSON.parse(row.summary_json) : { ...DEFAULT_SUMMARY },
      error: row.error || undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined
    };
  }

  getTask(taskId: string): ScanTaskState | null {
    const inMem = this.tasks.get(taskId);
    if (inMem) return inMem;
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM scan_tasks WHERE id = ?').get(taskId) as any;
    return row ? this.mapTaskRow(row) : null;
  }

  getTaskResults(taskId: string): any {
    this.ensureSchema();
    const task = this.getTask(taskId);
    if (!task) return null;
    const db = getDatabase();
    const events = db.prepare(`
      SELECT event_type, payload_json, created_at
      FROM scan_events
      WHERE task_id = ?
      ORDER BY id ASC
    `).all(taskId) as any[];
    const findings = db.prepare(`
      SELECT target_type, target, severity, title, description, evidence_json, source_engine, created_at
      FROM scan_findings
      WHERE task_id = ?
      ORDER BY id ASC
    `).all(taskId) as any[];

    return {
      taskId,
      timeline: events.map((e) => ({
        eventType: e.event_type,
        payload: e.payload_json ? JSON.parse(e.payload_json) : {},
        createdAt: e.created_at
      })),
      urlFindings: findings.filter((f) => f.target_type === 'url').map(this.mapFinding),
      hostFindings: findings.filter((f) => f.target_type === 'host').map(this.mapFinding),
      nucleiFindings: findings.filter((f) => f.target_type === 'nuclei').map(this.mapFinding),
      summary: task.summary
    };
  }

  private mapFinding(row: any): any {
    return {
      target: row.target,
      severity: row.severity,
      title: row.title,
      description: row.description,
      evidence: row.evidence_json ? JSON.parse(row.evidence_json) : {},
      sourceEngine: row.source_engine,
      createdAt: row.created_at
    };
  }

  getHistory(tenantId: string, limit = 20): ScanTaskState[] {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM scan_tasks
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
    return rows.map((r) => this.mapTaskRow(r));
  }

  cancelTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;
    if (task.status !== 'pending' && task.status !== 'running') return false;
    this.cancelled.add(taskId);
    task.status = 'cancelled';
    task.phase = 'done';
    task.progress = 100;
    task.completedAt = this.nowISO();
    this.upsertTask(task, 'scanner:task:cancelled', { status: task.status });
    return true;
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) return;
    if (this.isTaskCancelled(task.id)) return;

    task.status = 'running';
    task.phase = 'url-scan';
    task.progress = 5;
    task.startedAt = this.nowISO();
    this.upsertTask(task, 'scanner:task:started', { phase: task.phase, progress: task.progress });

    try {
      const urls = task.targets.urls || [];
      for (let i = 0; i < urls.length; i++) {
        if (this.isTaskCancelled(task.id)) return;
        await this.scanUrl(task, urls[i]);
        task.progress = Math.min(35, 5 + Math.round(((i + 1) / Math.max(1, urls.length)) * 30));
        this.upsertTask(task, 'scanner:task:progress', { phase: task.phase, progress: task.progress });
      }

      if (this.isTaskCancelled(task.id)) return;
      task.phase = 'host-scan';
      task.progress = 45;
      this.upsertTask(task, 'scanner:task:phase', { phase: task.phase, progress: task.progress });
      await this.runHostScan(task);
      task.progress = 75;
      this.upsertTask(task, 'scanner:task:progress', { phase: task.phase, progress: task.progress });

      if (this.isTaskCancelled(task.id)) return;
      task.phase = 'nuclei-scan';
      task.progress = 80;
      this.upsertTask(task, 'scanner:task:phase', { phase: task.phase, progress: task.progress });
      await this.runNuclei(task, urls);
      task.progress = 95;
      this.upsertTask(task, 'scanner:task:progress', { phase: task.phase, progress: task.progress });

      if (this.isTaskCancelled(task.id)) return;
      task.phase = 'finalizing';
      this.upsertTask(task, 'scanner:task:phase', { phase: task.phase, progress: task.progress });

      task.status = 'completed';
      task.phase = 'done';
      task.progress = 100;
      task.completedAt = this.nowISO();
      this.upsertTask(task, 'scanner:task:completed', { summary: task.summary });
    } catch (error: any) {
      task.status = 'failed';
      task.phase = 'done';
      task.progress = 100;
      task.error = error.message;
      task.completedAt = this.nowISO();
      this.upsertTask(task, 'scanner:task:failed', { error: error.message });
    }
  }
}

export const scannerTaskService = new ScannerTaskService();
