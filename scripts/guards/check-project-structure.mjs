import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const errors = [];

const requiredFiles = [
  '.editorconfig',
  '.idea/Networksafe.iml',
  '.idea/codeStyles/Project.xml',
  '.idea/codeStyles/codeStyleConfig.xml',
  '.idea/dataSources.xml',
  '.idea/inspectionProfiles/Project_Default.xml',
  '.idea/inspectionProfiles/profiles_settings.xml',
  '.idea/runConfigurations/AetherGuard_AI_Diagnose.xml',
  '.idea/runConfigurations/AetherGuard_Backend_Dev.xml',
  '.idea/runConfigurations/AetherGuard_Backend_Tests.xml',
  '.idea/runConfigurations/AetherGuard_Database_Check.xml',
  '.idea/runConfigurations/AetherGuard_Database_Up.xml',
  '.idea/runConfigurations/AetherGuard_Frontend_Dev.xml',
  '.idea/runConfigurations/AetherGuard_Gateway_Safety.xml',
  '.idea/runConfigurations/AetherGuard_Quality_Full_Local.xml',
  '.idea/runConfigurations/AetherGuard_Quality_Quick.xml',
  '.idea/runConfigurations/AetherGuard_Release_Guards.xml',
  'AGENTS.md',
  'CLAUDE.md',
  'backend/package.json',
  'deployment/development/docker-compose.jetbrains.yml',
  'e2e/package.json',
  'firmware/controller-stm32h5/test/Makefile',
  'frontend/package.json',
  'installer/package.json',
  'rescue/Cargo.toml',
  'rust-fastpath/Cargo.toml',
  'scripts/dev/run-firmware-host-tests.mjs',
  'scripts/dev/check-postgres.mjs',
  'simulator/package.json',
  'simulator/tsconfig.typecheck.json',
];

const packageManifestPaths = [
  'package.json',
  'backend/package.json',
  'e2e/package.json',
  'frontend/package.json',
  'installer/package.json',
  'simulator/package.json',
];

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

for (const relativePath of requiredFiles) {
  try {
    const entry = await stat(path.join(repoRoot, relativePath));
    if (!entry.isFile()) errors.push(`${relativePath}: expected a file`);
  } catch {
    errors.push(`${relativePath}: missing`);
  }
}

const packageManifests = new Map();
for (const relativePath of packageManifestPaths) {
  try {
    const manifestText = (await read(relativePath)).replace(/^\uFEFF/, '');
    packageManifests.set(relativePath, JSON.parse(manifestText));
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
  }
}

const rootScripts = packageManifests.get('package.json')?.scripts ?? {};
for (const scriptName of [
  'db:check',
  'db:down',
  'db:status',
  'db:up',
  'check:all',
  'check:backend',
  'check:firmware-host',
  'check:frontend',
  'check:gateway-safety',
  'check:installer',
  'check:project-structure',
  'check:quick',
  'check:release-guards',
  'check:rescue',
  'check:rust-fastpath',
]) {
  if (typeof rootScripts[scriptName] !== 'string' || rootScripts[scriptName].length === 0) {
    errors.push(`package.json: missing non-empty script ${scriptName}`);
  }
}

if (rootScripts['check:firmware-host'] !== 'node scripts/dev/run-firmware-host-tests.mjs') {
  errors.push(
    'package.json: check:firmware-host must use scripts/dev/run-firmware-host-tests.mjs',
  );
}

if (
  packageManifests.get('simulator/package.json')?.scripts?.typecheck !==
  'tsc --project tsconfig.typecheck.json'
) {
  errors.push(
    'simulator/package.json: scripts.typecheck must equal "tsc --project tsconfig.typecheck.json"',
  );
}

try {
  const moduleXml = await read('.idea/Networksafe.iml');
  // Content root may be expressed as $MODULE_DIR$/.. (GUI canonical when the
  // .iml lives in .idea/) or $PROJECT_DIR$ (resolves identically in the GUI
  // and additionally works under the headless inspect.bat inspector).
  const hasContentRoot =
    moduleXml.includes('<content url="file://$MODULE_DIR$/..">') ||
    moduleXml.includes('<content url="file://$PROJECT_DIR$">');
  if (!hasContentRoot) {
    errors.push('.idea/Networksafe.iml: missing <content url> ($MODULE_DIR$/.. or $PROJECT_DIR$)');
  }
  const requiredModuleFragments = [
    '<module type="WEB_MODULE"',
    'backend/src',
    'frontend/src',
    'installer/src',
    'rescue/src',
    'rust-fastpath/src',
    'firmware/controller-stm32h5/test',
    'backend/node_modules',
    'frontend/node_modules',
    'rescue/target',
    'rust-fastpath/target',
  ];
  for (const fragment of requiredModuleFragments) {
    if (!moduleXml.includes(fragment)) errors.push(`.idea/Networksafe.iml: missing ${fragment}`);
  }
} catch {
  // Missing files are reported by the required-file loop.
}

try {
  const gitignore = await read('.gitignore');
  for (const fragment of [
    '.idea/*',
    '!.idea/Networksafe.iml',
    '!.idea/dataSources.xml',
    '!.idea/codeStyles/**',
    '!.idea/inspectionProfiles/**',
    '!.idea/runConfigurations/**',
  ]) {
    if (!gitignore.includes(fragment)) errors.push(`.gitignore: missing ${fragment}`);
  }
  if (gitignore.includes('!.idea/workspace.xml')) {
    errors.push('.gitignore: workspace.xml must remain user-local');
  }
} catch (error) {
  errors.push(`.gitignore: unreadable (${error.message})`);
}

let runConfigurationCount = 0;
try {
  const runDirectory = '.idea/runConfigurations';
  const runFiles = (await readdir(path.join(repoRoot, runDirectory))).filter((name) => name.endsWith('.xml'));
  const names = new Set();
  runConfigurationCount = runFiles.length;
  for (const runFile of runFiles) {
    const content = await read(path.posix.join(runDirectory, runFile));
    const name = content.match(/<configuration[^>]+name="([^"]+)"/)?.[1];
    if (!name) errors.push(`${runDirectory}/${runFile}: missing configuration name`);
    else if (names.has(name)) errors.push(`${runDirectory}/${runFile}: duplicate configuration name ${name}`);
    else names.add(name);

    if (!content.includes('type="js.build_tools.npm"')) {
      errors.push(`${runDirectory}/${runFile}: only portable npm run configurations are allowed`);
    }
    if (!content.includes('$PROJECT_DIR$/')) {
      errors.push(`${runDirectory}/${runFile}: package path must be project-relative`);
    }
    if (/[A-Za-z]:\\|\/Users\/|\/home\//.test(content)) {
      errors.push(`${runDirectory}/${runFile}: contains an absolute user path`);
    }
  }
} catch (error) {
  errors.push(`.idea/runConfigurations: unreadable (${error.message})`);
}

if (errors.length > 0) {
  console.error('project_contracts=failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('project_contracts=passed');
console.log(`required_files=${requiredFiles.length}`);
console.log(`run_configurations=${runConfigurationCount}`);
console.log(`package_manifests=${packageManifests.size}`);
console.log('absolute_user_paths=0');
