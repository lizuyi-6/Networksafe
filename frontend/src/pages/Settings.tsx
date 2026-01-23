import React from 'react';
import { useLanguage } from '../context/LanguageContext';

const Settings = () => {
    const { t } = useLanguage();
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">{t('settings.title')}</h1>
            <div className="glass-panel p-8 text-center text-gray-500">
                {t('settings.desc')}
            </div>
        </div>
    );
};
export default Settings;
