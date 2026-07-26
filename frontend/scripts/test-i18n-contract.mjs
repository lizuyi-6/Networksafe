import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const srcDir = join(frontendDir, 'src');
const en = JSON.parse(await readFile(join(srcDir, 'locales', 'en.json'), 'utf8'));
const zh = JSON.parse(await readFile(join(srcDir, 'locales', 'zh.json'), 'utf8'));

const i18n = createInstance();
await i18n.init({
  resources: {
    en: {
      translation: {
        ...en,
        __contract: {
          current: 'Current EN',
          fallbackOnly: 'Fallback EN',
          greeting: 'Hello, {name}!'
        }
      }
    },
    zh: {
      translation: {
        ...zh,
        __contract: {
          current: 'Current ZH'
        }
      }
    }
  },
  lng: 'zh',
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' }
});

const checks = [];
async function check(name, assertion) {
  await assertion();
  checks.push(name);
  console.log(`[PASS] ${name}`);
}

await check('missing key returns the key name', () => {
  assert.equal(i18n.t('__contract.absent'), '__contract.absent');
});

await check('current locale value wins', () => {
  assert.equal(i18n.t('__contract.current'), 'Current ZH');
});

await check('English fallback is used when the Chinese key is absent', () => {
  assert.equal(i18n.t('__contract.fallbackOnly'), 'Fallback EN');
});

await check('React text rendering escapes untrusted interpolation', () => {
  const malicious = '<script>alert(1)</script>';
  const translated = i18n.t('__contract.greeting', { lng: 'en', name: malicious });
  assert.match(translated, /<script>/);
  const markup = renderToStaticMarkup(React.createElement('span', null, translated));
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
});

await check('application locale placeholders are interpolated', () => {
  assert.equal(i18n.t('dashboard.severity_level', { lng: 'zh', level: 'high' }), '严重级别 high');
  assert.equal(i18n.t('login.credentials_filled', { lng: 'en', preset: 'Admin' }), 'Admin credentials filled');
});

const requiredAuthKeys = [
  'auth_session_store_unavailable',
  'account_not_active',
  'session_invalid',
  'logout_revocation_failed',
  'password_session_revocation_failed',
  'refresh_session_revocation_failed'
];

await check('new authentication errors exist in both locales', () => {
  for (const key of requiredAuthKeys) {
    assert.equal(typeof en.backend?.[key], 'string', `missing en.backend.${key}`);
    assert.equal(typeof zh.backend?.[key], 'string', `missing zh.backend.${key}`);
  }
});

await check('disabled password-login copy requires explicit emergency-access enablement', () => {
  const zhCopy = i18n.t('login.password_login_disabled', { lng: 'zh' });
  const enCopy = i18n.t('login.password_login_disabled', { lng: 'en' });
  assert.match(zhCopy, /所有本地密码登录/);
  assert.match(zhCopy, /显式启用/);
  assert.match(enCopy, /every role/i);
  assert.match(enCopy, /explicitly enable/i);
  assert.doesNotMatch(enCopy, /configured break-glass account/i);
});

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '__tests__') continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(absolute));
    } else if (['.ts', '.tsx'].includes(extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

await check('frontend source has no direct HTML injection sink', () => {
  const sinkPattern = /dangerouslySetInnerHTML\s*=|\.innerHTML\s*=|\.outerHTML\s*=/;
  return sourceFiles(srcDir).then(async (files) => {
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      assert.doesNotMatch(source, sinkPattern, `unsafe HTML sink in ${file}`);
    }
  });
});

console.log(`${checks.length}/8 i18n contract assertions passed`);
