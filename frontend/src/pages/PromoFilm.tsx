import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, RadioTower, ScrollText, Shield, Sparkles, Waypoints } from 'lucide-react';

type Accent = 'blue' | 'mint' | 'cyan' | 'amber' | 'ink';

type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

type FocusPoint = {
    x: number;
    y: number;
    zoom?: number;
};

type ObjectCard = {
    assetId?: string;
    label: string;
    title: string;
    copy: string;
    variant: 'panel' | 'pill' | 'stack';
    accent: Accent;
    startSec: number;
    endSec: number;
    clipOffsetSec?: number;
    landscape: Rect;
    vertical: Rect;
    focusLandscape?: FocusPoint;
    focusVertical?: FocusPoint;
};

type SceneDefinition = {
    id: string;
    layout: 'intro' | 'stage-left' | 'stage-right' | 'outro';
    durationSec: number;
    kicker: string;
    ghostWord?: string;
    backgroundPreset: string;
    headline: string;
    subcopy: string;
    caption: string;
    motionPreset?: string;
    transitionIn?: string;
    transitionOut?: string;
    objectCards: ObjectCard[];
};

type SceneRuntime = SceneDefinition & {
    index: number;
    startSec: number;
    endSec: number;
    startMs: number;
    endMs: number;
    durationMs: number;
};

type RuntimeAsset = {
    id: string;
    url: string;
    type: 'video' | 'image';
    durationSec: number;
    fallback: boolean;
};

type RuntimeManifest = {
    id: string;
    title: string;
    theme: string;
    brand: {
        productName: string;
        palette?: Record<string, string>;
    };
    scenes: SceneDefinition[];
};

type RuntimePayload = {
    manifest: RuntimeManifest;
    assets: Record<string, RuntimeAsset>;
};

type CaptureHandle = {
    ready: boolean;
    seek: (ms: number) => Promise<void>;
};

declare global {
    interface Window {
        __PROMO_FILM__?: CaptureHandle;
        __PROMO_FILM_DATA__?: RuntimePayload;
    }
}

