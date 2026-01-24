
import { useLanguage } from '../context/LanguageContext';
import AIEndpointSettings from '../components/AIEndpointSettings';

const Settings = () => {
    const { t } = useLanguage();
    return (
        <div className="space-y-6 p-6 max-w-[1200px] mx-auto">
            <h1 className="text-2xl font-bold text-foreground">{t('settings.title')}</h1>

            {/* AI 模型端点配置 */}
            <AIEndpointSettings />

            {/* 其他设置 */}
            <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-semibold text-foreground mb-4">其他设置</h3>
                <p className="text-muted-foreground">{t('settings.desc')}</p>
            </div>
        </div>
    );
};
export default Settings;
