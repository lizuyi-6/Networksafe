function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((interval) => interval.endSec > interval.startSec)
    .map((interval) => ({ startSec: interval.startSec, endSec: interval.endSec }))
    .sort((left, right) => left.startSec - right.startSec);

  if (sorted.length === 0) return [];

  const merged = [sorted[0]];
  for (const interval of sorted.slice(1)) {
    const current = merged.at(-1);
    if (interval.startSec <= current.endSec) {
      current.endSec = Math.max(current.endSec, interval.endSec);
      continue;
    }
    merged.push(interval);
  }

  return merged;
}

function sumIntervals(intervals) {
  return mergeIntervals(intervals).reduce((total, interval) => total + (interval.endSec - interval.startSec), 0);
}

function toColor(hex) {
  return `0x${hex.replace('#', '')}`;
}

function escapePathForFilter(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function escapeDrawtext(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, '\\n');
}

function wrapText(text, maxChars) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;

  const lines = [];
  let cursor = 0;
  const breakpoints = ['，', '。', '；', '：', '、', ',', '.', ' '];

  while (cursor < clean.length) {
    let end = Math.min(clean.length, cursor + maxChars);
    if (end < clean.length) {
      const slice = clean.slice(cursor, end + 1);
      let split = -1;
      for (let index = slice.length - 1; index >= 0; index -= 1) {
        if (!breakpoints.includes(slice[index])) continue;
        if (index < maxChars * 0.45) continue;
        split = index + 1;
        break;
      }
      if (split > 0) {
        end = cursor + split;
      }
    }
    lines.push(clean.slice(cursor, end).trim());
    cursor = end;
  }

  return lines.join('\n');
}

function px(value, total) {
  return Math.round(total * value);
}

function roundNumber(value) {
  return Number(value.toFixed(3));
}

function progressExpr(startSec, durationSec) {
  return `clip((t-${roundNumber(startSec)})/${roundNumber(durationSec)},0,1)`;
}

function windowAlphaExpr(startSec, endSec, inDuration = 0.32, outDuration = 0.24) {
  const enter = progressExpr(startSec, inDuration);
  const leave = `clip((${roundNumber(endSec)}-t)/${roundNumber(outDuration)},0,1)`;
  return `${enter}*${leave}`;
}

function motionExpr(base, delta, progress) {
  if (!delta) return `${base}`;
  return `${base}+(${roundNumber(delta)})*(1-${progress})`;
}

function getCards(scene) {
  return scene.objectCards || scene.uiCards || [];
}

function getAccentColor(accent, palette) {
  const map = {
    cyan: palette.cyan,
    blue: palette.blue,
    mint: palette.mint,
    lime: palette.lime,
    coral: palette.coral
  };
  return map[accent] || palette.cyan;
}

function getLayout(orientation, layoutName, width, height) {
  const landscape = {
    intro: { textX: 108, textY: 188, titleSize: 88, subY: 366, subSize: 30, ghostX: 108, ghostY: 792, ghostSize: 176 },
    outro: { textX: 108, textY: 188, titleSize: 78, subY: 436, subSize: 28, ghostX: 108, ghostY: 798, ghostSize: 154 },
    'stage-left': { textX: 108, textY: 154, titleSize: 70, subY: 292, subSize: 26, ghostX: 104, ghostY: 808, ghostSize: 164 },
    'stage-right': { textX: 1036, textY: 154, titleSize: 62, subY: 284, subSize: 24, ghostX: 832, ghostY: 808, ghostSize: 150 }
  };

  const vertical = {
    intro: { textX: 74, textY: 238, titleSize: 72, subY: 408, subSize: 30, ghostX: 58, ghostY: 1150, ghostSize: 132 },
    outro: { textX: 74, textY: 236, titleSize: 68, subY: 500, subSize: 28, ghostX: 58, ghostY: 1166, ghostSize: 122 },
    'stage-left': { textX: 74, textY: 190, titleSize: 64, subY: 332, subSize: 28, ghostX: 58, ghostY: 1170, ghostSize: 128 },
    'stage-right': { textX: 74, textY: 190, titleSize: 64, subY: 332, subSize: 28, ghostX: 58, ghostY: 1170, ghostSize: 128 }
  };

  const selected = (orientation === 'vertical' ? vertical : landscape)[layoutName] || (orientation === 'vertical' ? vertical : landscape)['stage-left'];
  return {
    ...selected,
    brandIconX: orientation === 'vertical' ? 74 : 104,
    brandIconY: orientation === 'vertical' ? 78 : 72,
    brandTextX: orientation === 'vertical' ? 128 : 158,
    brandTextY: orientation === 'vertical' ? 86 : 80,
    brandRuleY: orientation === 'vertical' ? 128 : 118,
    kickerY: selected.textY - (orientation === 'vertical' ? 52 : 42),
    titleMaxChars: orientation === 'vertical' ? 12 : 15,
    subcopyMaxChars: orientation === 'vertical' ? 16 : 20,
    width,
    height
  };
}

