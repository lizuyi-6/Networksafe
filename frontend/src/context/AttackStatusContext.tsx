import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useWebSocket } from './WebSocketContext';

interface AttackStatus {
    isRunning: boolean;
    total: number;
    completed: number;
    blocked: number;
    allowed: number;
    currentAttack: string | null;
    startTime: Date | null;
}

interface AttackStatusContextType {
    status: AttackStatus;
}

const AttackStatusContext = createContext<AttackStatusContextType | undefined>(undefined);

export const AttackStatusProvider = ({ children }: { children: ReactNode }) => {
    const { subscribe } = useWebSocket();
    const [status, setStatus] = useState<AttackStatus>({
        isRunning: false,
        total: 0,
        completed: 0,
        blocked: 0,
        allowed: 0,
        currentAttack: null,
        startTime: null
    });

    useEffect(() => {
        const unsubscribe = subscribe('*', (data: any) => {
            const { event, ...eventData } = data;

            switch (event) {
                case 'attack:simulation:start':
                    setStatus({
                        isRunning: true,
                        total: eventData.totalAttacks,
                        completed: 0,
                        blocked: 0,
                        allowed: 0,
                        currentAttack: null,
                        startTime: new Date()
                    });
                    break;

                case 'attack:start':
                    setStatus(prev => ({
                        ...prev,
                        currentAttack: eventData.attackName
                    }));
                    break;

                case 'attack:result':
                    setStatus(prev => ({
                        ...prev,
                        completed: prev.completed + 1,
                        blocked: prev.blocked + (eventData.blocked ? 1 : 0),
                        allowed: prev.allowed + (eventData.blocked ? 0 : 1)
                    }));
                    break;

                case 'attack:simulation:complete':
                    setStatus(prev => ({
                        ...prev,
                        isRunning: false,
                        currentAttack: null
                    }));
                    break;
            }
        });

        return () => {
            unsubscribe();
        };
    }, [subscribe]);

    return (
        <AttackStatusContext.Provider value={{ status }}>
            {children}
        </AttackStatusContext.Provider>
    );
};

export const useAttackStatus = () => {
    const context = useContext(AttackStatusContext);
    if (!context) {
        throw new Error('useAttackStatus must be used within an AttackStatusProvider');
    }
    return context;
};
