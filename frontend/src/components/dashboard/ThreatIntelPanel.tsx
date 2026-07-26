import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ConsolePanel, ConsoleEmptyState } from '../ConsolePrimitives';
import { TabButton } from './TabButton';
import type { AttackOrigin, ThreatItem } from '../../types/api';

// Origin bars carry their value in length, not hue — so all known origins share one
// accent color (identity is the country label + rank order), and only "Unknown" is
// visually de-emphasized in gray. This avoids assigning politically-loaded per-country
// colors and keeps the bars readable as a magnitude ranking.
const originBarColor = (code: string) => (code === 'Unknown' ? 'bg-slate-400' : 'bg-primary');

interface ThreatIntelPanelProps {
    origins: AttackOrigin[];
    threats: ThreatItem[];
    emptyDescription: string;
}

export const ThreatIntelPanel = ({ origins, threats, emptyDescription }: ThreatIntelPanelProps) => {
    const { t } = useLanguage();
    const [tab, setTab] = useState<'origins' | 'vectors'>('origins');

    return (
        <ConsolePanel
            title={t('dashboard.threat_intel')}
            subtitle={t('dashboard.attack_sources_subtitle')}
            icon={Globe}
            iconTone="warning"
        >
            {/* Tab switcher */}
            <div className="mb-4 flex gap-1 rounded-lg bg-muted p-0.5">
                <TabButton active={tab === 'origins'} onClick={() => setTab('origins')}>
                    {t('dashboard.tab_origins')}
                </TabButton>
                <TabButton active={tab === 'vectors'} onClick={() => setTab('vectors')}>
                    {t('dashboard.tab_vectors')}
                </TabButton>
            </div>

            {tab === 'origins' ? (
                <div className="space-y-4">
                    {origins.length > 0 ? (
                        [...origins]
                            .sort((a, b) => b.percentage - a.percentage)
                            .map((item, index) => (
                                <div key={`${item.countryCode}-${index}`}>
                                    <div className="mb-2 flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2 font-medium text-foreground">
                                            <span className={`h-2 w-2 rounded-full ${originBarColor(item.countryCode)}`} />
                                            {item.country}
                                            <span className="text-muted-foreground">({item.countryCode})</span>
                                        </span>
                                        <span className="font-mono font-bold text-foreground">
                                            {Math.round(item.percentage)}%
                                        </span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full border border-border/50 bg-muted">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${item.percentage}%` }}
                                            transition={{ duration: 0.6, delay: index * 0.06 }}
                                            className={`h-full ${originBarColor(item.countryCode)}`}
                                        />
                                    </div>
                                </div>
                            ))
                    ) : (
                        <ConsoleEmptyState title={t('dashboard.no_attack_sources')} description={emptyDescription} />
                    )}
                </div>
            ) : (
                <div className="divide-y divide-border">
                    {threats.length > 0 ? (
                        [...threats]
                            .sort((a, b) => b.value - a.value)
                            .map((threat, index) => (
                                <div
                                    key={`${threat.name}-${index}`}
                                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="h-3 w-3 rounded-full bg-primary" />
                                        <span className="text-sm font-medium text-foreground">{threat.name}</span>
                                    </div>
                                    <span className="font-mono text-sm font-bold text-foreground">
                                        {threat.value}
                                    </span>
                                </div>
                            ))
                    ) : (
                        <ConsoleEmptyState title={t('dashboard.no_attack_data')} />
                    )}
                </div>
            )}
        </ConsolePanel>
    );
};
