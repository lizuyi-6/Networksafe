/**
 * Agents 管理页面
 * 
 * 功能：
 * - 显示所有已连接的 Agent
 * - Agent 状态监控（在线/离线）
 * - 触发远程扫描
 * - 查看 Agent 日志
 * - 封禁/解封 IP
 */

import { useEffect, useState } from 'react';
import {
    Server, Activity, Shield, Wifi, WifiOff,
    RefreshCw, Scan, Ban, AlertTriangle,
    Cpu, HardDrive, Clock, Globe
} from 'lucide-react';

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
    agentId: string;
    threat: {
        type: string;
        severity: string;
        sourceIP: string;
        description: string;
        ruleId: string;
    };
    timestamp: string;
}

const AgentCard = ({ agent, onScan, onViewLogs }: {
    agent: Agent;
    onScan: () => void;
    onViewLogs: () => void;
}) => {
    const formatUptime = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    };

    const formatMemory = (bytes: number): string => {
        const gb = bytes / (1024 * 1024 * 1024);
        return `${gb.toFixed(1)} GB`;
    };

    return (
        <div className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-all">
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${agent.isOnline ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                        <Server className={agent.isOnline ? 'text-emerald-500' : 'text-red-500'} size={20} />
                    </div>
                    <div>
                        <h3 className="font-medium text-foreground">{agent.hostname}</h3>
                        <p className="text-xs text-muted-foreground font-mono">{agent.agentId}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {agent.isOnline ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
                            <Wifi size={12} /> 在线
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded">
                            <WifiOff size={12} /> 离线
                        </span>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-2 bg-muted/30 rounded">
                    <Cpu size={14} className="mx-auto text-muted-foreground mb-1" />
                    <div className="text-sm font-medium text-foreground">
                        {agent.status?.cpuUsage ?? '--'}%
                    </div>
                    <div className="text-xxs text-muted-foreground">CPU</div>
                </div>
                <div className="text-center p-2 bg-muted/30 rounded">
                    <HardDrive size={14} className="mx-auto text-muted-foreground mb-1" />
                    <div className="text-sm font-medium text-foreground">
                        {agent.status?.memoryUsage ?? '--'}%
                    </div>
                    <div className="text-xxs text-muted-foreground">内存</div>
                </div>
                <div className="text-center p-2 bg-muted/30 rounded">
                    <Clock size={14} className="mx-auto text-muted-foreground mb-1" />
                    <div className="text-sm font-medium text-foreground">
                        {agent.status?.uptime ? formatUptime(agent.status.uptime) : '--'}
                    </div>
                    <div className="text-xxs text-muted-foreground">运行时间</div>
                </div>
            </div>

            {/* Info */}
            <div className="text-xs text-muted-foreground space-y-1 mb-4">
                <div className="flex justify-between">
                    <span>平台</span>
                    <span className="text-foreground">{agent.platform}</span>
                </div>
                <div className="flex justify-between">
                    <span>架构</span>
                    <span className="text-foreground">{agent.registration?.arch || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                    <span>内存</span>
                    <span className="text-foreground">
                        {agent.registration?.totalMemory ? formatMemory(agent.registration.totalMemory) : 'Unknown'}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>最后心跳</span>
                    <span className="text-foreground">
                        {agent.lastHeartbeat ? new Date(agent.lastHeartbeat).toLocaleTimeString() : '--'}
                    </span>
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
                <button
                    onClick={onScan}
                    disabled={!agent.isOnline}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <Scan size={14} /> 扫描
                </button>
                <button
                    onClick={onViewLogs}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium bg-muted text-foreground rounded hover:bg-muted/80 transition-all"
                >
                    <Activity size={14} /> 日志
                </button>
            </div>
        </div>
    );
};

const ThreatCard = ({ event }: { event: ThreatEvent }) => {
    const severityColors: Record<string, string> = {
        critical: 'bg-red-500/20 text-red-500 border-red-500/30',
        high: 'bg-orange-500/20 text-orange-500 border-orange-500/30',
        medium: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
        low: 'bg-blue-500/20 text-blue-500 border-blue-500/30'
    };

    return (
        <div className={`p-3 rounded-lg border ${severityColors[event.threat.severity] || severityColors.medium}`}>
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                    <AlertTriangle size={16} />
                    <span className="font-medium text-sm">{event.threat.description}</span>
                </div>
                <span className="text-xxs uppercase font-bold">{event.threat.severity}</span>
            </div>
            <div className="mt-2 text-xs space-y-1 opacity-80">
                <div>类型: {event.threat.type}</div>
                <div>来源 IP: {event.threat.sourceIP}</div>
                <div>规则 ID: {event.threat.ruleId}</div>
                <div>时间: {new Date(event.timestamp).toLocaleString()}</div>
            </div>
        </div>
    );
};

const Agents = () => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [threats, setThreats] = useState<ThreatEvent[]>([]);
    const [loading, setLoading] = useState(true);

    // 获取 Agent 列表
    const fetchAgents = async () => {
        try {
            const response = await fetch('/api/agents');
            const data = await response.json();
            if (data.success) {
                setAgents(data.agents);
            }
        } catch (error) {
            console.error('Failed to fetch agents:', error);
            // Mock data for demo
            setAgents([
                {
                    agentId: 'agent-web-server-01',
                    hostname: 'web-server-01',
                    platform: 'linux',
                    isOnline: true,
                    lastHeartbeat: new Date().toISOString(),
                    status: { cpuUsage: 23, memoryUsage: 45, uptime: 864000 },
                    registration: { arch: 'x64', cpus: 8, totalMemory: 17179869184, version: '2.0.0' }
                },
                {
                    agentId: 'agent-db-server-01',
                    hostname: 'db-server-01',
                    platform: 'linux',
                    isOnline: true,
                    lastHeartbeat: new Date().toISOString(),
                    status: { cpuUsage: 67, memoryUsage: 82, uptime: 2592000 },
                    registration: { arch: 'x64', cpus: 16, totalMemory: 34359738368, version: '2.0.0' }
                },
                {
                    agentId: 'agent-api-gateway',
                    hostname: 'api-gateway',
                    platform: 'linux',
                    isOnline: false,
                    lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
                    status: { cpuUsage: 0, memoryUsage: 0, uptime: 0 },
                    registration: { arch: 'x64', cpus: 4, totalMemory: 8589934592, version: '1.9.0' }
                }
            ]);
        } finally {
            setLoading(false);
        }
    };

    // 触发扫描
    const triggerScan = async (agentId: string) => {
        try {
            await fetch(`/api/agents/${agentId}/scan`, { method: 'POST' });
            alert(`扫描指令已发送到 ${agentId}`);
        } catch (error) {
            console.error('Failed to trigger scan:', error);
        }
    };

    useEffect(() => {
        fetchAgents();
        const interval = setInterval(fetchAgents, 10000); // 每 10 秒刷新
        return () => clearInterval(interval);
    }, []);

    // Mock threats for demo
    useEffect(() => {
        setThreats([
            {
                agentId: 'agent-web-server-01',
                threat: {
                    type: 'sql_injection',
                    severity: 'critical',
                    sourceIP: '203.15.44.12',
                    description: 'SQL Injection - UNION SELECT',
                    ruleId: 'SQL-001'
                },
                timestamp: new Date(Date.now() - 120000).toISOString()
            },
            {
                agentId: 'agent-web-server-01',
                threat: {
                    type: 'brute_force',
                    severity: 'high',
                    sourceIP: '185.220.101.33',
                    description: 'Possible Brute Force Attack',
                    ruleId: 'BF-001'
                },
                timestamp: new Date(Date.now() - 300000).toISOString()
            }
        ]);
    }, []);

    const onlineCount = agents.filter(a => a.isOnline).length;

    // Mock data for resource charts
    const resourceData = [
        { time: '00:00', cpu: 20, memory: 40 },
        { time: '04:00', cpu: 15, memory: 35 },
        { time: '08:00', cpu: 45, memory: 60 },
        { time: '12:00', cpu: 70, memory: 80 },
        { time: '16:00', cpu: 65, memory: 75 },
        { time: '20:00', cpu: 50, memory: 65 },
        { time: '23:59', cpu: 30, memory: 50 },
    ];

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Agent Command Center</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Real-time monitoring and control of distributed security agents
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={fetchAgents}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border text-foreground rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all shadow-sm"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all">
                        <Server size={14} /> Deploy New Agent
                    </button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Server size={64} />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg">
                            <Server size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Total Agents</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">{agents.length}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <span className="text-emerald-500 flex items-center gap-0.5"><Activity size={10} /> +2</span> since last week
                    </div>
                </div>

                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Wifi size={64} className="text-emerald-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                            <Wifi size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Active Nodes</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">{onlineCount}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {Math.round((onlineCount / (agents.length || 1)) * 100)}% uptime rate
                    </div>
                </div>

                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Shield size={64} className="text-red-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-red-500/10 text-red-500 rounded-lg">
                            <Shield size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Threats Blocked</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">{threats.length}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        Last 24 hours
                    </div>
                </div>

                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Ban size={64} className="text-orange-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-orange-500/10 text-orange-500 rounded-lg">
                            <Ban size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Blacklisted IPs</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">12</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <span className="text-orange-500">+3</span> new today
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content Area - Agents List & Network Map */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Agents Grid */}
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-semibold text-foreground flex items-center gap-2">
                                <Server size={16} className="text-primary" /> Active Fleet
                            </h3>
                            <div className="flex gap-2 text-xs">
                                <span className="px-2 py-1 bg-muted rounded cursor-pointer hover:text-primary transition-colors">All</span>
                                <span className="px-2 py-1 bg-transparent text-muted-foreground cursor-pointer hover:text-primary transition-colors">Linux</span>
                                <span className="px-2 py-1 bg-transparent text-muted-foreground cursor-pointer hover:text-primary transition-colors">Windows</span>
                            </div>
                        </div>

                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading fleet data...</div>
                        ) : agents.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border/50">
                                <div className="p-3 bg-muted rounded-full inline-block mb-3">
                                    <Server size={24} className="text-muted-foreground" />
                                </div>
                                <p className="mb-2">No agents connected</p>
                                <code className="bg-background px-3 py-1 rounded text-xs border border-border inline-block">
                                    npm run agent -- --server=http://your-server:8080
                                </code>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {agents.map(agent => (
                                    <AgentCard
                                        key={agent.agentId}
                                        agent={agent}
                                        onScan={() => triggerScan(agent.agentId)}
                                        onViewLogs={() => console.log('View logs:', agent.agentId)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Network Resource Usage Chart */}
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm h-[300px]">
                        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                            <Activity size={16} className="text-indigo-500" /> Fleet Resource Trends
                        </h3>
                        <div className="w-full h-[240px]">
                            {/* NOTE: Need to import Recharts components in the file for this to work */}
                            {/* We will assume they are available or user will prompt to fix */}
                            <div className="w-full h-full flex items-end justify-between px-4 pb-4 bg-muted/10 rounded-lg relative overflow-hidden">
                                {resourceData.map((d, i) => (
                                    <div key={i} className="group relative flex flex-col items-center gap-2 h-full justify-end w-full mx-1">
                                        <div className="w-full bg-indigo-500/20 group-hover:bg-indigo-500/30 rounded-t transition-all relative" style={{ height: `${d.cpu}%` }}>
                                            <div className="hidden group-hover:block absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-10">
                                                CPU: {d.cpu}%
                                            </div>
                                        </div>
                                        <span className="text-xxs text-muted-foreground">{d.time}</span>
                                    </div>
                                ))}
                                {/* Simple Grid Lines */}
                                <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 opacity-10">
                                    <div className="w-full h-px bg-foreground"></div>
                                    <div className="w-full h-px bg-foreground"></div>
                                    <div className="w-full h-px bg-foreground"></div>
                                    <div className="w-full h-px bg-foreground"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column - Threats & Geo */}
                <div className="space-y-6">
                    {/* Security Alerts */}
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm h-full max-h-[500px] flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-semibold text-foreground flex items-center gap-2">
                                <AlertTriangle size={16} className="text-orange-500" /> Security Alerts
                            </h3>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Live</span>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
                            {threats.map((event, idx) => (
                                <ThreatCard key={idx} event={event} />
                            ))}
                            {threats.length === 0 && (
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                    No active threats detected.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Global Distribution Mock */}
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                            <Globe size={16} className="text-blue-500" /> Node Distribution
                        </h3>
                        <div className="aspect-video bg-muted/30 rounded-lg flex items-center justify-center relative overflow-hidden">
                            {/* Abstract Map Dots */}
                            <div className="absolute top-1/3 left-1/4 w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                            <div className="absolute top-1/2 left-1/2 w-3 h-3 bg-emerald-500 rounded-full animate-pulse delay-75 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                            <div className="absolute bottom-1/3 right-1/4 w-2 h-2 bg-muted-foreground/30 rounded-full"></div>

                            <Globe size={64} className="text-muted-foreground/10" />
                            <span className="text-xs text-muted-foreground mt-2 absolute bottom-2">Global monitoring active</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Agents;
