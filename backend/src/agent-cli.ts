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

function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    let serverUrl = process.env.FLUXGUARD_SERVER || 'http://localhost:8080';
    let onboardingCode = process.env.FLUXGUARD_ONBOARDING_CODE;
    let hostname = process.env.FLUXGUARD_HOSTNAME;
    let platform = process.env.FLUXGUARD_PLATFORM;
    let mac = process.env.FLUXGUARD_MAC;

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

    process.env.FLUXGUARD_AGENT_ID = data.data.agentId;
    process.env.FLUXGUARD_AGENT_API_KEY = data.data.apiKey;
    process.env.FLUXGUARD_AGENT_SECRET_KEY = data.data.secretKey;
    process.env.FLUXGUARD_ONBOARDING_CODE = '';

    console.log(`[onboarding] exchanged code for agentId=${data.data.agentId}`);
}

async function main(): Promise<void> {
    const options = parseArgs();

    console.log('FluxGuard Agent CLI');
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

main();
