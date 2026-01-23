
import { useLanguage } from '../context/LanguageContext';

const FixHistory = () => {
    const { t } = useLanguage();
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">{t('history.title')}</h1>
            <div className="glass-panel p-8 text-center text-gray-500">
                {t('history.desc')}
            </div>
        </div>
    );
};
export default FixHistory;
