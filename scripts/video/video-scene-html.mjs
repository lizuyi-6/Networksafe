function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitGhostWord(kicker, fallback) {
  if (!kicker) return fallback;
  const parts = kicker.split('/').map((part) => part.trim()).filter(Boolean);
  const tail = parts.at(-1);
  if (!tail) return fallback;
  return tail.replace(/\s+/g, ' ').toUpperCase();
}

function getLayoutFrame(layout, orientation) {
  const landscape = {
    intro: {
      content: { x: '6.5%', y: '12%', w: '50%' }
    },
    outro: {
      content: { x: '11%', y: '18%', w: '78%' }
    },
    'single-right': {
      content: { x: '6.5%', y: '16%', w: '34%' },
      primary: { x: '47%', y: '12%', w: '45%', h: '70%', delay: '0.22s' }
    },
    'single-left': {
      content: { x: '55%', y: '16%', w: '31%' },
      primary: { x: '7%', y: '14%', w: '44%', h: '68%', delay: '0.22s' }
    },
    'dual-float': {
      content: { x: '6.5%', y: '16%', w: '34%' },
      primary: { x: '44%', y: '12%', w: '46%', h: '65%', delay: '0.18s' },
      secondary: { x: '64%', y: '59%', w: '22%', h: '19%', delay: '0.42s' }
    },
    edge: {
      content: { x: '6.5%', y: '14%', w: '34%' },
      primary: { x: '9%', y: '36%', w: '45%', h: '42%', delay: '0.16s' },
      secondary: { x: '59%', y: '52%', w: '28%', h: '18%', delay: '0.38s' }
    }
  };

  const vertical = {
    intro: {
      content: { x: '7%', y: '12%', w: '86%' }
    },
    outro: {
      content: { x: '7%', y: '16%', w: '86%' }
    },
    'single-right': {
      content: { x: '7%', y: '10%', w: '86%' },
      primary: { x: '6%', y: '47%', w: '88%', h: '29%', delay: '0.22s' }
    },
    'single-left': {
      content: { x: '7%', y: '10%', w: '86%' },
      primary: { x: '6%', y: '46%', w: '88%', h: '29%', delay: '0.22s' }
    },
    'dual-float': {
      content: { x: '7%', y: '10%', w: '86%' },
      primary: { x: '5%', y: '45%', w: '90%', h: '27%', delay: '0.18s' },
      secondary: { x: '54%', y: '70%', w: '34%', h: '13%', delay: '0.42s' }
    },
    edge: {
      content: { x: '7%', y: '9%', w: '86%' },
      primary: { x: '6%', y: '40%', w: '88%', h: '23%', delay: '0.16s' },
      secondary: { x: '16%', y: '68%', w: '68%', h: '14%', delay: '0.38s' }
    }
  };

  return (orientation === 'vertical' ? vertical : landscape)[layout];
}

function renderMedia(asset, className, objectPosition) {
  if (!asset) return '';
  const shared = `class="${className}" style="object-position:${escapeHtml(objectPosition || '50% 50%')}"`;
  if (asset.type === 'video') {
    return `<video ${shared} src="${escapeHtml(asset.url)}" preload="auto" muted playsinline loop></video>`;
  }
  return `<img ${shared} src="${escapeHtml(asset.url)}" alt="" loading="eager" />`;
}

function renderChips(chips = []) {
  if (!chips.length) return '';
  return `<div class="chips anim anim-chips">${chips
    .map((chip, index) => `<span class="chip" style="--chip-delay:${(0.08 * index).toFixed(2)}s">${escapeHtml(chip)}</span>`)
    .join('')}</div>`;
}

function renderCard(card, frame, asset, orientation, index) {
  if (!card || !frame || !asset) return '';
  const objectPosition =
    orientation === 'vertical'
      ? card.objectPositionVertical || card.objectPositionLandscape || '50% 50%'
      : card.objectPositionLandscape || card.objectPositionVertical || '50% 50%';

  return `
    <section
      class="card card-${escapeHtml(card.role || `slot-${index + 1}`)} anim anim-card"
      style="--card-x:${frame.x};--card-y:${frame.y};--card-w:${frame.w};--card-h:${frame.h};--card-delay:${frame.delay || '0s'}"
    >
      <div class="card-shell">
        <div class="card-glow"></div>
        <div class="card-label">${escapeHtml(card.label || asset.label || '')}</div>
        ${renderMedia(asset, 'card-media', objectPosition)}
        <div class="card-sheen"></div>
      </div>
    </section>
  `;
}

