import { createContext, useState, useContext, ReactNode, useEffect, useRef } from 'react';
import { canUseDemoMode, getStoredDemoMode, setRuntimeDemoMode, setStoredDemoMode } from '../config/demo-mode';

/**
 * Data source type
 * - 'api': Data is fetched from backend API (normal mode and demo mode)
 * - 'local': Data is generated locally (fallback when API is unavailable)
 */
export type DataSource = 'api' | 'local';

interface DemoContextType {
    isDemoMode: boolean;
    toggleDemoMode: () => void;
    canToggleDemoMode: boolean;
    attackSimEnabled: boolean;
    modeResolved: boolean;
    /**
     * Data source - always 'api' in demo mode (data comes from backend demo data)
     * This ensures demo mode uses the same data pipeline as production
     */
    dataSource: DataSource;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider = ({ children }: { children: ReactNode }) => {
    const [canToggleDemoMode, setCanToggleDemoMode] = useState<boolean>(canUseDemoMode());
    const [isDemoMode, setIsDemoMode] = useState<boolean>(() => getStoredDemoMode());
    const [attackSimEnabled, setAttackSimEnabled] = useState<boolean>(false);
    const [modeResolved, setModeResolved] = useState<boolean>(false);
    const [dataSource, setDataSource] = useState<DataSource>('api');
    const initializedRef = useRef(false);
    const isDemoModeRef = useRef(getStoredDemoMode());

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        let mounted = true;
        setRuntimeDemoMode(false);

        // Fetch backend mode status
        // IMPORTANT: Demo mode data still comes from API (backend demo data)
        // This ensures consistent data pipeline between demo and production
        fetch('/api/system/mode', { credentials: 'include' })
            .then(r => {
                if (!r.ok) throw new Error(`mode endpoint unavailable: ${r.status}`);
                return r.json();
            })
            .then(data => {
                if (!mounted) return;
                const backendDemoEnabled = data.appMode === 'demo' && data.demoEnabled === true;
                const allowDemo = canUseDemoMode() && backendDemoEnabled;
                const allowAttackSim = data.attackSimEnabled === true;
                setCanToggleDemoMode(allowDemo);
                setAttackSimEnabled(allowAttackSim);

                // Data source is always 'api' - demo mode uses backend demo data
                // This is the key change: demo mode does NOT use local mock data
                setDataSource('api');

                if (!allowDemo) {
                    setIsDemoMode(false);
                    isDemoModeRef.current = false;
                    setRuntimeDemoMode(false);
                    if (typeof window !== 'undefined') {
                        localStorage.removeItem('demo_mode');
                    }
                } else {
                    setRuntimeDemoMode(isDemoModeRef.current);
                }
                setModeResolved(true);
            })
            .catch(() => {
                if (!mounted) return;
                setCanToggleDemoMode(false);
                setAttackSimEnabled(false);
                setIsDemoMode(false);
                isDemoModeRef.current = false;
                setRuntimeDemoMode(false);
                // Fallback to local data source when API is unavailable
                setDataSource('local');
                if (typeof window !== 'undefined') {
                    localStorage.removeItem('demo_mode');
                }
                setModeResolved(true);
            });

        return () => {
            mounted = false;
        };
    }, []);

    const toggleDemoMode = () => {
        if (!canToggleDemoMode) return;
        setIsDemoMode(prev => {
            const newValue = !prev;
            isDemoModeRef.current = newValue;
            setStoredDemoMode(newValue);
            setRuntimeDemoMode(newValue);
            window.location.reload();
            return newValue;
        });
    };

    return (
        <DemoContext.Provider value={{ isDemoMode, toggleDemoMode, canToggleDemoMode, attackSimEnabled, modeResolved, dataSource }}>
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
