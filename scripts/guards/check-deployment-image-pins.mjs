import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const composePath = path.join(repositoryRoot, 'docker-compose.yml');
const bareMetalInstallerPath = path.join(
  repositoryRoot,
  'deployment',
  'bare-metal',
  'install.sh'
);

const [composeContents, bareMetalInstallerContents] = await Promise.all([
  readFile(composePath, 'utf8'),
  readFile(bareMetalInstallerPath, 'utf8')
]);

const violations = [];
const mutableMinioReference = /minio\/minio:latest\b/;
const datedMinioReleaseReference = /^minio\/minio:RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:@sha256:[a-f0-9]{64})?$/;

for (const [relativePath, contents] of [
  ['docker-compose.yml', composeContents],
  ['deployment/bare-metal/install.sh', bareMetalInstallerContents]
]) {
  if (mutableMinioReference.test(contents)) {
    violations.push(`${relativePath}: deployable MinIO image must not use the mutable latest tag`);
  }
}

const composeImageMatch = composeContents.match(
  /^\s{4}image:\s*(minio\/minio:[^\s]+)\s*$/m
);
const bareMetalImageMatch = bareMetalInstallerContents.match(
  /AG_MINIO_IMAGE:=(minio\/minio:[^}]+)}/
);

if (!composeImageMatch) {
  violations.push('docker-compose.yml: unable to resolve the canonical MinIO server image');
}
if (!bareMetalImageMatch) {
  violations.push('deployment/bare-metal/install.sh: unable to resolve AG_MINIO_IMAGE');
}
if (composeImageMatch && !datedMinioReleaseReference.test(composeImageMatch[1])) {
  violations.push(`docker-compose.yml: MinIO image is not a dated immutable release reference: ${composeImageMatch[1]}`);
}
if (bareMetalImageMatch && !datedMinioReleaseReference.test(bareMetalImageMatch[1])) {
  violations.push(`deployment/bare-metal/install.sh: MinIO image is not a dated immutable release reference: ${bareMetalImageMatch[1]}`);
}
if (
  composeImageMatch &&
  bareMetalImageMatch &&
  composeImageMatch[1] !== bareMetalImageMatch[1]
) {
  violations.push(
    `bare-metal MinIO image ${bareMetalImageMatch[1]} does not match canonical Compose image ${composeImageMatch[1]}`
  );
}

if (violations.length > 0) {
  console.error('deployment_image_pins=failed');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('deployment_image_pins=passed');
console.log(`minio_image=${composeImageMatch[1]}`);
