import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Accent = 'blue' | 'cyan' | 'emerald' | 'amber' | 'rose';

const accentClasses: Record<Accent, string> = {
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rose: 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const accentBarClasses: Record<Accent, string> = {
    blue: 'from-blue-500/90 to-sky-400/90',
    cyan: 'from-cyan-500/90 to-sky-400/90',
    emerald: 'from-emerald-500/90 to-teal-400/90',
    amber: 'from-amber-500/90 to-orange-400/90',
    rose: 'from-rose-500/90 to-pink-400/90',
};

export const LandingSection = ({
    id,
    testId,
    eyebrow,
    title,
    description,
    actions,
    children,
    className = '',
}: {
    id?: string;
    testId?: string;
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <section
        id={id}
        data-testid={testId}
        className={`mx-auto max-w-[1480px] px-6 py-20 md:px-8 md:py-24 xl:px-10 ${className}`}
    >
        <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
                {eyebrow && (
                    <span className="inline-flex items-center rounded-full border border-border/80 bg-card/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        {eyebrow}
                    </span>
                )}
                <h2 className="max-w-4xl text-3xl font-bold tracking-tight text-foreground md:text-5xl md:leading-[1.02]">
                    {title}
                </h2>
                {description && (
                    <p className="max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">
                        {description}
                    </p>
                )}
            </div>
            {actions && <div className="flex items-center gap-3">{actions}</div>}
        </div>
        {children}
    </section>
);

export const LandingPanel = ({
    children,
    className = '',
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div className={`rounded-[28px] border border-border/80 bg-card/90 shadow-sm backdrop-blur-sm ${className}`}>
        {children}
    </div>
);

export const LandingBadge = ({
    children,
    accent = 'blue',
}: {
    children: ReactNode;
    accent?: Accent;
}) => (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${accentClasses[accent]}`}>
        {children}
    </span>
);

export const MetricStrip = ({
    items,
}: {
    items: Array<{ label: string; value: string; note?: string }>;
}) => (
    <div className="grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
            <LandingPanel key={item.label} className="p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
                <div className="mt-3 text-3xl font-bold tracking-tight text-foreground">{item.value}</div>
                {item.note && <div className="mt-2 text-sm text-muted-foreground">{item.note}</div>}
            </LandingPanel>
        ))}
    </div>
);

export const StoryCard = ({
    icon: Icon,
    title,
    description,
    accent = 'blue',
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    accent?: Accent;
}) => (
    <LandingPanel className="h-full p-6">
        <div className="flex h-full flex-col gap-5">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${accentClasses[accent]}`}>
                <Icon size={18} />
            </div>
            <div className="space-y-3">
                <h3 className="text-xl font-semibold tracking-tight text-foreground">{title}</h3>
                <p className="text-sm leading-7 text-muted-foreground">{description}</p>
            </div>
        </div>
    </LandingPanel>
);

export const ProductFrame = ({
    accent = 'blue',
    eyebrow,
    title,
    description,
    children,
    footer,
    className = '',
}: {
    accent?: Accent;
    eyebrow?: string;
    title: string;
    description?: string;
    children: ReactNode;
    footer?: ReactNode;
    className?: string;
}) => (
    <LandingPanel className={`overflow-hidden ${className}`}>
        <div className="border-b border-border/80 bg-background/70 px-5 py-4">
            <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${accentBarClasses[accent]}`} />
                {eyebrow && <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</span>}
            </div>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-foreground">{title}</h3>
            {description && <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">{description}</p>}
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="border-t border-border/80 bg-muted/20 px-5 py-4 text-sm text-muted-foreground">{footer}</div>}
    </LandingPanel>
);

export const JourneyStep = ({
    step,
    title,
    description,
}: {
    step: string;
    title: string;
    description: string;
}) => (
    <div className="relative rounded-[24px] border border-border/80 bg-card/85 p-5 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{step}</span>
            <span className="h-2.5 w-2.5 rounded-full bg-primary/80" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
    </div>
);
