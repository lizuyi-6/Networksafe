'use strict';
// Shared privacy sanitization for the VIguard (AetherGuard) LAN challenge capture.
//
// Two layers, both fail-safe:
//   1. Recursive key-based redaction (deepSanitize): walks objects/arrays and, for a
//      denylist of sensitive KEYS (case-insensitive), replaces/removes the value -
//      this catches structured fields like {"sessionId": "..."} anywhere in the tree.
//   2. String-level patterns (sanitizeString): applied to every string value, this
//      catches the SAME identifiers when they appear embedded inside a stringified-JSON
//      body (e.g. requestSanitized.body holds an escaped JSON string, so key matching
//      alone never sees "sessionId").
//
// CRITICAL: sanitize BEFORE truncate. Truncating a raw body first can split a UUID or
// token in half, leaving a partial fragment that no full-pattern scanner can catch.
// safeTruncate() operates on the ALREADY-sanitized string and cuts at a safe character
// boundary (never mid-multibyte, never mid-placeholder).
//
// Placeholder mapping (HMAC-SHA256, dataset-local salt):
//   - raw-private/.id-salt (gitignored) keys the HMAC. Without it, real-evidence
//     processing FAILS CLOSED (throws). Sequential mapping is ONLY available in
//     SANITIZER_TEST_MODE=true (for unit tests with synthetic fixtures).
//   - Legacy sequential placeholders [PREFIX_0009] from a prior run are remapped through
//     HMAC(salt, "legacy:" + oldPlaceholder) so the final output uses ONE format only.
//     This is recorded as legacyPlaceholderRemapped=true (honest: the original resource
//     id is gone; the remap is opaque, not a recovery).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const TEST_MODE = process.env.SANITIZER_TEST_MODE === 'true';

