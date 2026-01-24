
import { useLanguage } from '../context/LanguageContext';

const FixHistory = () => {
    const { t } = useLanguage();
    return (
        <div className="space-y-6 p-6">
            <h1 className="text-xl font-medium text-foreground">{t('history.title')}</h1>
            <div className="bg-card border border-border rounded-lg p-12 text-center">
                <p className="text-muted-foreground">{t('history.desc')}</p>
            </div>
        </div>
    );
};
export default FixHistory;
