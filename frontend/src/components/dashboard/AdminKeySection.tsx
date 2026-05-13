import { Key } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ConsolePanel } from '../ConsolePrimitives';

interface AdminKeySectionProps {
    apiKeys: any[];
    visible: boolean;
}

export const AdminKeySection = ({ apiKeys, visible }: AdminKeySectionProps) => {
    const { t } = useLanguage();

    if (!visible) return null;

    return (
        <ConsolePanel
            title={t('dashboard.admin_api_keys')}
            subtitle={t('dashboard.admin_api_keys_subtitle')}
            icon={Key}
            iconTone="success"
        >
            <div className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                    {t('dashboard.api_key_desc_full')}
                </p>
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted p-3">
                    <code className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {apiKeys[0]?.prefix ? `${apiKeys[0].prefix}********` : t('dashboard.not_found')}
                    </code>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {apiKeys[0]?.lastUsed || t('dashboard.never_used_short')}
                    </span>
                </div>
            </div>
        </ConsolePanel>
    );
};