// ---------- runtime credential values (never hard-coded) ----------
const credsFile = path.join(DIR, 'raw-private/.test-creds.env');
const credsRaw = fs.existsSync(credsFile) ? fs.readFileSync(credsFile, 'utf8') : '';
function envVal(k) {
  const m = credsRaw.match(new RegExp('^' + k + '="?(.*?)"?\\s*$', 'm'));
  return m ? m[1] : null;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const TESTPASS = envVal('VIGUARD_PASS');
const TESTUSER = envVal('VIGUARD_USER');
const TENANT = envVal('VIGUARD_TENANT');

// ---------- id mapping ----------
// FAIL-CLOSED salt design. Real evidence MUST NOT be mapped without the operator's secret
// dataset-local salt. Two hard rules prevent the test suite from silently bypassing this:
//   (1) In SANITIZER_TEST_MODE the salt is held IN MEMORY only (the known synthetic value, or
//       SANITIZER_TEST_SALT if a test pins one). The test suite NEVER writes a salt to
//       raw-private/.id-salt, so a clean clone that runs the tests cannot leave a public fixed
//       salt behind for a later enrich.js (production) to pick up and map real identifiers with.
//   (2) In production (not test mode), if raw-private/.id-salt is MISSING OR contains the known
//       synthetic test salt, FAIL CLOSED (throw) instead of mapping real identifiers with a
//       public salt. The synthetic value is public; it must never process real evidence.
const saltFile = path.join(DIR, 'raw-private/.id-salt');
const KNOWN_SYNTHETIC_TEST_SALT = '0123456789abcdef'.repeat(4); // 64-char public test fixture
let salt = null;
if (TEST_MODE) {
  // In-memory only. A test MAY pin a specific salt via SANITIZER_TEST_SALT (>=64 chars); otherwise
  // the known synthetic value drives HMAC so unit tests see the real 8-hex placeholder format.
  const ts = process.env.SANITIZER_TEST_SALT;
  salt = (typeof ts === 'string' && ts.length >= 64) ? ts : KNOWN_SYNTHETIC_TEST_SALT;
} else if (fs.existsSync(saltFile)) {
  salt = fs.readFileSync(saltFile, 'utf8').trim();
  if (salt === KNOWN_SYNTHETIC_TEST_SALT) {
    throw new Error("sanitize.js: FAIL CLOSED - raw-private/.id-salt holds the known synthetic " +
      "test salt. This value is public and cannot process real evidence. Delete it and generate " +
      "a real one: node -e \"require('fs').writeFileSync('raw-private/.id-salt',require('crypto').randomBytes(32).toString('hex'))\"");
  }
  if (salt.length < 64) {
    throw new Error(`sanitize.js: FAIL CLOSED - raw-private/.id-salt is ${salt.length} chars (need >=64).`);
  }
}
const HAS_SALT = !!salt;
let mappingMethod;
if (HAS_SALT) mappingMethod = 'hmac-sha256[salt=raw-private/.id-salt(gitignored),trunc=8hex]';
else if (TEST_MODE) mappingMethod = 'sequential-per-run (SANITIZER_TEST_MODE; synthetic fixtures only)';
else mappingMethod = 'NONE (no salt and not test mode; real-evidence mapping will fail closed)';

const seqMaps = new Map(); // prefix -> Map(realValue -> placeholder)
let legacyRemapped = false;

function mapId(prefix, realValue) {
  if (realValue == null || realValue === '') return realValue;
  const v = String(realValue);
  if (salt) {
    const h = crypto.createHmac('sha256', salt).update(prefix + ':' + v).digest('hex').slice(0, 8).toUpperCase();
    return `[${prefix}_${h}]`;
  }
  if (TEST_MODE) {
    if (!seqMaps.has(prefix)) seqMaps.set(prefix, new Map());
    const m = seqMaps.get(prefix);
    if (!m.has(v)) m.set(v, `[${prefix}_${String(m.size + 1).padStart(4, '0')}]`);
    return m.get(v);
  }
  throw new Error(`sanitize.js: cannot map ${prefix} without a salt (and not in SANITIZER_TEST_MODE). ` +
    `Create raw-private/.id-salt (e.g. node -e "require('fs').writeFileSync('raw-private/.id-salt',require('crypto').randomBytes(32).toString('hex'))") ` +
    `or set SANITIZER_TEST_MODE=true for synthetic-fixture tests only.`);
}

// Placeholder prefix registry (for legacy-remap + stats scanning).
const ID_PREFIXES = ['RESOURCE_ID', 'SESSION_ID', 'USER_ID', 'TENANT_ID'];

// ---------- sensitive KEY handling (case-insensitive) ----------
const KEY_DROP = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization']);
const KEY_PLACEHOLDER = new Map(Object.entries({
  password: '[REDACTED_PASSWORD]',
  passwd: '[REDACTED_PASSWORD]',
  secret: '[REDACTED_SECRET]',
  token: '[REDACTED_TOKEN]',
  accesstoken: '[REDACTED_TOKEN]',
  refreshtoken: '[REDACTED_TOKEN]',
  csrftoken: '[REDACTED_TOKEN]',
  csrf: '[REDACTED_TOKEN]',
  apikey: '[REDACTED_API_KEY]',
  'x-api-key': '[REDACTED_API_KEY]',
  devicekey: '[REDACTED_API_KEY]',
  phone: '[REDACTED_PHONE]',
  address: '[REDACTED_ADDRESS]',
  email: '[TEST_ACCOUNT]',
}));
const KEY_ID_PREFIX = new Map(Object.entries({
  sessionid: 'SESSION_ID',
  session: 'SESSION_ID',
  tenantid: 'TENANT_ID',
  userid: 'USER_ID',
  findingid: 'RESOURCE_ID',
  sourceid: 'RESOURCE_ID',
  alertid: 'RESOURCE_ID',
}));

// A value that is already a mapped placeholder should not be re-mapped.
function isPlaceholder(v) {
  return /^\[(RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID|REDACTED|TEST_ACCOUNT|TENANT_ID)[_\]]/.test(String(v));
}

// ---------- string-level patterns ----------
// Order matters: (1) legacy placeholder remap, (2) credential literals, (3) JWT,
// (4) key:"value" redaction for sensitive keys, (5) generic email, (6) generic UUID.
function buildPatterns() {
  const p = [];
  // (0) Normalize malformed double-bracket placeholders [[PREFIX_HEX] -> [PREFIX_ID_HEX].
  //     A PRIOR buggy legacy-remap (see (1) below) called mapId(match.split('_')[0], ...) on
  //     the FULL match "[RESOURCE_ID_0009]": split('_')[0] is "[RESOURCE" (NOT "RESOURCE_ID"),
  //     so mapId emitted "[[RESOURCE_<hex>]" - a doubled leading "[" and a truncated prefix
  //     label. scanFinalStats only scans the CORRECT [PREFIX_ID_HEX] format, so these slipped
  //     through as zero (a false "0 placeholders" in the report). The hex is identity-stable,
  //     so we PRESERVE it and only fix the bracket + prefix label (RESOURCE->RESOURCE_ID,
  //     SESSION->SESSION_ID, USER->USER_ID, TENANT->TENANT_ID). Pure regex reformat - no salt
  //     needed - runs FIRST so the output uses one consistent format. (Runs unconditionally;
  //     if there is nothing to normalize it matches nothing.)
  p.push({
    name: 'malformed-double-bracket-normalize', category: 'internal_resource_identifier',
    re: /\[\[(RESOURCE|SESSION|USER|TENANT)_([0-9A-Fa-f]{8})\]/g,
    to: (_match, short, hex) => { legacyRemapped = true; return '[' + short + '_ID_' + hex + ']'; },
  });
  // (1) Legacy sequential placeholders [PREFIX_NNNN] -> remap via HMAC(salt, "legacy:"+old).
  //     Uses the CAPTURE GROUP (prefix) as mapId's prefix arg, NOT match.split('_')[0]
  //     (which on the full "[RESOURCE_ID_0009]" yields "[RESOURCE" and produces the malformed
  //     [[RESOURCE_<hex>] tokens normalized in (0) above). Only matches NUMERIC suffixes (the
  //     old sequential format); hex-suffix placeholders are already current and left alone.
  if (salt) {
    p.push({
      name: 'legacy-placeholder-remap', category: 'internal_resource_identifier',
      re: /\[(RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9]{4}\]/g,
      to: (match, prefix) => { legacyRemapped = true; return mapId(prefix, 'legacy:' + match); },
    });
  }
  // (2) Real credential literals (exact match, run before everything else).
  if (TESTPASS) p.push({ name: 'password-literal', re: new RegExp(escRe(TESTPASS), 'g'), to: '[REDACTED_PASSWORD]', category: 'credential' });
  if (TESTUSER) p.push({ name: 'email-literal', re: new RegExp(escRe(TESTUSER), 'g'), to: '[TEST_ACCOUNT]', category: 'personal_identifier' });
  if (TENANT) p.push({ name: 'tenant-literal', re: new RegExp(escRe(TENANT), 'gi'), to: '[TENANT_ID]', category: 'tenant_identifier' });
  // (3) Full JWT (3 base64url segments).
  p.push({ name: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, to: '[REDACTED_JWT]', category: 'credential' });
  // (4) Escaped or bare key:"value" forms. Skip values that are already placeholders.
  const kv = (key, repl, category) => ({
    name: key, category,
    re: new RegExp('(\\\\?"' + key + '\\\\?"\\s*:\\s*\\\\?")([^"\\\\]{1,512})(\\\\?")', 'gi'),
    to: (m, a, v, c) => a + (isPlaceholder(v) ? v : (typeof repl === 'function' ? repl(v) : repl)) + c,
  });
  p.push(kv('sessionId', v => mapId('SESSION_ID', v), 'session_identifier'));
  p.push(kv('session_id', v => mapId('SESSION_ID', v), 'session_identifier'));
  p.push(kv('accessToken', '[REDACTED_TOKEN]', 'credential'));
  p.push(kv('refreshToken', '[REDACTED_TOKEN]', 'credential'));
  p.push(kv('tenantId', v => mapId('TENANT_ID', v), 'tenant_identifier'));
  p.push(kv('userId', v => mapId('USER_ID', v), 'personal_identifier'));
  p.push(kv('findingId', v => mapId('RESOURCE_ID', v), 'internal_resource_identifier'));
  p.push(kv('sourceId', v => mapId('RESOURCE_ID', v), 'internal_resource_identifier'));
  p.push(kv('alertId', v => mapId('RESOURCE_ID', v), 'internal_resource_identifier'));
  p.push(kv('source', v => {
    // 'source' is only sensitive when it holds a UUID-shaped value (internal resource id);
    // plain text like "local" or "manual" is left alone.
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}/.test(v)) return mapId('RESOURCE_ID', v);
    return v;
  }, 'internal_resource_identifier'));
  p.push(kv('id', v => {
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}/.test(v)) return mapId('RESOURCE_ID', v);
    return v;
  }, 'internal_resource_identifier'));
  p.push(kv('email', '[TEST_ACCOUNT]', 'personal_identifier'));
  p.push(kv('password', '[REDACTED_PASSWORD]', 'credential'));
  p.push(kv('secret', '[REDACTED_SECRET]', 'credential'));
  p.push(kv('apiKey', '[REDACTED_API_KEY]', 'credential'));
  // (5) Generic email addresses -> placeholder.
  p.push({ name: 'email-generic', category: 'personal_identifier', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, to: '[TEST_ACCOUNT]' });
  // (6) Bare internal UUIDs -> stable resource placeholder.
  p.push({ name: 'uuid', category: 'internal_resource_identifier', re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, to: v => mapId('RESOURCE_ID', v) });
  return p;
}
let PATTERNS;
try { PATTERNS = buildPatterns(); }
catch (e) { /* if mapId throws during build (no salt, no test mode), patterns that need it will throw at use time */ PATTERNS = []; }

