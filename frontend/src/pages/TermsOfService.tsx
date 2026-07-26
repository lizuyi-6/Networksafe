import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { ArrowLeft, Scale } from 'lucide-react';

const sectionKeys = [
    { titleKey: 'terms.section_1_title', bodyKey: 'terms.section_1_body' },
    { titleKey: 'terms.section_2_title', bodyKey: 'terms.section_2_body' },
    { titleKey: 'terms.section_3_title', bodyKey: 'terms.section_3_body' },
    { titleKey: 'terms.section_4_title', bodyKey: 'terms.section_4_body' },
    { titleKey: 'terms.section_5_title', bodyKey: 'terms.section_5_body' },
    { titleKey: 'terms.section_6_title', bodyKey: 'terms.section_6_body' },
];

const TermsOfService = () => {
    const navigate = useNavigate();
    const { t } = useLanguage();

    return (
        <div className="min-h-screen overflow-y-auto overflow-x-hidden bg-background text-foreground">
            <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
                <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <ArrowLeft size={16} aria-hidden="true" />
                        {t('terms.back_to_home')}
                    </button>
                    <div className="flex items-center gap-3 text-right">
                        <Scale size={18} className="text-primary" aria-hidden="true" />
                        <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('terms.legal')}</div>
                        <div className="text-sm font-semibold text-foreground sm:text-base">{t('terms.page_title')}</div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
                <div className="border-l-2 border-primary bg-card px-5 py-7 shadow-panel sm:px-8 sm:py-9">
                    <div className="max-w-3xl space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('terms.effective_date')}</div>
                        <h1 className="text-2xl font-semibold text-foreground sm:text-4xl">{t('terms.main_title')}</h1>
                        <p className="text-base leading-8 text-muted-foreground">
                            {t('terms.intro')}
                        </p>
                    </div>

                    <div className="mt-10 grid gap-5">
                        {sectionKeys.map((section) => (
                            <section key={section.titleKey} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
                                <h2 className="text-lg font-semibold text-foreground sm:text-xl">{t(section.titleKey)}</h2>
                                <p className="mt-3 text-sm leading-7 text-muted-foreground">{t(section.bodyKey)}</p>
                            </section>
                        ))}
                    </div>

                    <div className="mt-10 rounded-lg border border-border bg-muted/30 p-5 sm:p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('terms.contact_label')}</div>
                        <p className="mt-3 text-sm leading-7 text-muted-foreground">
                            {t('terms.contact_body')}
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default TermsOfService;
