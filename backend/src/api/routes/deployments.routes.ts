import { Router, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { InputValidator } from '../../security/input-validator';
import { getDatabase } from '../../config/database';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import auditLogger from '../../security/audit-logger.service';

// SECURITY FIX CVE-2026-014: Add input validation to deployments routes
const inputValidator = new InputValidator();

const router = Router();
router.use(authenticate, requireRole('admin'));

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
}

function nowISO(): string {
  return new Date().toISOString();
}

function ensureSchema(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT,
      server_type TEXT NOT NULL,
      name TEXT,
      profile_json TEXT NOT NULL,
      config_text TEXT NOT NULL,
      env_snippet TEXT NOT NULL,
      checksum TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

async function getDeploymentRow(id: string, tenantId: string) {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<any>(`
      SELECT *
      FROM deployment_profiles
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `, [id, tenantId]);
  }

  return getDatabase().prepare(`
    SELECT *
    FROM deployment_profiles
    WHERE id = ? AND tenant_id = ?
  `).get(id, tenantId) as any;
}

async function listDeploymentRows(tenantId: string, siteId: string | null, limit: number) {
  if (postgresShadowStoreService.canServeReads()) {
    if (siteId) {
      return await postgresShadowStoreService.queryAll<any>(`
        SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
        FROM deployment_profiles
        WHERE tenant_id = $1 AND site_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `, [tenantId, siteId, limit]);
    }
    return await postgresShadowStoreService.queryAll<any>(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [tenantId, limit]);
  }

  const db = getDatabase();
  if (siteId) {
    return db.prepare(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = ? AND site_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, siteId, limit) as any[];
  }

  return db.prepare(`
    SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
    FROM deployment_profiles
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(tenantId, limit) as any[];
}

async function getNextVersion(tenantId: string, serverType: string, siteId: string | null) {
  if (postgresShadowStoreService.canServeReads()) {
    const row = await postgresShadowStoreService.queryOne<any>(`
      SELECT MAX(version) AS "maxVersion"
      FROM deployment_profiles
      WHERE tenant_id = $1 AND server_type = $2 AND ((site_id = $3) OR ($3 IS NULL AND site_id IS NULL))
    `, [tenantId, serverType, siteId]);
    return (Number(row?.maxVersion || 0) || 0) + 1;
  }

  const row = getDatabase().prepare(`
    SELECT MAX(version) as maxVersion
    FROM deployment_profiles
    WHERE tenant_id = ? AND server_type = ? AND (site_id = ? OR (? IS NULL AND site_id IS NULL))
  `).get(tenantId, serverType, siteId, siteId) as any;
  return (Number(row?.maxVersion || 0) || 0) + 1;
}

async function persistDeployment(row: Record<string, any>) {
  if (postgresShadowStoreService.canServeReads()) {
    await postgresShadowStoreService.execute(`
      INSERT INTO deployment_profiles
      (id, tenant_id, site_id, server_type, name, profile_json, config_text, env_snippet, checksum, version, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id)
      DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        site_id = EXCLUDED.site_id,
        server_type = EXCLUDED.server_type,
        name = EXCLUDED.name,
        profile_json = EXCLUDED.profile_json,
        config_text = EXCLUDED.config_text,
        env_snippet = EXCLUDED.env_snippet,
        checksum = EXCLUDED.checksum,
        version = EXCLUDED.version,
        created_by = EXCLUDED.created_by,
        created_at = EXCLUDED.created_at
    `, [
      row.id,
      row.tenant_id,
      row.site_id,
      row.server_type,
      row.name,
      row.profile_json,
      row.config_text,
      row.env_snippet,
      row.checksum,
      row.version,
      row.created_by,
      row.created_at
    ]);
  }

  getDatabase().prepare(`
    INSERT OR REPLACE INTO deployment_profiles
    (id, tenant_id, site_id, server_type, name, profile_json, config_text, env_snippet, checksum, version, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.tenant_id,
    row.site_id,
    row.server_type,
    row.name,
    row.profile_json,
    row.config_text,
    row.env_snippet,
    row.checksum,
    row.version,
    row.created_by,
    row.created_at
  );

  if (!postgresShadowStoreService.canServeReads()) {
    void postgresShadowStoreService.upsert('deployment_profiles', row);
  }
}

function renderNginx(profile: any): string {
  return `server {
  listen ${profile.port};
  server_name ${profile.serverName};

  location / {
    proxy_pass ${profile.upstream};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  limit_req_zone $binary_remote_addr zone=api_limit:10m rate=${profile.rateLimit}r/m;
  location /api/ {
    limit_req zone=api_limit burst=20 nodelay;
  }
}`;
}

function renderApache(profile: any): string {
  return `<VirtualHost *:${profile.port}>
  ServerName ${profile.serverName}
  ProxyPreserveHost On
  ProxyPass / ${profile.upstream}/
  ProxyPassReverse / ${profile.upstream}/

  <Location /api/>
    SetEnv RATE_LIMIT ${profile.rateLimit}
  </Location>
</VirtualHost>`;
}

function renderEnvSnippet(profile: any): string {
  return `ALLOWED_ORIGINS=http://${profile.serverName}
RATE_LIMIT_REQUESTS=${profile.rateLimit}
UPSTREAM_TARGET=${profile.upstream}
LISTEN_PORT=${profile.port}`;
}

function validateProfile(profile: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const port = Number(profile?.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) errors.push('Invalid port');
  if (!profile?.serverName || typeof profile.serverName !== 'string') errors.push('Invalid serverName');
  if (!profile?.upstream || typeof profile.upstream !== 'string') errors.push('Invalid upstream');
  const rate = Number(profile?.rateLimit);
  if (!Number.isFinite(rate) || rate < 1 || rate > 100000) errors.push('Invalid rateLimit');
  return { ok: errors.length === 0, errors };
}

router.post('/generate', (req: AuthenticatedRequest, res: Response) => {
  // SECURITY FIX CVE-2026-014: Validate input before processing
  const validationResult = inputValidator.validateRequest(req);
  if (!validationResult.isValid) {
    return res.status(400).json({
      success: false,
      error: 'backend.invalid_input',
      details: validationResult.errors
    });
  }

  ensureSchema();
  const serverType = req.body?.serverType;
  const profile = req.body?.profile || {};
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: 'backend.invalid_profile', details: validation.errors });
  }
  if (serverType !== 'nginx' && serverType !== 'apache') {
    return res.status(400).json({ success: false, error: 'backend.servertype_must_be_nginx_or_apache' });
  }

  const configText = serverType === 'nginx' ? renderNginx(profile) : renderApache(profile);
  const envSnippet = renderEnvSnippet(profile);
  const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');

  return res.json({
    success: true,
    data: {
      configText,
      envSnippet,
      checksum,
      warnings: []
    }
  });
});

