import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { useLanguage } from '../context/LanguageContext';
import { useStepUp } from '../context/StepUpContext';
import { ConsolePanel } from './ConsolePrimitives';
import {
    deleteWebAuthnCredential,
    fetchWebAuthnCredentials,
    getWebAuthnRegistrationOptions,
    verifyWebAuthnRegistration,
    type WebAuthnCredentialSummary
} from '../services/api';

const PasskeySettings = () => {
    const { t } = useLanguage();
    const { refreshCredentials } = useStepUp();
    const [credentials, setCredentials] = useState<WebAuthnCredentialSummary[]>([]);
    const [currentPassword, setCurrentPassword] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = async () => {
        try {
            setCredentials(await fetchWebAuthnCredentials());
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : t('settings.passkeyLoadFailed'));
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const register = async () => {
        if (!currentPassword) {
            setError(t('settings.passkeyPasswordRequired'));
            return;
        }
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const options = await getWebAuthnRegistrationOptions(currentPassword);
            const registration = await startRegistration({ optionsJSON: options });
            await verifyWebAuthnRegistration(currentPassword, registration, name.trim() || undefined);
            setCurrentPassword('');
            setName('');
            setNotice(t('settings.passkeyAdded'));
            await load();
            await refreshCredentials();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : t('settings.passkeyRegistrationFailed'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (credentialId: string) => {
        if (!currentPassword) {
            setError(t('settings.passkeyPasswordRequired'));
            return;
        }
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            await deleteWebAuthnCredential(credentialId, currentPassword);
            setCurrentPassword('');
            setNotice(t('settings.passkeyRemoved'));
            await load();
            await refreshCredentials();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : t('settings.passkeyRemovalFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <ConsolePanel title={t('settings.passkeysTitle')} subtitle={t('settings.passkeysSubtitle')} className="max-w-[1200px]">
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('settings.passkeysDescription')}</p>
                {credentials.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{t('settings.noPasskeys')}</div>
                ) : (
                    <div className="space-y-2">
                        {credentials.map((credential) => (
                            <div key={credential.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                                <div>
                                    <div className="text-sm font-medium text-foreground">{credential.name || t('settings.unnamedPasskey')}</div>
                                    <div className="text-xs text-muted-foreground">{credential.deviceType || t('settings.passkeyDevice')} · {new Date(credential.createdAt).toLocaleDateString()}</div>
                                </div>
                                <button type="button" onClick={() => void remove(credential.id)} disabled={busy} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/20 disabled:opacity-50">
                                    {t('common.delete')}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t('settings.currentPassword')} aria-label={t('settings.currentPassword')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                    <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('settings.passkeyName')} aria-label={t('settings.passkeyName')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                    <button type="button" onClick={() => void register()} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        {busy ? t('common.loading') : t('settings.addPasskey')}
                    </button>
                </div>
                {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">{error}</div>}
                {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">{notice}</div>}
            </div>
        </ConsolePanel>
    );
};

export default PasskeySettings;
