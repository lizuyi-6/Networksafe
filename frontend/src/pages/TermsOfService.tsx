import { useNavigate } from 'react-router-dom';

const sections = [
    {
        title: '1. Service Scope',
        body: 'AetherGuard provides a control console, gateway coordination, traffic inspection workflows, device operations, and security automation features for authorized customer environments.',
    },
    {
        title: '2. Acceptable Use',
        body: 'You must only connect systems, data, and operators that you are authorized to manage. Abuse, unlawful interception, credential sharing, and attempts to disable platform safeguards are prohibited.',
    },
    {
        title: '3. Customer Responsibilities',
        body: 'Customers remain responsible for account administration, deployment choices, legal basis for inspected traffic, credential custody, and reviewing automated security decisions before high-impact production actions.',
    },
    {
        title: '4. Availability and Changes',
        body: 'The platform may evolve over time. Material changes to supported workflows, retention controls, or deployment requirements should be communicated through release notes, control-plane notices, or contract updates.',
    },
    {
        title: '5. Security and Incident Handling',
        body: 'AetherGuard applies technical and organizational controls appropriate for a security operations platform. If a verified incident affects customer data, notification and coordination follow the contracted incident process.',
    },
    {
        title: '6. Suspension and Termination',
        body: 'Accounts or tenants may be suspended for abuse, unpaid service, legal requests, or actions that put the platform or other tenants at risk. On termination, retained data is handled according to the agreed retention and deletion policy.',
    },
];

const TermsOfService = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen overflow-y-auto overflow-x-hidden bg-background text-foreground">
            <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Back to home
                    </button>
                    <div className="text-right">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Legal</div>
                        <div className="text-lg font-semibold text-foreground">Terms of Service</div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-6 py-12">
                <div className="rounded-[28px] border border-border bg-card/80 p-8 shadow-sm">
                    <div className="max-w-3xl space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Effective date</div>
                        <h1 className="text-4xl font-bold tracking-tight text-foreground">AetherGuard Terms of Service</h1>
                        <p className="text-base leading-8 text-muted-foreground">
                            These terms govern access to the AetherGuard control platform, associated security workflows,
                            and managed deployment tooling. They are intended for enterprise and operator use.
                        </p>
                    </div>

                    <div className="mt-10 grid gap-5">
                        {sections.map((section) => (
                            <section key={section.title} className="rounded-[22px] border border-border/80 bg-background/70 p-6">
                                <h2 className="text-xl font-semibold tracking-tight text-foreground">{section.title}</h2>
                                <p className="mt-3 text-sm leading-7 text-muted-foreground">{section.body}</p>
                            </section>
                        ))}
                    </div>

                    <div className="mt-10 rounded-[22px] border border-border/80 bg-muted/20 p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contact</div>
                        <p className="mt-3 text-sm leading-7 text-muted-foreground">
                            For contract-specific terms, data processing commitments, or support escalations, use the
                            contact channel defined in your customer agreement or operator onboarding record.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default TermsOfService;
