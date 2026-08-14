import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useLiveMode } from '../context/LiveModeContext';
import AIEndpointSettings from '../components/AIEndpointSettings';
import ModelSelector from '../components/ModelSelector';
import PlatformCapabilitySettings from '../components/PlatformCapabilitySettings';
import { ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';
import { logout } from '../services/api';
import { isAllowedRedirectTarget } from '../security/redirect-guard';
import { setSessionUserIdentity } from '../services/session-cache';

const Settings = () => {
    const { t } = useLanguage();
    const { liveModeEnabled, toggleLiveMode } = useLiveMode();
    const navigate = useNavigate();
    const [endpointVersion, setEndpointVersion] = useState(0);
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        setLoggingOut(true);
        try {
            const result = await logout();
            setSessionUserIdentity(null);
            if (result?.endSessionUrl) {
                // FE-002: endSessionUrl is backend-supplied — only follow it
                // when it is a same-origin/allowlisted target. On mismatch we
                // still complete the local logout below.
                if (!isAllowedRedirectTarget(result.endSessionUrl)) {
                    console.warn('Blocked OIDC end-session redirect to untrusted target:', result.endSessionUrl);
                } else {
                    window.location.assign(result.endSessionUrl);
                    return;
                }
            }
        } catch {
            // proceed with local cleanup even if server call fails
        }
        setSessionUserIdentity(null);
        navigate('/login', { replace: true });
    };

    return (
        <ConsolePage title={t('settings.title')} subtitle={t('settings.subtitle')}>
            <PlatformCapabilitySettings endpointVersion={endpointVersion} />
            <ModelSelector />
            <AIEndpointSettings onChanged={() => setEndpointVersion((value) => value + 1)} />

            <ConsolePanel title={t('settings.other')} subtitle={t('settings.otherSubtitle')} className="max-w-[1200px]">
                <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                        <div>
                            <div className="text-sm font-medium text-foreground">{t('header.live')}</div>
                            <div className="text-xs text-muted-foreground">{t('settings.liveRefreshDesc')}</div>
                        </div>
                        <button
                            type="button"
                            data-testid="settings-live-mode-toggle"
                            aria-label={t('header.live')}
                            aria-pressed={liveModeEnabled}
                            onClick={toggleLiveMode}
                            className="group inline-flex min-h-6 min-w-11 cursor-pointer items-center justify-center"
                        >
                            <div className={`w-9 h-5 rounded-full border relative transition-colors ${liveModeEnabled ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                                <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full shadow-sm transition-all ${liveModeEnabled ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                            </div>
                        </button>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                        <div>
                            <div className="text-sm font-medium text-foreground">{t('settings.logout')}</div>
                            <div className="text-xs text-muted-foreground">{t('settings.logoutDesc')}</div>
                        </div>
                        <button
                            data-testid="settings-logout"
                            onClick={handleLogout}
                            disabled={loggingOut}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 transition-colors"
                        >
                            {loggingOut ? t('settings.loggingOut') : t('settings.logout')}
                        </button>
                    </div>
                </div>
            </ConsolePanel>
        </ConsolePage>
    );
};
export default Settings;
