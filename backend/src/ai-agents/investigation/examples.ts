/**
 * Bug Investigation Agent Team - Usage Examples
 *
 * Practical examples of using the bug investigation agent team.
 */

import { BugInvestigationTeam } from './index';
import { BugReport, InvestigationContext } from './types';

// ============================================
// Example 1: Basic Bug Investigation
// ============================================

async function basicInvestigationExample() {
  const team = BugInvestigationTeam.getInstance();

  // Create bug report
  const bugReport = BugInvestigationTeam.createBugReport({
    title: 'Payment service timeout',
    description: 'Payment service times out after 30 seconds when processing bulk payments',
    severity: 'high',
    category: 'performance',
    reproductionSteps: [
      'Create bulk payment with 100+ items',
      'Submit payment request',
      'Request times out after 30 seconds'
    ],
    environment: {
      os: 'Ubuntu 22.04',
      runtime: 'Node.js v18.17.0',
      version: '2.1.0'
    },
    reporter: 'john.doe@example.com'
  });

  // Create investigation context
  const context = BugInvestigationTeam.createContext({
    bugReport,
    logs: [
      {
        timestamp: new Date('2024-01-15T10:30:00Z'),
        level: 'error',
        service: 'payment-service',
        message: 'Request timeout: Operation timed out after 30000ms',
        metadata: {
          requestId: 'req-123',
          userId: 'user-456'
        },
        traceId: 'trace-abc-123'
      },
      {
        timestamp: new Date('2024-01-15T10:30:05Z'),
        level: 'warn',
        service: 'payment-service',
        message: 'Database query took 25000ms',
        metadata: {
          query: 'SELECT * FROM payments WHERE status = "pending"',
          duration: 25000
        }
      }
    ],
    traces: [
      {
        traceId: 'trace-abc-123',
        spanId: 'span-1',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        duration: 30000,
        service: 'payment-service',
        operation: 'processBulkPayment',
        tags: {
          'payment.count': '100',
          'user.id': 'user-456'
        },
        status: 'error',
        error: {
          message: 'Operation timed out'
        }
      }
    ],
    metrics: {
      cpu: {
        usage: 85,
        loadAverage: [2.5, 2.3, 2.1]
      },
      memory: {
        used: 2048,
        total: 4096,
        percentage: 50
      },
      network: {
        inbound: 1024000,
        outbound: 512000,
        connections: 50
      }
    }
  });

  // Start investigation
  console.log('Starting investigation...');
  const result = await team.investigate(bugReport, context);

  console.log('Investigation completed:', result.investigationId);
  console.log('Findings:', result.findings.length);
  console.log('Root cause:', result.rootCause?.description);
  console.log('Solutions:', result.recommendedSolutions.length);
  console.log('Confidence:', result.confidence);

  return result;
}

// ============================================
// Example 2: Security Bug Investigation
// ============================================

async function securityInvestigationExample() {
  const team = BugInvestigationTeam.getInstance();

  const bugReport = BugInvestigationTeam.createBugReport({
    title: 'SQL injection vulnerability in user search',
    description: 'User search endpoint vulnerable to SQL injection attacks',
    severity: 'critical',
    category: 'security',
    reproductionSteps: [
      'Navigate to user search endpoint',
      'Enter search query: \' OR "1"="1',
      'System returns all users instead of filtered results'
    ],
    environment: {
      os: 'Ubuntu 22.04',
      runtime: 'Node.js v18.17.0',
      version: '2.1.0'
    },
    reporter: 'security-team@example.com'
  });

  const context = BugInvestigationTeam.createContext({
    bugReport,
    logs: [
      {
        timestamp: new Date(),
        level: 'error',
        service: 'api-gateway',
        message: 'Potential SQL injection detected',
        metadata: {
          query: 'SELECT * FROM users WHERE name = \'\' OR "1"="1\'',
          ip: '192.168.1.100'
        }
      }
    ],
    codeContext: {
      filePath: 'src/api/users.controller.ts',
      lineNumber: 42,
      function: 'searchUsers',
      codeSnippet: `
        const query = \`SELECT * FROM users WHERE name = '\${req.params.query}'\`;
        const results = await database.execute(query);
      `
    }
  });

  const result = await team.investigate(bugReport, context);

  console.log('Security investigation results:');
  console.log('- Severity:', result.rootCause?.category);
  console.log('- Affected file:', result.rootCause?.location.file);
  console.log('- Solutions:', result.recommendedSolutions);

  return result;
}

