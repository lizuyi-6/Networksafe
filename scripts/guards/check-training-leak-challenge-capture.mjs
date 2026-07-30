#!/usr/bin/env node
'use strict';
// Guard: the VIguard LAN live-execution challenge set must NEVER enter any
// training / validation / ordinary-test artifact. It is reserved as an external
// independent challenge test set (split=external_challenge_test, eligibleForTraining=false).
//
// Fails (exit 1) if:
//   1. Any challenge sampleId (viguard-lan-NNNNNN) appears in a training/release/manifest
//      artifact outside the capture directory, OR
//   2. Any committed file outside the capture directory references the challenge capture
//      directory as a data source (a future builder wiring it in), OR
//   3. Any dataset sample itself is marked eligibleForTraining=true or a split other than
//      external_challenge_test.
//
// This is a repository guard in the spirit of scripts/guards/*.mjs: it scans text and
// reports; it does not modify anything. Run from the repo root:
//   node scripts/guards/check-training-leak-challenge-capture.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPTURE_DIR = path.join(root, 'ml', 'data', 'lan_challenge_capture');

const violations = [];

// ---- collect the challenge sampleIds from the capture dir (source of truth) ----
const challengeIds = new Set();
if (fs.existsSync(CAPTURE_DIR)) {
  for (const f of fs.readdirSync(CAPTURE_DIR)) {
    if (!/\.jsonl$/.test(f)) continue;
    const txt = fs.readFileSync(path.join(CAPTURE_DIR, f), 'utf8');
    for (const m of txt.matchAll(/viguard-lan-\d{6}/g)) challengeIds.add(m[0]);
  }
}

// ---- (3) dataset samples must not be training-eligible ----
if (fs.existsSync(CAPTURE_DIR)) {
  for (const f of fs.readdirSync(CAPTURE_DIR)) {
    if (!/\.jsonl$/.test(f)) continue;
    const lines = fs.readFileSync(path.join(CAPTURE_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let s; try { s = JSON.parse(line); } catch { continue; }
      const dm = s.datasetMetadata;
      if (!dm) continue; // evidence files without metadata are checked by verify.js
      if (dm.eligibleForTraining === true) violations.push(`${f}: ${s.sampleId} eligibleForTraining=true`);
      if (dm.split && dm.split !== 'external_challenge_test') violations.push(`${f}: ${s.sampleId} split=${dm.split}`);
    }
  }
}

// ---- directories that hold training/release/manifest artifacts ----
const SCAN_DIRS = [
  path.join(root, 'ml', 'data', 'releases'),
  path.join(root, 'ml', 'data', 'manifests'),
  path.join(root, 'ml', 'data', 'training'),
  path.join(root, 'ml', 'data', 'datasets'),
];
const SCAN_EXTS = new Set(['.json', '.jsonl', '.csv', '.txt', '.yaml', '.yml']);

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'lan_challenge_capture') continue; // the protected dir itself
      if (['node_modules', '.git', 'raw-private', '__pycache__'].includes(entry.name)) continue;
      walk(p, out);
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(p);
    }
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(d, files);

// ---- (1) challenge ids must not appear in training artifacts ----
// ---- (2) no outside file may reference the capture dir as a data source ----
const idRegex = /viguard-lan-\d{6}/;
for (const f of files) {
  const rel = path.relative(root, f);
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (idRegex.test(txt)) violations.push(`${rel}: contains challenge sampleId (e.g. ${txt.match(idRegex)[0]})`);
  if (/lan_challenge_capture/.test(txt)) violations.push(`${rel}: references lan_challenge_capture as a data source`);
}

// Also scan ml/data_pipeline python sources for any glob/path that would pull the capture
// dir into a training build (defense for future builders).
const PIPELINE_DIR = path.join(root, 'ml', 'data_pipeline');
if (fs.existsSync(PIPELINE_DIR)) {
  for (const f of fs.readdirSync(PIPELINE_DIR)) {
    if (!/\.py$/.test(f)) continue;
    const rel = path.join('ml', 'data_pipeline', f);
    const txt = fs.readFileSync(path.join(PIPELINE_DIR, f), 'utf8');
    if (/lan_challenge_capture/.test(txt)) violations.push(`${rel}: pipeline source references lan_challenge_capture`);
  }
}

if (violations.length) {
  console.error('TRAINING-LEAK GUARD: FAIL');
  for (const v of violations.slice(0, 50)) console.error('  - ' + v);
  console.error(`challenge ids tracked: ${challengeIds.size}`);
  process.exit(1);
}
console.log(`TRAINING-LEAK GUARD: PASS (challenge ids tracked: ${challengeIds.size}; scanned ${files.length} training/release artifacts + pipeline sources)`);
process.exit(0);