export function buildSceneHtml({ manifest, shot, orientation, assetSources, durationSec }) {
  const palette = manifest.brand.palette;
  const frame = getLayoutFrame(shot.layout, orientation);
  const shield = '/images/shield-logo.png';
  const ghostWord = splitGhostWord(shot.kicker, manifest.brand.productName);
  const primaryCard = shot.cards?.find((card) => card.role === 'primary') || shot.cards?.[0];
  const backgroundAsset = primaryCard ? assetSources[primaryCard.assetId] : null;
  const cardsHtml = (shot.cards || [])
    .map((card, index) => {
      const slot = frame?.[card.role] || frame?.primary;
      return renderCard(card, slot, assetSources[card.assetId], orientation, index);
    })
    .join('');

  const bodyHtml = shot.body ? `<p class="body anim anim-body">${escapeHtml(shot.body)}</p>` : '';
  const captionHtml = shot.caption ? `<p class="caption anim anim-caption">${escapeHtml(shot.caption)}</p>` : '';
  const ctaHtml = shot.cta ? `<div class="cta anim anim-cta">${escapeHtml(shot.cta)}</div>` : '';
  const backdropHtml = backgroundAsset
    ? `
      <div class="backdrop-frame">
        ${renderMedia(backgroundAsset, 'backdrop-media', primaryCard?.objectPositionLandscape || '50% 50%')}
      </div>
    `
    : '';

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(shot.title)}</title>
    <style>
      @font-face {
        font-family: 'HarmonyOS Sans';
        src: url('/fonts/HarmonyOS_Sans_Regular.ttf') format('truetype');
        font-display: swap;
      }

      :root {
        --ink: ${palette.ink};
        --surface: ${palette.surface};
        --surface-soft: ${palette.surfaceSoft};
        --cyan: ${palette.cyan};
        --mint: ${palette.mint};
        --blue: ${palette.blue};
        --white: ${palette.white};
        --text-soft: ${palette.textSoft};
        --scene-duration: ${durationSec}s;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background:
          radial-gradient(circle at 14% 18%, rgba(53, 242, 255, 0.28), transparent 22%),
          radial-gradient(circle at 84% 14%, rgba(91, 140, 255, 0.24), transparent 20%),
          radial-gradient(circle at 72% 78%, rgba(122, 255, 202, 0.18), transparent 24%),
          linear-gradient(138deg, #02050d 0%, #041122 28%, #071935 58%, #030915 100%);
        color: var(--white);
        font-family: 'HarmonyOS Sans', 'Microsoft YaHei UI', sans-serif;
      }

      body::before,
      body::after {
        content: '';
        position: absolute;
        inset: auto;
        width: 44vw;
        height: 44vw;
        border-radius: 999px;
        filter: blur(88px);
        opacity: 0.82;
        pointer-events: none;
      }

      body::before {
        left: -12vw;
        top: -12vw;
        background: rgba(53, 242, 255, 0.16);
        animation: drift 16s ease-in-out infinite alternate;
      }

      body::after {
        right: -10vw;
        bottom: -14vw;
        background: rgba(91, 140, 255, 0.16);
        animation: drift 19s ease-in-out infinite alternate-reverse;
      }

      .scene {
        position: relative;
        width: 100%;
        height: 100%;
        isolation: isolate;
        overflow: hidden;
      }

      .grid {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
        background-size: 88px 88px;
        mask-image: radial-gradient(circle at center, rgba(0, 0, 0, 0.7), transparent 86%);
        opacity: 0.24;
      }

      .backdrop-frame {
        position: absolute;
        inset: 0;
        opacity: 0.22;
        filter: saturate(1.25);
      }

      .backdrop-media {
        width: 100%;
        height: 100%;
        object-fit: cover;
        filter: blur(30px) saturate(1.32) brightness(1.08);
        --media-scale-start: 1.18;
        --media-scale-end: 1.24;
        transform: scale(1.18);
      }

      .shield {
        position: absolute;
        right: -8%;
        top: 10%;
        width: 42%;
        opacity: 0.045;
        filter: grayscale(1) brightness(1.8) blur(6px);
        mix-blend-mode: screen;
        animation: floaty 8s ease-in-out infinite alternate;
      }

      .ghost {
        position: absolute;
        left: ${orientation === 'vertical' ? '6%' : '4%'};
        top: ${orientation === 'vertical' ? '30%' : '58%'};
        font-size: ${orientation === 'vertical' ? '108px' : '140px'};
        line-height: 0.9;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.065);
        text-transform: uppercase;
        filter: blur(0.2px);
        white-space: nowrap;
      }

      .brand-mark {
        position: absolute;
        left: ${orientation === 'vertical' ? '7%' : '6.5%'};
        top: ${orientation === 'vertical' ? '6%' : '7%'};
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 4;
      }

      .brand-icon {
        width: ${orientation === 'vertical' ? '40px' : '44px'};
        height: ${orientation === 'vertical' ? '40px' : '44px'};
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.03));
        box-shadow:
          0 10px 24px rgba(53, 242, 255, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .brand-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .brand-name {
        font-size: ${orientation === 'vertical' ? '22px' : '24px'};
        font-weight: 700;
        letter-spacing: 0.02em;
        line-height: 1;
      }

      .brand-caption {
        color: rgba(174, 191, 208, 0.82);
        font-size: ${orientation === 'vertical' ? '11px' : '12px'};
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .content {
        position: absolute;
        left: ${frame?.content?.x || '8%'};
        top: ${frame?.content?.y || '14%'};
        width: ${frame?.content?.w || '34%'};
        z-index: 3;
      }

      .kicker {
        margin: 0 0 14px;
        color: rgba(174, 191, 208, 0.88);
        font-size: ${orientation === 'vertical' ? '18px' : '17px'};
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .title {
        margin: 0;
        max-width: 100%;
        font-size: ${orientation === 'vertical' ? '56px' : '66px'};
        line-height: 1.02;
        letter-spacing: -0.03em;
        text-wrap: balance;
        text-shadow: 0 10px 36px rgba(53, 242, 255, 0.1);
      }

      .body {
        margin: 22px 0 0;
        max-width: ${orientation === 'vertical' ? '90%' : '88%'};
        color: rgba(245, 251, 255, 0.94);
        font-size: ${orientation === 'vertical' ? '24px' : '24px'};
        line-height: 1.45;
      }

      .caption {
        margin: 18px 0 0;
        max-width: ${orientation === 'vertical' ? '88%' : '82%'};
        color: rgba(193, 211, 232, 0.88);
        font-size: ${orientation === 'vertical' ? '17px' : '16px'};
        line-height: 1.5;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 26px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        padding: 10px 15px;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.05));
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(247, 251, 255, 0.92);
        font-size: ${orientation === 'vertical' ? '16px' : '15px'};
        backdrop-filter: blur(16px);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      }

      .cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 250px;
        margin-top: 30px;
        padding: 16px 26px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(53, 242, 255, 0.22), rgba(91, 140, 255, 0.28));
        border: 1px solid rgba(53, 242, 255, 0.26);
        color: var(--white);
        font-size: ${orientation === 'vertical' ? '21px' : '22px'};
        box-shadow: 0 24px 72px rgba(53, 242, 255, 0.18);
      }

      .card {
        position: absolute;
        left: var(--card-x);
        top: var(--card-y);
        width: var(--card-w);
        height: var(--card-h);
        z-index: 3;
      }

      .card-shell {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: ${orientation === 'vertical' ? '30px' : '34px'};
        background:
          linear-gradient(180deg, rgba(15, 31, 56, 0.6), rgba(3, 10, 22, 0.82)),
          rgba(6, 17, 33, 0.84);
        border: 1px solid rgba(255, 255, 255, 0.11);
        box-shadow:
          0 34px 90px rgba(0, 0, 0, 0.52),
          0 0 0 1px rgba(53, 242, 255, 0.05),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }

      .card-glow {
        position: absolute;
        inset: -18%;
        background:
          radial-gradient(circle at 20% 18%, rgba(53, 242, 255, 0.26), transparent 34%),
          radial-gradient(circle at 76% 24%, rgba(91, 140, 255, 0.22), transparent 28%);
        filter: blur(36px);
        opacity: 1;
        pointer-events: none;
        z-index: 1;
      }

      .card-label {
        position: absolute;
        left: 18px;
        top: 18px;
        z-index: 4;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(4, 11, 22, 0.76);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(247, 251, 255, 0.84);
        font-size: ${orientation === 'vertical' ? '14px' : '13px'};
        letter-spacing: 0.06em;
        text-transform: uppercase;
        backdrop-filter: blur(14px);
      }

      .card-media {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        filter: saturate(1.2) contrast(1.08) brightness(1.03);
        --media-scale-start: 1.04;
        --media-scale-end: 1.08;
        transform: scale(1.04);
        z-index: 2;
      }

      .card-sheen {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(115deg, rgba(255, 255, 255, 0.2), transparent 14%, transparent 52%, rgba(255, 255, 255, 0.1)),
          linear-gradient(180deg, transparent, rgba(4, 11, 22, 0.14));
        mix-blend-mode: screen;
        z-index: 3;
        pointer-events: none;
      }

      .anim {
        animation-play-state: paused;
      }

      .is-live .anim {
        animation-play-state: running;
      }

      .is-live .card-media,
      .is-live .backdrop-media {
        animation: mediaDrift 11s ease-in-out infinite alternate;
      }

      .anim-title {
        animation: titleIn calc(var(--scene-duration) * 0.42) cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }

      .anim-kicker {
        animation: fadeUp 700ms ease both;
      }

      .anim-body {
        animation: fadeUp 860ms ease both;
        animation-delay: 0.18s;
      }

      .anim-caption {
        animation: fadeUp 920ms ease both;
        animation-delay: 0.26s;
      }

      .anim-card {
        animation: cardIn 1100ms cubic-bezier(0.18, 0.84, 0.18, 1) both, floaty 9s ease-in-out infinite alternate;
        animation-delay: var(--card-delay), calc(var(--card-delay) + 0.8s);
      }

      .anim-chips {
        animation: fadeUp 900ms ease both;
        animation-delay: 0.32s;
      }

      .is-live .chip {
        animation: chipIn 700ms ease both;
        animation-delay: var(--chip-delay);
      }

      .anim-cta {
        animation: fadeUp 900ms ease both;
        animation-delay: 0.38s;
      }

      @keyframes drift {
        from {
          transform: translate3d(0, 0, 0) scale(1);
        }
        to {
          transform: translate3d(4vw, 2.6vw, 0) scale(1.1);
        }
      }

      @keyframes mediaDrift {
        from {
          transform: scale(var(--media-scale-start, 1.04)) translate3d(0, 0, 0);
        }
        to {
          transform: scale(var(--media-scale-end, 1.08)) translate3d(-1.4%, -0.8%, 0);
        }
      }

      @keyframes titleIn {
        from {
          transform: translate3d(0, 22px, 0);
          opacity: 0;
          filter: blur(9px);
        }
        to {
          transform: translate3d(0, 0, 0);
          opacity: 1;
          filter: blur(0);
        }
      }

      @keyframes fadeUp {
        from {
          transform: translate3d(0, 18px, 0);
          opacity: 0;
        }
        to {
          transform: translate3d(0, 0, 0);
          opacity: 1;
        }
      }

      @keyframes cardIn {
        from {
          opacity: 0;
          transform: translate3d(0, 26px, 0) scale(0.96);
          clip-path: inset(0 0 100% 0 round 34px);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          clip-path: inset(0 0 0 0 round 34px);
        }
      }

      @keyframes floaty {
        from {
          transform: translate3d(0, 0, 0);
        }
        to {
          transform: translate3d(0, -10px, 0);
        }
      }

      @keyframes chipIn {
        from {
          transform: translate3d(0, 12px, 0);
          opacity: 0;
        }
        to {
          transform: translate3d(0, 0, 0);
          opacity: 1;
        }
      }
    </style>
  </head>
  <body>
    <main class="scene">
      <div class="grid"></div>
      ${backdropHtml}
      <img class="shield" src="${shield}" alt="" />
      <div class="brand-mark">
        <img class="brand-icon" src="${shield}" alt="" />
        <div class="brand-meta">
          <div class="brand-name">${escapeHtml(manifest.brand.productName)}</div>
          <div class="brand-caption">Security Control Loop</div>
        </div>
      </div>
      <div class="ghost">${escapeHtml(ghostWord)}</div>
      <section class="content">
        <p class="kicker anim anim-kicker">${escapeHtml(shot.kicker || manifest.brand.productName)}</p>
        <h1 class="title anim anim-title">${escapeHtml(shot.title)}</h1>
        ${bodyHtml}
        ${renderChips(shot.chips)}
        ${captionHtml}
        ${ctaHtml}
      </section>
      ${cardsHtml}
    </main>
    <script>
      (() => {
        const media = Array.from(document.querySelectorAll('video, img'));
        const waitForMedia = media.length
          ? Promise.all(media.map((node) => new Promise((resolve) => {
              const done = () => resolve();
              if (node.tagName === 'VIDEO') {
                if (node.readyState >= 2) {
                  resolve();
                  return;
                }
                node.addEventListener('loadeddata', done, { once: true });
                node.addEventListener('error', done, { once: true });
                window.setTimeout(done, 1800);
                return;
              }
              if (node.complete) {
                resolve();
                return;
              }
              node.addEventListener('load', done, { once: true });
              node.addEventListener('error', done, { once: true });
              window.setTimeout(done, 1800);
            })))
          : Promise.resolve();

        window.__sceneReady = false;
        window.startScene = () => {
          document.body.classList.add('is-live');
          document.querySelectorAll('video').forEach((node) => {
            try {
              node.currentTime = 0;
            } catch (error) {
              // ignored
            }
            node.play().catch(() => {});
          });
        };

        waitForMedia.then(() => {
          window.__sceneReady = true;
        });

        window.setTimeout(() => {
          window.__sceneReady = true;
        }, 2000);
      })();
    </script>
  </body>
</html>
`;
}