function getBackgroundPreset(name, width, height, palette) {
  const presets = {
    'brand-stage': {
      base: palette.stage,
      ghostOpacity: 0.05,
      lines: [
        { x: px(0.08, width), y: px(0.79, height), w: px(0.3, width), h: 2, alpha: 0.14 },
        { x: px(0.64, width), y: px(0.16, height), w: px(0.12, width), h: px(0.44, height), alpha: 0.04 }
      ],
      glows: [
        { x: `-140+18*sin(t*0.24)`, y: `${px(0.44, height)}+14*cos(t*0.2)`, alpha: 0.18 },
        { x: `${px(0.62, width)}+20*sin(t*0.22)`, y: `${px(0.1, height)}+16*cos(t*0.18)`, alpha: 0.14 },
        { x: `${px(0.56, width)}+12*cos(t*0.18)`, y: `${px(0.72, height)}+18*sin(t*0.17)`, alpha: 0.1 }
      ]
    },
    'risk-stage': {
      base: palette.stageLift,
      ghostOpacity: 0.045,
      lines: [
        { x: px(0.58, width), y: px(0.12, height), w: px(0.18, width), h: px(0.52, height), alpha: 0.05 },
        { x: px(0.1, width), y: px(0.82, height), w: px(0.24, width), h: 2, alpha: 0.12 }
      ],
      glows: [
        { x: `-120+22*sin(t*0.28)`, y: `${px(0.52, height)}+18*cos(t*0.22)`, alpha: 0.16 },
        { x: `${px(0.72, width)}+22*sin(t*0.21)`, y: `${px(0.08, height)}+10*cos(t*0.17)`, alpha: 0.08 },
        { x: `${px(0.5, width)}+16*cos(t*0.2)`, y: `${px(0.74, height)}+10*sin(t*0.16)`, alpha: 0.12 }
      ]
    },
    'decision-stage': {
      base: palette.stage,
      ghostOpacity: 0.046,
      lines: [
        { x: px(0.62, width), y: px(0.22, height), w: px(0.16, width), h: 2, alpha: 0.12 },
        { x: px(0.58, width), y: px(0.58, height), w: px(0.22, width), h: px(0.12, height), alpha: 0.05 }
      ],
      glows: [
        { x: `${px(0.66, width)}+18*sin(t*0.24)`, y: `${px(0.16, height)}+12*cos(t*0.19)`, alpha: 0.13 },
        { x: `${px(0.52, width)}+14*cos(t*0.18)`, y: `${px(0.7, height)}+12*sin(t*0.18)`, alpha: 0.11 },
        { x: `-110+16*sin(t*0.2)`, y: `${px(0.36, height)}+18*cos(t*0.17)`, alpha: 0.08 }
      ]
    },
    'record-stage': {
      base: palette.stageLift,
      ghostOpacity: 0.044,
      lines: [
        { x: px(0.14, width), y: px(0.68, height), w: px(0.26, width), h: 2, alpha: 0.14 },
        { x: px(0.18, width), y: px(0.74, height), w: px(0.18, width), h: px(0.12, height), alpha: 0.05 }
      ],
      glows: [
        { x: `${px(0.08, width)}+12*sin(t*0.18)`, y: `${px(0.58, height)}+18*cos(t*0.14)`, alpha: 0.11 },
        { x: `${px(0.68, width)}+18*sin(t*0.18)`, y: `${px(0.14, height)}+14*cos(t*0.17)`, alpha: 0.12 },
        { x: `${px(0.42, width)}+14*cos(t*0.14)`, y: `${px(0.8, height)}+10*sin(t*0.16)`, alpha: 0.09 }
      ]
    },
    'edge-stage': {
      base: palette.stage,
      ghostOpacity: 0.045,
      lines: [
        { x: px(0.12, width), y: px(0.78, height), w: px(0.28, width), h: 2, alpha: 0.14 },
        { x: px(0.66, width), y: px(0.18, height), w: px(0.12, width), h: px(0.44, height), alpha: 0.05 }
      ],
      glows: [
        { x: `${px(0.04, width)}+18*sin(t*0.16)`, y: `${px(0.62, height)}+16*cos(t*0.16)`, alpha: 0.09 },
        { x: `${px(0.72, width)}+14*sin(t*0.18)`, y: `${px(0.12, height)}+10*cos(t*0.14)`, alpha: 0.12 },
        { x: `${px(0.58, width)}+10*cos(t*0.14)`, y: `${px(0.7, height)}+12*sin(t*0.14)`, alpha: 0.1 }
      ]
    }
  };

  return presets[name] || presets['brand-stage'];
}

