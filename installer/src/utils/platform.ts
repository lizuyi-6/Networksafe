import * as os from 'os';

export type Platform = 'linux' | 'macos' | 'windows' | 'unknown';

export function detectPlatform(): Platform {
  const platform = os.platform();
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'unknown';
}

export function isLinux(): boolean {
  return detectPlatform() === 'linux';
}

export function isWindows(): boolean {
  return detectPlatform() === 'windows';
}

export function isMacOS(): boolean {
  return detectPlatform() === 'macos';
}

export function getDistro(): string {
  if (!isLinux()) return 'unknown';
  try {
    const fs = require('fs');
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf-8');
      const match = content.match(/^ID=(.+)$/m);
      if (match) return match[1].replace(/"/g, '').trim();
    }
  } catch { /* ignore */ }
  return 'unknown';
}

export function supportsNativeDeploy(): boolean {
  return isLinux();
}
