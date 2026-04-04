import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import AIEndpointSettings from '../components/AIEndpointSettings';
import ModelSelector from '../components/ModelSelector';
import PlatformCapabilitySettings from '../components/PlatformCapabilitySettings';
import { ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const Settings = () => {
    const { t } = useLanguage();
    const [endpointVersion, setEndpointVersion] = useState(0);
    return (
        <ConsolePage title={t('settings.title')} subtitle={t('settings.subtitle')}>
            <PlatformCapabilitySettings endpointVersion={endpointVersion} />
            <ModelSelector />
            <AIEndpointSettings onChanged={() => setEndpointVersion((value) => value + 1)} />

            <ConsolePanel title={t('settings.other')} subtitle={t('settings.otherSubtitle')} className="max-w-[1200px]">
                <p className="text-sm text-muted-foreground">{t('settings.desc')}</p>
            </ConsolePanel>
        </ConsolePage>
    );
};
export default Settings;
