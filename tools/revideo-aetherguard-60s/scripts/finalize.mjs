import {copyFileSync, existsSync, mkdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(projectDir, '..', '..');
const artifactsDir = path.join(repoRoot, 'artifacts', 'video', 'revideo-aetherguard-60s');
const visualPath = path.join(projectDir, 'output', 'aetherguard-visual-master.mp4');
const voicePath = path.join(projectDir, 'public', 'audio', 'narration-60s.wav');
const musicPath = path.join(projectDir, 'public', 'audio', 'music-sfx-60s.wav');
const subtitlePath = path.join(projectDir, 'output', 'aetherguard-60s.zh-CN.srt');
const finalPath = path.join(artifactsDir, 'aetherguard-60s.final.mp4');
const finalSubtitlePath = path.join(artifactsDir, 'aetherguard-60s.zh-CN.srt');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

for (const required of [visualPath, voicePath, musicPath, subtitlePath]) {
  if (!existsSync(required)) throw new Error(`Missing required input: ${path.relative(projectDir, required)}`);
}
mkdirSync(artifactsDir, {recursive: true});

const filter = [
  '[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[voiceMix][voiceKey]',
  '[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.26[music]',
  '[music][voiceKey]sidechaincompress=threshold=0.018:ratio=8:attack=20:release=280:makeup=1[musicDuck]',
  '[voiceMix][musicDuck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,atrim=0:60,alimiter=limit=0.95[aout]',
].join(';');

execFileSync(ffmpeg, [
  '-y',
  '-i', visualPath,
  '-i', voicePath,
  '-i', musicPath,
  '-filter_complex', filter,
  '-map', '0:v:0',
  '-map', '[aout]',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '16',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-frames:v', '1800',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-ar', '48000',
  '-ac', '2',
  '-t', '60',
  '-movflags', '+faststart',
  finalPath,
], {stdio: 'inherit'});

copyFileSync(subtitlePath, finalSubtitlePath);
const report = {
  generatedAt: new Date().toISOString(),
  visualMaster: path.relative(repoRoot, visualPath),
  voice: path.relative(repoRoot, voicePath),
  music: path.relative(repoRoot, musicPath),
  final: path.relative(repoRoot, finalPath),
  subtitle: path.relative(repoRoot, finalSubtitlePath),
  bytes: statSync(finalPath).size,
  encoding: {
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 1800,
    video: 'h264/yuv420p',
    audio: 'aac/48000Hz/stereo/192kbps',
  },
};
writeFileSync(path.join(artifactsDir, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`final ${path.relative(repoRoot, finalPath)} (${report.bytes} bytes)`);
console.log(`subtitle ${path.relative(repoRoot, finalSubtitlePath)}`);
