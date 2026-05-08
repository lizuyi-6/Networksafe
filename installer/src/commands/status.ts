import { exec } from '../utils/exec';
import { info, success, error, warn, header, newLine } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';
const HEALTH_CHECK_TIMEOUT = 5000;

async function checkBackendHealth(port: number): Promise<boolean> {
  try {
    const axios = (await import('axios')).default;
    const response = await axios.get(`http://127.0.0.1:${port}/api/health`, {
      timeout: HEALTH_CHECK_TIMEOUT,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function checkNginxStatus(): Promise<boolean> {
  const result = await exec('systemctl', ['is-active', 'nginx']);
  return result.stdout.trim() === 'active';
}

async function getPm2Status(): Promise<string> {
  const result = await exec('pm2', ['jlist']);
  if (result.exitCode !== 0) return 'unknown';
  try {
    const list = JSON.parse(result.stdout);
    const app = list.find((p: any) => p.name === PM2_NAME);
    if (!app) return 'not found';
    return app.pm2_env?.status || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function statusCommand(): Promise<void> {
  header('AetherGuard 服务状态');

  // PM2 Backend
  const pm2Status = await getPm2Status();
  const pm2Ok = pm2Status === 'online';
  if (pm2Ok) {
    success(`后端 (PM2): ${pm2Status}`);
  } else if (pm2Status === 'not found') {
    warn('后端 (PM2): 未找到');
  } else {
    error(`后端 (PM2): ${pm2Status}`);
  }

  // Nginx
  const nginxOk = await checkNginxStatus();
  if (nginxOk) {
    success('Nginx: 运行中');
  } else {
    error('Nginx: 未运行');
  }

  // Health Check
  newLine();
  info('正在检查服务健康状态...');
  const backendHealthy = await checkBackendHealth(3005);
  if (backendHealthy) {
    success('后端健康检查: 正常');
  } else {
    error('后端健康检查: 异常');
  }

  // Frontend check
  try {
    const axios = (await import('axios')).default;
    const frontendResponse = await axios.get('http://127.0.0.1/', {
      timeout: HEALTH_CHECK_TIMEOUT,
      validateStatus: () => true,
    });
    if (frontendResponse.status === 200) {
      success('前端: 可访问');
    } else {
      warn(`前端: HTTP ${frontendResponse.status}`);
    }
  } catch {
    error('前端: 无法访问');
  }

  newLine();
  if (pm2Ok && nginxOk && backendHealthy) {
    success('所有服务正常运行');
  } else {
    warn('部分服务异常，请检查日志');
  }
}