// ============================================
// Example 3: Memory Leak Investigation
// ============================================

async function memoryLeakInvestigationExample() {
  const team = BugInvestigationTeam.getInstance();

  const bugReport = BugInvestigationTeam.createBugReport({
    title: 'Memory leak in WebSocket connection handler',
    description: 'Memory usage increases over time as WebSocket connections are established and closed',
    severity: 'high',
    category: 'memory',
    reproductionSteps: [
      'Establish WebSocket connection',
      'Send and receive messages',
      'Close connection',
      'Monitor memory - not released'
    ],
    environment: {
      os: 'Alpine Linux',
      runtime: 'Node.js v20.5.0',
      version: '3.0.0'
    },
    reporter: 'monitoring-system'
  });

  const context = BugInvestigationTeam.createContext({
    bugReport,
    logs: [
      {
        timestamp: new Date(),
        level: 'error',
        service: 'websocket-gateway',
        message: 'OutOfMemoryError: JavaScript heap out of memory',
        metadata: {
          heapUsed: '4096MB',
          heapTotal: '4096MB',
          connections: 10000
        }
      }
    ],
    metrics: {
      cpu: {
        usage: 60,
        loadAverage: [1.5, 1.4, 1.3]
      },
      memory: {
        used: 4096,
        total: 4096,
        percentage: 100
      },
      customMetrics: {
        activeConnections: 10000,
        memoryPerConnection: 0.41
      }
    }
  });

  const result = await team.investigate(bugReport, context);

  console.log('Memory leak investigation:');
  console.log('- Root cause:', result.rootCause?.description);
  console.log('- Contributing factors:', result.rootCause?.contributingFactors);
  console.log('- Recommended solutions:');
  result.recommendedSolutions.forEach((solution, index) => {
    console.log(`  ${index + 1}. [${solution.priority}] ${solution.description}`);
    console.log(`     Risk: ${solution.risk}, Effort: ${solution.estimatedEffort}`);
  });

  return result;
}

// ============================================
// Example 4: Crash Investigation
// ============================================

async function crashInvestigationExample() {
  const team = BugInvestigationTeam.getInstance();

  const bugReport = BugInvestigationTeam.createBugReport({
    title: 'Application crashes when processing invalid JSON',
    description: 'Application crashes with unhandled exception when receiving malformed JSON',
    severity: 'critical',
    category: 'crash',
    reproductionSteps: [
      'Send POST request with invalid JSON',
      'Application crashes immediately'
    ],
    environment: {
      os: 'Debian 11',
      runtime: 'Node.js v18.17.0',
      version: '2.1.0'
    },
    reporter: 'api-monitor'
  });

  const context = BugInvestigationTeam.createContext({
    bugReport,
    logs: [
      {
        timestamp: new Date(),
        level: 'fatal',
        service: 'api-server',
        message: 'UnhandledPromiseRejection: SyntaxError: Unexpected token }',
        metadata: {
          stackTrace: 'at JSON.parse (<anonymous>)\n' +
                     'at parseBody (/app/src/middleware/body-parser.ts:42:15)',
          requestBody: '{"name": "test", "data": }}'
        }
      }
    ],
    codeContext: {
      filePath: 'src/middleware/body-parser.ts',
      lineNumber: 42,
      function: 'parseBody',
      codeSnippet: 'const parsed = JSON.parse(req.body);'
    }
  });

  const result = await team.investigate(bugReport, context);

  console.log('Crash investigation:');
  console.log('- Root cause:', result.rootCause?.description);
  console.log('- Location:', result.rootCause?.location);
  console.log('- Fix:', result.recommendedSolutions[0]?.implementation);

  return result;
}

// ============================================
// Example 5: Monitoring Investigation Status
// ============================================

