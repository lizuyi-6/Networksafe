/**
 * Security Operations Service Tests
 *
 * Smoke tests for security findings, alerts, and action tracking.
 * Uses the real in-memory SQLite database and the real service singleton.
 */

import { initDatabase, getDatabase } from '../../config/database';
import { securityOperationsService } from '../../services/security-operations.service';
import { scannerTaskService } from '../../services/scanner-task.service';

describe('securityOperationsService smoke tests', () => {
  beforeAll(async () => {
    await initDatabase();
    scannerTaskService.prepare();
    securityOperationsService.prepare();
  });

  beforeEach(() => {
    // Clear operational tables between tests so smoke tests don't
    // collide on UNIQUE constraints (fingerprint, externalRef, etc.).
    const db = getDatabase();
    db.exec('DELETE FROM sec_findings;');
    db.exec('DELETE FROM sec_assets;');
    db.exec('DELETE FROM sec_alerts;');
    db.exec('DELETE FROM sec_actions;');
  });

  it('upserts an asset and retrieves it by external ref', () => {
    const tenantId = `tenant-asset-${Date.now()}`;

    const asset = securityOperationsService.upsertAsset({
      tenantId,
      assetType: 'host',
      externalRef: '192.168.1.100',
      displayName: 'Test Server',
      primaryAddress: '192.168.1.100',
      status: 'observed',
      metadata: { os: 'linux' }
    });

    expect(asset.assetId).toBeTruthy();
    expect(asset.displayName).toBe('Test Server');
    expect(asset.assetType).toBe('host');

    const found = securityOperationsService.getAssetByExternalRef(tenantId, 'host', '192.168.1.100');
    expect(found).toBeDefined();
    expect(found?.assetId).toBe(asset.assetId);
  });

  it('lists assets and returns the upserted asset', () => {
    const tenantId = `tenant-list-asset-${Date.now()}`;

    securityOperationsService.upsertAsset({
      tenantId,
      assetType: 'url',
      externalRef: 'https://app.example.com',
      displayName: 'Example App',
      status: 'observed'
    });

    const assets = securityOperationsService.listAssets(tenantId, 50);
    expect(assets.length).toBeGreaterThan(0);
    const found = assets.find(a => a.externalRef === 'https://app.example.com');
    expect(found).toBeDefined();
    expect(found?.displayName).toBe('Example App');
  });

  it('ingests a finding and retrieves it by id', () => {
    const tenantId = `tenant-finding-${Date.now()}`;

    const finding = securityOperationsService.ingestFinding({
      tenantId,
      sourceType: 'scanner',
      sourceRef: 'nuclei',
      target: 'https://app.example.com',
      category: 'sql-injection',
      severity: 'high',
      title: 'SQL Injection in Login',
      description: 'Login form vulnerable to SQL injection',
      evidence: { url: 'https://app.example.com/login' },
      remediation: { fix: 'use parameterized queries' }
    });

    expect(finding.findingId).toBeTruthy();
    expect(finding.severity).toBe('high');
    expect(finding.title).toBe('SQL Injection in Login');

    const found = securityOperationsService.getFindingById(tenantId, finding.findingId);
    expect(found).toBeDefined();
    expect(found?.fingerprint).toBe(finding.fingerprint);
  });

  it('creates an alert from a critical finding', () => {
    const tenantId = `tenant-alert-${Date.now()}`;

    // First ingest a critical finding
    const finding = securityOperationsService.ingestFinding({
      tenantId,
      sourceType: 'scanner',
      sourceRef: 'nuclei',
      target: 'https://critical.example.com',
      category: 'rce',
      severity: 'critical',
      title: 'Remote Code Execution',
      description: 'RCE vulnerability found',
      createAlert: true
    });

    expect(finding.findingId).toBeTruthy();

    // List alerts for tenant
    const alerts = securityOperationsService.listAlerts(tenantId);
    expect(alerts.length).toBeGreaterThan(0);
    const criticalAlert = alerts.find(a => a.severity === 'Critical');
    expect(criticalAlert).toBeDefined();
    expect(criticalAlert?.title).toBe('Remote Code Execution');
  });

  it('records an action run and retrieves it', () => {
    const tenantId = `tenant-action-${Date.now()}`;

    const action = securityOperationsService.recordActionRun({
      tenantId,
      title: 'Block malicious IP',
      status: 'pending',
      operator: 'admin@test.com',
      rollbackNotes: 'Unblock the IP if legitimate traffic',
      runLog: [
        { at: new Date().toISOString(), message: 'Action created', actor: 'admin@test.com' }
      ]
    });

    expect(action.actionId).toBeTruthy();
    expect(action.status).toBe('pending');
    expect(action.operator).toBe('admin@test.com');

    const found = securityOperationsService.getActionById(tenantId, action.actionId);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Block malicious IP');
  });

  it('updates an action run status and appends log', () => {
    const tenantId = `tenant-update-${Date.now()}`;

    const action = securityOperationsService.recordActionRun({
      tenantId,
      title: 'Scan network',
      status: 'pending',
      operator: 'scanner@test.com'
    });

    const updated = securityOperationsService.updateActionRun({
      tenantId,
      actionId: action.actionId,
      status: 'running',
      appendLog: [
        { at: new Date().toISOString(), message: 'Scan started', actor: 'system' }
      ]
    });

    expect(updated).toBeDefined();
    expect(updated?.status).toBe('running');
    expect(updated?.runLog.length).toBeGreaterThan(0);
  });

  it('summarizes threats for a tenant', () => {
    const tenantId = `tenant-threats-${Date.now()}`;

    // Ingest a few findings
    securityOperationsService.ingestFinding({
      tenantId,
      sourceType: 'scanner',
      sourceRef: 'nuclei',
      target: 'https://app.example.com',
      category: 'xss',
      severity: 'medium',
      title: 'XSS in search box',
      description: 'Cross-site scripting'
    });

    securityOperationsService.ingestFinding({
      tenantId,
      sourceType: 'scanner',
      sourceRef: 'nuclei',
      target: 'https://app.example.com',
      category: 'sql-injection',
      severity: 'high',
      title: 'SQL Injection',
      description: 'SQL injection found'
    });

    const summary = securityOperationsService.summarizeThreats(tenantId);
    expect(summary.length).toBeGreaterThan(0);
    // Should have xss and sql-injection categories
    const categories = summary.map(s => s.type);
    expect(categories).toContain('xss');
    expect(categories).toContain('sql-injection');
  });

  it('gets dashboard summary with counts', () => {
    const tenantId = `tenant-dash-${Date.now()}`;

    // Ingest a critical finding
    securityOperationsService.ingestFinding({
      tenantId,
      sourceType: 'scanner',
      sourceRef: 'nuclei',
      target: 'https://app.example.com',
      category: 'rce',
      severity: 'critical',
      title: 'RCE',
      description: 'Critical RCE'
    });

    const summary = securityOperationsService.getDashboardSummary(tenantId);
    expect(summary).toBeDefined();
    expect(typeof summary.openCriticalFindings).toBe('number');
    expect(typeof summary.highRiskFindings).toBe('number');
    expect(typeof summary.activeAlerts).toBe('number');
    expect(Array.isArray(summary.recentActions)).toBe(true);
    expect(Array.isArray(summary.recentValidations)).toBe(true);
  });
});
