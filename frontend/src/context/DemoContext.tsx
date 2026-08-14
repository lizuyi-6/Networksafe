import { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { canUseDemoMode, getCurrentDemoUserKey, getStoredDemoMode, setRuntimeDemoMode, setStoredDemoMode } from '../config/demo-mode';
import { isPublicStandaloneRoute } from '../config/public-routes';
import { fetchSystemMode, switchSystemMode } from '../services/api';

/**
 * Data source type
 * - 'api': Data is fetched from backend API (normal mode and demo mode)
 * - 'local': Data is generated locally (fallback when API is unavailable)
 */
export type DataSource = 'api' | 'local';

interface DemoContextType {
    isDemoMode: boolean;
    toggleDemoMode: () => void;
    isSwitchingDemoMode: boolean;
    attackSimEnabled: boolean;
    modeResolved: boolean;
    /**
     * Data source - always 'api' in demo mode (data comes from backend demo data)
     * This ensures demo mode uses the same data pipeline as production
     */
    dataSource: DataSource;
    /**
     * FE-001 (audit 2026-08): true when the last backend mode switch failed.
     * The local toggle is kept working offline (deliberate), but the operator
     * must be able to SEE that the backend is still in the previous mode
     * instead of a silent `.catch(() => {})`.
     */
    backendModeSyncFailed: boolean;
    refreshDemoState: () => Promise<void>;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider = ({ children }: { children: ReactNode }) => {
    const location = useLocation();
    const [isDemoMode, setIsDemoMode] = useState<boolean>(() => getStoredDemoMode());
    const [isSwitchingDemoMode, setIsSwitchingDemoMode] = useState<boolean>(false);
    const [attackSimEnabled, setAttackSimEnabled] = useState<boolean>(false);
    const [modeResolved, setModeResolved] = useState<boolean>(false);
    const [dataSource, setDataSource] = useState<DataSource>('api');
    const [backendModeSyncFailed, setBackendModeSyncFailed] = useState<boolean>(false);

    const syncLocalDemoState = () => {
        const userKey = getCurrentDemoUserKey();
        const localDemoEnabled = getStoredDemoMode(userKey);
        setIsDemoMode(localDemoEnabled);
        setRuntimeDemoMode(localDemoEnabled);
        return localDemoEnabled;
    };

    const refreshDemoState = async () => {
        const localDemoEnabled = syncLocalDemoState();

        try {
            const data = await fetchSystemMode();
            setAttackSimEnabled(data.attackSimEnabled === true);
            setIsDemoMode(localDemoEnabled);
            setRuntimeDemoMode(localDemoEnabled);
            setDataSource('api');
            setModeResolved(true);
        } catch {
            setAttackSimEnabled(false);

            if (!getCurrentDemoUserKey()) {
                setIsDemoMode(false);
                setRuntimeDemoMode(false);
            }

            setDataSource('local');
            setModeResolved(true);
        }
    };

    useEffect(() => {
        syncLocalDemoState();
        setIsSwitchingDemoMode(false);
        if (isPublicStandaloneRoute(location.pathname)) {
            setAttackSimEnabled(false);
            setModeResolved(true);
            return;
        }

        void refreshDemoState();
    }, [location.pathname]);

    const toggleDemoMode = () => {
        if (isSwitchingDemoMode) return;
        // FE-001: demo toggle is a build-time opt-in (canUseDemoMode). In a
        // build without demo support the toggle is inert.
        if (!canUseDemoMode()) return;
        setIsSwitchingDemoMode(true);

        const nextDemoMode = !isDemoMode;
        setIsDemoMode(nextDemoMode);
        setRuntimeDemoMode(nextDemoMode);
        setStoredDemoMode(nextDemoMode);
        setDataSource('api');
        setModeResolved(true);

        void Promise.resolve()
            .then(async () => {
                try {
                    await switchSystemMode(nextDemoMode ? 'demo' : 'production');
                    setBackendModeSyncFailed(false);
                    await refreshDemoState();
                } catch (error) {
                    // FE-001: keep the local toggle working offline (deliberate
                    // design), but surface the backend sync failure instead of
                    // swallowing it — the operator must know the backend is
                    // still in the previous mode.
                    setBackendModeSyncFailed(true);
                    console.warn('Backend system-mode switch failed; local demo toggle applied, backend mode unchanged.', error);
                }
            })
            .finally(() => {
                setIsSwitchingDemoMode(false);
            });
    };

    return (
        <DemoContext.Provider value={{
            isDemoMode,
            toggleDemoMode,
            isSwitchingDemoMode,
            attackSimEnabled,
            modeResolved,
            dataSource,
            backendModeSyncFailed,
            refreshDemoState
        }}>
            {children}
        </DemoContext.Provider>
    );
};

export const useDemo = () => {
    const context = useContext(DemoContext);
    if (!context) {
        throw new Error('useDemo must be used within a DemoProvider');
    }
    return context;
};
