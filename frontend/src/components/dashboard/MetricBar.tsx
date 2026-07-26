import { motion, Variants } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const toneClasses: Record<Tone, string> = {
    primary: 'bg-primary/10 text-primary border-primary/15',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    neutral: 'bg-muted/60 text-muted-foreground border-border',
};

const fadeUpVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
};

export interface MetricItem {
    icon: LucideIcon;
    label: string;
    value: string | number;
    trend?: number;
    tone: Tone;
    /** Which trend direction is "good" (green). Defaults to 'up'. Set 'down' for metrics where rising is bad (threats, high-risk findings). */
    goodDirection?: 'up' | 'down';
}

export const MetricBar = ({ items }: { items: MetricItem[] }) => (
    <motion.div
        variants={fadeUpVariants}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
    >
        {items.map((item, i) => (
            <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-sm hover:border-primary/20"
            >
                <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${toneClasses[item.tone]}`}
                >
                    <item.icon size={16} />
                </div>
                <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{item.label}</p>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold tracking-tight text-foreground">
                            {item.value}
                        </span>
                        {item.trend !== undefined && item.trend !== 0 && (() => {
                            const rising = item.trend > 0;
                            const goodDir = item.goodDirection ?? 'up';
                            const isGood = goodDir === 'up' ? rising : !rising;
                            return (
                                <span className={`text-xs font-medium ${isGood ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {rising ? '↑' : '↓'}
                                    {Math.abs(item.trend)}%
                                </span>
                            );
                        })()}
                    </div>
                </div>
            </div>
        ))}
    </motion.div>
);
