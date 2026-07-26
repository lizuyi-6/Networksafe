import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const toneClasses: Record<Tone, string> = {
    primary: 'border-primary/25 bg-primary/10 text-primary',
    success: 'border-success/25 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/25 bg-danger/10 text-danger',
    neutral: 'border-border bg-muted/70 text-muted-foreground',
};

const rise: Variants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

const sequence: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.035 } },
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
    <motion.div
        variants={sequence}
        initial="hidden"
        animate="visible"
        className={`mx-auto min-h-full max-w-[1680px] space-y-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7 ${className}`}
    >
        <motion.header variants={rise} className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
                <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{title}</h1>
                {subtitle && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </motion.header>
        {children}
    </motion.div>
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
    <motion.section
        variants={rise}
        className={`overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-panel ${className}`}
    >
        {(title || headerAction) && (
            <div className="flex min-h-14 flex-col gap-3 border-b border-border bg-muted/35 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                    {title && (
                        <div className="flex min-w-0 items-center gap-3">
                            {Icon && (
                                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${toneClasses[iconTone]}`}>
                                    <Icon size={16} aria-hidden="true" />
                                </span>
                            )}
                            <div className="min-w-0">
                                <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
                                {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
                            </div>
                        </div>
                    )}
                </div>
                {headerAction && <div className="min-w-0 w-full lg:w-auto lg:shrink-0">{headerAction}</div>}
            </div>
        )}
        <div className="p-4 sm:p-5">{children}</div>
    </motion.section>
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
    <motion.div
        variants={rise}
        className="relative min-h-[126px] overflow-hidden rounded-lg border border-border bg-card p-4 shadow-panel"
    >
        <span className={`absolute inset-y-0 left-0 w-0.5 ${tone === 'primary' ? 'bg-primary' : tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'danger' ? 'bg-danger' : 'bg-border'}`} />
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <div className="mt-3 truncate text-2xl font-semibold tabular-nums text-foreground">{value}</div>
                {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
            </div>
            {Icon && (
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${toneClasses[tone]}`}>
                    <Icon size={16} aria-hidden="true" />
                </span>
            )}
        </div>
    </motion.div>
);

export const ConsoleEmptyState = ({
    title,
    description,
}: {
    title: string;
    description?: string;
}) => (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-5 py-8 text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>}
    </div>
);