function sanitizeString(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const p of PATTERNS) out = out.replace(p.re, typeof p.to === 'function' ? p.to : p.to);
  return out;
}

// Recursive object/array sanitizer. Returns a NEW structure; never mutates input.
function deepSanitize(node, keyName) {
  const key = keyName ? String(keyName).toLowerCase() : null;
  if (key) {
    if (KEY_DROP.has(key)) return undefined;
    if (KEY_PLACEHOLDER.has(key)) return KEY_PLACEHOLDER.get(key);
    if (KEY_ID_PREFIX.has(key) && typeof node === 'string' && !isPlaceholder(node)) return mapId(KEY_ID_PREFIX.get(key), node);
  }
  if (node === null || node === undefined) return node;
  if (typeof node === 'string') return sanitizeString(node);
  if (typeof node === 'number' || typeof node === 'boolean') return node;
  if (Array.isArray(node)) {
    return node.map(item => deepSanitize(item)).filter(item => item !== undefined);
  }
  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const sv = deepSanitize(v, k);
      if (sv === undefined) continue;
      out[k] = sv;
    }
    return out;
  }
  return node;
}

// HTTP header sanitizer: drops credential headers, redacts the rest.
const DROP_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-csrf-token', 'csrf-token', 'x-api-key', 'x-device-key']);
function sanitizeHeaders(h) {
  const o = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (DROP_HEADERS.has(k.toLowerCase())) continue;
    o[k] = sanitizeString(String(v));
  }
  return o;
}

