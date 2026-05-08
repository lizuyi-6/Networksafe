import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { exec, execQuiet } from '../utils/exec';
import { info, success, error, warn, header, spinner } from '../utils/logger';

interface AgentOptions {
  server?: string;
  onboardingCode?: string;
  hostname?: string;
  installDir?: string;
}

function parseAgentEnv(envPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    result[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim();
  }
  return result;
}

function writeAgentEnv(envPath: string, vars: Record<string, string>): void {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
}

async function exchangeOnboardingCode(serverUrl: string, code: string): Promise<{ agentId: string; apiKey: string; secretKey: string }> {
  const axios = (await import('axios')).default;
  const response = await axios.post(`${serverUrl}/api/agent-onboarding/exchange`, {
    onboardingCode: code,
  });

  if (!response.data?.success) {
    throw new Error(response.data?.error || 'Onboarding failed');
  }

  return {
    agentId: response.data.data.agentId,
    apiKey: response.data.data.apiKey,
    secretKey: response.data.data.secretKey,
  };
}

async function installAgentService(installDir: string): Promise<void> {
  const serviceFile = `/etc/systemd/system/aetherguard-agent.service`;
  const serviceContent = `[Unit]
Description=AetherGuard Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${installDir}
EnvironmentFile=${path.join(installDir, 'agent.env')}
ExecStart=/usr/bin/node ${path.join(installDir, 'agent-cli.js')}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

  fs.writeFileSync(serviceFile, serviceContent);
  await exec('systemctl', ['daemon-reload']);
  await exec('systemctl', ['enable', 'aetherguard-agent']);
  await exec('systemctl', ['start', 'aetherguard-agent']);
}

export async function agentCommand(options: AgentOptions): Promise<void> {
  header('安装 AetherGuard Agent');

  const installDir = options.installDir || '/opt/aetherguard-agent';

  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true });
  }

  // Check if agent is already registered
  const envPath = path.join(installDir, 'agent.env');
  const existingEnv = parseAgentEnv(envPath);

  if (existingEnv.AETHERGUARD_AGENT_ID && !options.onboardingCode) {
    info('检测到已注册的 Agent');
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '选择操作:',
        choices: [
          { name: '查看状态', value: 'status' },
          { name: '重新注册', value: 'reregister' },
          { name: '启动服务', value: 'start' },
          { name: '停止服务', value: 'stop' },
          { name: '重启服务', value: 'restart' },
        ],
      },
    ]);

    switch (action) {
      case 'status': {
        const result = await exec('systemctl', ['status', 'aetherguard-agent', '--no-pager']);
        console.log(result.stdout || result.stderr);
        return;
      }
      case 'start': {
        const s = spinner('启动 Agent 服务...');
        const started = await execQuiet('systemctl', ['start', 'aetherguard-agent']);
        s.succeed(started ? 'Agent 服务已启动' : '启动失败');
        return;
      }
      case 'stop': {
        const s = spinner('停止 Agent 服务...');
        const stopped = await execQuiet('systemctl', ['stop', 'aetherguard-agent']);
        s.succeed(stopped ? 'Agent 服务已停止' : '停止失败');
        return;
      }
      case 'restart': {
        const s = spinner('重启 Agent 服务...');
        const restarted = await execQuiet('systemctl', ['restart', 'aetherguard-agent']);
        s.succeed(restarted ? 'Agent 服务已重启' : '重启失败');
        return;
      }
      case 'reregister':
        // Continue to registration flow
        break;
    }
  }

  // Collect server info
  let serverUrl = options.server || existingEnv.AETHERGUARD_SERVER;
  let onboardingCode = options.onboardingCode;

  if (!serverUrl) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'server',
        message: '控制面板地址 (如 http://192.168.1.100:3005):',
        validate: (v: string) => v.length > 0 || '请输入控制面板地址',
      },
    ]);
    serverUrl = answer.server;
  }

  if (!onboardingCode) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'code',
        message: 'Agent 注册码 (从控制面板获取):',
        mask: '*',
        validate: (v: string) => v.length > 0 || '请输入注册码',
      },
    ]);
    onboardingCode = answer.code;
  }

  // Exchange onboarding code
  const s = spinner('正在注册 Agent...');
  try {
    if (!serverUrl || !onboardingCode) {
      throw new Error('服务器地址和注册码不能为空');
    }
    const credentials = await exchangeOnboardingCode(serverUrl, onboardingCode);
    s.succeed('Agent 注册成功');

    // Save credentials
    const envVars: Record<string, string> = {
      AETHERGUARD_SERVER: serverUrl,
      AETHERGUARD_AGENT_ID: credentials.agentId,
      AETHERGUARD_AGENT_API_KEY: credentials.apiKey,
      AETHERGUARD_AGENT_SECRET_KEY: credentials.secretKey,
    };

    if (options.hostname) {
      envVars.AETHERGUARD_HOSTNAME = options.hostname;
    }

    writeAgentEnv(envPath, envVars);
    success('Agent 凭证已保存');

    // Check if we have agent-cli.js
    const agentCliPath = path.join(installDir, 'agent-cli.js');
    if (!fs.existsSync(agentCliPath)) {
      warn('未找到 agent-cli.js，请手动复制后端构建产物中的 agent-cli.js');
      info(`目标路径: ${agentCliPath}`);
    } else {
      // Install systemd service
      const s2 = spinner('安装 systemd 服务...');
      await installAgentService(installDir);
      s2.succeed('Agent 服务已安装');
    }

    info('');
    success('Agent 安装完成!');
    info('');
    info('常用命令:');
    info('  aetherguard agent --status    查看 Agent 状态');
    info('  aetherguard agent --restart   重启 Agent');
    info('  aetherguard agent --stop      停止 Agent');

  } catch (err: any) {
    s.fail('Agent 注册失败');
    error(err.message || '未知错误');
    process.exit(1);
  }
}