async function monitoringExample() {
  const team = BugInvestigationTeam.getInstance();

  // Start an investigation
  const bugReport = BugInvestigationTeam.createBugReport({
    title: 'Test bug for monitoring',
    description: 'Testing investigation monitoring',
    severity: 'medium',
    category: 'functional'
  });

  const context = BugInvestigationTeam.createContext({
    bugReport,
    logs: [],
    traces: []
  });

  // Investigation runs asynchronously
  team.investigate(bugReport, context)
    .then(result => {
      console.log('Investigation completed!');
      console.log('ID:', result.investigationId);
      console.log('Confidence:', result.confidence);
    })
    .catch(error => {
      console.error('Investigation failed:', error);
    });

  // Monitor status
  const investigationId = 'pending-investigation-id'; // Would get from initial response
  console.log('Monitoring investigation...');

  const interval = setInterval(() => {
    const status = team.getInvestigationStatus(investigationId);

    if (status.status === 'completed') {
      clearInterval(interval);
      console.log('Investigation completed!');
    } else if (status.status === 'in_progress') {
      console.log('Progress:', status.tasksCompleted, '/', status.tasksTotal);
    } else if (status.status === 'failed') {
      clearInterval(interval);
      console.log('Investigation failed');
    }
  }, 5000);
}

// ============================================
// Example 6: Batch Investigation
// ============================================

async function batchInvestigationExample() {
  const team = BugInvestigationTeam.getInstance();

  const bugReports = [
    BugInvestigationTeam.createBugReport({
      title: 'Bug 1',
      description: 'First bug',
      severity: 'medium',
      category: 'functional'
    }),
    BugInvestigationTeam.createBugReport({
      title: 'Bug 2',
      description: 'Second bug',
      severity: 'high',
      category: 'performance'
    }),
    BugInvestigationTeam.createBugReport({
      title: 'Bug 3',
      description: 'Third bug',
      severity: 'low',
      category: 'functional'
    })
  ];

  // Investigate in parallel (with concurrency limit)
  const maxConcurrent = 3;
  const results = [];

  for (let i = 0; i < bugReports.length; i += maxConcurrent) {
    const batch = bugReports.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(bugReport => {
        const context = BugInvestigationTeam.createContext({
          bugReport,
          logs: [],
          traces: []
        });
        return team.investigate(bugReport, context);
      })
    );
    results.push(...batchResults);
  }

  console.log(`Completed ${results.length} investigations`);
  return results;
}

// ============================================
// Example 7: Using with Express API
// ============================================

async function apiIntegrationExample() {
  const fetch = require('node-fetch');

  const investigationData = {
    title: 'API timeout error',
    description: 'API endpoint /api/users times out intermittently',
    severity: 'high',
    category: 'performance',
    reproductionSteps: [
      'Call GET /api/users',
      'Wait 30+ seconds',
      'Receive timeout error'
    ],
    environment: {
      os: 'Ubuntu',
      runtime: 'Node.js v18',
      version: '1.0.0'
    },
    logs: [
      {
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'api-server',
        message: 'Request timeout',
        traceId: 'trace-123'
      }
    ]
  };

  const response = await fetch('http://localhost:3000/api/investigation/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-agent-token'
    },
    body: JSON.stringify(investigationData)
  });

  const result = await response.json();
  console.log('Investigation started:', result.data.investigationId);

  return result;
}

// ============================================
// Run Examples
// ============================================

async function main() {
  console.log('=== Bug Investigation Agent Team Examples ===\n');

  try {
    console.log('Example 1: Basic Investigation');
    await basicInvestigationExample();
    console.log('\n');

    // Uncomment to run other examples
    // console.log('Example 2: Security Investigation');
    // await securityInvestigationExample();
    // console.log('\n');

    // console.log('Example 3: Memory Leak Investigation');
    // await memoryLeakInvestigationExample();
    // console.log('\n');

    // console.log('Example 4: Crash Investigation');
    // await crashInvestigationExample();
    // console.log('\n');

  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export {
  basicInvestigationExample,
  securityInvestigationExample,
  memoryLeakInvestigationExample,
  crashInvestigationExample,
  monitoringExample,
  batchInvestigationExample,
  apiIntegrationExample
};
