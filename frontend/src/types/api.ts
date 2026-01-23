export interface HistoryPoint {
    time: string;
    requests: number;
    blocked: number;
}

export interface ThreatItem {
    name: string;
    value: number;
    color: string;
}

export interface DashboardStats {
    totalRequests: number;
    currentRPS: number;
    blockedRequests: number;
    activeConnections: number;
    successRate: number;
    history: HistoryPoint[];
    threats: ThreatItem[];
}

export interface AdminError {
    userId: string;
    errorCode: string;
    message: string;
    timestamp: string;
}

export interface ServerPerf {
    cpu: number;
    memory: number;
}

export interface ClientPerf {
    total_agents: number;
    avg_cpu_overhead: string;
    avg_latency_added: string;
}

export interface LogItem {
    id: number;
    time: string;
    type: string;
    level: string;
    message: string;
    ip: string;
    status?: number; // Optional mapping
    method?: string; // Optional mapping
    path?: string;   // Optional mapping
}

export interface AdminPerformance {
    server: ServerPerf;
    clients: ClientPerf;
}
