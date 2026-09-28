import {execFileSync, execFile} from 'node:child_process';
import {existsSync, mkdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(projectDir, '..', '..');
const artifactsDir = path.join(repoRoot, 'artifacts', 'video', 'revideo-aetherguard-60s');
const finalPath = path.join(artifactsDir, 'aetherguard-60s.final.mp4');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const expectedFrames = 1800;
const failures = [];

if (!existsSync(finalPath)) throw new Error(`Missing final video: ${finalPath}`);

function check(condition, message) {
  if (!condition) failures.push(message);
}

function ffprobeJson(args) {
  return JSON.parse(execFileSync(ffprobe, ['-v', 'error', ...args, '-of', 'json', finalPath], {encoding: 'utf8'}));
}

const probe = ffprobeJson(['-show_format', '-show_streams']);
const video = probe.streams.find((stream) => stream.codec_type === 'video');
const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
const duration = Number(probe.format.duration);
const counted = ffprobeJson(['-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames']);
const frames = Number(counted.streams[0]?.nb_read_frames);

check(Boolean(video), 'missing video stream');
check(Boolean(audio), 'missing audio stream');
check(Math.abs(duration - 60) <= 0.06, `duration ${duration} is outside 59.94–60.06 seconds`);
check(video?.width === 1920 && video?.height === 1080, `unexpected resolution ${video?.width}x${video?.height}`);
check(video?.codec_name === 'h264', `unexpected video codec ${video?.codec_name}`);
check(video?.pix_fmt === 'yuv420p', `unexpected pixel format ${video?.pix_fmt}`);
check(video?.avg_frame_rate === '30/1' || video?.r_frame_rate === '30/1', `unexpected frame rate ${video?.avg_frame_rate ?? video?.r_frame_rate}`);
check(frames === expectedFrames, `expected ${expectedFrames} frames, got ${frames}`);
check(audio?.codec_name === 'aac', `unexpected audio codec ${audio?.codec_name}`);
check(Number(audio?.sample_rate) === 48000, `unexpected sample rate ${audio?.sample_rate}`);
check(Number(audio?.channels) === 2, `unexpected channel count ${audio?.channels}`);

async function ffmpegReport(args) {
  try {
    const result = await execFileAsync(ffmpeg, args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    return `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  }
}

const motionReport = await ffmpegReport([
  '-hide_banner',
  '-nostats',
  '-i', finalPath,
  '-vf', 'blackdetect=d=0.7:pic_th=0.98:pix_th=0.10,freezedetect=n=-55dB:d=4',
  '-an',
  '-f', 'null', '-',
]);
const audioReport = await ffmpegReport([
  '-hide_banner',
  '-nostats',
  '-i', finalPath,
  '-map', '0:a:0',
  '-af', 'volumedetect,silencedetect=n=-45dB:d=6',
  '-f', 'null', '-',
]);
const blackIntervals = motionReport.split(/\r?\n/).filter((line) => line.includes('black_start'));
const freezeIntervals = motionReport.split(/\r?\n/).filter((line) => line.includes('freeze_start'));
const silenceIntervals = audioReport.split(/\r?\n/).filter((line) => line.includes('silence_start'));
const maxVolume = audioReport.match(/max_volume:\s*([-\d.]+) dB/)?.[1] ?? null;
check(blackIntervals.length === 0, `black intervals detected: ${blackIntervals.join(' | ')}`);
check(freezeIntervals.length === 0, `freeze intervals detected: ${freezeIntervals.join(' | ')}`);
check(silenceIntervals.length === 0, `long silence detected: ${silenceIntervals.join(' | ')}`);
check(maxVolume !== null && Number(maxVolume) <= -0.2, `unexpected max volume ${maxVolume}`);

const framesDir = path.join(artifactsDir, 'qa-frames');
mkdirSync(framesDir, {recursive: true});
const qaTimes = [3, 9, 18, 28, 39, 51, 57];
for (const seconds of qaTimes) {
  const target = path.join(framesDir, `frame-${String(seconds).padStart(2, '0')}s.png`);
  execFileSync(ffmpeg, [
    '-y',
    '-ss', String(seconds),
    '-i', finalPath,
    '-frames:v', '1',
    '-q:v', '2',
    target,
  ], {stdio: 'ignore'});
  check(statSync(target).size > 20_000, `QA frame at ${seconds}s is unexpectedly small`);
}

const report = {
  checkedAt: new Date().toISOString(),
  file: path.relative(repoRoot, finalPath),
  duration,
  width: video?.width,
  height: video?.height,
  fps: video?.avg_frame_rate,
  frames,
  videoCodec: video?.codec_name,
  pixelFormat: video?.pix_fmt,
  audioCodec: audio?.codec_name,
  sampleRate: Number(audio?.sample_rate),
  channels: Number(audio?.channels),
  maxVolumeDb: maxVolume === null ? null : Number(maxVolume),
  blackIntervals,
  freezeIntervals,
  silenceIntervals,
  qaFrames: qaTimes.map((seconds) => path.relative(repoRoot, path.join(framesDir, `frame-${String(seconds).padStart(2, '0')}s.png`))),
  failures,
};
writeFileSync(path.join(artifactsDir, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`media_qa duration=${duration.toFixed(3)}s frames=${frames} resolution=${video?.width}x${video?.height}`);
console.log(`audio_qa codec=${audio?.codec_name} sampleRate=${audio?.sample_rate} channels=${audio?.channels} maxVolume=${maxVolume}dB`);
console.log(`qa_report ${path.relative(repoRoot, path.join(artifactsDir, 'qa-report.json'))}`);
if (failures.length > 0) {
  console.error('media_qa=failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('media_qa=passed');
