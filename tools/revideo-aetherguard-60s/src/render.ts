import path from 'node:path';
import {renderVideo, type RenderSettings} from '@revideo/renderer';
import {FPS} from './timeline.js';

const args = new Set(process.argv.slice(2));
const smoke = args.has('--smoke');
const preview = args.has('--preview');
const seconds = smoke ? 3 : 60;
const designSize = {x: 1920, y: 1080};
const outputScale = smoke ? 1 / 3 : preview ? 1 / 2 : 1;
const range: [number, number] = [0, (seconds * FPS - 1) / FPS];
const outputName = smoke
  ? 'aetherguard-smoke.mp4'
  : preview
    ? 'aetherguard-preview.mp4'
    : 'aetherguard-visual-master.mp4';

const ffmpegPath = process.env.FFMPEG_PATH || 'C:/Users/Abraham/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe';
const ffprobePath = process.env.FFPROBE_PATH || 'C:/Users/Abraham/AppData/Local/Microsoft/WinGet/Links/ffprobe.exe';
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter((value): value is string => Boolean(value));

type ProjectRenderSettings = NonNullable<RenderSettings['projectSettings']> & {
  resolutionScale: number;
};

const projectSettings: ProjectRenderSettings = {
  range,
  size: designSize,
  exporter: {
    name: '@revideo/core/ffmpeg',
    options: {format: 'mp4'},
  },
  resolutionScale: outputScale,
};

const settings: RenderSettings = {
  outFile: outputName,
  outDir: './output',
  workers: 1,
  logProgress: true,
  viteBasePort: smoke ? 9210 : preview ? 9220 : 9230,
  projectSettings,
  ffmpeg: {
    ffmpegPath,
    ffprobePath,
    ffmpegLogLevel: 'error',
  },
  puppeteer: {
    headless: true,
    executablePath: chromeCandidates[0],
  },
};

const output = await renderVideo({
  projectFile: './src/project.tsx',
  variables: {smoke, preview},
  settings,
});

console.log(path.resolve(output));
