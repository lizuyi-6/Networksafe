import { createContext, useState, useContext, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

type Language = 'en' | 'zh';

interface LanguageContextType {
    language: Language;
    toggleLanguage: () => void;
    t: (key: string, options?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const { t } = useTranslation();
    const [language, setLanguage] = useState<Language>((i18n.language as Language) || 'en');

    const toggleLanguage = () => {
        const newLang = language === 'en' ? 'zh' : 'en';
        setLanguage(newLang);
        i18n.changeLanguage(newLang);
    };

    return (
        <LanguageContext.Provider value={{ language, toggleLanguage, t: t as (key: string, options?: Record<string, string | number>) => string }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
