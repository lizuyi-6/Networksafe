const { io } = require('socket.io-client');
const socket = io('http://127.0.0.1:3005', {
  auth: {
    type: 'agent',
    agentId: 'agent-14bb5126-f245-44b6-b45d-59dfebe0c6a8',
    apiKey: 'agent_85488bd686c4a924a271cfb5059387311c4c2701d9db1b76'
  },
  transports: ['websocket'],
  timeout: 10000
});

socket.on('connect', () => {
  console.log('connected');
  socket.emit('agent:review_sample', {
    sample: {
      requestId: 'acceptance-agent-review-2',
      timestamp: new Date().toISOString(),
      sourceIp: '203.0.113.45',
      method: 'POST',
      path: '/api/auth/login',
      protocol: 'https',
      userAgent: 'python-requests/2.32 automated-checker',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-attack-id': 'acceptance-review-2'
      },
      body: 'email=admin%40corp.local&password=Winter2026!&otp=000000',
      evidence: 'Confirmed malicious credential stuffing attempt from an automated attack tool targeting privileged login with breached credentials. This is not normal user activity.',
      rawPayload: 'POST /api/auth/login HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nemail=admin%40corp.local&password=Winter2026!&otp=000000',
      existingSignals: ['seed-automation-review', 'credential-stuffing-suspected'],
      riskScore: 0.74,
      matchedRuleIds: ['seed-automation-review'],
      decisionSource: 'agent-local-review',
      metadata: {
        scenario: 'acceptance-review',
        attackFamily: 'automation',
        severity: 'high',
        behavior: 'credential_stuffing'
      }
    },
    timestamp: new Date().toISOString()
  });
  setTimeout(() => {
    console.log('done');
    socket.close();
    process.exit(0);
  }, 7000);
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
}, 20000);
