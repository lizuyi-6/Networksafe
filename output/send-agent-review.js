const { io } = require('socket.io-client');
const socket = io('http://127.0.0.1:3005', {
  auth: {
    type: 'agent',
    agentId: 'agent-7ad65257-7ba0-4f5e-b028-a25f7480737a',
    apiKey: 'agent_7d455818eb55468b46885295f7f1edcd2fe905df82606758'
  },
  transports: ['websocket'],
  timeout: 10000
});

socket.on('connect', () => {
  console.log('connected');
  socket.emit('agent:review_sample', {
    sample: {
      requestId: 'acceptance-agent-review-1',
      timestamp: new Date().toISOString(),
      sourceIp: '198.51.100.77',
      method: 'POST',
      path: '/wp-login.php',
      protocol: 'https',
      userAgent: 'sqlmap/1.8.3#stable',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-attack-id': 'acceptance-review-1'
      },
      body: "username=admin' OR 1=1 --&password=test&redirect=/admin",
      evidence: 'Confirmed malicious SQL injection authentication bypass probe against a login endpoint. This sample is an exploit attempt intended to gain unauthorized admin access.',
      rawPayload: "POST /wp-login.php HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nusername=admin' OR 1=1 --&password=test&redirect=/admin",
      existingSignals: ['seed-sqli-auth-bypass', 'agent-local-review'],
      riskScore: 0.91,
      matchedRuleIds: ['seed-sqli-auth-bypass'],
      decisionSource: 'agent-local-review',
      metadata: {
        scenario: 'acceptance-review',
        attackFamily: 'sqli',
        severity: 'high'
      }
    },
    timestamp: new Date().toISOString()
  });
  setTimeout(() => {
    console.log('done');
    socket.close();
    process.exit(0);
  }, 5000);
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
}, 15000);