const DEFAULT_SCENES: SceneDefinition[] = [
    {
        id: 'intro',
        layout: 'intro',
        durationSec: 8,
        kicker: 'AetherGuard',
        ghostWord: 'AETHER',
        backgroundPreset: 'dawn',
        headline: '让安全先被看见',
        subcopy: '把风险、判断、证据和边缘动作，收进同一条控制回路。',
        caption: '让安全先被看见。把风险、判断、证据和边缘动作，收进同一条控制回路。',
        objectCards: []
    },
    {
        id: 'risk',
        layout: 'stage-left',
        durationSec: 10,
        kicker: 'Risk',
        ghostWord: 'RISK',
        backgroundPreset: 'signal',
        headline: '先看见真正的风险',
        subcopy: '把最值得关注的信号，推到视线中心。',
        caption: '先看见真正的风险。把最值得关注的信号，推到视线中心。',
        objectCards: [
            {
                assetId: 'dashboard-signal',
                label: 'Risk',
                title: 'Threat pressure',
                copy: 'Live control signal',
                variant: 'panel',
                accent: 'cyan',
                startSec: 1.4,
                endSec: 8.6,
                landscape: { x: 0.53, y: 0.16, w: 0.34, h: 0.48 },
                vertical: { x: 0.08, y: 0.48, w: 0.84, h: 0.24 },
                focusLandscape: { x: 0.68, y: 0.22, zoom: 1.72 },
                focusVertical: { x: 0.68, y: 0.2, zoom: 1.86 }
            }
        ]
    },
    {
        id: 'decision',
        layout: 'stage-left',
        durationSec: 12,
        kicker: 'Decision',
        ghostWord: 'DECISION',
        backgroundPreset: 'decision',
        headline: '不是命中规则，是做出判断',
        subcopy: '噪音先被压下，真正需要动作的事件才被推出。',
        caption: '不是命中规则，是做出判断。噪音先被压下，真正需要动作的事件才被推出。',
        objectCards: [
            {
                assetId: 'alerts-priority',
                label: 'Signal',
                title: 'Priority alert',
                copy: 'Noise reduced',
                variant: 'pill',
                accent: 'amber',
                startSec: 1.4,
                endSec: 6.8,
                landscape: { x: 0.54, y: 0.19, w: 0.28, h: 0.15 },
                vertical: { x: 0.08, y: 0.45, w: 0.84, h: 0.1 },
                focusLandscape: { x: 0.58, y: 0.2, zoom: 1.7 },
                focusVertical: { x: 0.58, y: 0.18, zoom: 1.92 }
            },
            {
                assetId: 'agent-monitor-focus',
                label: 'Decision',
                title: 'Agent consensus',
                copy: 'Seven layers align',
                variant: 'panel',
                accent: 'blue',
                startSec: 4.2,
                endSec: 10.2,
                landscape: { x: 0.52, y: 0.39, w: 0.36, h: 0.3 },
                vertical: { x: 0.08, y: 0.62, w: 0.84, h: 0.2 },
                focusLandscape: { x: 0.62, y: 0.2, zoom: 1.82 },
                focusVertical: { x: 0.62, y: 0.2, zoom: 1.98 }
            }
        ]
    },
    {
        id: 'record',
        layout: 'stage-right',
        durationSec: 12,
        kicker: 'Record',
        ghostWord: 'RECORD',
        backgroundPreset: 'trace',
        headline: '每一次动作，都留下证据',
        subcopy: '记录、时间线和复盘线索，被压缩成一条可追溯链路。',
        caption: '每一次动作，都留下证据。记录、时间线和复盘线索，被压缩成一条可追溯链路。',
        objectCards: [
            {
                assetId: 'history-trace',
                label: 'Record',
                title: 'Audit trail',
                copy: 'Replayable evidence',
                variant: 'stack',
                accent: 'mint',
                startSec: 1.6,
                endSec: 9.6,
                landscape: { x: 0.11, y: 0.29, w: 0.36, h: 0.3 },
                vertical: { x: 0.08, y: 0.52, w: 0.84, h: 0.21 },
                focusLandscape: { x: 0.56, y: 0.21, zoom: 1.82 },
                focusVertical: { x: 0.58, y: 0.2, zoom: 1.96 }
            }
        ]
    },
    {
        id: 'edge',
        layout: 'stage-left',
        durationSec: 10,
        kicker: 'Edge',
        ghostWord: 'EDGE',
        backgroundPreset: 'edge',
        headline: '从控制台，延伸到边缘',
        subcopy: '命令推出去之后，确认信号会从设备一侧回来。',
        caption: '从控制台，延伸到边缘。命令推出去之后，确认信号会从设备一侧回来。',
        objectCards: [
            {
                assetId: 'deployment-command',
                label: 'Push',
                title: 'Deploy command',
                copy: 'One move',
                variant: 'pill',
                accent: 'blue',
                startSec: 1.2,
                endSec: 6.8,
                landscape: { x: 0.13, y: 0.58, w: 0.37, h: 0.14 },
                vertical: { x: 0.08, y: 0.5, w: 0.84, h: 0.1 },
                focusLandscape: { x: 0.6, y: 0.22, zoom: 1.86 },
                focusVertical: { x: 0.6, y: 0.2, zoom: 2.0 }
            },
            {
                assetId: 'devices-edge',
                label: 'Edge',
                title: 'Board confirm',
                copy: 'Physical handshake',
                variant: 'panel',
                accent: 'cyan',
                startSec: 4.4,
                endSec: 8.8,
                landscape: { x: 0.56, y: 0.25, w: 0.29, h: 0.25 },
                vertical: { x: 0.14, y: 0.68, w: 0.72, h: 0.16 },
                focusLandscape: { x: 0.58, y: 0.2, zoom: 1.8 },
                focusVertical: { x: 0.58, y: 0.18, zoom: 1.92 }
            }
        ]
    },
    {
        id: 'outro',
        layout: 'outro',
        durationSec: 8,
        kicker: 'AetherGuard',
        ghostWord: 'CONTROL',
        backgroundPreset: 'calm',
        headline: '看见风险，做出判断，留下证据，扩展到边缘',
        subcopy: 'A security control loop.',
        caption: '看见风险，做出判断，留下证据，扩展到边缘。',
        objectCards: []
    }
];

const DEFAULT_RUNTIME: RuntimePayload = {
    manifest: {
        id: 'aetherguard-demo-1min',
        title: 'AetherGuard Promo Film',
        theme: 'light',
        brand: {
            productName: 'AetherGuard'
        },
        scenes: DEFAULT_SCENES
    },
    assets: {}
};