function getMotionOffsets(motionPreset, cardIndex, orientation) {
  const vertical = orientation === 'vertical';
  const map = {
    'headline-float': [{ x: 0, y: vertical ? 36 : 28 }],
    'single-drift': [{ x: vertical ? 0 : 46, y: vertical ? 44 : 18 }],
    'pair-handoff': [
      { x: vertical ? 0 : 26, y: vertical ? 34 : -16 },
      { x: vertical ? 0 : 42, y: vertical ? 56 : 22 }
    ],
    'stack-rise': [{ x: vertical ? 0 : -18, y: vertical ? 42 : 34 }],
    handoff: [
      { x: vertical ? 0 : -36, y: vertical ? 28 : 14 },
      { x: vertical ? 0 : 30, y: vertical ? 42 : -18 }
    ]
  };

  return map[motionPreset]?.[cardIndex] || { x: vertical ? 0 : 24, y: vertical ? 28 : 14 };
}

function buildInputDescriptorList({ manifest, scene, orientation, assetResults, shieldPath }) {
  const outputSize = manifest.output[orientation];
  const duration = roundNumber(scene.durationSec);
  const fps = manifest.compositionFps;
  const background = getBackgroundPreset(scene.backgroundPreset, outputSize.width, outputSize.height, manifest.brand.palette);
  const glowSizes = [
    Math.round(outputSize.width * 0.34),
    Math.round(outputSize.width * 0.28),
    Math.round(outputSize.width * 0.24)
  ];

  const inputs = [
    { kind: 'lavfi', args: ['-f', 'lavfi', '-t', String(duration), '-r', String(fps), '-i', `color=c=${toColor(background.base)}:s=${outputSize.width}x${outputSize.height}:r=${fps}`] },
    { kind: 'lavfi', args: ['-f', 'lavfi', '-t', String(duration), '-r', String(fps), '-i', `color=c=${toColor(manifest.brand.palette.cyan)}:s=${glowSizes[0]}x${glowSizes[0]}:r=${fps}`] },
    { kind: 'lavfi', args: ['-f', 'lavfi', '-t', String(duration), '-r', String(fps), '-i', `color=c=${toColor(manifest.brand.palette.blue)}:s=${glowSizes[1]}x${glowSizes[1]}:r=${fps}`] },
    { kind: 'lavfi', args: ['-f', 'lavfi', '-t', String(duration), '-r', String(fps), '-i', `color=c=${toColor(manifest.brand.palette.mint)}:s=${glowSizes[2]}x${glowSizes[2]}:r=${fps}`] },
    { kind: 'loop', args: ['-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', shieldPath] },
    { kind: 'lavfi', args: ['-f', 'lavfi', '-t', String(duration), '-r', String(fps), '-i', `color=c=${toColor(manifest.brand.palette.stage)}:s=${outputSize.width}x${outputSize.height}:r=${fps}`] }
  ];

  for (const card of getCards(scene)) {
    const asset = assetResults[card.assetId];
    if (!asset) {
      throw new Error(`Scene ${scene.id} references missing asset ${card.assetId}`);
    }

    inputs.push({
      kind: 'lavfi',
      args: ['-f', 'lavfi', '-t', String(duration), '-r', String(fps), '-i', `color=c=white@0.0:s=${outputSize.width}x${outputSize.height}:r=${fps}`]
    });

    if (asset.type === 'image') {
      inputs.push({
        kind: 'image',
        args: ['-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', asset.sourcePath]
      });
      continue;
    }

    inputs.push({
      kind: 'video',
      args: ['-stream_loop', '-1', '-t', String(duration), '-i', asset.sourcePath]
    });
  }

  return inputs;
}

