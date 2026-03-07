import { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { getCurrentDemoUserKey, getStoredDemoMode, setRuntimeDemoMode, setStoredDemoMode } from '../config/demo-mode';
import { fetchSystemMode } from '../services/api';

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
    refreshDemoState: () => Promise<void>;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider = ({ children }: { children: ReactNode }) => {
    const [isDemoMode, setIsDemoMode] = useState<boolean>(() => getStoredDemoMode());
    const [isSwitchingDemoMode, setIsSwitchingDemoMode] = useState<boolean>(false);
    const [attackSimEnabled, setAttackSimEnabled] = useState<boolean>(false);
    const [modeResolved, setModeResolved] = useState<boolean>(false);
    const [dataSource, setDataSource] = useState<DataSource>('api');

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
        void refreshDemoState();
    }, []);

    const toggleDemoMode = () => {
        if (isSwitchingDemoMode) return;
        setIsSwitchingDemoMode(true);

        const nextDemoMode = !isDemoMode;
        setIsDemoMode(nextDemoMode);
        setRuntimeDemoMode(nextDemoMode);
        setStoredDemoMode(nextDemoMode);
        setDataSource('api');
        setModeResolved(true);

        void Promise.resolve().finally(() => {
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