const accentStyles: Record<Accent, { chip: string; glow: string; border: string; tint: string }> = {
    blue: {
        chip: '#3B82F6',
        glow: 'rgba(59, 130, 246, 0.18)',
        border: 'rgba(59, 130, 246, 0.25)',
        tint: 'rgba(59, 130, 246, 0.08)'
    },
    mint: {
        chip: '#10B981',
        glow: 'rgba(16, 185, 129, 0.18)',
        border: 'rgba(16, 185, 129, 0.24)',
        tint: 'rgba(16, 185, 129, 0.08)'
    },
    cyan: {
        chip: '#06B6D4',
        glow: 'rgba(6, 182, 212, 0.18)',
        border: 'rgba(6, 182, 212, 0.24)',
        tint: 'rgba(6, 182, 212, 0.08)'
    },
    amber: {
        chip: '#F59E0B',
        glow: 'rgba(245, 158, 11, 0.18)',
        border: 'rgba(245, 158, 11, 0.24)',
        tint: 'rgba(245, 158, 11, 0.08)'
    },
    ink: {
        chip: '#0F172A',
        glow: 'rgba(15, 23, 42, 0.12)',
        border: 'rgba(15, 23, 42, 0.16)',
        tint: 'rgba(15, 23, 42, 0.05)'
    }
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
    return clamp(value, 0, 1);
}

function mix(from: number, to: number, progress: number) {
    return from + (to - from) * progress;
}

function easeOutCubic(value: number) {
    return 1 - Math.pow(1 - clamp01(value), 3);
}

function computeScenes(sourceScenes: SceneDefinition[]): SceneRuntime[] {
    let cursor = 0;
    return sourceScenes.map((scene, index) => {
        const startSec = cursor;
        const endSec = startSec + scene.durationSec;
        cursor = endSec;
        return {
            ...scene,
            index,
            startSec,
            endSec,
            startMs: startSec * 1000,
            endMs: endSec * 1000,
            durationMs: scene.durationSec * 1000
        };
    });
}

function getScenePhase(timeMs: number, scene: SceneRuntime) {
    const localMs = timeMs - scene.startMs;
    const enter = easeOutCubic(localMs / 900);
    const exit = easeOutCubic((scene.endMs - timeMs) / 900);
    const opacity = clamp01(Math.min(enter, exit));
    return {
        opacity,
        y: mix(18, 0, opacity),
        scale: mix(0.985, 1, opacity)
    };
}

function getCardPhase(timeMs: number, scene: SceneRuntime, card: ObjectCard) {
    const cardStartMs = scene.startMs + card.startSec * 1000;
    const cardEndMs = scene.startMs + card.endSec * 1000;
    const enter = easeOutCubic((timeMs - cardStartMs + 320) / 900);
    const exit = easeOutCubic((cardEndMs - timeMs + 240) / 840);
    const opacity = clamp01(Math.min(enter, exit));
    return {
        opacity,
        active: opacity > 0.001,
        y: mix(30, 0, opacity),
        scale: mix(0.95, 1, opacity)
    };
}

function getTextBoxStyle(layout: SceneRuntime['layout'], isVertical: boolean) {
    if (layout === 'intro' || layout === 'outro') {
        return isVertical
            ? { left: '8%', top: '16%', width: '84%', textAlign: 'left' as const }
            : { left: '8%', top: '18%', width: '54%', textAlign: 'left' as const };
    }

    if (isVertical) {
        return { left: '8%', top: '12%', width: '84%', textAlign: 'left' as const };
    }

    if (layout === 'stage-right') {
        return { left: '57%', top: '18%', width: '31%', textAlign: 'left' as const };
    }

    return { left: '8%', top: '18%', width: '34%', textAlign: 'left' as const };
}

function getCardRect(card: ObjectCard, isVertical: boolean) {
    return isVertical ? card.vertical : card.landscape;
}

function getCardFocus(card: ObjectCard, isVertical: boolean) {
    return (isVertical ? card.focusVertical : card.focusLandscape) || { x: 0.5, y: 0.5, zoom: 1.65 };
}

