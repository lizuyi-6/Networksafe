import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { promisify } from 'util';
import inquirer from 'inquirer';
import { exec, execQuiet, checkCommand } from '../utils/exec';
import { info, success, warn, error, header, spinner } from '../utils/logger';
import { generateSecret, generateHexSecret, buildEnvContent, AetherGuardConfig } from '../utils/config';
import { isLinux, getDistro, supportsNativeDeploy } from '../utils/platform';
import { generateNginxConfig } from '../templates/nginx.conf';

const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

const APP_NAME = 'AetherGuard';
const PM2_NAME = 'AetherGuard-backend';

interface InstallOptions {
  dir?: string;
  port?: number;
  backendPort?: number;
  skipDeps?: boolean;
  skipBuild?: boolean;
}

async function ensureRoot(): Promise<void> {
  if (process.getuid && process.getuid() !== 0) {
    error('请使用 root 权限运行此命令 (sudo aetherguard install)');
    process.exit(1);
  }
}

async function checkNodeVersion(): Promise<boolean> {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major < 18) {
    error(`Node.js 版本过低: ${nodeVersion}，需要 >= 18`);
    return false;
  }
  success(`Node.js 版本: ${nodeVersion}`);
  return true;
}

/**
 * SECURITY FIX (audit 2026-08, DP-012): never pipe a remote setup script
 * straight into a root shell. Download over HTTPS, then either
 *   (a) verify against a sha256 pin — export NODESOURCE_DEB_SHA256 /
 *       NODESOURCE_RPM_SHA256 (unattended installs; mismatch aborts), or
 *   (b) if no pin is set, print the sha256 + head of the script and require
 *       interactive confirmation. The trust decision cannot be skipped.
 */
const NODESOURCE_SETUP_SCRIPTS: Record<'deb' | 'rpm', { url: string; env: string }> = {
  deb: { url: 'https://deb.nodesource.com/setup_20.x', env: 'NODESOURCE_DEB_SHA256' },
  rpm: { url: 'https://rpm.nodesource.com/setup_20.x', env: 'NODESOURCE_RPM_SHA256' }
};

async function runVerifiedSetupScript(kind: 'deb' | 'rpm'): Promise<void> {
  const spec = NODESOURCE_SETUP_SCRIPTS[kind];
  const expected = process.env[spec.env] || '';
  const tmp = `/tmp/nodesource-setup-${kind}-${Date.now()}.sh`;
  await exec('bash', ['-c', `curl -fsSL ${spec.url} -o ${tmp}`]);

  const content = await readFileAsync(tmp);
  const actual = createHash('sha256').update(content).digest('hex');
  const cleanup = async (): Promise<void> => { await unlinkAsync(tmp).catch(() => undefined); };

  if (expected) {
    if (actual !== expected) {
      await cleanup();
      throw new Error(
        `nodesource setup script failed sha256 verification ` +
        `(expected ${expected}, got ${actual}). Refusing to run it as root.`
      );
    }
    success(`nodesource script sha256 verified: ${actual}`);
  } else {
    console.log('----------------------------------------------------------------');
    console.log(` Downloaded ${spec.url}`);
    console.log(` sha256: ${actual}`);
    console.log(` To run unattended, export ${spec.env}=<this hash> after review.`);
    console.log(' First lines of the script:');
    for (const line of content.toString('utf8').split('\n').slice(0, 12)) {
      console.log(`   | ${line}`);
    }
    console.log('----------------------------------------------------------------');
    const answer = await inquirer.prompt([{
      type: 'input',
      name: 'confirm',
      message: '审阅上面的脚本后输入 yes 以 root 执行:'
    }]);
    if (answer.confirm !== 'yes') {
      await cleanup();
      throw new Error('aborted by operator.');
    }
  }
  try {
    await exec('bash', [tmp]);
  } finally {
    await cleanup();
  }
}

async function installNodejs20(): Promise<void> {
  const s = spinner('安装 Node.js 20.x...');
  const distro = getDistro();

  if (distro === 'ubuntu' || distro === 'debian') {
    await runVerifiedSetupScript('deb');
    await exec('apt-get', ['install', '-y', 'nodejs']);
  } else if (distro === 'centos' || distro === 'rhel' || distro === 'fedora') {
    await runVerifiedSetupScript('rpm');
    await exec('yum', ['install', '-y', 'nodejs']);
  } else {
    s.fail('不支持的 Linux 发行版，请手动安装 Node.js 20.x');
    process.exit(1);
  }

  s.succeed('Node.js 20.x 安装完成');
}

async function installNginx(): Promise<void> {
  const s = spinner('安装 Nginx...');
  const distro = getDistro();

  if (distro === 'ubuntu' || distro === 'debian') {
    await exec('apt-get', ['install', '-y', 'nginx']);
  } else if (distro === 'centos' || distro === 'rhel' || distro === 'fedora') {
    await exec('yum', ['install', '-y', 'nginx']);
  } else {
    s.fail('不支持的 Linux 发行版，请手动安装 Nginx');
    process.exit(1);
  }

  s.succeed('Nginx 安装完成');
}

