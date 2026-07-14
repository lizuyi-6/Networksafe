'use strict';

const fs = require('fs');
const path = require('path');

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return values;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) return values;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      values[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      return values;
    }, {});
};

const resolveProjectEnv = (rootDir, key, overrideKey, fallback) => {
  if (overrideKey && process.env[overrideKey]) return process.env[overrideKey];
  if (process.env[key]) return process.env[key];

  for (const candidate of [path.join(rootDir, '.env'), path.join(rootDir, 'backend', '.env')]) {
    const value = parseEnvFile(candidate)[key];
    if (value) return value;
  }

  return fallback;
};

const extractAuthCookieHeader = (headers) => {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  const raw = values.join('\n');

  const cookies = ['accessToken', 'refreshToken'].map((name) => {
    const match = raw.match(new RegExp(`(?:^|[\\r\\n,]\\s*)${name}=([^;,\\r\\n]+)`));
    return match ? `${name}=${match[1]}` : null;
  }).filter(Boolean);

  return cookies.join('; ');
};

const createAuthCookieSession = async (baseUrl, email, password) => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  const cookieHeader = extractAuthCookieHeader(response.headers);
  if (!response.ok || !cookieHeader.includes('accessToken=') || !cookieHeader.includes('refreshToken=')) {
    throw new Error(`Cookie session login failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return { status: response.status, data, cookieHeader };
};

module.exports = {
  createAuthCookieSession,
  extractAuthCookieHeader,
  resolveProjectEnv
};