function PlaceholderArt({ accent }: { accent: Accent }) {
    const style = accentStyles[accent];
    return (
        <div
            className="h-full w-full"
            style={{
                background: `radial-gradient(circle at 25% 20%, ${style.glow}, transparent 38%), linear-gradient(135deg, rgba(255,255,255,0.9), rgba(241,245,249,0.98))`
            }}
        >
            <div className="flex h-full flex-col justify-between p-5 text-slate-600">
                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: style.chip }} />
                    <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Signal</span>
                </div>
                <div className="space-y-2">
                    <div className="h-2 w-3/4 rounded-full bg-slate-200" />
                    <div className="h-2 w-full rounded-full bg-slate-100" />
                    <div className="h-24 rounded-[20px] border border-white/80 bg-white/70" />
                </div>
            </div>
        </div>
    );
}

function DecorativeHalo({ preset, timeMs, isVertical }: { preset: string; timeMs: number; isVertical: boolean }) {
    const float = Math.sin(timeMs / 2600);
    const drift = Math.cos(timeMs / 3100);
    const leftOrbStyle = {
        transform: `translate3d(${mix(-12, 18, (float + 1) / 2)}px, ${mix(-8, 20, (drift + 1) / 2)}px, 0)`,
        opacity: preset === 'calm' ? 0.45 : 0.65
    };
    const rightOrbStyle = {
        transform: `translate3d(${mix(18, -14, (drift + 1) / 2)}px, ${mix(18, -10, (float + 1) / 2)}px, 0)`,
        opacity: preset === 'signal' ? 0.75 : 0.55
    };

    return (
        <>
            <div
                className="absolute rounded-full blur-3xl"
                style={{
                    ...leftOrbStyle,
                    left: isVertical ? '8%' : '10%',
                    top: isVertical ? '10%' : '14%',
                    width: isVertical ? '48vw' : '30vw',
                    height: isVertical ? '48vw' : '30vw',
                    background: 'radial-gradient(circle, rgba(56, 189, 248, 0.22), rgba(56, 189, 248, 0.05) 45%, transparent 72%)'
                }}
            />
            <div
                className="absolute rounded-full blur-3xl"
                style={{
                    ...rightOrbStyle,
                    right: isVertical ? '4%' : '10%',
                    bottom: isVertical ? '12%' : '12%',
                    width: isVertical ? '58vw' : '34vw',
                    height: isVertical ? '58vw' : '34vw',
                    background: 'radial-gradient(circle, rgba(16, 185, 129, 0.16), rgba(59, 130, 246, 0.1) 44%, transparent 72%)'
                }}
            />
        </>
    );
}