async function installPm2(): Promise<void> {
  const s = spinner('安装 PM2...');
  await exec('npm', ['install', '-g', 'pm2']);
  s.succeed('PM2 安装完成');
}

async function installDependencies(skipDeps: boolean): Promise<void> {
  if (skipDeps) {
    warn('跳过依赖安装');
    return;
  }

  const nodeOk = await checkNodeVersion();
  if (!nodeOk) {
    await installNodejs20();
    // Re-check after install
    const newVersion = process.version;
    if (parseInt(newVersion.slice(1).split('.')[0], 10) < 18) {
      // Need to reload node or just inform user
      warn('Node.js 安装完成，请重新运行安装命令');
      process.exit(0);
    }
  }

  if (!(await checkCommand('nginx'))) {
    await installNginx();
  } else {
    success('Nginx 已安装');
  }

  if (!(await checkCommand('pm2'))) {
    await installPm2();
  } else {
    success('PM2 已安装');
  }
}

async function collectConfig(options: InstallOptions): Promise<{ config: AetherGuardConfig; installDir: string }> {
  info('开始配置 AetherGuard...');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'installDir',
      message: '安装目录:',
      default: options.dir || '/opt/aetherguard',
    },
    {
      type: 'input',
      name: 'httpPort',
      message: 'HTTP 端口:',
      default: options.port || 80,
      validate: (v: string) => {
        const n = parseInt(v, 10);
        return (n > 0 && n < 65536) || '请输入有效的端口号';
      },
    },
    {
      type: 'input',
      name: 'backendPort',
      message: '后端服务端口:',
      default: options.backendPort || 3005,
      validate: (v: string) => {
        const n = parseInt(v, 10);
        return (n > 0 && n < 65536) || '请输入有效的端口号';
      },
    },
    {
      type: 'input',
      name: 'adminEmail',
      message: '管理员邮箱:',
      default: 'admin@aetherguard.com',
    },
    {
      type: 'password',
      name: 'adminPassword',
      message: '管理员密码 (至少12位):',
      mask: '*',
      validate: (v: string) => v.length >= 12 || '密码至少需要12位',
    },
    {
      type: 'confirm',
      name: 'autoGenSecrets',
      message: '自动生成安全密钥?',
      default: true,
    },
  ]);

  const installDir = path.resolve(answers.installDir);

  const config: AetherGuardConfig = {
    jwtSecret: answers.autoGenSecrets ? generateHexSecret(32) : (await inquirer.prompt([{ type: 'password', name: 'v', message: 'JWT_SECRET:' }])).v,
    auditLogSecret: answers.autoGenSecrets ? generateHexSecret(32) : (await inquirer.prompt([{ type: 'password', name: 'v', message: 'AUDIT_LOG_SECRET:' }])).v,
    encryptionKey: answers.autoGenSecrets ? generateHexSecret(32) : (await inquirer.prompt([{ type: 'password', name: 'v', message: 'ENCRYPTION_KEY:' }])).v,
    encryptionSalt: answers.autoGenSecrets ? generateHexSecret(32) : (await inquirer.prompt([{ type: 'password', name: 'v', message: 'ENCRYPTION_SALT:' }])).v,
    deviceCommandSecret: answers.autoGenSecrets ? generateHexSecret(24) : (await inquirer.prompt([{ type: 'password', name: 'v', message: 'DEVICE_COMMAND_SECRET:' }])).v,
    adminEmail: answers.adminEmail,
    adminPassword: answers.adminPassword,
    httpPort: parseInt(answers.httpPort, 10),
    httpsPort: 443,
    backendPort: parseInt(answers.backendPort, 10),
    allowedOrigins: `http://localhost:${answers.httpPort},http://127.0.0.1:${answers.httpPort}`,
    redisPassword: answers.autoGenSecrets ? generateSecret(16) : (await inquirer.prompt([{ type: 'password', name: 'v', message: 'REDIS_PASSWORD:' }])).v,
  };

  return { config, installDir };
}