// ---------- safe truncation (sanitize BEFORE truncate) ----------
// Truncates an ALREADY-SANITIZED string at a UTF-8 character boundary so it never
// splits a multibyte sequence or an escape sequence. Returns { text, truncated, bytes }.
const MAX_BODY_BYTES = 4000;
function byteLen(s) { return Buffer.byteLength(s, 'utf8'); }
function safeTruncate(s, maxBytes) {
  if (s == null) return { text: s, truncated: false, originalBytes: 0, retainedBytes: 0 };
  maxBytes = maxBytes || MAX_BODY_BYTES;
  const str = String(s);
  const originalBytes = byteLen(str);
  if (originalBytes <= maxBytes) return { text: str, truncated: false, originalBytes, retainedBytes: originalBytes };
  // Walk code-point by code-point (so a multi-byte UTF-8 sequence is never split mid-byte: each
  // code point is added whole or skipped), accumulating UTF-8 bytes to find the cut. BUT track the
  // cut position as a UTF-16 CODE-UNIT index (ch.length), NOT a code-point index. This is the ONE
  // index space shared by RegExp match.index and String.prototype.slice, which are both UTF-16
  // code-unit based. Mixing a code-point index (Array.from) with match.index/slice desynchronizes
  // when a surrogate-pair char (emoji, astral plane) precedes a placeholder: the code-point cut
  // index is smaller than the UTF-16 placeholder start, so the span check `cut > start` is false
  // and rollback never fires, leaking a partial `[RES` that no scanner catches. See ST10/ST11.
  let cutCodeUnitIdx = 0;
  let keptBytes = 0;
  for (const ch of str) {
    const chBytes = byteLen(ch);
    if (keptBytes + chBytes > maxBytes) break;
    keptBytes += chBytes;
    cutCodeUnitIdx += ch.length; // BMP char = 1 code unit; surrogate pair (emoji etc.) = 2
  }
  // Placeholder rollback - SPAN-BASED on the FULL string, in UTF-16 code-unit space (matches
  // match.index and slice). A truncated HMAC prefix MUST NOT leak: it breaks the non-reversible
  // mapping guarantee and can partially reveal an identifier. Locate every COMPLETE placeholder
  // token in the full string; if the cut landed anywhere strictly INSIDE one (after '[' and
  // before the char after ']'), roll the retained text back to BEFORE the '['. Correctly handles
  // every cut position - '[', '[RE', '[RESOURCE', '[RESOURCE_ID_', '[RESOURCE_ID_12345678' (']'
  // cut off) - AND correctly when surrogate-pair chars precede the placeholder, because the cut
  // index and the span indices are in the SAME UTF-16 code-unit space. The old end-anchored regex
  // required a near-complete prefix and silently missed cuts like '[RESO'; the prior Array.from
  // version mixed index systems and silently missed cuts after emoji. Both are now closed.
  const PH_SPAN = /\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9A-Fa-f]+\]/g;
  let rollbackTo = -1;
  for (const m of str.matchAll(PH_SPAN)) {
    const start = m.index;                  // UTF-16 code-unit index of '['
    const end = m.index + m[0].length;      // UTF-16 code-unit index AFTER ']'
    if (cutCodeUnitIdx > start && cutCodeUnitIdx < end) { rollbackTo = start; break; }
  }
  let kept = str.slice(0, rollbackTo >= 0 ? rollbackTo : cutCodeUnitIdx);
  // Also roll back a partial \uXXXX unicode escape (1-3 hex digits, incomplete) and a dangling
  // trailing backslash (start of an escape sequence cut off) - JSON-escape safety, independent
  // of the placeholder span check above.
  const partialUni = kept.match(/\\u[0-9A-Fa-f]{0,3}$/);
  if (partialUni) kept = kept.slice(0, partialUni.index);
  if (kept.endsWith('\\')) kept = kept.slice(0, -1);
  return { text: kept, truncated: true, originalBytes, retainedBytes: byteLen(kept) };
}

