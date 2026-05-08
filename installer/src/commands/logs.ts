import { exec } from '../utils/exec';
import { info, error, header } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';

interface LogsOptions {
  service?: string;
  lines?: number;
  follow?: boolean;
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  header('查看日志');

  const service = options.service || 'all';
  const lines = options.lines || 100;
  const follow = options.follow || false;

  if (service === 'backend' || service === 'all') {
    info('--- 后端日志 (PM2) ---');
    const args = ['logs', PM2_NAME, '--lines', String(lines)];
    if (follow) args.push('--follow');
    await exec('pm2', args, { stdio: 'inherit' } as any);
  }

  if (service === 'nginx' || service === 'all') {
    info('--- Nginx 日志 ---');
    const logFile = follow ? '-f' : '';
    const cmd = follow ? 'tail' : 'tail';
    const args = follow
      ? ['-f', '/var/log/nginx/error.log']
      : ['-n', String(lines), '/var/log/nginx/error.log'];
    await exec(cmd, args, { stdio: 'inherit' } as any);
  }
}
