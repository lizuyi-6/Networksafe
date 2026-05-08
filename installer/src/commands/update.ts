import * as fs from 'fs';
import * as path from 'path';
import { exec, execQuiet } from '../utils/exec';
import { info, success, error, warn, header, spinner } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';

export async function updateCommand(): Promise<void> {
  header('更新 AetherGuard');

  // Check if installed
  const installDir = '/opt/aetherguard';
  if (!fs.existsSync(installDir)) {
    error('未检测到 AetherGuard 安装');
    info('请先运行: aetherguard install');
    process.exit(1);
  }

  info('正在更新到最新版本...');

  // Backup current .env
  const envPath = path.join(installDir, 'backend', '.env');
  const envBackupPath = path.join(installDir, 'backend', '.env.backup');
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, envBackupPath);
    success('已备份配置文件');
  }

  // Pull latest code (if git repo)
  const backendDir = path.join(installDir, 'backend');
  const frontendDir = path.join(installDir, 'frontend');

  if (fs.existsSync(path.join(backendDir, '.git'))) {
    const s = spinner('拉取最新后端代码...');
    const result = await exec('git', ['pull'], { cwd: backendDir });
    if (result.exitCode === 0) {
      s.succeed('后端代码已更新');
    } else {
      s.warn('后端代码拉取失败，跳过');
    }
  }

  if (fs.existsSync(path.join(frontendDir, '.git'))) {
    const s = spinner('拉取最新前端代码...');
    const result = await exec('git', ['pull'], { cwd: frontendDir });
    if (result.exitCode === 0) {
      s.succeed('前端代码已更新');
    } else {
      s.warn('前端代码拉取失败，跳过');
    }
  }

  // Rebuild backend
  const s1 = spinner('重新构建后端...');
  const buildResult = await exec('npm', ['run', 'build'], { cwd: backendDir });
  if (buildResult.exitCode !== 0) {
    s1.fail('后端构建失败');
    error(buildResult.stderr);
    process.exit(1);
  }
  s1.succeed('后端构建完成');

  // Rebuild frontend
  const s2 = spinner('重新构建前端...');
  const frontendBuild = await exec('npm', ['run', 'build'], { cwd: frontendDir });
  if (frontendBuild.exitCode !== 0) {
    s2.fail('前端构建失败');
    error(frontendBuild.stderr);
    process.exit(1);
  }
  s2.succeed('前端构建完成');

  // Copy frontend to nginx
  const s3 = spinner('更新前端部署...');
  await exec('cp', ['-r', `${path.join(frontendDir, 'dist')}/.`, '/var/www/aetherguard']);
  s3.succeed('前端已更新');

  // Restart services
  const s4 = spinner('重启服务...');
  await exec('pm2', ['restart', PM2_NAME]);
  await exec('systemctl', ['restart', 'nginx']);
  s4.succeed('服务已重启');

  success('AetherGuard 更新完成');
}
