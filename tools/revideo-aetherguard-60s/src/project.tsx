import {makeProject} from '@revideo/core';
import mainScene from './scenes/main.js';
import {COLORS, FPS, FULL_RANGE_END} from './timeline.js';

export default makeProject({
  name: 'aetherguard-revideo-60s',
  scenes: [mainScene],
  settings: {
    shared: {
      background: COLORS.background,
      range: [0, FULL_RANGE_END],
      size: {x: 1920, y: 1080},
    },
    preview: {
      fps: FPS,
      resolutionScale: 1,
    },
    rendering: {
      exporter: {
        name: '@revideo/core/ffmpeg',
        options: {format: 'mp4'},
      },
      fps: FPS,
      resolutionScale: 1,
      colorSpace: 'srgb',
    },
  },
});
