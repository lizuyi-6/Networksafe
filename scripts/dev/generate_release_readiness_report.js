const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const outputPath = path.join(rootDir, 'docs', 'reports', 'release-readiness-2026-03-08.md');
const localAcceptancePath = path.join(rootDir, 'artifacts', 'ops', 'local-platform-acceptance.json');
const uiSmokePath = path.join(rootDir, 'artifacts', 'ops', 'ui-release-smoke.json');
const deploymentValidationPath = path.join(rootDir, 'artifacts', 'ops', 'deployment-bundle-validation', 'deployment-bundle-validation.json');
const externalHostPath = path.join(rootDir, 'artifacts', 'ops', 'external-linux-binary-agent-validation.json');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatCheck(label, value) {
  return `- ${label}: ${value}`;
}

function boolText(value) {
  return value ? 'yes' : 'no';
}

function main() {
  const localAcceptance = readJsonIfExists(localAcceptancePath);
  const uiSmoke = readJsonIfExists(uiSmokePath);
  const deploymentValidation = readJsonIfExists(deploymentValidationPath);
  const externalHost = readJsonIfExists(externalHostPath);

  const aiProof = localAcceptance?.checks?.platformAIProof?.data || null;
  const attackResult = localAcceptance?.checks?.attackSimulation?.data?.results?.[0] || null;
  const attackDecision = attackResult?.decision || null;
  const attackAiAnalysis = attackResult?.aiAnalysis || null;

  const localPassed = Boolean(localAcceptance?.summary?.pass);
  const uiPassed = Boolean(uiSmoke?.summary?.pass);
  const deploymentPassed = Boolean(deploymentValidation?.overallPassed);
  const externalPassed = Boolean(externalHost?.summary?.pass);

  const go = localPassed && uiPassed && deploymentPassed && externalPassed;
  const status = go ? 'GO' : 'NO-GO';

  const lines = [
    '# Release Readiness Report',
    '',
    `Generated At: ${new Date().toISOString()}`,
    `Status: \`${status}\``,
    '',
    '## Environment',
    formatCheck('Workspace', rootDir),
    formatCheck('Backend URL', localAcceptance?.environment?.baseUrl || 'unknown'),
    formatCheck('Frontend URL', localAcceptance?.environment?.frontendUrl || 'unknown'),
    formatCheck('External Linux host evidence file', fs.existsSync(externalHostPath) ? externalHostPath : 'missing'),
    '',
    '## Local Acceptance',
    formatCheck('Machine-readable report present', boolText(Boolean(localAcceptance))),
    formatCheck('Local acceptance pass', boolText(localPassed)),
    formatCheck('UI smoke pass', boolText(uiPassed)),
    formatCheck('Deployment bundle static validation pass', boolText(deploymentPassed)),
    '',
    '## AI Evidence',
    formatCheck('Deterministic AI proof success', boolText(aiProof?.success === true && aiProof?.content === 'AETHERGUARD_REMOTE_AI_OK')),
    formatCheck('AI proof content', aiProof?.content || 'missing'),
    formatCheck('AI proof model', aiProof?.model || 'missing'),
    formatCheck('AI proof latency', aiProof?.latency !== undefined ? `${aiProof.latency}ms` : 'missing'),
    formatCheck('AI proof provider', aiProof?.provider || 'missing'),
    formatCheck('AI proof request ID', aiProof?.requestId || 'missing'),
    formatCheck('Attack simulator decision verdict', attackDecision?.verdict || 'missing'),
    formatCheck('Attack simulator confidence', attackDecision?.confidence !== undefined ? String(attackDecision.confidence) : 'missing'),
    formatCheck('Attack simulator AI route', attackAiAnalysis?.route || 'missing'),
    formatCheck('Attack simulator AI provider', attackAiAnalysis?.provider || 'missing'),
    '',
    '## External Linux Host Gate',
    formatCheck('Evidence present', boolText(Boolean(externalHost))),
    formatCheck('Real install/healthcheck/upgrade/rollback pass', boolText(externalPassed)),
  ];

  if (externalHost) {
    lines.push(
      formatCheck('Host', externalHost.environment?.host || 'unknown'),
      formatCheck('Bundle', externalHost.bundle?.deploymentId || externalHost.bundle?.path || 'unknown'),
      formatCheck('Failed step', externalHost.summary?.failedStep || 'none'),
      formatCheck('Failure reason', externalHost.summary?.failureReason || 'none')
    );
  } else {
    lines.push('- Result: not executed in this workspace; publish gate remains incomplete');
  }

  lines.push(
    '',
    '## Evidence Files',
    formatCheck('Local acceptance JSON', fs.existsSync(localAcceptancePath) ? localAcceptancePath : 'missing'),
    formatCheck('UI smoke JSON', fs.existsSync(uiSmokePath) ? uiSmokePath : 'missing'),
    formatCheck('Deployment validation JSON', fs.existsSync(deploymentValidationPath) ? deploymentValidationPath : 'missing'),
    formatCheck('External host validation JSON', fs.existsSync(externalHostPath) ? externalHostPath : 'missing'),
    '',
    '## Release Decision',
    `- Status: \`${status}\``
  );

  if (go) {
    lines.push('- Notes: all local, UI, deployment, and external-host gates passed.');
  } else {
    const reasons = [];
    if (!localPassed) reasons.push('local acceptance did not pass');
    if (!uiPassed) reasons.push('UI smoke did not pass');
    if (!deploymentPassed) reasons.push('deployment bundle static validation did not pass');
    if (!externalPassed) reasons.push('external Linux host install/upgrade/rollback evidence is missing or failed');
    lines.push(`- Notes: ${reasons.join('; ')}.`);
  }

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    status,
    localPassed,
    uiPassed,
    deploymentPassed,
    externalPassed
  }, null, 2));
}

main();
