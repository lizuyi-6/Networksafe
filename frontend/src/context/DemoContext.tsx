import { createContext, useState, useContext, ReactNode, useEffect } from 'react';

interface DemoContextType {
    isDemoMode: boolean;
    toggleDemoMode: () => void;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider = ({ children }: { children: ReactNode }) => {
    const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
        return localStorage.getItem('demo_mode') === 'true';
    });

    const toggleDemoMode = () => {
        setIsDemoMode(prev => {
            const newValue = !prev;
            localStorage.setItem('demo_mode', String(newValue));
            window.location.reload(); // Reload to ensure all services/components pick up the change
            return newValue;
        });
    };

    return (
        <DemoContext.Provider value={{ isDemoMode, toggleDemoMode }}>
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
