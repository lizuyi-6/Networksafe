import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(projectDir, '..', '..');
const timelinePath = path.join(projectDir, 'content', 'timeline.json');
const segments = JSON.parse(readFileSync(timelinePath, 'utf8')).segments;
const audioDir = path.join(projectDir, 'public', 'audio');
const outputDir = path.join(projectDir, 'output');
const rawDir = path.join(audioDir, '.raw');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const powershell = process.env.POWERSHELL_PATH || 'powershell.exe';
const voiceName = process.env.TTS_VOICE || 'Microsoft Huihui Desktop';
const ttsScript = path.join(repoRoot, 'scripts', 'video', 'synthesize-tts.ps1');
const maxRate = Number(process.env.TTS_MAX_RATE || 4);

mkdirSync(rawDir, {recursive: true});
mkdirSync(outputDir, {recursive: true});

function ffprobeNumber(file, expression) {
  const output = execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries', expression,
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], {encoding: 'utf8'}).trim();
  const value = Number(output);
  if (!Number.isFinite(value)) throw new Error(`Unable to read ${expression} from ${file}: ${output}`);
  return value;
}

function synthesize(segment, rate, textPath, outputPath) {
  execFileSync(powershell, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ttsScript,
    '-InputPath', textPath,
    '-OutputPath', outputPath,
    '-VoiceName', voiceName,
    '-Rate', String(rate),
  ], {stdio: ['ignore', 'pipe', 'inherit']});
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

const segmentReport = [];
for (const segment of segments) {
  const slot = segment.endSec - segment.startSec;
  const textPath = path.join(rawDir, `${segment.id}.txt`);
  const wavPath = path.join(rawDir, `${segment.id}.wav`);
  writeFileSync(textPath, `${segment.voiceover}\n`, 'utf8');

  let selected = null;
  for (let rate = 0; rate <= maxRate; rate += 1) {
    synthesize(segment, rate, textPath, wavPath);
    const duration = ffprobeNumber(wavPath, 'format=duration');
    if (duration <= slot - 0.02) {
      selected = {rate, duration};
      break;
    }
  }

  if (!selected) {
    const duration = ffprobeNumber(wavPath, 'format=duration');
    throw new Error(
      `Narration segment ${segment.id} is ${duration.toFixed(3)}s at rate ${maxRate}, exceeding its ${slot.toFixed(3)}s slot; shorten the copy instead of trimming speech.`,
    );
  }

  segmentReport.push({
    id: segment.id,
    startSec: segment.startSec,
    endSec: segment.endSec,
    slotSec: slot,
    selectedRate: selected.rate,
    actualSec: selected.duration,
    slackSec: slot - selected.duration,
    text: segment.voiceover,
  });
  console.log(`narration ${segment.id}: rate=${selected.rate} duration=${selected.duration.toFixed(3)}s slot=${slot.toFixed(3)}s`);
}

const voiceInputs = segments.flatMap((segment) => ['-i', path.join(rawDir, `${segment.id}.wav`)]);
const voiceFilters = segments.map((segment, index) => {
  const slot = segment.endSec - segment.startSec;
  const startMs = Math.round(segment.startSec * 1000);
  return `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=80,lowpass=f=12000,acompressor=threshold=-22dB:ratio=3:attack=8:release=120:makeup=2,atrim=0:${slot.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${startMs}:all=1[s${index}]`;
});
const mixInputs = segments.map((_, index) => `[s${index}]`).join('');
const voiceFilter = `${voiceFilters.join(';')};${mixInputs}amix=inputs=${segments.length}:duration=longest:normalize=0,apad=whole_dur=60,atrim=0:60,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95[voice]`;
const voicePath = path.join(audioDir, 'narration-60s.wav');
execFileSync(ffmpeg, [
  '-y',
  ...voiceInputs,
  '-filter_complex', voiceFilter,
  '-map', '[voice]',
  '-ar', '48000',
  '-ac', '2',
  '-c:a', 'pcm_s16le',
  voicePath,
], {stdio: 'inherit'});

const musicPath = path.join(audioDir, 'music-sfx-60s.wav');
const eventStarts = [0, 6, 14, 23, 33, 45, 53];
const musicInputs = [
  '-f', 'lavfi', '-i', 'sine=frequency=55:duration=60:sample_rate=48000',
  '-f', 'lavfi', '-i', 'sine=frequency=110:duration=60:sample_rate=48000',
  '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=60:amplitude=0.028:seed=42:sample_rate=48000',
  ...eventStarts.flatMap((start, index) => {
    const frequency = index === 5 ? 220 : index === 6 ? 660 : 880;
    return ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.32:sample_rate=48000`];
  }),
];
const baseFilters = [
  '[0:a]aformat=channel_layouts=stereo,volume=0.16,lowpass=f=140,afade=t=in:st=0:d=2,afade=t=out:st=55:d=5[b0]',
  '[1:a]aformat=channel_layouts=stereo,volume=0.045,lowpass=f=220,afade=t=in:st=0:d=3,afade=t=out:st=55:d=5[b1]',
  '[2:a]aformat=channel_layouts=stereo,highpass=f=30,lowpass=f=260,volume=0.032,afade=t=in:st=0:d=3,afade=t=out:st=54:d=6[b2]',
];
const eventFilters = eventStarts.map((start, index) => {
  const inputIndex = index + 3;
  const startMs = Math.round(start * 1000);
  return `[${inputIndex}:a]aformat=channel_layouts=stereo,volume=${index === 6 ? 0.24 : 0.16},afade=t=in:st=0:d=0.012,afade=t=out:st=0.24:d=0.08,adelay=${startMs}:all=1[e${index}]`;
});
const musicMix = ['[b0]', '[b1]', '[b2]', ...eventStarts.map((_, index) => `[e${index}]`)].join('');
const musicFilter = `${baseFilters.join(';')};${eventFilters.join(';')};${musicMix}amix=inputs=${eventStarts.length + 3}:duration=first:normalize=0,atrim=0:60[music]`;
execFileSync(ffmpeg, [
  '-y',
  ...musicInputs,
  '-filter_complex', musicFilter,
  '-map', '[music]',
  '-ar', '48000',
  '-ac', '2',
  '-c:a', 'pcm_s16le',
  musicPath,
], {stdio: 'inherit'});

const srt = segments.map((segment, index) => [
  String(index + 1),
  `${srtTime(segment.startSec)} --> ${srtTime(segment.endSec)}`,
  segment.voiceover,
  '',
].join('\n')).join('\n');
writeFileSync(path.join(outputDir, 'aetherguard-60s.zh-CN.srt'), srt, 'utf8');

writeFileSync(path.join(outputDir, 'narration-report.json'), `${JSON.stringify({
  voiceName,
  maxRate,
  voicePath: path.relative(projectDir, voicePath),
  musicPath: path.relative(projectDir, musicPath),
  segments: segmentReport,
}, null, 2)}\n`, 'utf8');

console.log(`voice ${path.relative(projectDir, voicePath)}`);
console.log(`music ${path.relative(projectDir, musicPath)}`);
console.log(`subtitle ${path.relative(projectDir, path.join(outputDir, 'aetherguard-60s.zh-CN.srt'))}`);
