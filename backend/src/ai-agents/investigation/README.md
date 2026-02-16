# Bug Investigation Agent Team

A sophisticated multi-agent system for investigating and resolving complex bugs using AI-powered analysis.

## Overview

The Bug Investigation Agent Team is a specialized component of the AI Security Middleware system that coordinates multiple specialized agents to perform comprehensive bug investigations. It extends the existing 7-layer AI agent framework with investigation-specific capabilities.

## Architecture

### Investigation Workflow

```
Bug Report → Context Collection → Agent Team Analysis → Result Compilation
                    ↓
    ┌───────────────┴───────────────┐
    │                                │
┌───▼────┐  ┌─────────┐  ┌─────────▼─────┐
│  API   │  │ Database│  │  Agent Team    │
│ Layer  │  │ Service │  │  Coordinator   │
└────────┘  └─────────┘  └───────┬───────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
    ┌──────▼──────┐      ┌────────▼────────┐    ┌────────▼────────┐
    │Log Analysis │      │Trace Analysis   │    │Bug Reproduction │
    │Agent        │      │Agent            │    │Agent            │
    └─────────────┘      └─────────────────┘    └─────────────────┘
           │                       │                       │
           └───────────────────────┼───────────────────────┘
                                   │
                          ┌────────▼────────┐
                          │Code Analysis    │
                          │Agent            │
                          └─────────────────┘
                                   │
                          ┌────────▼────────┐
                          │Root Cause       │
                          │Agent            │
                          └─────────────────┘
                                   │
                          ┌────────▼────────┐
                          │Solution         │
                          │Agent            │
                          └─────────────────┘
```

### Specialized Agents

1. **Log Analysis Agent** - Analyzes logs to identify patterns, errors, and anomalies
2. **Trace Analysis Agent** - Examines distributed traces for performance and failure patterns
3. **Bug Reproduction Agent** - Generates reproduction guides and validates bug reports
4. **Code Analysis Agent** - Performs static code analysis to identify issues
5. **Root Cause Agent** - Correlates evidence to determine root cause
6. **Solution Agent** - Generates remediation strategies and solutions

## API Usage

### Start Investigation

**POST** `/api/investigation/start`

```bash
curl -X POST http://localhost:3000/api/investigation/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <agent-token>" \
  -d '{
    "title": "High memory usage in payment service",
    "description": "Payment service shows memory leaks after processing 1000+ transactions",
    "severity": "high",
    "category": "memory",
    "reproductionSteps": [
      "Send 1000 payment requests",
      "Monitor memory usage",
      "Memory keeps increasing"
    ],
    "environment": {
      "os": "Ubuntu 22.04",
      "runtime": "Node.js v18",
      "version": "1.2.3"
    },
    "logs": [
      {
        "timestamp": "2024-01-15T10:30:00Z",
        "level": "error",
        "service": "payment-service",
        "message": "OutOfMemoryError: JavaScript heap out of memory",
        "traceId": "trace-123"
      }
    ],
    "traces": [],
    "metrics": {
      "memory": {
        "used": 2048,
        "total": 4096,
        "percentage": 50
      }
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "investigationId": "inv-abc123",
    "bugReportId": "bug-123",
    "result": {
      "investigationId": "inv-abc123",
      "findings": [
        {
          "type": "memory",
          "severity": "high",
          "description": "Memory leak detected in payment service",
          "evidence": ["Memory usage increases with each transaction"]
        }
      ],
      "rootCause": {
        "category": "code",
        "description": "Unclosed database connections causing memory leak",
        "location": {
          "file": "src/services/payment.service.ts",
          "line": 42
        }
      },
      "recommendedSolutions": [
        {
          "type": "hotfix",
          "priority": "immediate",
          "description": "Ensure database connections are properly closed",
          "implementation": "Add connection cleanup in finally block",
          "estimatedEffort": "2 hours",
          "risk": "low"
        }
      ],
      "confidence": 0.85
    },
    "status": "completed"
  }
}
```

### Get Investigation Status

**GET** `/api/investigation/:investigationId/status`

```bash
curl -X GET http://localhost:3000/api/investigation/inv-abc123/status \
  -H "Authorization: Bearer <agent-token>"
```

### Get Investigation Result

**GET** `/api/investigation/:investigationId/result`