function createTextFilterParts({ fontPath, text, fontColor, fontSize, x, y, alphaExpr, lineSpacing = 0 }) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const yExpr = index === 0 ? `${y}` : `${y}+${index * (fontSize + lineSpacing)}`;
      return `drawtext=fontfile='${escapePathForFilter(fontPath)}':text='${escapeDrawtext(line)}':fontcolor=${fontColor}:fontsize=${fontSize}:x='${x}':y='${yExpr}'${alphaExpr ? `:alpha='${alphaExpr}'` : ''}`;
    });
}

function pushCardTextFilters(filters, config) {
  const {
    currentLabel,
    nextLabel,
    fontPath,
    orientation,
    palette,
    accent,
    label,
    title,
    copy,
    titleX,
    titleY,
    labelX,
    labelY,
    copyX,
    copyY,
    alphaExpr,
    variant
  } = config;

  const filterParts = [];
  filterParts.push(
    ...createTextFilterParts({
      fontPath,
      text: label,
      fontColor: `${toColor(accent)}@0.98`,
      fontSize: orientation === 'vertical' ? 18 : 17,
      x: labelX,
      y: labelY,
      alphaExpr
    })
  );

  if (title) {
    filterParts.push(
      ...createTextFilterParts({
        fontPath,
        text: title,
        fontColor: `${toColor(palette.text)}@0.98`,
        fontSize: variant === 'pill' ? (orientation === 'vertical' ? 27 : 28) : orientation === 'vertical' ? 24 : 26,
        lineSpacing: orientation === 'vertical' ? 6 : 8,
        x: titleX,
        y: titleY,
        alphaExpr
      })
    );
  }

  if (copy) {
    filterParts.push(
      ...createTextFilterParts({
        fontPath,
        text: copy,
        fontColor: `${toColor(palette.textSoft)}@0.96`,
        fontSize: orientation === 'vertical' ? 16 : 15,
        lineSpacing: orientation === 'vertical' ? 4 : 6,
        x: copyX,
        y: copyY,
        alphaExpr
      })
    );
  }

  filters.push(`${currentLabel}${filterParts.join(',')}[${nextLabel}]`);
}

