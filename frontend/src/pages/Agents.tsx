import { useEffect, useState } from 'react';
import {
    Server, Activity, Wifi, WifiOff,
    RefreshCw, Scan, AlertTriangle,
    Cpu, HardDrive, Clock
} from 'lucide-react';
import { fetchRecentAgentThreats } from '../services/api';

interface Agent {
    agentId: string;
    hostname: string;
    platform: string;
    isOnline: boolean;
    lastHeartbeat: string;
    status?: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
    };
    registration?: {
        arch: string;
        cpus: number;
        totalMemory: number;
        version: string;
    };
}

interface ThreatEvent {
    id?: string;
    title?: string;
    message?: string;
    severity: string;
    source?: string;
    timestamp: string;
}

const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
};

const Agents = () => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [threats, setThreats] = useState<ThreatEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchAgents = async () => {
        try {
            const response = await fetch('/api/agents', { credentials: 'include' });
            if (!response.ok) throw new Error(`FG-AGENTS-LIST-${response.status}`);
            const data = await response.json();
            setAgents(data?.agents || []);
        } catch (e: any) {
            setAgents([]);
            setError(e.message || 'FG-AGENTS-LIST-ERR');
        } finally {
            setLoading(false);
        }
    };

    const fetchThreats = async () => {
        try {
            const rows = await fetchRecentAgentThreats(50);
            setThreats(rows || []);
        } catch (e: any) {
            setThreats([]);
            setError(e.message || 'FG-AGENTS-THREATS-ERR');
        }
    };

    const triggerScan = async (agentId: string) => {
        try {
            const response = await fetch(`/api/agents/${agentId}/scan`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) throw new Error(`FG-AGENT-SCAN-${response.status}`);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchAgents();
        fetchThreats();
        const interval = setInterval(() => {
            fetchAgents();
            fetchThreats();
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const onlineCount = agents.filter(a => a.isOnline).length;

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Agent Command Center</h2>
                    <p className="text-sm text-muted-foreground mt-1">Real-time monitoring and control of distributed security agents</p>
                </div>
                <button
                    onClick={() => { fetchAgents(); fetchThreats(); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border text-foreground rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all shadow-sm"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {error && (
                <div className="p-3 rounded border border-red-500/30 text-red-300 bg-red-500/10 text-sm">{error}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                    <div className="text-sm text-muted-foreground">Total Agents</div>
                    <div className="text-3xl font-bold text-foreground">{agents.length}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                    <div className="text-sm text-muted-foreground">Active Nodes</div>
                    <div className="text-3xl font-bold text-foreground">{onlineCount}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                    <div className="text-sm text-muted-foreground">Threats</div>
                    <div className="text-3xl font-bold text-foreground">{threats.length}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                    <div className="text-sm text-muted-foreground">Uptime Rate</div>
                    <div className="text-3xl font-bold text-foreground">{Math.round((onlineCount / (agents.length || 1)) * 100)}%</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm">
                    <h3 className="font-semibold text-foreground mb-5 flex items-center gap-2"><Server size={16} className="text-primary" /> Active Fleet</h3>
                    {loading ? (
                        <div className="text-center py-12 text-muted-foreground">Loading fleet data...</div>
                    ) : agents.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">No agents connected</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {agents.map(agent => (
                                <div key={agent.agentId} className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-all">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${agent.isOnline ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                                                <Server className={agent.isOnline ? 'text-emerald-500' : 'text-red-500'} size={20} />
                                            </div>
                                            <div>
                                                <h3 className="font-medium text-foreground">{agent.hostname || agent.agentId}</h3>
                                                <p className="text-xs text-muted-foreground font-mono">{agent.agentId}</p>
                                            </div>
                                        </div>
                                        <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${agent.isOnline ? 'text-emerald-500 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>
                                            {agent.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                                            {agent.isOnline ? 'Online' : 'Offline'}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 mb-4">
                                        <div className="text-center p-2 bg-muted/30 rounded">
                                            <Cpu size={14} className="mx-auto text-muted-foreground mb-1" />
                                            <div className="text-sm font-medium text-foreground">{agent.status?.cpuUsage ?? '--'}%</div>
                                            <div className="text-xxs text-muted-foreground">CPU</div>
                                        </div>
                                        <div className="text-center p-2 bg-muted/30 rounded">
                                            <HardDrive size={14} className="mx-auto text-muted-foreground mb-1" />
                                            <div className="text-sm font-medium text-foreground">{agent.status?.memoryUsage ?? '--'}%</div>
                                            <div className="text-xxs text-muted-foreground">Memory</div>
                                        </div>
                                        <div className="text-center p-2 bg-muted/30 rounded">
                                            <Clock size={14} className="mx-auto text-muted-foreground mb-1" />
                                            <div className="text-sm font-medium text-foreground">{agent.status?.uptime ? formatUptime(agent.status.uptime) : '--'}</div>
                                            <div className="text-xxs text-muted-foreground">Uptime</div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => triggerScan(agent.agentId)}
                                        disabled={!agent.isOnline}
                                        className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    >
                                        <Scan size={14} /> Scan
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-card border border-border rounded-xl p-5 shadow-sm max-h-[500px] flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-semibold text-foreground flex items-center gap-2"><AlertTriangle size={16} className="text-orange-500" /> Security Alerts</h3>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Live</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                        {threats.map((event: any, idx: number) => (
                            <div key={event.id || idx} className="p-3 rounded-lg border bg-orange-500/5 border-orange-500/20">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle size={16} />
                                        <span className="font-medium text-sm">{event.title || 'Security Event'}</span>
                                    </div>
                                    <span className="text-xxs uppercase font-bold">{event.severity || 'medium'}</span>
                                </div>
                                <div className="mt-2 text-xs space-y-1 opacity-80">
                                    <div>{event.message || '-'}</div>
                                    <div>Source: {event.source || '-'}</div>
                                    <div>Time: {new Date(event.timestamp).toLocaleString()}</div>
                                </div>
                            </div>
                        ))}
                        {threats.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-sm">No active threats detected.</div>
                        )}
                    </div>

                    <div className="mt-4 p-3 rounded border border-border bg-muted/20 text-xs text-muted-foreground flex items-center gap-2">
                        <Activity size={14} /> Node distribution is disabled until real geo telemetry is available.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Agents;