router.post('/save', async (req: AuthenticatedRequest, res: Response) => {
  try {
  ensureSchema();
  const serverType = req.body?.serverType;
  const profile = req.body?.profile || {};
  const siteId = req.body?.siteId || null;
  const name = req.body?.name || null;

  if (serverType !== 'nginx' && serverType !== 'apache') {
    return res.status(400).json({ success: false, error: 'backend.servertype_must_be_nginx_or_apache' });
  }
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: 'backend.invalid_profile', details: validation.errors });
  }
  const configText = serverType === 'nginx' ? renderNginx(profile) : renderApache(profile);
  const envSnippet = renderEnvSnippet(profile);

  const tenantId = tenantOf(req);
  const version = await getNextVersion(tenantId, serverType, siteId);
  const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');
  const id = randomUUID();
  const createdAt = nowISO();

  await persistDeployment({
    id,
    tenant_id: tenantId,
    site_id: siteId,
    server_type: serverType,
    name,
    profile_json: JSON.stringify(profile),
    config_text: configText,
    env_snippet: envSnippet,
    checksum,
    version,
    created_by: req.user!.userId,
    created_at: createdAt
  });

  await auditLogger.log({
    tenantId,
    eventType: 'deployment_profile_saved',
    category: 'system',
    severity: 'warning',
    actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: req.ip },
    target: { type: 'site', id: siteId || id },
    action: 'save_deployment_profile',
    details: { deploymentId: id, serverType, version, checksum, name },
    status: 'success'
  });

  return res.json({
    success: true,
    data: {
      deploymentId: id,
      version,
      createdAt
    }
  });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_save_deployment_profile' });
  }
});

router.get('/:id/download', async (req: AuthenticatedRequest, res: Response) => {
  try {
  ensureSchema();
  const format = String(req.query.format || 'bundle');
  const row = await getDeploymentRow(req.params.id, tenantOf(req));
  if (!row) {
    return res.status(404).json({ success: false, error: 'backend.deployment_profile_not_found' });
  }

  void auditLogger.log({
    tenantId: tenantOf(req),
    eventType: 'deployment_profile_downloaded',
    category: 'system',
    severity: 'info',
    actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: req.ip },
    target: { type: 'site', id: String(row.site_id || row.id) },
    action: 'download_deployment_profile',
    details: { deploymentId: row.id, format },
    status: 'success'
  });

  if (format === 'conf') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}.conf"`);
    return res.send(row.config_text);
  }
  if (format === 'env') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}.env"`);
    return res.send(row.env_snippet);
  }

  const bundle = `# Config\n${row.config_text}\n\n# Env Snippet\n${row.env_snippet}\n`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}-bundle.txt"`);
  return res.send(bundle);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_download_deployment_profile' });
  }
});

router.get('/history/list', async (req: AuthenticatedRequest, res: Response) => {
  try {
  ensureSchema();
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 200);
  const siteId = (req.query.siteId as string) || null;
  const tenantId = tenantOf(req);
  const rows = await listDeploymentRows(tenantId, siteId, limit);

  return res.json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_load_deployment_history' });
  }
});

export default router;
