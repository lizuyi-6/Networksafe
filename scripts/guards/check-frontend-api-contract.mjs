/**
 * Guard: frontend/backend API contract consistency.
 *
 * Extracts every backend endpoint path the frontend calls (from api.ts) and
 * every route the backend actually registers (router.<method> + the mount
 * prefixes in control-plane-app.ts), normalizes both to Express `:param` form,
 * and fails if the frontend calls an endpoint the backend never declares.
 *
 * Catches the "frontend calls /api/foo, backend has no /foo" class of bug at
 * CI time instead of at runtime. Path parameters (`${id}` in the frontend,
 * `:id` in Express) are normalized so they match regardless of name.
 *
 * Run: node scripts/guards/check-frontend-api-contract.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const apiTsPath = path.join(workspaceRoot, 'frontend', 'src', 'services', 'api.ts');
const controlPlanePath = path.join(workspaceRoot, 'backend', 'src', 'bootstrap', 'control-plane-app.ts');
const routesDir = path.join(workspaceRoot, 'backend', 'src', 'api', 'routes');

function normalizePath(p) {
    // A ${...toString()} interpolation appended to a path is a query-string
    // builder (e.g. /rules${search.toString()}); the source may be truncated at
    // the backtick, so drop from "toString" onward regardless of closing brace.
    p = p.replace(/toString.*$/, '');
    p = p.replace(/\$\{[^}]*$/, ''); // dangling unclosed ${ from backtick truncation
    // strip query string
    p = p.split('?')[0];
    // collapse trailing slash
    p = p.replace(/\/$/, '');
    // Any template interpolation becomes :param — covers ${id}, ${encodeURIComponent(x)}.
    p = p.replace(/\$\{[^}]*\}/g, ':param');
    // Express path params (:id, :logId, ...) -> :param so names don't matter.
    p = p.replace(/\/:[A-Za-z0-9_]+/g, '/:param');
    p = p.replace(/\([^)]*\)/g, '');
    p = p.replace(/\/+/g, '/');
    p = p.replace(/\/+$/, '');
    return p || '/';
}

// ---- 1. Frontend calls -------------------------------------------------

function extractFrontendCalls() {
    if (!fs.existsSync(apiTsPath)) return new Set();
    const content = fs.readFileSync(apiTsPath, 'utf8');
    const calls = new Set();
    // Capture everything from ${API_BASE_URL} up to the closing backtick of the
    // template literal, then normalize (which collapses interpolations to :param).
    const re = /\$\{API_BASE_URL\}([^`]+)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        calls.add(normalizePath(m[1]));
    }
    return calls;
}

// ---- 2. Backend registered routes --------------------------------------

// Static paths registered directly on apiRouter/app (e.g. apiRouter.get('/announcements', ...))
function extractInlineBackendRoutes(controlPlaneContent) {
    const routes = new Set();
    const inlineRe = /apiRouter\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = inlineRe.exec(controlPlaneContent)) !== null) {
        routes.add(normalizePath(m[2]));
    }
    return routes;
}

// Router files: each declares relative paths; the mount prefix in control-plane-app
// turns them into full paths. We model every (prefix, relativePath) combination.
function buildBackendRouteSet() {
    const controlPlane = fs.readFileSync(controlPlanePath, 'utf8');

    // mountPrefix -> router module file basename (without ext) imported
    const mounts = []; // { prefix, module }
    const mountRe = /apiRouter\.use\(\s*['"`]([^'"`]*)['"`]\s*,\s*(\w+)/g;
    let m;
    while ((m = mountRe.exec(controlPlane)) !== null) {
        mounts.push({ prefix: m[1], routerVar: m[2] });
    }

    // Resolve each router var to its source file via the import statements.
    const importRe = /import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g;
    const varToFile = new Map();
    while ((m = importRe.exec(controlPlane)) !== null) {
        varToFile.set(m[1], m[2]);
    }

    const fullRoutes = new Set();
    // Inline (no router file) routes on apiRouter itself.
    for (const r of extractInlineBackendRoutes(controlPlane)) fullRoutes.add(r);

    for (const mount of mounts) {
        const rel = varToFile.get(mount.routerVar);
        if (!rel) continue;
        // Resolve import path to a routes file.
        const candidate = path.resolve(path.dirname(controlPlanePath), rel + (rel.endsWith('.ts') ? '' : '.ts'));
        if (!fs.existsSync(candidate)) continue;
        const content = fs.readFileSync(candidate, 'utf8');
        const relRe = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
        let rm;
        while ((rm = relRe.exec(content)) !== null) {
            const relPath = rm[2];
            // Mounting a router at '/' with a router that declares '/foo' => '/foo'.
            const combined = mount.prefix === '/' || mount.prefix === ''
                ? relPath
                : relPath === '/' ? mount.prefix : mount.prefix + relPath;
            fullRoutes.add(normalizePath(combined));
        }
    }

    // Health endpoints are registered directly in index.ts/app.ts, not under /api.
    fullRoutes.add(normalizePath('/health'));
    fullRoutes.add(normalizePath('/health/live'));
    fullRoutes.add(normalizePath('/health/ready'));

    return fullRoutes;
}

// ---- 3. Compare ---------------------------------------------------------

const frontendCalls = extractFrontendCalls();
const backendRoutes = buildBackendRouteSet();

const missing = [...frontendCalls].filter((p) => !backendRoutes.has(p)).sort();

if (missing.length > 0) {
    console.error('Frontend calls endpoints the backend does not register:');
    for (const p of missing) console.error(`  - ${p}`);
    console.error('');
    console.error(`Backend declares ${backendRoutes.size} routes; frontend calls ${frontendCalls.size}.`);
    process.exit(1);
}

console.log(`API contract consistent: ${frontendCalls.size} frontend calls all resolve to backend routes (${backendRoutes.size} registered).`);
