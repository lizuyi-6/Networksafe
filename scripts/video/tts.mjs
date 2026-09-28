#!/usr/bin/env node
// Batch TTS generator for AetherGuard video narration.
// Usage: STEP_API_KEY=... node scripts/video/tts.mjs [--force]
// Reads video-assets/segments.json, writes video-assets/audio/<id>.mp3 (skip if exists unless --force).
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SEGMENTS_FILE = process.env.SEGMENTS_FILE
  ? path.resolve(process.env.SEGMENTS_FILE)
  : path.join(ROOT, 'video-assets', 'segments.json');
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(ROOT, 'video-assets', 'audio');
const API = 'https://api.stepfun.com/step_plan/v1/audio/speech';
const MODEL = 'stepaudio-2.5-tts';
const VOICE = process.env.TTS_VOICE || 'zhengpaiqingnian';
const force = process.argv.includes('--force');

const key = process.env.STEP_API_KEY;
if (!key) { console.error('STEP_API_KEY not set'); process.exit(1); }

const segments = JSON.parse(await readFile(SEGMENTS_FILE, 'utf8'));
await mkdir(OUT_DIR, { recursive: true });

let ok = 0, skipped = 0, failed = 0;
for (const seg of segments) {
  const out = path.join(OUT_DIR, seg.id + '.mp3');
  if (!force) {
    try { await access(out); console.log('skip (exists):', seg.id); skipped++; continue; } catch {}
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: MODEL, input: seg.text, voice: VOICE, instruction: seg.instruction, response_format: 'mp3' }),
  });
  if (!res.ok) {
    console.error('FAIL', seg.id, res.status, (await res.text()).slice(0, 200));
    failed++;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf.subarray(0, 3).toString('latin1') !== 'ID3') {
    console.error('FAIL', seg.id, 'unexpected payload', buf.length, 'bytes');
    failed++;
    continue;
  }
  await writeFile(out, buf);
  ok++;
  console.log('ok:', seg.id, buf.length, 'bytes');
}
console.log('done: ok=' + ok, 'skipped=' + skipped, 'failed=' + failed);
process.exit(failed > 0 ? 1 : 0);
