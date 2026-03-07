import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const toneClasses: Record<Tone, string> = {
    primary: 'bg-primary/10 text-primary border-primary/15',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    neutral: 'bg-muted/60 text-muted-foreground border-border',
};

export const ConsolePage = ({
    title,
    subtitle,
    actions,
    children,
    className = '',
}: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <div className={`p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen pb-12 ${className}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
        </div>
        {children}
    </div>
);

export const ConsolePanel = ({
    title,
    subtitle,
    icon: Icon,
    iconTone = 'primary',
    headerAction,
    children,
    className = '',
}: {
    title?: string;
    subtitle?: string;
    icon?: LucideIcon;
    iconTone?: Tone;
    headerAction?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <section className={`bg-card border border-border rounded-xl shadow-sm overflow-hidden ${className}`}>
        {(title || headerAction) && (
            <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center justify-between gap-4">
                <div className="min-w-0">
                    {title && (
                        <div className="flex items-center gap-3 min-w-0">
                            {Icon && (
                                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${toneClasses[iconTone]}`}>
                                    <Icon size={16} />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h2 className="text-base font-semibold text-foreground truncate">{title}</h2>
                                {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
                            </div>
                        </div>
                    )}
                </div>
                {headerAction}
            </div>
        )}
        <div className="p-5">{children}</div>
    </section>
);

export const ConsoleStatCard = ({
    icon: Icon,
    label,
    value,
    hint,
    tone = 'primary',
}: {
    icon?: LucideIcon;
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    tone?: Tone;
}) => (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 min-w-0">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
                <div className="text-3xl font-bold text-foreground tracking-tight">{value}</div>
                {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </div>
            {Icon && (
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
                    <Icon size={18} />
                </div>
            )}
        </div>
    </div>
);

export const ConsoleEmptyState = ({
    title,
    description,
}: {
    title: string;
    description?: string;
}) => (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-2">{description}</p>}
    </div>
);
