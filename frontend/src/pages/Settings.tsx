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
        <ConsolePage title={t('settings.title')} subtitle="统一管理模型、AI 端点与系统配置项">
            <PlatformCapabilitySettings endpointVersion={endpointVersion} />
            <ModelSelector />
            <AIEndpointSettings onChanged={() => setEndpointVersion((value) => value + 1)} />

            <ConsolePanel title="其他设置" subtitle="保留系统级配置说明" className="max-w-[1200px]">
                <p className="text-sm text-muted-foreground">{t('settings.desc')}</p>
            </ConsolePanel>
        </ConsolePage>
    );
};
export default Settings;