```bash
curl -X GET http://localhost:3000/api/investigation/inv-abc123/result \
  -H "Authorization: Bearer <agent-token>"
```

### Get Active Investigations

**GET** `/api/investigation/active`

```bash
curl -X GET http://localhost:3000/api/investigation/active \
  -H "Authorization: Bearer <agent-token>"
```

### Get Agent Capabilities

**GET** `/api/investigation/capabilities`

```bash
curl -X GET http://localhost:3000/api/investigation/capabilities \
  -H "Authorization: Bearer <agent-token>"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "agentType": "log_analysis",
      "capabilities": [
        "log_pattern_recognition",
        "error_detection",
        "anomaly_detection",
        "log_correlation",
        "severity_analysis",
        "service_health_monitoring"
      ],
      "status": "active"
    },
    {
      "agentType": "trace_analysis",
      "capabilities": [
        "performance_analysis",
        "bottleneck_detection",
        "failure_analysis",
        "dependency_mapping",
        "latency_analysis"
      ],
      "status": "active"
    }
  ]
}
```

## Bug Categories

The system supports the following bug categories:

- **security** - Security vulnerabilities, authentication issues, authorization problems
- **performance** - Slow responses, high latency, resource bottlenecks
- **functional** - Incorrect behavior, logic errors, feature bugs
- **crash** - Application crashes, fatal errors, unhandled exceptions
- **memory** - Memory leaks, high memory usage, OutOfMemory errors
- **concurrency** - Race conditions, deadlocks, synchronization issues

## Severity Levels

- **critical** - System down, data loss, security breach
- **high** - Major functionality broken, severe degradation
- **medium** - Partial functionality affected, workaround available
- **low** - Minor issues, cosmetic problems

## Integration with Existing Systems

### Message Bus Integration

The investigation system integrates with the existing message bus for agent communication:

```typescript
import { MessageBus } from './ai-agents/core/message-bus';

// Subscribe to investigation events
messageBus.subscribe('investigation:started', (data) => {
  console.log('Investigation started:', data.investigationId);
});

messageBus.subscribe('investigation:completed', (data) => {
  console.log('Investigation completed:', data.result);
});
```

### AI Model Integration

Agents use the existing model router for AI-powered analysis:

```typescript
import { ModelRouter } from './ai-agents/models/model-router';

// Models are automatically routed through the model router
// Supports local (Ollama) and cloud (DashScope/Zhipu) models
```

## Configuration

### Environment Variables

```bash
# AI Model Configuration
AI_MODEL_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL_API_KEY=your-api-key
AI_MODEL_TYPE=qwen-max

# Database Configuration
INVESTIGATION_DB_PATH=./data/investigations.db

# Agent Configuration
MAX_INVESTIGATION_TIME=300000  # 5 minutes
MAX_PARALLEL_INVESTIGATIONS=5
```

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run investigation-specific tests
npm test -- investigation

# Run with coverage
npm test -- --coverage
```

### Adding New Agents

To add a new investigation agent:

1. Extend `BaseInvestigationAgent`
2. Implement the `analyze()` method
3. Add expertise capabilities
4. Register in coordinator

Example:

```typescript
import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType } from '../types';

export class CustomAgent extends BaseInvestigationAgent {
  constructor(coordinator: any) {
    super(InvestigationAgentType.CUSTOM, [
      'capability1',
      'capability2'
    ]);
  }

  public async analyze(context: InvestigationContext): Promise<any> {
    // Implementation
    return {
      findings: [],
      analysis: 'Custom analysis result'
    };
  }
}
```

## Troubleshooting

### Common Issues

**Investigation timeout**

- Increase `MAX_INVESTIGATION_TIME` in environment variables
- Check AI model endpoint availability
- Verify network connectivity

**Agents not responding**

- Check agent logs for errors
- Verify message bus is running
- Restart agent team

**Low confidence results**

- Provide more context (logs, traces, code)
- Ensure timestamps are accurate
- Include environment information

## Performance Considerations

- Investigations typically complete within 30-60 seconds
- Each agent has a 5-minute timeout
- Maximum 5 concurrent investigations supported
- Results are cached in database for fast retrieval

## Security

- All endpoints require agent authentication
- Rate limiting applied to prevent abuse
- Input validation on all requests
- SQL injection prevention through parameterized queries
- No sensitive data in logs

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