export default function PromoFilm() {
    const captureMode = useMemo(() => {
        if (typeof window === 'undefined') return false;
        return new URLSearchParams(window.location.search).get('capture') === '1';
    }, []);

    const runtime = useMemo<RuntimePayload>(() => {
        if (typeof window === 'undefined') return DEFAULT_RUNTIME;
        return window.__PROMO_FILM_DATA__ || DEFAULT_RUNTIME;
    }, []);

    const scenes = useMemo(() => {
        const sourceScenes = runtime.manifest.scenes?.length ? runtime.manifest.scenes : DEFAULT_SCENES;
        return computeScenes(sourceScenes);
    }, [runtime]);

    const totalDurationMs = scenes.length > 0 ? scenes[scenes.length - 1].endMs : 60000;
    const [virtualTimeMs, setVirtualTimeMs] = useState(0);
    const [loadedAssets, setLoadedAssets] = useState<Record<string, boolean>>({});
    const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

    const isVertical = typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false;
    const assetIds = useMemo(() => Object.keys(runtime.assets || {}), [runtime]);
    const allAssetsReady = assetIds.every((assetId) => {
        const asset = runtime.assets[assetId];
        if (!asset || asset.type !== 'video') return true;
        return Boolean(loadedAssets[assetId]);
    });

    useEffect(() => {
        const root = document.documentElement;
        const previousClass = root.className;
        const previousOverflow = document.body.style.overflow;
        root.classList.remove('dark');
        if (!root.classList.contains('light')) {
            root.classList.add('light');
        }
        document.body.style.overflow = 'hidden';

        return () => {
            root.className = previousClass;
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    useEffect(() => {
        if (captureMode) return undefined;

        let frameId = 0;
        let start: number | null = null;
        const loop = (timestamp: number) => {
            if (start === null) start = timestamp;
            const elapsed = (timestamp - start) % totalDurationMs;
            setVirtualTimeMs(elapsed);
            frameId = window.requestAnimationFrame(loop);
        };

        frameId = window.requestAnimationFrame(loop);
        return () => window.cancelAnimationFrame(frameId);
    }, [captureMode, totalDurationMs]);

    useEffect(() => {
        const seek = async (ms: number) => {
            const clamped = clamp(ms, 0, totalDurationMs);
            setVirtualTimeMs(clamped);
            await new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => resolve());
                });
            });
        };

        window.__PROMO_FILM__ = {
            ready: captureMode ? allAssetsReady : true,
            seek
        };

        return () => {
            delete window.__PROMO_FILM__;
        };
    }, [allAssetsReady, captureMode, totalDurationMs]);

    useEffect(() => {
        const activeCards = new Map<string, { card: ObjectCard; scene: SceneRuntime }>();

        for (const scene of scenes) {
            for (const card of scene.objectCards) {
                if (!card.assetId) continue;
                const phase = getCardPhase(virtualTimeMs, scene, card);
                if (!phase.active) continue;
                activeCards.set(card.assetId, { card, scene });
            }
        }

        for (const [assetId, element] of Object.entries(videoRefs.current)) {
            if (!element) continue;
            const asset = runtime.assets[assetId];
            if (!asset || asset.type !== 'video' || element.readyState < 1) continue;

            const active = activeCards.get(assetId);
            if (!active) {
                if (!element.paused) element.pause();
                continue;
            }

            const { card, scene } = active;
            const cardStartMs = scene.startMs + card.startSec * 1000;
            const cardDurationSec = Math.max(0.1, card.endSec - card.startSec);
            const playableDuration = Math.max(0.08, asset.durationSec - (card.clipOffsetSec || 0) - 0.04);
            const progressWithinCard = clamp01((virtualTimeMs - cardStartMs) / (cardDurationSec * 1000));
            const targetTime = (card.clipOffsetSec || 0) + playableDuration * progressWithinCard;

            if (Math.abs(element.currentTime - targetTime) > 1 / 120) {
                element.currentTime = targetTime;
            }

            if (!element.paused) {
                element.pause();
            }
        }
    }, [runtime.assets, scenes, virtualTimeMs]);

    const activeSceneIndex = scenes.findIndex((scene) => virtualTimeMs >= scene.startMs && virtualTimeMs < scene.endMs);
    const productName = runtime.manifest.brand.productName || 'AetherGuard';

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-[#F3F5F7] text-slate-950">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F5F7_42%,#EEF2F7_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.9),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(226,232,240,0.74),transparent_38%)]" />
            <div
                className="absolute inset-0 opacity-[0.045]"
                style={{
                    backgroundImage: 'linear-gradient(rgba(15,23,42,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.14) 1px, transparent 1px)',
                    backgroundSize: '84px 84px'
                }}
            />

            <DecorativeHalo
                preset={scenes[Math.max(0, activeSceneIndex)].backgroundPreset || 'dawn'}
                timeMs={virtualTimeMs}
                isVertical={isVertical}
            />

            <div className="relative flex h-full w-full flex-col px-[clamp(24px,3vw,56px)] py-[clamp(24px,3vh,42px)]">
                <div className="flex items-center justify-between">
                    <motion.div
                        animate={captureMode ? undefined : { y: [0, -3, 0] }}
                        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                        className="inline-flex items-center gap-3 rounded-full border border-white/75 bg-white/86 px-4 py-2 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.18)] backdrop-blur-xl"
                    >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm">
                            <Shield className="h-4 w-4" />
                        </span>
                        <div className="leading-tight">
                            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Promo Film</div>
                            <div className="text-sm font-semibold tracking-tight text-slate-900">{productName}</div>
                        </div>
                    </motion.div>

                    <div className="hidden items-center gap-2 md:flex">
                        {['Risk', 'Decision', 'Record', 'Edge'].map((chip) => (
                            <div
                                key={chip}
                                className="rounded-full border border-white/80 bg-white/78 px-3 py-1.5 text-[11px] font-medium tracking-[0.18em] text-slate-500 shadow-[0_14px_40px_-28px_rgba(15,23,42,0.18)]"
                            >
                                {chip}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="relative mt-6 flex-1 overflow-hidden rounded-[36px] border border-white/80 bg-white/55 shadow-[0_32px_90px_-42px_rgba(15,23,42,0.22)] backdrop-blur-xl">
                    {scenes.map((scene) => {
                        const phase = getScenePhase(virtualTimeMs, scene);
                        const textStyle = getTextBoxStyle(scene.layout, isVertical);

                        return (
                            <section
                                key={scene.id}
                                className="absolute inset-0"
                                style={{
                                    opacity: phase.opacity,
                                    transform: `translate3d(0, ${phase.y}px, 0) scale(${phase.scale})`,
                                    pointerEvents: 'none'
                                }}
                            >
                                <div className="absolute inset-0 rounded-[36px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.68),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.32),rgba(255,255,255,0.08))]" />
                                <div
                                    className="absolute font-semibold uppercase tracking-[0.24em] text-slate-200/90"
                                    style={{
                                        left: isVertical ? '8%' : '6%',
                                        bottom: isVertical ? '8%' : '6%',
                                        fontSize: isVertical ? '18vw' : '12vw',
                                        lineHeight: 0.92
                                    }}
                                >
                                    {scene.ghostWord || scene.kicker}
                                </div>

                                <div
                                    className="absolute z-10"
                                    style={{
                                        left: textStyle.left,
                                        top: textStyle.top,
                                        width: textStyle.width,
                                        textAlign: textStyle.textAlign
                                    }}
                                >
                                    <div className="mb-5 flex items-center gap-3">
                                        <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">{scene.kicker}</span>
                                    </div>
                                    <h1
                                        className="max-w-[14ch] font-semibold tracking-tight text-slate-950"
                                        style={{
                                            fontSize: isVertical ? 'clamp(2.2rem, 7vw, 4rem)' : 'clamp(2.6rem, 4.8vw, 5.5rem)',
                                            lineHeight: isVertical ? 1.02 : 0.98
                                        }}
                                    >
                                        {scene.headline}
                                    </h1>
                                    <p
                                        className="mt-5 max-w-[30rem] text-slate-500"
                                        style={{
                                            fontSize: isVertical ? 'clamp(0.96rem, 2.5vw, 1.12rem)' : 'clamp(1rem, 1.35vw, 1.18rem)',
                                            lineHeight: 1.65
                                        }}
                                    >
                                        {scene.subcopy}
                                    </p>

                                    {scene.layout === 'intro' ? (
                                        <div className="mt-8 flex flex-wrap gap-3">
                                            {[
                                                { label: 'Risk', icon: Sparkles },
                                                { label: 'Decision', icon: Waypoints },
                                                { label: 'Record', icon: ScrollText },
                                                { label: 'Edge', icon: RadioTower }
                                            ].map(({ label, icon: Icon }) => (
                                                <div
                                                    key={label}
                                                    className="inline-flex items-center gap-2 rounded-full border border-white/85 bg-white/86 px-4 py-2 text-sm font-medium text-slate-600 shadow-[0_18px_44px_-28px_rgba(15,23,42,0.18)]"
                                                >
                                                    <Icon className="h-4 w-4 text-sky-500" />
                                                    {label}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}

                                    {scene.layout === 'outro' ? (
                                        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.4)]">
                                            Control loop
                                            <ArrowRight className="h-4 w-4" />
                                        </div>
                                    ) : null}
                                </div>

                                {scene.objectCards.map((card, cardIndex) => {
                                    const cardPhase = getCardPhase(virtualTimeMs, scene, card);
                                    const rect = getCardRect(card, isVertical);
                                    const focus = getCardFocus(card, isVertical);
                                    const accent = accentStyles[card.accent] || accentStyles.blue;
                                    const asset = card.assetId ? runtime.assets[card.assetId] : undefined;
                                    const floatOffset = Math.sin((virtualTimeMs / 700) + cardIndex * 0.8) * 5;

                                    return (
                                        <div
                                            key={`${scene.id}-${card.label}-${cardIndex}`}
                                            className="absolute overflow-hidden rounded-[30px] border bg-white/92 shadow-[0_34px_90px_-38px_rgba(15,23,42,0.28)] backdrop-blur-xl"
                                            style={{
                                                left: `${rect.x * 100}%`,
                                                top: `${rect.y * 100}%`,
                                                width: `${rect.w * 100}%`,
                                                height: `${rect.h * 100}%`,
                                                borderColor: accent.border,
                                                boxShadow: `0 34px 90px -38px rgba(15, 23, 42, 0.28), 0 0 0 1px ${accent.border}`,
                                                transform: `translate3d(0, ${cardPhase.y + floatOffset}px, 0) scale(${cardPhase.scale})`,
                                                opacity: cardPhase.opacity
                                            }}
                                        >
                                            <div
                                                className="absolute inset-0"
                                                style={{
                                                    background: `linear-gradient(180deg, rgba(255,255,255,0.86), rgba(248,250,252,0.92) 32%, ${accent.tint})`
                                                }}
                                            />
                                            {card.variant === 'stack' ? (
                                                <>
                                                    <div className="absolute inset-x-[10%] top-[10%] h-[84%] rounded-[28px] border border-slate-200/70 bg-white/60 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.28)]" />
                                                    <div className="absolute inset-x-[5%] top-[5%] h-[90%] rounded-[28px] border border-slate-200/80 bg-white/72 shadow-[0_22px_60px_-38px_rgba(15,23,42,0.2)]" />
                                                </>
                                            ) : null}

                                            <div className="relative flex h-full flex-col">
                                                <div className="flex items-start justify-between px-5 pb-3 pt-5">
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <span
                                                                className="h-2.5 w-2.5 rounded-full"
                                                                style={{
                                                                    backgroundColor: accent.chip,
                                                                    boxShadow: `0 0 0 10px ${accent.glow}`
                                                                }}
                                                            />
                                                            <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-400">{card.label}</span>
                                                        </div>
                                                        <div className="text-[clamp(0.96rem,1.2vw,1.1rem)] font-semibold tracking-tight text-slate-900">{card.title}</div>
                                                        <div className="text-xs text-slate-500">{card.copy}</div>
                                                    </div>
                                                    {asset?.fallback ? (
                                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-amber-700">Still</span>
                                                    ) : (
                                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-700">Live</span>
                                                    )}
                                                </div>

                                                <div className={`relative flex-1 overflow-hidden ${card.variant === 'pill' ? 'mx-4 mb-4 min-h-0 rounded-[24px]' : 'mx-5 mb-5 min-h-0 rounded-[26px]'}`}>
                                                    <div className="absolute inset-0 overflow-hidden rounded-[inherit] border border-white/80 bg-slate-100">
                                                        {asset?.type === 'video' ? (
                                                            <video
                                                                ref={(node) => {
                                                                    if (card.assetId) {
                                                                        videoRefs.current[card.assetId] = node;
                                                                    }
                                                                }}
                                                                src={asset.url}
                                                                muted
                                                                playsInline
                                                                preload="auto"
                                                                className="absolute inset-0 h-full w-full"
                                                                style={{
                                                                    objectFit: 'cover',
                                                                    transformOrigin: '50% 50%',
                                                                    transform: `translate(${(0.5 - focus.x) * 100}%, ${(0.5 - focus.y) * 100}%) scale(${focus.zoom || 1.65})`
                                                                }}
                                                                onLoadedData={() => {
                                                                    if (!card.assetId) return;
                                                                    setLoadedAssets((current) => ({ ...current, [card.assetId as string]: true }));
                                                                }}
                                                            />
                                                        ) : asset?.type === 'image' ? (
                                                            <img
                                                                src={asset.url}
                                                                alt={card.title}
                                                                className="absolute inset-0 h-full w-full object-cover"
                                                                style={{
                                                                    transformOrigin: '50% 50%',
                                                                    transform: `translate(${(0.5 - focus.x) * 100}%, ${(0.5 - focus.y) * 100}%) scale(${focus.zoom || 1.65})`
                                                                }}
                                                            />
                                                        ) : (
                                                            <PlaceholderArt accent={card.accent} />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </section>
                        );
                    })}
                </div>

                <div className="mt-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {scenes.map((scene, index) => {
                            const isActive = index === activeSceneIndex;
                            return (
                                <div
                                    key={scene.id}
                                    className="h-2.5 rounded-full transition-all"
                                    style={{
                                        width: isActive ? 44 : 18,
                                        backgroundColor: isActive ? '#0F172A' : 'rgba(148, 163, 184, 0.32)'
                                    }}
                                />
                            );
                        })}
                    </div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400">
                        {captureMode ? 'Capture mode' : 'Preview loop'}
                    </div>
                </div>
            </div>
        </div>
    );
}
