import { motion, Variants } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const toneStroke: Record<Tone, string> = {
    primary: 'stroke-primary',
    success: 'stroke-emerald-500',
    warning: 'stroke-amber-500',
    danger: 'stroke-rose-500',
    neutral: 'stroke-muted-foreground',
};

const fadeUpVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
};

export interface GaugeItem {
    icon: LucideIcon;
    label: string;
    value: number | null;
    tone: Tone;
    /**
     * 'percent' (default) renders a 0–100 ring.
     * 'value' renders a magnitude that has no fixed ceiling (e.g. MB/s throughput)
     * as a numeric tile — a ring would misrepresent it as a percentage.
     */
    kind?: 'percent' | 'value';
    /** Unit label for kind='value' (e.g. 'MB/s'). Ignored for percent gauges. */
    unit?: string;
}

const toneText: Record<Tone, string> = {
    primary: 'text-primary',
    success: 'text-emerald-500',
    warning: 'text-amber-500',
    danger: 'text-rose-500',
    neutral: 'text-muted-foreground',
};

const GaugeRing = ({ value, tone }: { value: number; tone: Tone }) => {
    const circumference = 2 * Math.PI * 15.9155;
    const clamped = Math.max(0, Math.min(100, value));
    const offset = circumference - (clamped / 100) * circumference;

    return (
        <svg viewBox="0 0 36 36" className="h-14 w-14">
            <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                className="stroke-muted"
                strokeWidth="3"
                strokeLinecap="round"
            />
            <motion.path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                className={toneStroke[tone]}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
            />
        </svg>
    );
};

export const SystemGauges = ({ gauges }: { gauges: GaugeItem[] }) => (
    <motion.div variants={fadeUpVariants} className="grid grid-cols-2 gap-x-6 gap-y-5">
        {gauges.map((g, i) => (
            <div
                key={i}
                className="flex min-h-[112px] flex-col items-center justify-center gap-2"
            >
                {g.kind === 'value' ? (
                    <div className="flex h-14 flex-col items-center justify-center">
                        <span className={`text-2xl font-semibold tabular-nums ${toneText[g.tone]}`}>
                            {g.value === null ? '--' : g.value.toFixed(2)}
                        </span>
                        {g.unit && g.value !== null && <span className="text-[11px] font-medium text-muted-foreground">{g.unit}</span>}
                    </div>
                ) : g.value === null ? (
                    <div className="flex h-[82px] flex-col items-center justify-center gap-2 text-muted-foreground">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-border text-lg font-semibold">--</div>
                    </div>
                ) : (
                    <>
                        <GaugeRing value={g.value} tone={g.tone} />
                        <span className="text-lg font-semibold tabular-nums text-foreground">{g.value.toFixed(1)}%</span>
                    </>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <g.icon size={12} />
                    <span>{g.label}</span>
                </div>
            </div>
        ))}
    </motion.div>
);
