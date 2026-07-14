import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enJSON from './locales/en.json';
import zhJSON from './locales/zh.json';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: {
                translation: enJSON
            },
            zh: {
                translation: zhJSON
            }
        },
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false, // React escapes interpolated text during rendering.
            prefix: '{',
            suffix: '}'
        }
    });

export default i18n;
