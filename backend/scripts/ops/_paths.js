const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(backendRoot, '..');
const releasesDir = path.join(repoRoot, 'artifacts', 'releases');
const opsDir = path.join(repoRoot, 'artifacts', 'ops', 'backend');

fs.mkdirSync(opsDir, { recursive: true });

const resolveRelease = (name) => path.join(releasesDir, name);
const resolveOpsFile = (name) => path.join(opsDir, name);
const resolveBackendPath = (...segments) => path.join(backendRoot, ...segments);

module.exports = {
    backendRoot,
    repoRoot,
    releasesDir,
    opsDir,
    resolveRelease,
    resolveOpsFile,
    resolveBackendPath,
};
