import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { fetchCurrentUserSession, isRequestAbortError } from '../services/api';

interface WebSocketContextType {
    connected: boolean;
    subscribe: (event: string, callback: (data: any) => void) => () => void;
    emit: (event: string, data: any) => void;
    addTerminalLog: (message: string) => void;
    terminalLogs: string[];
    reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider = ({ children }: { children: ReactNode }) => {
    const location = useLocation();
    const [connected, setConnected] = useState(false);
    const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
    const socketRef = useRef<Socket | null>(null);
    const subscribersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

    const addTerminalLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setTerminalLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    }, []);

    const connectSocket = useCallback(() => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        // Connect to current host - Vite proxy will forward to backend
        const socket = io({
            autoConnect: true,
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionAttempts: 10,
            withCredentials: true,
            auth: {
                type: 'dashboard'
            }
        });

        socket.on('connect', () => {
            addTerminalLog('WebSocket connected');
            setConnected(true);
        });

        socket.on('disconnect', () => {
            addTerminalLog('WebSocket disconnected');
            setConnected(false);
        });

        socket.on('connect_error', (error) => {
            addTerminalLog(`WebSocket connection error: ${error.message}`);
            setConnected(false);
        });

        socket.onAny((event, data) => {
            const subscribers = subscribersRef.current.get(event);
            if (subscribers) {
                subscribers.forEach(callback => callback(data));
            }
            const allSubscribers = subscribersRef.current.get('*');
            if (allSubscribers) {
                allSubscribers.forEach(callback => callback({ event, ...data }));
            }
        });

        socketRef.current = socket;
    }, [addTerminalLog]);

    useEffect(() => {
        const isPublicRoute =
            location.pathname === '/' ||
            location.pathname === '/login' ||
            location.pathname === '/privacy' ||
            location.pathname === '/terms';

        if (isPublicRoute) {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            setConnected(false);
            return;
        }

        const controller = new AbortController();
        let disposed = false;

        const syncSocketSession = async () => {
            try {
                const user = await fetchCurrentUserSession(controller.signal);
                if (disposed || controller.signal.aborted) {
                    return;
                }

                if (user) {
                    connectSocket();
                    return;
                }
            } catch (error) {
                if (disposed || isRequestAbortError(error, controller.signal)) {
                    return;
                }
            }

            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            setConnected(false);
        };

        void syncSocketSession();

        return () => {
            disposed = true;
            controller.abort();
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [connectSocket, location.pathname]);

    const subscribe = useCallback((event: string, callback: (data: any) => void) => {
        if (!subscribersRef.current.has(event)) {
            subscribersRef.current.set(event, new Set());
        }
        subscribersRef.current.get(event)!.add(callback);

        return () => {
            subscribersRef.current.get(event)?.delete(callback);
        };
    }, []);

    const emit = useCallback((event: string, data: any) => {
        if (socketRef.current && connected) {
            socketRef.current.emit(event, data);
        }
    }, [connected]);

    const reconnect = useCallback(() => {
        connectSocket();
    }, [connectSocket]);

    return (
        <WebSocketContext.Provider value={{ connected, subscribe, emit, addTerminalLog, terminalLogs, reconnect }}>
            {children}
        </WebSocketContext.Provider>
    );
};

export const useWebSocket = () => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
};
