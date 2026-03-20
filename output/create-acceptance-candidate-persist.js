const { initDatabase, getDatabase, closeDatabase } = require('./dist/config/database');
const { detectionPipelineService } = require('./dist/services/detection-pipeline.service');
(async () => {
  await initDatabase();
  detectionPipelineService.prepare();
  const request = {
    tenantId: 'd6c3e59a-dbb2-4ff5-997d-1c1fb6b7f7f2',
    channel: 'agent',
    requestId: 'acceptance-agent-candidate-2',
    timestamp: new Date().toISOString(),
    sourceIp: '203.0.113.121',
    method: 'POST',
    path: '/api/tasks/preview',
    userAgent: 'python-requests/2.32 automated-checker',
    headers: { 'content-type': 'application/json', 'x-acceptance-candidate': '2' },
    body: '{"template":"daily-job","target":"report&&curl http://127.0.0.1:8080/internal/export"}',
    evidence: 'Acceptance candidate for agent rule sync. Confirmed malicious command injection reconnaissance attempting internal curl exfiltration.',
    rawPayload: 'POST /api/tasks/preview HTTP/1.1\nContent-Type: application/json\n\n{"template":"daily-job","target":"report&&curl http://127.0.0.1:8080/internal/export"}',
    metadata: { scenario: 'acceptance-candidate', agentId: 'agent-fdb0c7a0-6101-42ab-9b06-8c9f39eda8f7' }
  };
  const candidate = await detectionPipelineService['createOrMergeRuleCandidate'](
    request,
    'command_injection',
    'high',
    'Acceptance candidate for validating agent rule approval and hot synchronization.',
    0.99,
    {
      request,
      ai: {
        verdict: 'malicious',
        confidence: 0.99,
        reasoning: 'Acceptance candidate for validating agent rule approval and hot synchronization.',
        routeMode: 'acceptance',
        model: 'acceptance-fixture'
      }
    }
  );
  getDatabase().save();
  console.log(JSON.stringify(candidate));
  closeDatabase();
  process.exit(0);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
