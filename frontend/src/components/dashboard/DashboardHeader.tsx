import { motion, Variants } from 'framer-motion';
import { Download, Pause, Play } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

const fadeUpVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
};

export type TimeRange = '1h' | '24h' | '7d';

interface DashboardHeaderProps {
    timeRange: TimeRange;
    onTimeRangeChange: (range: TimeRange) => void;
    paused: boolean;
    onTogglePause: () => void;
    onExport: (format: 'json' | 'csv') => void;
}

export const DashboardHeader = ({
    timeRange,
    onTimeRangeChange,
    paused,
    onTogglePause,
    onExport,
}: DashboardHeaderProps) => {
    const { t } = useLanguage();

    return (
        <motion.div
            variants={fadeUpVariants}
            className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
        >
            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {t('dashboard.title')}
                </h1>
                <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                {/* Time range pill selector */}
                <div className="flex rounded-lg border border-border bg-muted p-0.5">
                    {(['1h', '24h', '7d'] as const).map((range) => (
                        <button
                            key={range}
                            data-testid={`dashboard-range-${range}`}
                            onClick={() => onTimeRangeChange(range)}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                                timeRange === range
                                    ? 'bg-card text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {t(`dashboard.time_${range}`)}
                        </button>
                    ))}
                </div>

                {/* Pause / Resume */}
                <button
                    data-testid="dashboard-log-pause"
                    aria-label={paused ? t('dashboard.resume_logs') || 'Resume' : t('dashboard.pause_logs') || 'Pause'}
                    onClick={onTogglePause}
                    className={`rounded-lg border border-border bg-card p-2 transition-colors hover:bg-muted/30 ${
                        paused ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    {paused ? <Play size={16} /> : <Pause size={16} />}
                </button>

                {/* Export JSON */}
                <button
                    data-testid="dashboard-export-json"
                    aria-label={t('dashboard.export_json') || 'Export JSON'}
                    onClick={() => onExport('json')}
                    className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                >
                    <Download size={16} />
                </button>

                {/* Export CSV */}
                <button
                    data-testid="dashboard-export-csv"
                    onClick={() => onExport('csv')}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                >
                    CSV
                </button>
            </div>
        </motion.div>
    );
};
