import { motion, AnimatePresence } from 'framer-motion';
import { Search, Terminal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ConsolePanel } from '../ConsolePrimitives';
import type { LogItem } from '../../types/api';

interface LiveLogStreamProps {
    logs: LogItem[];
    filterQuery: string;
    onFilterChange: (query: string) => void;
    emptyText: string;
}

const levelColor = (level?: string, status?: number) => {
    const normalizedLevel = String(level || '').toUpperCase();
    if (normalizedLevel === 'ERROR' || (typeof status === 'number' && status >= 400)) return 'bg-rose-500';
    if (normalizedLevel === 'WARN' || normalizedLevel === 'WARNING') return 'bg-amber-500';
    if (normalizedLevel === 'INFO' || normalizedLevel === 'DEBUG' || (typeof status === 'number' && status >= 200 && status < 400)) return 'bg-emerald-500';
    return 'bg-muted-foreground';
};

const levelRowClass = (level?: string, status?: number) => {
    const normalizedLevel = String(level || '').toUpperCase();
    if (normalizedLevel === 'ERROR' || (typeof status === 'number' && status >= 400)) return 'border-rose-500/10 bg-rose-500/5';
    if (normalizedLevel === 'WARN' || normalizedLevel === 'WARNING') return 'border-amber-500/10 bg-amber-500/5';
    return 'border-transparent bg-transparent';
};

export const LiveLogStream = ({ logs, filterQuery, onFilterChange, emptyText }: LiveLogStreamProps) => {
    const { t } = useLanguage();

    return (
        <ConsolePanel
            title={t('dashboard.real_time_logs')}
            subtitle={t('dashboard.logs_subtitle')}
            icon={Terminal}
            iconTone="neutral"
        >
            {/* Inline filter */}
            <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 text-muted-foreground" size={14} />
                <input
                    data-testid="dashboard-log-filter"
                    type="text"
                    value={filterQuery}
                    onChange={(e) => onFilterChange(e.target.value)}
                    placeholder={t('dashboard.filter_placeholder')}
                    className="w-full rounded-lg border border-border bg-muted/30 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
            </div>

            {/* Log list */}
            <div className="h-[400px] overflow-y-auto rounded-md border border-border bg-muted/10 p-3 font-mono text-xs">
                <AnimatePresence initial={false}>
                    {logs.map((log) => (
                        <motion.div
                            key={`${log.id}-${log.time}`}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.15 }}
                            className={`mb-1.5 flex items-start gap-3 rounded-lg border p-2 transition-colors hover:bg-muted/20 ${levelRowClass(log.level, log.status)}`}
                        >
                            {/* Level indicator bar */}
                            <div className={`mt-1 h-4 w-1 shrink-0 rounded-full ${levelColor(log.level, log.status)}`} />
                            <span className="w-16 shrink-0 text-muted-foreground">
                                {new Date(log.time).toLocaleTimeString()}
                            </span>
                            <span className="w-10 shrink-0 font-bold text-foreground">
                                {typeof log.status === 'number' ? log.status : '--'}
                            </span>
                            <span className="w-10 shrink-0 font-semibold text-primary">
                                {log.type}
                            </span>
                            <span className="break-all text-foreground">{log.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
                {logs.length === 0 && (
                    <div className="flex h-full items-center justify-center py-12 font-sans text-sm text-muted-foreground">
                        {emptyText}
                    </div>
                )}
            </div>
        </ConsolePanel>
    );
};
