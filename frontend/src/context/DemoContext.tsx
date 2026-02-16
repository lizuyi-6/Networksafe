import { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { canUseDemoMode, getStoredDemoMode, setRuntimeDemoMode, setStoredDemoMode } from '../config/demo-mode';

interface DemoContextType {
    isDemoMode: boolean;
    toggleDemoMode: () => void;
    canToggleDemoMode: boolean;
    attackSimEnabled: boolean;
    modeResolved: boolean;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider = ({ children }: { children: ReactNode }) => {
    const [canToggleDemoMode, setCanToggleDemoMode] = useState<boolean>(canUseDemoMode());
    const [isDemoMode, setIsDemoMode] = useState<boolean>(() => getStoredDemoMode());
    const [attackSimEnabled, setAttackSimEnabled] = useState<boolean>(false);
    const [modeResolved, setModeResolved] = useState<boolean>(false);

    useEffect(() => {
        let mounted = true;
        // Never expose demo data before backend mode capability is verified.
        setRuntimeDemoMode(false);

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
                if (!allowDemo) {
                    setIsDemoMode(false);
                    setRuntimeDemoMode(false);
                    if (typeof window !== 'undefined') {
                        localStorage.removeItem('demo_mode');
                    }
                } else {
                    setRuntimeDemoMode(isDemoMode);
                }
                setModeResolved(true);
            })
            .catch(() => {
                // Fail closed: disable demo capabilities when backend mode cannot be verified.
                setCanToggleDemoMode(false);
                setAttackSimEnabled(false);
                setIsDemoMode(false);
                setRuntimeDemoMode(false);
                if (typeof window !== 'undefined') {
                    localStorage.removeItem('demo_mode');
                }
                setModeResolved(true);
            });

        return () => {
            mounted = false;
        };
    }, [isDemoMode]);

    const toggleDemoMode = () => {
        if (!canToggleDemoMode) return;
        setIsDemoMode(prev => {
            const newValue = !prev;
            setStoredDemoMode(newValue);
            setRuntimeDemoMode(newValue);
            window.location.reload(); // Reload to ensure all services/components pick up the change
            return newValue;
        });
    };

    return (
        <DemoContext.Provider value={{ isDemoMode, toggleDemoMode, canToggleDemoMode, attackSimEnabled, modeResolved }}>
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