// ---------- privacy audit scanner (full + PARTIAL identifiers) ----------
// Scans committed text for residual sensitive indicators. Detects BOTH complete and
// PARTIAL (truncated) fragments. Partial detection is context-aware to reduce false
// positives: it looks for UUID-shaped prefixes, sensitive-key + non-placeholder value,
// high-entropy hex tails, and unclosed JSON strings.
function auditText(text, fileName) {
  const findings = [];
  const add = (category, indicator, re, opts) => {
    const m = text.match(re);
    if (m && m.length) findings.push({ file: fileName, category, indicator, count: m.length, ...(opts || {}) });
  };

  // --- complete credentials ---
  add('credential', 'jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g);
  add('credential', 'authorization-header', /\\?"?(authorization|proxy-authorization)\\?"?\s*[:=]/gi);
  add('credential', 'set-cookie', /set-cookie\\?"?\s*:/gi);
  if (TESTPASS) add('credential', 'password-literal', new RegExp(escRe(TESTPASS), 'g'));

  // --- complete session identifier (sessionId key with a residual hex/token value) ---
  add('session_identifier', 'sessionId-token', /sessionId\\?"\s*:\s*\\?"[0-9a-f]{16,}/gi);

  // --- PARTIAL session identifier: sessionId key whose value starts hex but is NOT a placeholder ---
  // Catches values truncated mid-token. The value must start with hex and not be [SESSION_ID_.
  add('session_identifier', 'sessionId-partial-value', /sessionId\\?"\s*:\s*\\?"(?!\[SESSION_ID_)[0-9a-fA-F]{1,63}(?![0-9a-fA-F]*\\?")/gi);

  // --- PARTIAL UUID: a UUID-shaped fragment with 3+ groups (8-4-4-...) shorter than a full
  // 36-char UUID. Greedy match consumes as many groups as present; we keep fragments with
  // length in [18, 35] so full 36-char UUIDs are excluded but truncation at any group
  // boundary (incl. 8-4-4 with no 4th hyphen) and mid-group cuts are caught.
  const partialUuidRe = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}(?:-[0-9a-fA-F]+)*\b/g;
  let partialMatches = (text.match(partialUuidRe) || []).filter(f => f.length >= 18 && f.length < 36);
  if (partialMatches.length) findings.push({ file: fileName, category: 'internal_resource_identifier', indicator: 'partial-uuid-fragment', count: partialMatches.length });

  // --- complete raw UUID (36 chars) that was NOT mapped ---
  add('internal_resource_identifier', 'raw-uuid', /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g);

  // --- sensitive key + non-placeholder value (catches partial OR complete) ---
  // e.g. "source":"d512b525-dca9-4b8e-aa6c-2bb3b  (value is hex-ish, not a [PLACEHOLDER])
  const sensitiveKeyVal = (key, indicator, category) => {
    const re = new RegExp('\\\\?"' + key + '\\\\?"\\s*:\\s*\\\\"(?!\\[)([0-9a-fA-F-]{8,})', 'gi');
    const m = text.match(re);
    if (m && m.length) findings.push({ file: fileName, category, indicator, count: m.length });
  };
  sensitiveKeyVal('source', 'source-raw-id-value', 'internal_resource_identifier');
  sensitiveKeyVal('findingId', 'findingId-raw-value', 'internal_resource_identifier');
  sensitiveKeyVal('userId', 'userId-raw-value', 'personal_identifier');
  sensitiveKeyVal('tenantId', 'tenantId-raw-value', 'tenant_identifier');
  sensitiveKeyVal('sessionId', 'sessionId-raw-value', 'session_identifier');
  sensitiveKeyVal('token', 'token-raw-value', 'credential');

  // --- PARTIAL JWT: eyJ prefix without 3 complete segments (truncated mid-token) ---
  add('credential', 'partial-jwt', /eyJ[A-Za-z0-9_-]{1,}(?:(?!\.[A-Za-z0-9_-]{8,}\.)(\.|\.))?/g);

  // --- high-entropy hex token value bound to a session/token KEY (context-aware) ---
  // Bare 60+ hex runs are NOT flagged (they are usually SHA256 hashes in reports/manifests);
  // we only flag a long hex value when it is the value of a session/token-like key, which is
  // the residual-token-truncation signal we actually care about.
  add('session_identifier', 'hex-session-tail', /(?:sessionId|session_id|session|token|accessToken|refreshToken|csrfToken|csrf|deviceKey|apiKey)\\?"\s*:\s*\\?"[0-9a-fA-F]{40,}/gi);

  // --- tenant / user identifiers ---
  add('tenant_identifier', 'tenantId-value', /tenantId\\?"\s*:\s*\\?"(?!\[TENANT_ID)[^"\\]{6,}/gi);
  add('personal_identifier', 'userId-value', /userId\\?"\s*:\s*\\?"(?!\[USER_ID)[^"\\]{6,}/gi);
  add('personal_identifier', 'email-address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?!test\b)[A-Za-z]{2,}/g);
  if (TESTUSER) add('personal_identifier', 'test-email-literal', new RegExp(escRe(TESTUSER), 'g'));

  // --- environment metadata ---
  add('environment_metadata', 'windows-user-path', /[A-Z]:\\\\Users\\\\[^\\/\s"']+/gi);
  add('environment_metadata', 'unix-home-path', /\/home\/[^/\s"']+\//gi);

  return findings;
}

// ---------- final-file-scan stats (scans committed placeholders) ----------
// Counts unique placeholders + occurrences by category in the ACTUAL committed files,
// not the in-process map. This is what the audit report uses.
function scanFinalStats(files) {
  const byCat = {
    session: { unique: 0, occurrences: 0 },
    user: { unique: 0, occurrences: 0 },
    tenant: { unique: 0, occurrences: 0 },
    resource: { unique: 0, occurrences: 0 },
  };
  const sets = { session: new Set(), user: new Set(), tenant: new Set(), resource: new Set() };
  const prefixToCat = { SESSION_ID: 'session', USER_ID: 'user', TENANT_ID: 'tenant', RESOURCE_ID: 'resource' };
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const [prefix, cat] of Object.entries(prefixToCat)) {
      // Canonical placeholder syntax: [PREFIX_ID_<exactly 8 uppercase hex>]. The sanitizer
      // uppercases the HMAC truncation, so committed placeholders are uppercase 8-hex. A token
      // with the wrong hex length or case is NOT counted here - it is an INVALID placeholder,
      // counted separately by dataset-files.countInvalidPlaceholders() and failed-closed by
      // verify.js (INVALID: gate). Previously [0-9A-Fa-f]{4,8} silently accepted 4-7 hex / any
      // case, letting e.g. [RESOURCE_ID_ABCDEF] (6 hex) pass as a valid mapped id.
      const re = new RegExp('\\[' + prefix + '_[0-9A-F]{8}\\]', 'g');
      const matches = txt.match(re) || [];
      for (const m of matches) sets[cat].add(m);
      byCat[cat].occurrences += matches.length;
    }
  }
  for (const cat of Object.keys(byCat)) byCat[cat].unique = sets[cat].size;
  const uniqueTotal = Object.values(sets).reduce((n, s) => n + s.size, 0);
  const occTotal = Object.values(byCat).reduce((n, c) => n + c.occurrences, 0);
  // Count residual LEGACY sequential placeholders [PREFIX_NNNN] still in the committed files.
  // After a salted regeneration these MUST be 0 (they were remapped to HMAC). A non-zero count
  // here means a legacy placeholder survived regeneration - a finding.
  let residualLegacySequential = 0;
  for (const f of files) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const m = txt.match(/\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9]{4}\]/g);
    if (m) residualLegacySequential += m.length;
  }
  return {
    uniqueInternalIdsMapped: uniqueTotal,
    totalMappedOccurrences: occTotal,
    mappedByCategory: byCat,
    residualLegacySequential,
    residualRawIdentifiers: 0, // filled by caller from auditText results
    residualPartialIdentifiers: 0, // filled by caller
  };
}

module.exports = {
  deepSanitize,
  sanitizeString,
  sanitizeHeaders,
  mapId,
  safeTruncate,
  MAX_BODY_BYTES,
  auditText,
  scanFinalStats,
  mappingMethod,
  hasSalt: () => HAS_SALT,
  isTestMode: () => TEST_MODE,
  legacyRemapped: () => legacyRemapped,
  envVal,
  escRe,
  ID_PREFIXES,
  _internals: { KEY_DROP, KEY_PLACEHOLDER, KEY_ID_PREFIX, DROP_HEADERS },
};
