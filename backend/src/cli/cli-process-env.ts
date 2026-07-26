/**
 * Configure the CLI process before any business module is imported.
 *
 * stdout is a machine-readable protocol surface for JSON and JSONL commands.
 * Route module diagnostics to stderr even when an operator enables debug logs.
 */
const writeDiagnostic = console.error.bind(console);
console.log = writeDiagnostic;
console.info = writeDiagnostic;
console.debug = writeDiagnostic;

const defaults: Record<string, string> = {
  AUDIT_LOG_SECRET: 'aetherguard-cli-local-audit-secret-min-32-characters',
  JWT_SECRET: 'aetherguard-cli-local-jwt-secret-minimum-32-characters',
  DEVICE_COMMAND_SECRET: 'aetherguard-cli-local-device-cmd-secret-32',
  ALLOW_TEST_RUNTIME: 'true',
  LOG_LEVEL: 'error'
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key] && process.env.NODE_ENV !== 'production') {
    process.env[key] = value;
  }
}
