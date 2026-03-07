import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

const LIVE_MODE_STORAGE_KEY = 'aetherguard-live-mode';

interface LiveModeContextType {
    liveModeEnabled: boolean;
    setLiveModeEnabled: (next: boolean) => void;
    toggleLiveMode: () => void;
}

const LiveModeContext = createContext<LiveModeContextType | undefined>(undefined);

export const LiveModeProvider = ({ children }: { children: ReactNode }) => {
    const [liveModeEnabled, setLiveModeEnabledState] = useState<boolean>(() => {
        const raw = window.localStorage.getItem(LIVE_MODE_STORAGE_KEY);
        return raw === null ? true : raw === 'true';
    });

    useEffect(() => {
        window.localStorage.setItem(LIVE_MODE_STORAGE_KEY, String(liveModeEnabled));
    }, [liveModeEnabled]);

    const value = useMemo<LiveModeContextType>(() => ({
        liveModeEnabled,
        setLiveModeEnabled: setLiveModeEnabledState,
        toggleLiveMode: () => setLiveModeEnabledState((current) => !current)
    }), [liveModeEnabled]);

    return <LiveModeContext.Provider value={value}>{children}</LiveModeContext.Provider>;
};

export const useLiveMode = () => {
    const context = useContext(LiveModeContext);
    if (!context) {
        throw new Error('useLiveMode must be used within a LiveModeProvider');
    }
    return context;
};
