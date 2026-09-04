#!/usr/bin/env node
/**
 * Aether security regression R2-F001 (CWE-532)
 *
 * Attack path: WebSocket dashboard handshake with a refreshToken-only cookie
 * header -> auditLogger details.cookies -> recursiveSanitize -> details_json.
 * BEFORE the fix the raw cookie (incl. the live refresh-token JWT) survived
 * persistence verbatim (probe output jwtSurvives=true, 2026-08-17 evidence).
 * AFTER the fix the audit persistence sanitizer structurally redacts any
 * '*cookie*' field, so the JWT must NOT survive.
 *
 * Exit 0 = regression passes (fixed). Exit 1 = regression FAILS (vuln back).
 */
process.env.TS_NODE_PROJECT = __dirname + '/../../tsconfig.json';
require('ts-node/register/transpile-only');

const { recursiveSanitize } = require('../../src/utils/log-sanitizer');

const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0ZXIiLCJzZXNzaW9uSWQiOiJhYmMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const cookieHeader = `refreshToken=${fakeJwt}; other=1`;

let failures = 0;

// 1. The exact audit-persistence path used by the gateway failure branch.
const persisted = recursiveSanitize({ reason: 'No token provided', cookies: cookieHeader });
if (String(persisted.cookies).includes(fakeJwt)) {
  console.error('FAIL: recursiveSanitize retained the refreshToken JWT in the cookies field of audit details');
  failures += 1;
} else {
  console.log('PASS: audit persistence redacts the cookies field (' + JSON.stringify(persisted.cookies).slice(0, 60) + ')');
}

// 1b. The gateway's value-free diagnostics shape (handshakeCookieAudit key,
// chosen to avoid the 'cookie' substring so presence/names survive sanitize).
const auditShape = { present: true, cookieNames: ['refreshToken', 'other'] };
const persistedShape = recursiveSanitize({ reason: 'No token provided', handshakeCookieAudit: auditShape });
if (JSON.stringify(persistedShape.handshakeCookieAudit) !== JSON.stringify(auditShape)) {
  console.error('FAIL: handshakeCookieAudit diagnostics did not survive persistence verbatim: ' + JSON.stringify(persistedShape));
  failures += 1;
} else {
  console.log('PASS: handshakeCookieAudit {present,cookieNames} survives persistence (value-free by construction)');
}

// 1c. A raw value under the renamed key must STILL be pattern-redacted
// (defense in depth: the rename must not become a new leak channel).
const persistedRaw = recursiveSanitize({ handshakeCookieAudit: cookieHeader });
if (String(JSON.stringify(persistedRaw)).includes(fakeJwt)) {
  console.error('FAIL: a raw cookie string under handshakeCookieAudit survived persistence');
  failures += 1;
} else {
  console.log('PASS: raw cookie value under handshakeCookieAudit is still pattern-redacted (' + JSON.stringify(persistedRaw).slice(0, 80) + ')');
}

// 2. Nested variants of the same leak shape (any '*cookie*' key).
const nested = recursiveSanitize({ ctx: { requestCookies: cookieHeader, Cookie: cookieHeader } });
for (const [key, value] of Object.entries(nested.ctx || {})) {
  if (String(value).includes(fakeJwt)) {
    console.error(`FAIL: nested field ctx.${key} retained the refreshToken JWT`);
    failures += 1;
  }
}
if (failures === 0) {
  console.log('PASS: nested *cookie* fields are also redacted');
}

// NOTE: recursiveSanitize still does NOT pattern-redact bare JWTs inside
// unrelated string fields (only field-name based redaction + control-char
// stripping). That residual gap is tracked as a hardening recommendation in
// the audit report, not as part of this regression's attack path.

if (failures > 0) {
  console.error(`R2-F001 regression: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('R2-F001 regression: all checks passed');
