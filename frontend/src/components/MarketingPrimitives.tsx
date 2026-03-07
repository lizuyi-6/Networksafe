import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const toneClasses: Record<Tone, string> = {
    primary: 'border-primary/15 bg-primary/10 text-primary',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    danger: 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    neutral: 'border-border bg-muted/40 text-muted-foreground',
};

export const MarketingSection = ({
    id,
    eyebrow,
    title,
    description,
    actions,
    children,
    className = '',
}: {
    id?: string;
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <section id={id} className={`mx-auto max-w-[1400px] px-6 py-20 md:py-24 ${className}`}>
        <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
                {eyebrow && (
                    <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {eyebrow}
                    </div>
                )}
                <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-5xl">{title}</h2>
                {description && <p className="text-base leading-7 text-muted-foreground md:text-lg">{description}</p>}
            </div>
            {actions && <div className="flex items-center gap-3">{actions}</div>}
        </div>
        {children}
    </section>
);

export const MarketingSurface = ({
    children,
    className = '',
}: {
    children: ReactNode;
    className?: string;
}) => <div className={`rounded-2xl border border-border bg-card shadow-sm ${className}`}>{children}</div>;

export const MarketingHeroPanel = ({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: ReactNode;
}) => (
    <MarketingSurface className="overflow-hidden">
        <div className="border-b border-border bg-muted/20 px-5 py-4">
            <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-sm font-semibold text-foreground">{title}</span>
            </div>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="p-5">{children}</div>
    </MarketingSurface>
);

export const MarketingStat = ({
    label,
    value,
    hint,
}: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
}) => (
    <div className="rounded-xl border border-border bg-muted/15 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
        <div className="mt-3 text-3xl font-bold tracking-tight text-foreground">{value}</div>
        {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
);

export const MarketingFeatureCard = ({
    icon: Icon,
    title,
    description,
    tone = 'primary',
    footer,
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    tone?: Tone;
    footer?: ReactNode;
}) => (
    <MarketingSurface className="h-full p-6">
        <div className="flex h-full flex-col gap-5">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${toneClasses[tone]}`}>
                <Icon size={18} />
            </div>
            <div className="space-y-3">
                <h3 className="text-xl font-semibold tracking-tight text-foreground">{title}</h3>
                <p className="text-sm leading-7 text-muted-foreground">{description}</p>
            </div>
            {footer && <div className="mt-auto border-t border-border pt-4 text-xs text-muted-foreground">{footer}</div>}
        </div>
    </MarketingSurface>
);
