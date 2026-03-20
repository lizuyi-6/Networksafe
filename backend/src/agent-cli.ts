import { promises as fs } from 'fs';
import os from 'os';
import { startAgent } from './agent';
import logger from './utils/logger';

interface CliOptions {
    serverUrl: string;
    onboardingCode?: string;
    hostname?: string;
    platform?: string;
    mac?: string;
}

interface OnboardingExchangeResponse {
    success: boolean;
    data?: {
        agentId?: string;
        apiKey?: string;
        secretKey?: string;
    };
}

function readEnvValue(...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

function setEnvValue(canonicalKey: string, legacyKey: string, value: string): void {
    process.env[canonicalKey] = value;
    process.env[legacyKey] = value;
}

function envFilePath(): string | undefined {
    return readEnvValue('AETHERGUARD_ENV_FILE', 'AetherGuard_ENV_FILE');
}

async function persistCredentialEnvFile(credentials: {
    agentId: string;
    apiKey: string;
    secretKey: string;
}): Promise<void> {
    const target = envFilePath();
    if (!target) {
        return;
    }

    const current = await fs.readFile(target, 'utf8').catch(() => '');
    const updates = new Map<string, string>([
        ['AETHERGUARD_AGENT_ID', credentials.agentId],
        ['AETHERGUARD_AGENT_API_KEY', credentials.apiKey],
        ['AETHERGUARD_AGENT_SECRET_KEY', credentials.secretKey],
        ['AETHERGUARD_ONBOARDING_CODE', '']
    ]);
    const lines = current ? current.split(/\r?\n/) : [];
    const seen = new Set<string>();
    const nextLines = lines.map((line) => {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) {
            return line;
        }

        const key = match[1];
        if (!updates.has(key)) {
            return line;
        }

        seen.add(key);
        return `${key}=${updates.get(key)}`;
    });

    for (const [key, value] of updates.entries()) {
        if (!seen.has(key)) {
            nextLines.push(`${key}=${value}`);
        }
    }

    const serialized = `${nextLines.filter((line, index, items) => !(line === '' && index === items.length - 1)).join('\n')}\n`;
    await fs.writeFile(target, serialized, 'utf8');
}

function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    let serverUrl = readEnvValue('AETHERGUARD_SERVER', 'AetherGuard_SERVER') || 'http://localhost:8080';
    let onboardingCode = readEnvValue('AETHERGUARD_ONBOARDING_CODE', 'AetherGuard_ONBOARDING_CODE');
    let hostname = readEnvValue('AETHERGUARD_HOSTNAME', 'AetherGuard_HOSTNAME');
    let platform = readEnvValue('AETHERGUARD_PLATFORM', 'AetherGuard_PLATFORM');
    let mac = readEnvValue('AETHERGUARD_MAC', 'AetherGuard_MAC');

    for (const arg of args) {
        if (arg.startsWith('--server=')) {
            serverUrl = arg.replace('--server=', '');
        }
        if (arg.startsWith('--onboarding-code=')) {
            onboardingCode = arg.replace('--onboarding-code=', '');
        }
        if (arg.startsWith('--hostname=')) {
            hostname = arg.replace('--hostname=', '');
        }
        if (arg.startsWith('--platform=')) {
            platform = arg.replace('--platform=', '');
        }
        if (arg.startsWith('--mac=')) {
            mac = arg.replace('--mac=', '');
        }
    }

    return { serverUrl, onboardingCode, hostname, platform, mac };
}

async function exchangeOnboardingCode(options: CliOptions): Promise<void> {
    if (!options.onboardingCode) return;

    const baseUrl = options.serverUrl.replace(/\/+$/, '');
    const hostname = options.hostname || os.hostname();
    const platform = options.platform || process.platform;

    const response = await fetch(`${baseUrl}/api/agent-onboarding/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            onboardingCode: options.onboardingCode,
            hostname,
            platform,
            mac: options.mac
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Onboarding exchange failed: ${response.status} ${text}`);
    }

    const data = await response.json() as OnboardingExchangeResponse;
    if (!data?.success || !data?.data?.agentId || !data?.data?.apiKey || !data?.data?.secretKey) {
        throw new Error('Onboarding exchange returned invalid payload');
    }

    setEnvValue('AETHERGUARD_AGENT_ID', 'AetherGuard_AGENT_ID', data.data.agentId);
    setEnvValue('AETHERGUARD_AGENT_API_KEY', 'AetherGuard_AGENT_API_KEY', data.data.apiKey);
    setEnvValue('AETHERGUARD_AGENT_SECRET_KEY', 'AetherGuard_AGENT_SECRET_KEY', data.data.secretKey);
    setEnvValue('AETHERGUARD_ONBOARDING_CODE', 'AetherGuard_ONBOARDING_CODE', '');

    await persistCredentialEnvFile({
        agentId: data.data.agentId,
        apiKey: data.data.apiKey,
        secretKey: data.data.secretKey
    });

    console.log(`[onboarding] exchanged code for agentId=${data.data.agentId}`);
}

export async function main(): Promise<void> {
    const options = parseArgs();

    console.log('AetherGuard Agent CLI');
    console.log(`server: ${options.serverUrl}`);

    try {
        await exchangeOnboardingCode(options);
        const agent = await startAgent(options.serverUrl);

        process.on('SIGINT', async () => {
            console.log('\nstopping agent...');
            await agent.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\nstopping agent...');
            await agent.stop();
            process.exit(0);
        });
    } catch (error: any) {
        logger.error('Agent startup failed', { error: error.message });
        console.error(`Agent startup failed: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    void main();
}
