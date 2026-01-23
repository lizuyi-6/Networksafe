
import { useLanguage } from '../context/LanguageContext';

const Settings = () => {
    const { t } = useLanguage();
    return (
        <div className="space-y-6 p-6">
            <h1 className="text-xl font-medium text-zinc-100">{t('settings.title')}</h1>
            <div className="bg-surface border border-border rounded-lg p-12 text-center">
                <p className="text-zinc-500">{t('settings.desc')}</p>
            </div>
        </div>
    );
};
export default Settings;