export function buildSceneRenderSpec({ manifest, scene, orientation, assetResults, fontPath, shieldPath }) {
  const outputSize = manifest.output[orientation];
  const layout = getLayout(orientation, scene.layout, outputSize.width, outputSize.height);
  const palette = manifest.brand.palette;
  const background = getBackgroundPreset(scene.backgroundPreset, outputSize.width, outputSize.height, palette);
  const cards = getCards(scene);
  const durationSec = roundNumber(scene.durationSec);
  const fps = manifest.compositionFps;
  const inputs = buildInputDescriptorList({ manifest, scene, orientation, assetResults, shieldPath });
  const inputArgs = inputs.flatMap((input) => input.args);
  const filters = [];
  const titleIn = progressExpr(0.16, 0.7);
  const subIn = progressExpr(0.26, 0.64);
  const kickerIn = progressExpr(0.08, 0.45);

  filters.push(`[0:v]format=rgba,noise=alls=${orientation === 'vertical' ? 4 : 3}:allf=t+u[base0]`);
  filters.push(`[1:v]format=rgba,colorchannelmixer=aa=${background.glows[0].alpha},gblur=sigma=${orientation === 'vertical' ? 104 : 124}[glowA]`);
  filters.push(`[2:v]format=rgba,colorchannelmixer=aa=${background.glows[1].alpha},gblur=sigma=${orientation === 'vertical' ? 94 : 112}[glowB]`);
  filters.push(`[3:v]format=rgba,colorchannelmixer=aa=${background.glows[2].alpha},gblur=sigma=${orientation === 'vertical' ? 82 : 94}[glowC]`);
  filters.push(`[4:v]format=rgba,split[shieldIconRaw][shieldGhostRaw]`);
  filters.push(`[shieldIconRaw]scale=${orientation === 'vertical' ? 42 : 48}:-1,colorchannelmixer=aa=0.96[shieldIcon]`);
  filters.push(`[shieldGhostRaw]scale=${Math.round(outputSize.width * (orientation === 'vertical' ? 0.72 : 0.42))}:-1,colorchannelmixer=aa=0.03,hue=s=0[shieldGhost]`);

  let current = '[base0]';
  const overlays = [
    { label: 'glowA', x: background.glows[0].x, y: background.glows[0].y },
    { label: 'glowB', x: background.glows[1].x, y: background.glows[1].y },
    { label: 'glowC', x: background.glows[2].x, y: background.glows[2].y },
    { label: 'shieldGhost', x: `${Math.round(outputSize.width * 0.66)}`, y: `${Math.round(outputSize.height * 0.12)}` },
    { label: 'shieldIcon', x: `${layout.brandIconX}`, y: `${layout.brandIconY}` }
  ];

  for (const [index, overlay] of overlays.entries()) {
    const next = `[layer${index}]`;
    filters.push(`${current}[${overlay.label}]overlay=x='${overlay.x}':y='${overlay.y}':format=auto${next}`);
    current = next;
  }

  const titleText = wrapText(scene.headline, layout.titleMaxChars);
  const subcopyText = wrapText(scene.subcopy, layout.subcopyMaxChars);
  const ghostText = wrapText(scene.ghostWord || manifest.brand.productName.toUpperCase(), orientation === 'vertical' ? 11 : 16);
  const baseDecorations = [];

  for (const line of background.lines) {
    baseDecorations.push(`drawbox=x=${line.x}:y=${line.y}:w=${line.w}:h=${Math.max(2, line.h)}:color=${toColor(palette.surfaceLine)}@${line.alpha}:t=fill`);
  }
  baseDecorations.push(`drawbox=x=${layout.brandTextX}:y=${layout.brandRuleY}:w=${orientation === 'vertical' ? 108 : 126}:h=2:color=${toColor(palette.cyan)}@0.78:t=fill`);

  const headerFilters = [
    ...createTextFilterParts({
      fontPath,
      text: manifest.brand.productName,
      fontColor: `${toColor(palette.text)}@0.98`,
      fontSize: orientation === 'vertical' ? 30 : 32,
      x: layout.brandTextX,
      y: layout.brandTextY
    }),
    ...createTextFilterParts({
      fontPath,
      text: 'SECURITY CONTROL LOOP',
      fontColor: `${toColor(palette.textSoft)}@0.86`,
      fontSize: 12,
      x: layout.brandTextX,
      y: layout.brandTextY + (orientation === 'vertical' ? 32 : 34)
    }),
    ...createTextFilterParts({
      fontPath,
      text: scene.kicker || manifest.brand.productName,
      fontColor: `${toColor(palette.textSoft)}@0.95`,
      fontSize: orientation === 'vertical' ? 18 : 17,
      x: layout.textX,
      y: `${layout.kickerY + (orientation === 'vertical' ? 16 : 14)}+18*(1-${kickerIn})`,
      alphaExpr: kickerIn
    }),
    ...createTextFilterParts({
      fontPath,
      text: titleText,
      fontColor: `${toColor(palette.text)}@0.99`,
      fontSize: layout.titleSize,
      lineSpacing: orientation === 'vertical' ? 10 : 12,
      x: layout.textX,
      y: `${layout.textY}+26*(1-${titleIn})`,
      alphaExpr: titleIn
    }),
    ...createTextFilterParts({
      fontPath,
      text: subcopyText,
      fontColor: `${toColor(palette.textSoft)}@0.98`,
      fontSize: layout.subSize,
      lineSpacing: orientation === 'vertical' ? 8 : 10,
      x: layout.textX,
      y: `${layout.subY}+16*(1-${subIn})`,
      alphaExpr: subIn
    }),
    ...createTextFilterParts({
      fontPath,
      text: ghostText,
      fontColor: `${toColor(palette.text)}@${background.ghostOpacity}`,
      fontSize: layout.ghostSize,
      lineSpacing: orientation === 'vertical' ? 10 : 12,
      x: layout.ghostX,
      y: layout.ghostY
    })
  ];
  filters.push(`${current}${[...baseDecorations, ...headerFilters].join(',')}[composed0]`);
  current = '[composed0]';

  let blankInputIndex = 6;
  const staticIntervals = [];
  for (const [cardIndex, card] of cards.entries()) {
    const asset = assetResults[card.assetId];
    const cardBox = card[orientation];
    const focus = card[`focus${orientation[0].toUpperCase()}${orientation.slice(1)}`] || { x: 0.5, y: 0.5 };
    const offset = getMotionOffsets(scene.motionPreset, cardIndex, orientation);
    const variant = card.variant || 'panel';
    const accent = getAccentColor(card.accent, palette);
    const cardWidth = px(cardBox.w, outputSize.width);
    const cardHeight = px(cardBox.h, outputSize.height);
    const cardX = px(cardBox.x, outputSize.width);
    const cardY = px(cardBox.y, outputSize.height);
    const cardAlphaExpr = windowAlphaExpr(card.startSec, card.endSec);
    const enterProgress = progressExpr(card.startSec, 0.45);
    const baseXExpr = motionExpr(cardX, offset.x, enterProgress);
    const baseYExpr = motionExpr(cardY, offset.y, enterProgress);
    const shadowXExpr = motionExpr(cardX - (variant === 'pill' ? 16 : 24), offset.x, enterProgress);
    const shadowYExpr = motionExpr(cardY + (variant === 'pill' ? 10 : 16), offset.y, enterProgress);
    const backAXExpr = motionExpr(cardX + 16, offset.x * 0.35, enterProgress);
    const backAYExpr = motionExpr(cardY + 12, offset.y * 0.35, enterProgress);
    const backBXExpr = motionExpr(cardX + 28, offset.x * 0.2, enterProgress);
    const backBYExpr = motionExpr(cardY + 22, offset.y * 0.2, enterProgress);
    const innerPad = variant === 'pill' ? (orientation === 'vertical' ? 14 : 18) : orientation === 'vertical' ? 16 : 20;
    const innerWidth = Math.max(40, cardWidth - innerPad * 2);
    const innerHeight = Math.max(40, cardHeight - innerPad * 2);
    const title = wrapText(card.title, variant === 'pill' ? (orientation === 'vertical' ? 14 : 18) : orientation === 'vertical' ? 14 : 16);
    const copy = variant === 'pill' ? String(card.copy || '').trim() : wrapText(card.copy, orientation === 'vertical' ? 16 : 18);
    const splitCount = variant === 'stack' ? 4 : 2;
    const blankBase = `blank${cardIndex}`;
    const blankShadow = `${blankBase}shadow`;
    const blankBackA = `${blankBase}backA`;
    const blankBackB = `${blankBase}backB`;
    const blankCard = `${blankBase}card`;
    const blankLabel = `[${blankInputIndex}:v]`;
    const assetLabel = `[${blankInputIndex + 1}:v]`;
    const parts = variant === 'stack'
      ? [`[${blankShadow}]`, `[${blankBackA}]`, `[${blankBackB}]`, `[${blankCard}]`]
      : [`[${blankShadow}]`, `[${blankCard}]`];
    filters.push(`${blankLabel}format=rgba,split=${splitCount}${parts.join('')}`);

    filters.push(
      `[${blankShadow}]drawbox=x='${shadowXExpr}':y='${shadowYExpr}':w=${cardWidth + (variant === 'pill' ? 30 : 42)}:h=${cardHeight + (variant === 'pill' ? 18 : 34)}:color=${toColor(palette.shadow)}@0.22:t=fill,gblur=sigma=${variant === 'pill' ? 18 : 26},fade=t=in:st=${roundNumber(card.startSec)}:d=0.32:alpha=1,fade=t=out:st=${roundNumber(Math.max(card.startSec, card.endSec - 0.24))}:d=0.24:alpha=1[shadow${cardIndex}]`
    );

    let layered = current;
    filters.push(`${layered}[shadow${cardIndex}]overlay=0:0:format=auto[shadowed${cardIndex}]`);
    layered = `[shadowed${cardIndex}]`;

    if (variant === 'stack') {
      filters.push(
        `[${blankBackA}]drawbox=x='${backAXExpr}':y='${backAYExpr}':w=${cardWidth}:h=${cardHeight}:color=${toColor(palette.surfaceSoft)}@0.42:t=fill,drawbox=x='${backAXExpr}':y='${backAYExpr}':w=${cardWidth}:h=${cardHeight}:color=${toColor(accent)}@0.18:t=2,fade=t=in:st=${roundNumber(card.startSec)}:d=0.32:alpha=1,fade=t=out:st=${roundNumber(Math.max(card.startSec, card.endSec - 0.24))}:d=0.24:alpha=1[stackA${cardIndex}]`
      );
      filters.push(
        `[${blankBackB}]drawbox=x='${backBXExpr}':y='${backBYExpr}':w=${cardWidth}:h=${cardHeight}:color=${toColor(palette.surfaceSoft)}@0.26:t=fill,drawbox=x='${backBXExpr}':y='${backBYExpr}':w=${cardWidth}:h=${cardHeight}:color=${toColor(accent)}@0.14:t=2,fade=t=in:st=${roundNumber(card.startSec)}:d=0.32:alpha=1,fade=t=out:st=${roundNumber(Math.max(card.startSec, card.endSec - 0.24))}:d=0.24:alpha=1[stackB${cardIndex}]`
      );
      filters.push(`${layered}[stackB${cardIndex}]overlay=0:0:format=auto[stackedB${cardIndex}]`);
      filters.push(`[stackedB${cardIndex}][stackA${cardIndex}]overlay=0:0:format=auto[stackedA${cardIndex}]`);
      layered = `[stackedA${cardIndex}]`;
    }

    const labelStripHeight = variant === 'pill' ? Math.max(20, Math.round(cardHeight * 0.18)) : Math.max(22, Math.round(cardHeight * 0.12));
    const footerOverlayHeight = variant === 'pill' ? Math.max(30, Math.round(cardHeight * 0.46)) : Math.max(44, Math.round(cardHeight * 0.34));
    filters.push(
      `[${blankCard}]drawbox=x='${baseXExpr}':y='${baseYExpr}':w=${cardWidth}:h=${cardHeight}:color=${toColor(palette.surface)}@0.92:t=fill,drawbox=x='${baseXExpr}':y='${baseYExpr}':w=${cardWidth}:h=${cardHeight}:color=${toColor(palette.surfaceLine)}@0.9:t=2,drawbox=x='${baseXExpr}':y='${baseYExpr}':w=${cardWidth}:h=${labelStripHeight}:color=${toColor(accent)}@0.14:t=fill,fade=t=in:st=${roundNumber(card.startSec)}:d=0.32:alpha=1,fade=t=out:st=${roundNumber(Math.max(card.startSec, card.endSec - 0.24))}:d=0.24:alpha=1[cardBase${cardIndex}]`
    );
    filters.push(`${layered}[cardBase${cardIndex}]overlay=0:0:format=auto[cardShell${cardIndex}]`);

    const assetPrelude = asset.type === 'image' ? `fps=${fps}` : `fps=${manifest.captureFps},framerate=fps=${fps}`;
    filters.push(
      `${assetLabel}setpts=PTS-STARTPTS,${assetPrelude},scale=${innerWidth}:${innerHeight}:force_original_aspect_ratio=increase,crop=${innerWidth}:${innerHeight}:x='(in_w-out_w)*${clamp(focus.x, 0, 1)}':y='(in_h-out_h)*${clamp(focus.y, 0, 1)}',eq=contrast=1.04:saturation=0.9:brightness=-0.05,format=rgba,fade=t=in:st=${roundNumber(card.startSec)}:d=0.32:alpha=1,fade=t=out:st=${roundNumber(Math.max(card.startSec, card.endSec - 0.24))}:d=0.24:alpha=1[asset${cardIndex}]`
    );
    filters.push(`[cardShell${cardIndex}][asset${cardIndex}]overlay=x='${baseXExpr}+${innerPad}':y='${baseYExpr}+${innerPad}':format=auto[assetApplied${cardIndex}]`);
    filters.push(
      `[assetApplied${cardIndex}]drawbox=x='${baseXExpr}':y='${baseYExpr}+${cardHeight - footerOverlayHeight}':w=${cardWidth}:h=${footerOverlayHeight}:color=${toColor(palette.shadow)}@${variant === 'pill' ? 0.28 : 0.34}:t=fill[cardTint${cardIndex}]`
    );

    const labelX = `${baseXExpr}+${variant === 'pill' ? 18 : 20}`;
    const labelY = `${baseYExpr}+${variant === 'pill' ? 12 : 18}`;
    const titleX = `${baseXExpr}+${variant === 'pill' ? 18 : 20}`;
    const titleY = variant === 'pill' ? `${baseYExpr}+${Math.round(cardHeight * 0.42)}` : `${baseYExpr}+${Math.round(cardHeight * 0.62)}`;
    const copyX = `${baseXExpr}+${variant === 'pill' ? Math.round(cardWidth * 0.55) : 20}`;
    const copyY = variant === 'pill' ? `${baseYExpr}+${Math.round(cardHeight * 0.44)}` : `${baseYExpr}+${Math.round(cardHeight * 0.79)}`;
    pushCardTextFilters(filters, {
      currentLabel: '[cardTint' + cardIndex + ']',
      nextLabel: 'cardText' + cardIndex,
      fontPath,
      orientation,
      palette,
      accent,
      label: card.label,
      title,
      copy,
      labelX,
      labelY,
      titleX,
      titleY,
      copyX,
      copyY,
      alphaExpr: cardAlphaExpr,
      variant
    });

    current = `[cardText${cardIndex}]`;
    if (asset.type === 'image') {
      staticIntervals.push({ startSec: card.startSec, endSec: card.endSec });
    }
    blankInputIndex += 2;
  }

  if (scene.transitionIn === 'dip-black') {
    filters.push(`[5:v]format=rgba,colorchannelmixer=aa=1,fade=t=out:st=0:d=0.8:alpha=1[sceneWash]`);
    filters.push(`${current}[sceneWash]overlay=0:0:format=auto[outv]`);
  } else {
    filters.push(`${current}format=yuv420p[outv]`);
  }

  const visibleDurationSec = sumIntervals(cards.map((card) => ({ startSec: card.startSec, endSec: card.endSec })));
  const staticVisibleDurationSec = sumIntervals(staticIntervals);

  return {
    inputArgs,
    filterScript: `${filters.join(';\n')}\n`,
    outputArgs: [
      '-map',
      '[outv]',
      '-an',
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    ],
    sceneAnalytics: {
      uiVisibleDurationSec: Number(visibleDurationSec.toFixed(3)),
      staticVisibleDurationSec: Number(staticVisibleDurationSec.toFixed(3)),
      assetIds: cards.map((card) => card.assetId)
    }
  };
}
