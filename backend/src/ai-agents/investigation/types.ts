/**
 * Bug Investigation Agent Team
 *
 * A specialized multi-agent system for complex bug investigation and root cause analysis.
 * Extends the existing AI agent framework with investigation-specific capabilities.
 */

export interface BugReport {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'performance' | 'functional' | 'crash' | 'memory' | 'concurrency';
  reproductionSteps?: string[];
  environment: {
    os: string;
    runtime: string;
    version: string;
    region?: string;
  };
  reporter: string;
  timestamp: Date;
  attachments?: string[];
}

export interface InvestigationContext {
  bugReport: BugReport;
  systemState: {
    logs: LogEntry[];
    traces: TraceEvent[];
    metrics: SystemMetrics;
    codeContext?: CodeContext;
  };
  relatedIncidents?: string[];
  previousInvestigations?: InvestigationSummary[];
}

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string;
  message: string;
  metadata?: Record<string, any>;
  traceId?: string;
}

export interface TraceEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp: Date;
  duration: number;
  service: string;
  operation: string;
  tags: Record<string, string>;
  status: 'ok' | 'error';
  error?: {
    message: string;
    stackTrace?: string;
  };
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  network?: {
    inbound: number;
    outbound: number;
    connections: number;
  };
  customMetrics?: Record<string, number>;
}

export interface CodeContext {
  filePath: string;
  lineNumber: number;
  function: string;
  codeSnippet: string;
  relatedFiles?: string[];
}

export interface InvestigationResult {
  investigationId: string;
  bugReportId: string;
  findings: Finding[];
  rootCause?: RootCause;
  reproductionSteps?: ReproductionGuide;
  recommendedSolutions: Solution[];
  confidence: number;
  evidence: Evidence[];
  timestamp: Date;
  investigators: string[];
}

export interface Finding {
  type: 'anomaly' | 'error' | 'performance' | 'security' | 'configuration';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location?: string;
  evidence: string[];
  relatedFindings?: string[];
}

export interface RootCause {
  category: 'code' | 'configuration' | 'environment' | 'dependency' | 'design' | 'external';
  description: string;
  location: {
    file?: string;
    line?: number;
    function?: string;
    service?: string;
  };
  explanation: string;
  contributingFactors: string[];
}

export interface ReproductionGuide {
  steps: string[];
  prerequisites: string[];
  expectedBehavior: string;
  actualBehavior: string;
  successRate: number;
}

export interface Solution {
  type: 'hotfix' | 'refactor' | 'configuration' | 'upgrade' | 'workaround';
  priority: 'immediate' | 'urgent' | 'normal' | 'low';
  description: string;
  implementation: string;
  estimatedEffort: string;
  risk: 'low' | 'medium' | 'high';
  sideEffects?: string[];
  codeChanges?: CodeChange[];
}

export interface CodeChange {
  filePath: string;
  oldCode?: string;
  newCode: string;
  lineNumber?: number;
  description: string;
}

export interface Evidence {
  type: 'log' | 'trace' | 'metric' | 'code' | 'test' | 'screenshot' | 'user_report';
  description: string;
  source: string;
  timestamp: Date;
  data: any;
}

export interface InvestigationSummary {
  investigationId: string;
  date: Date;
  outcome: 'resolved' | 'mitigated' | 'investigating' | 'closed';
  summary: string;
}

export interface AgentTask {
  taskId: string;
  assignedTo: string;
  taskType: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  input: any;
  output?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
}

export enum InvestigationAgentType {
  BUG_REPRODUCTION = 'bug_reproduction',
  CODE_ANALYSIS = 'code_analysis',
  LOG_ANALYSIS = 'log_analysis',
  TRACE_ANALYSIS = 'trace_analysis',
  ROOT_CAUSE = 'root_cause',
  SOLUTION = 'solution',
  COORDINATOR = 'coordinator'
}

export interface InvestigationAgentCapabilities {
  agentType: InvestigationAgentType;
  capabilities: string[];
  tools: string[];
  expertise: string[];
}
