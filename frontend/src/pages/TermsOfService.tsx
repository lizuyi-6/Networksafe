import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

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
        <div data-testid="terms-page" className="min-h-screen overflow-y-auto overflow-x-hidden bg-background text-foreground">
            <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {t('terms.back_to_home')}
                    </button>
                    <div className="text-right">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('terms.legal')}</div>
                        <div className="text-lg font-semibold text-foreground">{t('terms.page_title')}</div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-6 py-12">
                <div className="rounded-[28px] border border-border bg-card/80 p-8 shadow-sm">
                    <div className="max-w-3xl space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('terms.effective_date')}</div>
                        <h1 className="text-4xl font-bold tracking-tight text-foreground">{t('terms.main_title')}</h1>
                        <p className="text-base leading-8 text-muted-foreground">
                            {t('terms.intro')}
                        </p>
                    </div>

                    <div className="mt-10 grid gap-5">
                        {sectionKeys.map((section) => (
                            <section key={section.titleKey} className="rounded-[22px] border border-border/80 bg-background/70 p-6">
                                <h2 className="text-xl font-semibold tracking-tight text-foreground">{t(section.titleKey)}</h2>
                                <p className="mt-3 text-sm leading-7 text-muted-foreground">{t(section.bodyKey)}</p>
                            </section>
                        ))}
                    </div>

                    <div className="mt-10 rounded-[22px] border border-border/80 bg-muted/20 p-6">
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
