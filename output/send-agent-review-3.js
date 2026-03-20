const { io } = require('socket.io-client');
const socket = io('http://127.0.0.1:3005', {
  auth: {
    type: 'agent',
    agentId: 'agent-fdb0c7a0-6101-42ab-9b06-8c9f39eda8f7',
    apiKey: 'agent_a432b4560f5217b05f68ada5d4d66350f8ce42b41ac4ee17'
  },
  transports: ['websocket'],
  timeout: 10000
});

socket.on('connect', () => {
  console.log('connected');
  socket.emit('agent:review_sample', {
    sample: {
      requestId: 'acceptance-agent-review-3',
      timestamp: new Date().toISOString(),
      sourceIp: '203.0.113.99',
      method: 'POST',
      path: '/api/tasks/preview',
      protocol: 'https',
      userAgent: 'python-requests/2.32 automated-checker',
      headers: {
        'content-type': 'application/json',
        'x-attack-id': 'acceptance-review-3'
      },
      body: '{"template":"daily-job","target":"report&&curl http://127.0.0.1:8080/internal/export"}',
      evidence: 'Confirmed malicious command injection reconnaissance from an automated tool attempting to force the server to issue an internal curl request for data exfiltration.',
      rawPayload: 'POST /api/tasks/preview HTTP/1.1\nContent-Type: application/json\n\n{"template":"daily-job","target":"report&&curl http://127.0.0.1:8080/internal/export"}',
      existingSignals: ['seed-automation-review', 'command-injection-suspected'],
      riskScore: 0.88,
      matchedRuleIds: ['seed-automation-review'],
      decisionSource: 'agent-local-review',
      metadata: {
        scenario: 'acceptance-review',
        attackFamily: 'command_injection',
        severity: 'high',
        behavior: 'internal_curl_probe'
      }
    },
    timestamp: new Date().toISOString()
  });
  setTimeout(() => {
    console.log('done');
    socket.close();
    process.exit(0);
  }, 9000);
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err.message);
  process.exit(1);
});

socket.on('error', (payload) => {
  console.error('socket_error', JSON.stringify(payload));
});

setTimeout(() => {
  console.error('timeout');
  process.exit(1);
}, 25000);