async function setupDirectories(installDir: string): Promise<void> {
  const s = spinner('创建目录结构...');
  const dirs = [
    installDir,
    path.join(installDir, 'backend'),
    path.join(installDir, 'frontend'),
    path.join(installDir, 'data'),
    path.join(installDir, 'logs'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  s.succeed('目录结构创建完成');
}

async function buildBackend(skipBuild: boolean, installDir: string): Promise<void> {
  if (skipBuild) {
    warn('跳过后端构建，请确保后端构建产物已存在');
    return;
  }

  const backendSrc = path.join(process.cwd(), 'backend');
  const backendDest = path.join(installDir, 'backend');

  if (!fs.existsSync(backendSrc)) {
    warn('未找到后端源码目录，跳过构建');
    return;
  }

  const s = spinner('构建后端...');

  // Copy source to install dir
  await exec('cp', ['-r', backendSrc, installDir]);

  // Build
  const buildResult = await exec('npm', ['run', 'build'], { cwd: backendDest });
  if (buildResult.exitCode !== 0) {
    s.fail('后端构建失败');
    error(buildResult.stderr);
    process.exit(1);
  }

  // Install production deps
  const installResult = await exec('npm', ['install', '--production'], { cwd: backendDest });
  if (installResult.exitCode !== 0) {
    s.fail('后端依赖安装失败');
    error(installResult.stderr);
    process.exit(1);
  }

  s.succeed('后端构建完成');
}

async function buildFrontend(skipBuild: boolean, installDir: string): Promise<void> {
  if (skipBuild) {
    warn('跳过前端构建，请确保前端构建产物已存在');
    return;
  }

  const frontendSrc = path.join(process.cwd(), 'frontend');
  const frontendDest = path.join(installDir, 'frontend');

  if (!fs.existsSync(frontendSrc)) {
    warn('未找到前端源码目录，跳过构建');
    return;
  }

  const s = spinner('构建前端...');

  // Copy source
  await exec('cp', ['-r', frontendSrc, installDir]);

  // Build
  const buildResult = await exec('npm', ['run', 'build'], { cwd: frontendDest });
  if (buildResult.exitCode !== 0) {
    s.fail('前端构建失败');
    error(buildResult.stderr);
    process.exit(1);
  }

  s.succeed('前端构建完成');
}

async function copyFrontendToNginx(installDir: string): Promise<void> {
  const s = spinner('复制前端到 Nginx 目录...');
  const frontendDist = path.join(installDir, 'frontend', 'dist');
  const nginxRoot = '/var/www/aetherguard';

  if (!fs.existsSync(nginxRoot)) {
    fs.mkdirSync(nginxRoot, { recursive: true });
  }

  await exec('cp', ['-r', `${frontendDist}/.`, nginxRoot]);
  await exec('chown', ['-R', 'www-data:www-data', nginxRoot]);

  s.succeed('前端部署完成');
}

async function setupNginx(config: AetherGuardConfig, installDir: string): Promise<void> {
  const s = spinner('配置 Nginx...');

  const nginxConfig = generateNginxConfig({
    serverName: '_',
    backendPort: config.backendPort,
    rootPath: '/var/www/aetherguard',
  });

  const nginxConfPath = '/etc/nginx/conf.d/aetherguard.conf';
  fs.writeFileSync(nginxConfPath, nginxConfig);

  await exec('nginx', ['-t']);
  await exec('systemctl', ['restart', 'nginx']);
  await exec('systemctl', ['enable', 'nginx']);

  s.succeed('Nginx 配置完成');
}

async function startBackend(installDir: string): Promise<void> {
  const s = spinner('启动后端服务...');
  const backendDist = path.join(installDir, 'backend', 'dist');

  await exec('pm2', ['restart', PM2_NAME], { cwd: backendDist })
    .catch(() => exec('pm2', ['start', 'index.js', '--name', PM2_NAME], { cwd: backendDist }));

  await exec('pm2', ['save']);
  await exec('pm2', ['startup']);

  s.succeed('后端服务已启动');
}

export async function installCommand(options: InstallOptions): Promise<void> {
  header(`${APP_NAME} 一键安装`);

  if (!supportsNativeDeploy()) {
    error('原生部署仅支持 Linux 系统');
    info('Windows/macOS 用户请使用 Docker 部署: docker-compose up -d');
    process.exit(1);
  }

  await ensureRoot();

  // Install dependencies
  await installDependencies(options.skipDeps || false);

  // Collect configuration
  const { config, installDir } = await collectConfig(options);

  // Setup directories
  await setupDirectories(installDir);

  // Write .env
  const envPath = path.join(installDir, 'backend', '.env');
  fs.writeFileSync(envPath, buildEnvContent(config), { mode: 0o600 });
  success('配置文件已生成');

  // Build and deploy
  await buildBackend(options.skipBuild || false, installDir);
  await buildFrontend(options.skipBuild || false, installDir);
  await copyFrontendToNginx(installDir);

  // Setup Nginx
  await setupNginx(config, installDir);

  // Start backend
  await startBackend(installDir);

  header('安装完成');
  success(`AetherGuard 已成功部署!`);
  info(`访问地址: http://localhost:${config.httpPort}`);
  info(`API 地址: http://localhost:${config.httpPort}/api`);
  info(`后台管理: http://localhost:${config.httpPort}`);
  info(`默认账号: ${config.adminEmail}`);
  info('');
  info('常用命令:');
  info('  aetherguard status   - 查看服务状态');
  info('  aetherguard logs     - 查看日志');
  info('  aetherguard stop     - 停止服务');
  info('  aetherguard restart  - 重启服务');
}
