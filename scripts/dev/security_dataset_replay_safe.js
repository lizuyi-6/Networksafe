const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const rootDir = path.resolve(__dirname, '..', '..');
const baseUrl = process.env.AETHERGUARD_BASE_URL || 'http://localhost:3005';
const datasetRepo = process.env.AETHERGUARD_DATASET_REPO || 'https://github.com/lizuyi-6/aetherguard-security-dataset.git';
const datasetOwner = process.env.AETHERGUARD_DATASET_OWNER || 'lizuyi-6';
const datasetName = process.env.AETHERGUARD_DATASET_NAME || 'aetherguard-security-dataset';
const datasetRef = process.env.AETHERGUARD_DATASET_REF || 'main';
const adminEmail = process.env.AETHERGUARD_ADMIN_EMAIL || 'admin@aetherguard.local';
const adminPassword = process.env.AETHERGUARD_ADMIN_PASSWORD || 'AdminAccept123!';
const globalDelayMs = Math.max(0, Number(process.env.AETHERGUARD_GLOBAL_DELAY_MS || 300));
const authDelayMs = Math.max(0, Number(process.env.AETHERGUARD_AUTH_DELAY_MS || 3000));
const maxSamplesTotal = Number(process.env.AETHERGUARD_MAX_SAMPLES_TOTAL || 0);
const maxSamplesPerFile = Number(process.env.AETHERGUARD_MAX_SAMPLES_PER_FILE || 0);
const includeTypes = new Set(
  String(process.env.AETHERGUARD_INCLUDE_TYPES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const excludeTypes = new Set(
  String(process.env.AETHERGUARD_EXCLUDE_TYPES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const showcaseLimit = Math.max(1, Number(process.env.AETHERGUARD_SHOWCASE_LIMIT || 5));
const approveShowcaseCount = Math.max(0, Number(process.env.AETHERGUARD_APPROVE_SHOWCASE_COUNT || 0));
const cleanupExtraPending = String(process.env.AETHERGUARD_CLEANUP_EXTRA_PENDING || 'false').toLowerCase() === 'true';
const runId = process.env.AETHERGUARD_RUN_ID || `dataset-replay-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.join(rootDir, 'artifacts', 'ops', `live-dataset-replay-${runId}`);
const screenshotsDir = path.join(outputDir, 'screenshots');
const agentReconnectLogPath = path.join(outputDir, 'agent-reconnect.log');

const skippedTypes = new Set([
  'ddos',
  'port_scan',
  'http_smuggling',
  'smuggling_advanced',
  'websocket',
  'deserialization',
  'file_upload',
  'xxe',
  'redos'
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function shortText(value, max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function sanitizeFileName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function toCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
}

async function requestRaw(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    json: parsed
  };
}

function unwrapApiPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

function isLoopbackOrPrivateIpv4(hostname) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return false;
  }
  return (
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  );
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

async function assertSafeTarget(targetUrl) {
  const parsed = new URL(targetUrl);
  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'host.docker.internal' ||
    hostname === 'backend' ||
    hostname === 'frontend' ||
    isLoopbackOrPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname)
  ) {
    return;
  }

  if (net.isIP(hostname)) {
    throw new Error(`Refusing public target ${targetUrl}. This replay tool only supports localhost, private IPs, or explicit internal hostnames.`);
  }

  const resolved = await dns.lookup(hostname, { all: true });
  if (!resolved.length) {
    throw new Error(`Refusing target ${targetUrl}. Hostname could not be resolved to a local/private address.`);
  }

  const allPrivate = resolved.every((entry) => {
    return entry.family === 4
      ? isLoopbackOrPrivateIpv4(entry.address)
      : isPrivateIpv6(entry.address);
  });

  if (!allPrivate) {
    throw new Error(`Refusing public target ${targetUrl}. Resolved addresses: ${resolved.map((entry) => entry.address).join(', ')}`);
  }
}

async function login() {
  const response = await requestRaw(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: adminEmail,
      password: adminPassword
    })
  });

  if (!response.ok) {
    throw new Error(`Login failed with ${response.status}: ${shortText(response.text, 600)}`);
  }

  const payload = unwrapApiPayload(response.json);
  const accessToken = payload?.accessToken || response.json?.accessToken;
  if (!accessToken) {
    throw new Error('Login succeeded but accessToken was missing.');
  }

  return {
    accessToken,
    user: payload?.user || response.json?.user || null
  };
}

async function authedJson(route, token, options = {}) {
  const response = await requestRaw(`${baseUrl}${route}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  return {
    ...response,
    data: unwrapApiPayload(response.json)
  };
}

async function fetchDatasetTree() {
  const response = await requestRaw(`https://api.github.com/repos/${datasetOwner}/${datasetName}/git/trees/${datasetRef}?recursive=1`, {
    headers: {
      'user-agent': 'aetherguard-dataset-replay-safe'
    }
  });
  if (!response.ok || !response.json?.tree) {
    throw new Error(`Failed to load dataset tree: ${response.status} ${shortText(response.text, 400)}`);
  }
  return response.json;
}

async function fetchDatasetJson(filePath) {
  const response = await requestRaw(`https://raw.githubusercontent.com/${datasetOwner}/${datasetName}/${datasetRef}/${filePath}`, {
    headers: {
      'user-agent': 'aetherguard-dataset-replay-safe'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to load dataset file ${filePath}: ${response.status}`);
  }
  if (!response.json || !Array.isArray(response.json)) {
    throw new Error(`Dataset file ${filePath} did not contain a JSON array.`);
  }
  return {
    text: response.text,
    data: response.json
  };
}

function normalizeSampleType(sample, filePath) {
  const rawType = String(sample.type || '').trim().toLowerCase();
  if (rawType) {
    return rawType;
  }
  const base = path.basename(filePath, '.json').replace(/^\d+_/, '').toLowerCase();
  if (base === 'normal_extended' || base === 'normal_traffic') {
    return 'normal';
  }
  return base;
}

function classifyDelivery(type) {
  if (type === 'sql_injection') {
    return ['rules_query', 'auth_json', 'auth_form'];
  }
  if (type === 'xss') {
    return ['rules_query', 'auth_json'];
  }
  if (type === 'command_injection') {
    return ['rules_query', 'auth_json'];
  }
  if (type === 'path_traversal') {
    return ['rules_query', 'auth_json'];
  }
  if (type === 'ssrf') {
    return ['sites_post'];
  }
  if (type === 'ldap_injection' || type === 'ldap') {
    return ['rules_query', 'auth_json'];
  }
  if (type === 'jwt' || type === 'jwt_attack') {
    return ['rules_header'];
  }
  if (type === 'ssti' || type === 'graphql_injection' || type === 'nosql_advanced' || type === 'nosql_injection') {
    return ['rules_query', 'auth_json'];
  }
  if (type === 'encoding_bypass' || type === 'unicode_homoglyph' || type === 'type_confusion' || type === 'prototype_pollution') {
    return ['rules_query'];
  }
  if (type === 'log4j_injection' || type === 'text4shell') {
    return ['rules_header'];
  }
  if (type === 'spring4shell') {
    return ['rules_query', 'auth_form'];
  }
  if (type === 'oauth_bypass' || type === 'api_abuse' || type === 'cache_poison' || type === 'protocol_pollution') {
    return ['rules_query', 'rules_header'];
  }
  if (type === 'normal') {
    return ['rules_query'];
  }
  if (skippedTypes.has(type)) {
    return [];
  }
  return ['rules_query'];
}

function buildReplayRequest(sample, variant, token) {
  const payload = String(sample.payload || '');
  const requestId = `${runId}:${sample.id}:${variant}`;
  const userAgent = sample.normalizedType === 'normal'
    ? 'Mozilla/5.0 (dataset-replay-safe)'
    : 'sqlmap/1.8';
  const baseHeaders = {
    'x-request-id': requestId,
    'x-dataset-run-id': runId,
    'x-dataset-sample-id': String(sample.id),
    'x-dataset-type': sample.normalizedType,
    'user-agent': userAgent
  };

  if (variant === 'rules_query') {
    const probe = encodeURIComponent(payload);
    return {
      requestId,
      method: 'GET',
      route: `/api/rules?probe=${probe}`,
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${token}`
      },
      body: undefined
    };
  }

  if (variant === 'rules_header') {
    return {
      requestId,
      method: 'GET',
      route: '/api/rules',
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${token}`,
        'x-replay-probe': payload,
        'x-replay-payload': payload
      },
      body: undefined
    };
  }

  if (variant === 'auth_json') {
    return {
      requestId,
      method: 'POST',
      route: '/api/auth/login',
      headers: {
        ...baseHeaders,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: payload,
        password: 'DatasetReplay!123'
      })
    };
  }

  if (variant === 'auth_form') {
    return {
      requestId,
      method: 'POST',
      route: '/api/auth/login',
      headers: {
        ...baseHeaders,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        email: payload,
        password: 'DatasetReplay!123'
      }).toString()
    };
  }

  if (variant === 'sites_post') {
    return {
      requestId,
      method: 'POST',
      route: '/api/sites',
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        domain: `${sanitizeFileName(sample.id)}.replay.local`,
        target: payload,
        sslEnabled: true
      })
    };
  }

  throw new Error(`Unsupported replay variant: ${variant}`);
}

async function listRulesSnapshot(token, suffix) {
  const response = await authedJson('/api/rules', token);
  writeJson(path.join(outputDir, `rules-${suffix}.json`), response.data || response.json || null);
  return response.data || response.json || {};
}

async function listEventsSnapshot(token, suffix, from) {
  const query = from ? `?from=${encodeURIComponent(from)}&limit=500` : '?limit=500';
  const response = await authedJson(`/api/rules/events${query}`, token);
  writeJson(path.join(outputDir, `rules-events-${suffix}.json`), response.data || response.json || null);
  return response.data?.events || response.json?.events || [];
}

async function listCandidatesSnapshot(token, suffix, status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await authedJson(`/api/rules/candidates${query}`, token);
  writeJson(path.join(outputDir, `rules-candidates-${suffix}.json`), response.data || response.json || null);
  return response.data?.candidates || response.json?.candidates || [];
}

async function healthSnapshot(label) {
  const response = await requestRaw(`${baseUrl}/api/health`);
  writeJson(path.join(outputDir, `health-${label}.json`), response.json || { status: response.status, raw: response.text });
  return unwrapApiPayload(response.json) || response.json || null;
}

function filterFiles(tree) {
  return tree.tree
    .filter((entry) => entry.type === 'blob' && entry.path.endsWith('.json'))
    .filter((entry) => !entry.path.endsWith('00_summary.json'))
    .filter((entry) => /^(full_test_dataset|complete_dataset|advanced_dataset|zeroday_dataset)\//.test(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildDatasetIndexEntry(filePath, blobEntry, parsedArray, rawText) {
  const samples = parsedArray.map((sample) => ({
    id: sample.id,
    type: sample.type,
    severity: sample.severity,
    expectedDetection: sample.expected_detection === true
  }));

  return {
    path: filePath,
    size: blobEntry.size,
    blobSha: blobEntry.sha,
    sha256: sha256(rawText),
    sampleCount: parsedArray.length,
    types: Array.from(new Set(parsedArray.map((sample) => normalizeSampleType(sample, filePath)))).sort(),
    samples
  };
}

function makeCsv(results) {
  const headers = [
    'requestId',
    'sampleId',
    'type',
    'severity',
    'datasetFile',
    'variant',
    'status',
    'blocked',
    'eventId',
    'eventVerdict',
    'eventAttackFamily',
    'candidateId',
    'candidateStatus',
    'candidateAttackFamily',
    'learningVerified',
    'responsePreview'
  ];

  const lines = [headers.join(',')];
  for (const row of results) {
    lines.push([
      row.requestId,
      row.sampleId,
      row.type,
      row.severity,
      row.datasetFile,
      row.variant,
      row.responseStatus,
      row.blocked,
      row.event?.detectionEventId || '',
      row.event?.verdict || '',
      row.event?.attackFamily || '',
      row.candidate?.candidateId || '',
      row.candidate?.status || '',
      row.candidate?.attackFamily || '',
      row.learningVerified,
      row.responsePreview
    ].map(toCsvValue).join(','));
  }
  return lines.join('\n');
}

function pickShowcaseCandidates(runCandidates) {
  return [...runCandidates]
    .sort((left, right) => {
      const confidenceDelta = Number(right.aiConfidence || 0) - Number(left.aiConfidence || 0);
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }
      return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    })
    .slice(0, showcaseLimit);
}

function candidateBelongsToRun(candidate) {
  const requestHeaders = candidate?.latestEvidence?.request?.headers || {};
  return (
    requestHeaders['x-dataset-run-id'] === runId ||
    String(candidate?.latestEvidence?.request?.requestId || '').startsWith(`${runId}:`)
  );
}

function buildTalkEvidence(report) {
  const lines = [
    '# Dataset Replay Evidence',
    '',
    `- generatedAt: ${nowIso()}`,
    `- baseUrl: ${baseUrl}`,
    `- runId: ${runId}`,
    `- datasetRepo: ${datasetRepo}`,
    `- datasetCommit: ${report.datasetCommit}`,
    `- safeTargetGuard: enabled`,
    '',
    '## Summary',
    '',
    `- replayedRequests: ${report.summary.replayedRequests}`,
    `- blocked403: ${report.summary.blocked403}`,
    `- skippedSamples: ${report.summary.skippedSamples}`,
    `- runEvents: ${report.summary.runEvents}`,
    `- newOrMergedCandidates: ${report.summary.runCandidates}`,
    `- learningVerifiedCandidates: ${report.summary.learningVerifiedCandidates}`,
    `- approvedShowcase: ${report.summary.approvedShowcase}`,
    '',
    '## Showcase',
    ''
  ];

  for (const candidate of report.showcaseCandidates) {
    lines.push(`- candidate ${candidate.candidateId} (${candidate.attackFamily}, ${candidate.status}) confidence=${candidate.aiConfidence}`);
  }

  if (!report.showcaseCandidates.length) {
    lines.push('- No showcase candidates were generated in this run.');
  }

  lines.push(
    '',
    '## Files',
    '',
    '- run-manifest.json',
    '- dataset-index.json',
    '- replay-results.ndjson',
    '- replay-results.csv',
    '- health-before.json',
    '- health-after.json',
    '- rules-events-before.json',
    '- rules-events-after.json',
    '- rules-candidates-before.json',
    '- rules-candidates-after.json',
    '- showcase-candidates.json',
    '- approve-sync.json',
    '- agent-reconnect.log',
    '- screenshots/'
  );

  return lines.join('\n');
}

async function main() {
  ensureDir(outputDir);
  ensureDir(screenshotsDir);
  writeText(agentReconnectLogPath, 'Not executed. The safe dataset replay tool does not perform remote SSH operations.\n');

  await assertSafeTarget(baseUrl);

  const tree = await fetchDatasetTree();
  const datasetFiles = filterFiles(tree);
  const datasetIndex = [];
  const loadedSamples = [];

  for (const fileEntry of datasetFiles) {
    const file = await fetchDatasetJson(fileEntry.path);
    const indexEntry = buildDatasetIndexEntry(fileEntry.path, fileEntry, file.data, file.text);
    datasetIndex.push(indexEntry);

    let acceptedInFile = 0;
    for (const sample of file.data) {
      const normalizedType = normalizeSampleType(sample, fileEntry.path);
      if (includeTypes.size && !includeTypes.has(normalizedType)) {
        continue;
      }
      if (excludeTypes.has(normalizedType)) {
        continue;
      }
      if (maxSamplesPerFile > 0 && acceptedInFile >= maxSamplesPerFile) {
        break;
      }
      if (maxSamplesTotal > 0 && loadedSamples.length >= maxSamplesTotal) {
        break;
      }

      loadedSamples.push({
        ...sample,
        datasetFile: fileEntry.path,
        normalizedType
      });
      acceptedInFile += 1;
    }

    if (maxSamplesTotal > 0 && loadedSamples.length >= maxSamplesTotal) {
      break;
    }
  }

  writeJson(path.join(outputDir, 'dataset-index.json'), {
    repo: datasetRepo,
    commit: tree.sha,
    files: datasetIndex
  });

  const auth = await login();
  const runStartedAt = nowIso();
  const healthBefore = await healthSnapshot('before');
  const rulesBefore = await listRulesSnapshot(auth.accessToken, 'before');
  const eventsBefore = await listEventsSnapshot(auth.accessToken, 'before');
  const candidatesBefore = await listCandidatesSnapshot(auth.accessToken, 'before');

  const manifest = {
    generatedAt: runStartedAt,
    runId,
    baseUrl,
    datasetRepo,
    datasetCommit: tree.sha,
    datasetRef,
    adminEmail,
    safeTargetGuard: true,
    globalDelayMs,
    authDelayMs,
    approveShowcaseCount,
    cleanupExtraPending,
    maxSamplesTotal,
    maxSamplesPerFile,
    includeTypes: Array.from(includeTypes),
    excludeTypes: Array.from(excludeTypes),
    localUser: auth.user,
    healthBefore,
    rulesBeforeSummary: rulesBefore.summary || null,
    counts: {
      datasetFiles: datasetFiles.length,
      indexedFiles: datasetIndex.length,
      acceptedSamples: loadedSamples.length
    }
  };
  writeJson(path.join(outputDir, 'run-manifest.json'), manifest);

  const results = [];
  let consecutive5xx = 0;
  let unhealthySince = null;

  for (const sample of loadedSamples) {
    const variants = classifyDelivery(sample.normalizedType);
    if (!variants.length) {
      results.push({
        requestId: `${runId}:${sample.id}:skipped`,
        sampleId: String(sample.id),
        type: sample.normalizedType,
        severity: sample.severity,
        datasetFile: sample.datasetFile,
        variant: 'skipped',
        responseStatus: 0,
        responsePreview: `Skipped type ${sample.normalizedType}`,
        blocked: false,
        skipped: true,
        learningVerified: false
      });
      continue;
    }

    for (const variant of variants) {
      const replay = buildReplayRequest(sample, variant, auth.accessToken);
      const response = await requestRaw(`${baseUrl}${replay.route}`, {
        method: replay.method,
        headers: replay.headers,
        body: replay.body
      });

      const isServerError = response.status >= 500;
      consecutive5xx = isServerError ? consecutive5xx + 1 : 0;
      if (consecutive5xx >= 5) {
        throw new Error(`Stopping replay after ${consecutive5xx} consecutive 5xx responses.`);
      }

      if (results.length % 20 === 0) {
        const health = await requestRaw(`${baseUrl}/api/health`);
        const currentStatus = unwrapApiPayload(health.json)?.status || health.json?.status || 'unknown';
        if (currentStatus !== 'healthy') {
          unhealthySince = unhealthySince || Date.now();
          if (Date.now() - unhealthySince > 60000) {
            throw new Error(`Stopping replay because health stayed non-healthy for more than 60 seconds. Current status: ${currentStatus}`);
          }
        } else {
          unhealthySince = null;
        }
      }

      results.push({
        requestId: replay.requestId,
        sampleId: String(sample.id),
        type: sample.normalizedType,
        severity: sample.severity,
        datasetFile: sample.datasetFile,
        variant,
        responseStatus: response.status,
        responsePreview: shortText(response.text, 400),
        blocked: response.status === 403,
        skipped: false,
        learningVerified: false
      });

      await sleep(variant === 'auth_json' || variant === 'auth_form' ? authDelayMs : globalDelayMs);
    }
  }

  const healthAfter = await healthSnapshot('after');
  const eventsAfter = await listEventsSnapshot(auth.accessToken, 'after', runStartedAt);
  const candidatesAfter = await listCandidatesSnapshot(auth.accessToken, 'after');

  const eventsByRequestId = new Map(
    eventsAfter
      .filter((event) => String(event.requestId || '').startsWith(`${runId}:`))
      .map((event) => [String(event.requestId), event])
  );

  const beforeCandidateIds = new Set(candidatesBefore.map((candidate) => candidate.candidateId));
  const runCandidates = candidatesAfter.filter(candidateBelongsToRun);
  const showcaseCandidates = pickShowcaseCandidates(runCandidates);
  const showcaseIds = new Set(showcaseCandidates.map((candidate) => candidate.candidateId));

  for (const result of results) {
    const event = eventsByRequestId.get(result.requestId);
    result.event = event || null;
    const candidate = runCandidates.find((entry) => entry.candidateId === event?.candidateId)
      || runCandidates.find((entry) => String(entry.latestEvidence?.request?.requestId || '') === result.requestId)
      || null;
    result.candidate = candidate;
    result.learningVerified = Boolean(candidate?.latestEvidence?.primaryAi && candidate?.latestEvidence?.learningVerificationAi);
  }

  const approvalResults = [];
  if (approveShowcaseCount > 0) {
    const pendingShowcase = showcaseCandidates.filter((candidate) => candidate.status === 'pending').slice(0, approveShowcaseCount);
    for (const candidate of pendingShowcase) {
      const approval = await authedJson(`/api/rules/candidates/${encodeURIComponent(candidate.candidateId)}/approve`, auth.accessToken, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'Dataset replay showcase approval on isolated local stack'
        })
      });
      approvalResults.push({
        candidateId: candidate.candidateId,
        status: approval.status,
        payload: approval.data || approval.json || null
      });
    }
  }
  writeJson(path.join(outputDir, 'approve-sync.json'), approvalResults);

  if (cleanupExtraPending) {
    for (const candidate of runCandidates) {
      if (candidate.status !== 'pending' || showcaseIds.has(candidate.candidateId)) {
        continue;
      }
      await authedJson(`/api/rules/candidates/${encodeURIComponent(candidate.candidateId)}/reject`, auth.accessToken, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'Archived after dataset replay export'
        })
      });
    }
  }

  fs.writeFileSync(
    path.join(outputDir, 'replay-results.ndjson'),
    results.map((row) => JSON.stringify(row)).join('\n')
  );
  fs.writeFileSync(path.join(outputDir, 'replay-results.csv'), makeCsv(results), 'utf8');
  writeJson(path.join(outputDir, 'showcase-candidates.json'), showcaseCandidates);

  const report = {
    datasetCommit: tree.sha,
    summary: {
      replayedRequests: results.filter((result) => !result.skipped).length,
      blocked403: results.filter((result) => result.blocked).length,
      skippedSamples: results.filter((result) => result.skipped).length,
      runEvents: Array.from(eventsByRequestId.values()).length,
      runCandidates: runCandidates.length,
      learningVerifiedCandidates: runCandidates.filter((candidate) => candidate.latestEvidence?.primaryAi && candidate.latestEvidence?.learningVerificationAi).length,
      approvedShowcase: approvalResults.length
    },
    showcaseCandidates
  };

  writeText(path.join(outputDir, 'talk-evidence.md'), buildTalkEvidence(report));

  console.log(JSON.stringify({
    outputDir,
    runId,
    baseUrl,
    datasetCommit: tree.sha,
    replayedRequests: report.summary.replayedRequests,
    blocked403: report.summary.blocked403,
    runCandidates: report.summary.runCandidates,
    learningVerifiedCandidates: report.summary.learningVerifiedCandidates,
    approvedShowcase: report.summary.approvedShowcase,
    note: 'Public targets are intentionally refused by this tool. Use localhost or a private isolated environment only.'
  }, null, 2));
}

main().catch((error) => {
  ensureDir(outputDir);
  writeJson(path.join(outputDir, 'run-error.json'), {
    generatedAt: nowIso(),
    runId,
    baseUrl,
    error: error?.stack || error?.message || String(error)
  });
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
