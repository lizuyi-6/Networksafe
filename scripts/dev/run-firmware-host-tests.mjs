import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const firmwareRoot = path.join(repoRoot, 'firmware', 'controller-stm32h5');
const outputDirectory = mkdtempSync(path.join(tmpdir(), 'aetherguard-firmware-host-'));
const outputName = process.platform === 'win32' ? 'test_controller.exe' : 'test_controller';
const outputPath = path.join(outputDirectory, outputName);

const makefile = readFileSync(path.join(firmwareRoot, 'test', 'Makefile'), 'utf8');
const makefileContract = [
  '-Wall -Wextra -std=c11 -g -Itest -ICore/Inc -ICore/Src',
  'test/mock_hal.c',
  'test/test_stubs.c',
  'test/test_controller.c',
  'Core/Src/controller_tasks.c',
  'Core/Src/serial_json.c',
  'Core/Src/interlock_driver.c',
];

for (const fragment of makefileContract) {
  if (!makefile.includes(fragment)) {
    console.error(`firmware_makefile_contract_missing=${fragment}`);
    process.exit(1);
  }
}

const compilerArguments = [
  '-Wall',
  '-Wextra',
  '-std=c11',
  '-g',
  '-Itest',
  '-ICore/Inc',
  '-ICore/Src',
  '-o',
  outputPath,
  'test/mock_hal.c',
  'test/test_stubs.c',
  'test/test_controller.c',
  'Core/Src/controller_tasks.c',
  'Core/Src/serial_json.c',
  'Core/Src/interlock_driver.c',
];

const compile = spawnSync('gcc', compilerArguments, {
  cwd: firmwareRoot,
  stdio: 'inherit',
});

if (compile.error) {
  console.error(`firmware_host_compile_error=${compile.error.message}`);
  process.exit(1);
}
if (compile.status !== 0) {
  console.error(`firmware_host_compile_exit_code=${compile.status}`);
  process.exit(compile.status ?? 1);
}

const test = spawnSync(outputPath, [], {
  cwd: firmwareRoot,
  stdio: 'inherit',
});

if (test.error) {
  console.error(`firmware_host_test_error=${test.error.message}`);
  process.exit(1);
}

console.log('firmware_host_compiler=gcc');
console.log(`firmware_makefile_contract=${makefileContract.length}`);
console.log(`firmware_host_test_exit_code=${test.status ?? 1}`);
process.exit(test.status ?? 1);
