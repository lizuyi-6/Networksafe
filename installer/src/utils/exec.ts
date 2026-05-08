import { spawn, SpawnOptionsWithoutStdio } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(command: string, args: string[] = [], options: SpawnOptionsWithoutStdio = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: exitCode ?? 0 });
    });

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
}

export async function execQuiet(command: string, args: string[] = [], options: SpawnOptionsWithoutStdio = {}): Promise<boolean> {
  const result = await exec(command, args, options);
  return result.exitCode === 0;
}

export async function checkCommand(command: string): Promise<boolean> {
  const result = await exec(process.platform === 'win32' ? 'where' : 'which', [command]);
  return result.exitCode === 0;
}
