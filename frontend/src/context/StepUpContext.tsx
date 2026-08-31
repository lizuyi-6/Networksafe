import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import {
    STEPUP_REQUIRED_EVENT,
    getWebAuthnStepUpOptions,
    verifyWebAuthnStepUp,
    resolveStepUpRequest,
    fetchWebAuthnCredentials,
    type WebAuthnCredentialSummary
} from '../services/api';
import { useLanguage } from './LanguageContext';

type StepUpReason = 'required' | 'enroll_required';

type StepUpContextValue = {
    open: boolean;
    reason: StepUpReason | null;
    busy: boolean;
    error: string | null;
    credentials: WebAuthnCredentialSummary[];
    retry: () => void;
    cancel: () => void;
    refreshCredentials: () => Promise<void>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

export const useStepUp = (): StepUpContextValue => {
    const context = useContext(StepUpContext);
    if (!context) {
        throw new Error('useStepUp must be used inside StepUpProvider');
    }
    return context;
};

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export const StepUpProvider = ({ children }: { children: ReactNode }) => {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<StepUpReason | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [credentials, setCredentials] = useState<WebAuthnCredentialSummary[]>([]);

    const refreshCredentials = useCallback(async () => {
        try {
            setCredentials(await fetchWebAuthnCredentials());
        } catch {
            setCredentials([]);
        }
    }, []);

    const cancel = useCallback(() => {
        setOpen(false);
        setBusy(false);
        resolveStepUpRequest(false);
    }, []);

    const authenticateStepUp = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const options = await getWebAuthnStepUpOptions();
            const assertion = await startAuthentication({ optionsJSON: options });
            await verifyWebAuthnStepUp(assertion);
            setOpen(false);
            setBusy(false);
            resolveStepUpRequest(true);
        } catch (caught) {
            // Keep the waiter pending after a browser cancellation or a bad
            // assertion. The user can retry from the same dialog; canceling
            // the dialog or the timeout is what rejects the original request.
            setBusy(false);
            setError(errorMessage(caught, t('stepup.authenticationFailed')));
        }
    }, [t]);

    const handleRequired = useCallback((event: Event) => {
        const detail = (event as CustomEvent<{ reason?: StepUpReason }>).detail;
        setReason(detail?.reason === 'enroll_required' ? 'enroll_required' : 'required');
        setError(null);
        setOpen(true);
        void refreshCredentials();
    }, [refreshCredentials]);

    useEffect(() => {
        window.addEventListener(STEPUP_REQUIRED_EVENT, handleRequired);
        return () => window.removeEventListener(STEPUP_REQUIRED_EVENT, handleRequired);
    }, [handleRequired]);

    const retry = useCallback(() => {
        void authenticateStepUp();
    }, [authenticateStepUp]);

    const value = useMemo(() => ({
        open,
        reason,
        busy,
        error,
        credentials,
        retry,
        cancel,
        refreshCredentials
    }), [open, reason, busy, error, credentials, retry, cancel, refreshCredentials]);

    return (
        <StepUpContext.Provider value={value}>
            {children}
        </StepUpContext.Provider>
    );
};

export const StepUpDialog = () => {
    const { t } = useLanguage();
    const { open, reason, busy, error, retry, cancel } = useStepUp();
    if (!open) return null;

    const enrollRequired = reason === 'enroll_required';
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
            <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
                <div className="mb-5">
                    <div id="stepup-title" className="text-lg font-semibold text-foreground">
                        {enrollRequired ? t('stepup.enrollRequiredTitle') : t('stepup.title')}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {enrollRequired ? t('stepup.enrollRequiredDescription') : t('stepup.description')}
                    </p>
                </div>
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">{error}</div>}
                {enrollRequired ? (
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={cancel} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/40">
                            {t('common.cancel')}
                        </button>
                        <button type="button" onClick={() => { cancel(); window.location.assign('/settings'); }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                            {t('stepup.goToSecurity')}
                        </button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={cancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-50">
                            {t('common.cancel')}
                        </button>
                        <button type="button" onClick={retry} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                            {busy ? t('stepup.authenticating') : t('stepup.usePasskey')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StepUpContext;
