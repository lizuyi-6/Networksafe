# JetBrains Development Setup

The repository commits only team-owned JetBrains settings. User state such as
`.idea/workspace.xml`, data-source passwords, shelves, and HTTP request history remains ignored.

## Project Model

`.idea/Networksafe.iml` defines one `WEB_MODULE` rooted at the repository root. It marks the
backend, frontend, installer, simulator, Rust, Rescue, firmware, and E2E source trees, while
excluding dependency caches, generated builds, test artifacts, runtime data, and Rust targets.

Project code style is driven by `.editorconfig` and `.idea/codeStyles/`. ESLint, unresolved
JavaScript references, unused JavaScript symbols, and TypeScript type validation are enabled in
the shared inspection profile.

## Headless Inspection

`scripts/dev/run-idea-inspect.ps1` drives IntelliJ IDEA's bundled command-line inspector
(`bin/inspect.bat`) against the shared `Project Default` inspection profile, so the same checks
the GUI runs can be reproduced in CI or a shell. It auto-discovers the IDEA install, isolates its
config/system directories so it does not collide with an already-running GUI instance, and accepts
an optional scope directory to keep runs fast:

```powershell
powershell -File scripts/dev/run-idea-inspect.ps1                      # whole project (slow)
powershell -File scripts/dev/run-idea-inspect.ps1 backend\src          # scoped, seconds
```

The module content root is written as `$PROJECT_DIR$` rather than the `$MODULE_DIR$/..` canonical
form. Both resolve to the repository root inside the GUI; `$PROJECT_DIR$` additionally resolves
correctly under `inspect.bat`, which otherwise treats the project directory as the module dir and
scopes analysis one level too high (sweeping in sibling repositories under the parent folder).
`check-project-structure.mjs` accepts either form.

## Run Configurations

| Configuration | Command | Scope |
| --- | --- | --- |
| `AetherGuard - Backend Dev` | `backend npm run dev` | Local backend process |
| `AetherGuard - Frontend Dev` | `frontend npm run dev` | Local Vite process |
| `AetherGuard - Backend Tests` | `backend npm run test:all` | Four-shard Jest suite |
| `AetherGuard - Database Up` | `npm run db:up` | Starts PostgreSQL with a development-only loopback binding on `127.0.0.1:15432` |
| `AetherGuard - Database Check` | `npm run db:check` | Verifies database name, user, PostgreSQL 16+, and reports the public table count |
| `AetherGuard - Quality Quick` | `npm run check:quick` | Structure, release guards, backend/frontend typecheck and lint, installer audit/build |
| `AetherGuard - Quality Full Local` | `npm run check:all` | Sequential local test/build suite; does not include Docker or Playwright release verification |
| `AetherGuard - Gateway Safety` | `npm run check:gateway-safety` | Simulator scenarios plus host-side firmware tests; not hardware HIL |
| `AetherGuard - Release Guards` | `npm run check:release-guards` | Five static release guards |
| `AetherGuard - AI Diagnose` | `npm run diagnose` | Machine-readable repository diagnosis |

The authoritative GitHub workflow remains `.github/workflows/ci.yml`. It additionally runs clean
dependency installs, production dependency audits, Docker image builds, Playwright release
verification, and artifact upload in isolated Linux jobs.

## PostgreSQL Data Source

The shared `AetherGuard PostgreSQL (Local)` data source points to
`jdbc:postgresql://127.0.0.1:15432/aetherguard` with user `aetherguard`. Start it from the
`AetherGuard - Database Up` run configuration, then use the password from the ignored root `.env`
(`POSTGRES_PASSWORD`) when JetBrains prompts. JetBrains stores that password in its local password
safe; it is never committed in `.idea/dataSources.xml`.

The loopback port is provided only by
`deployment/development/docker-compose.jetbrains.yml`. The canonical production Compose file keeps
PostgreSQL internal to the Compose network. Override the local port with
`JETBRAINS_POSTGRES_PORT` when `15432` is occupied, and update the local data-source URL to match.

`DB_MODE=postgres` does not mean every repository has been migrated away from SQLite. PostgreSQL is
authoritative for the repositories that explicitly branch on `getDatabaseMode()`, while remaining
legacy paths may still use the SQLite fallback. Use `/health/ready` and the backend shadow-store
status when validating the running control plane; a successful IDE connection proves database
connectivity, not complete write-path migration.

The Docker backend reads the root `.env` and connects to `postgres:5432` inside the Compose network.
The standalone `AetherGuard - Backend Dev` process reads `backend/.env` and remains SQLite-oriented
unless a developer explicitly supplies a host-reachable shadow URL; the two launch modes are kept
separate so the container hostname `postgres` is never mistaken for a host DNS name.

## Toolchain

- Node.js 22 for CI parity.
- Rust 1.85 with Clippy for `rust-fastpath/` and `rescue/`.
- GCC for firmware host tests. `scripts/dev/run-firmware-host-tests.mjs` compiles into the OS temp
  directory and checks that its flags and source list still match the canonical firmware Makefile.
- Docker is required only for the Docker and release-verification portions of GitHub CI.

## Known Gap

`cargo fmt --check` is not a gate yet. Both existing Rust crates currently produce formatting
diffs, so enabling it now would make every CI run fail without distinguishing new violations from
the existing backlog. Formatting should be introduced in a dedicated, reviewable change that
formats each crate and then adds `cargo fmt --check` to CI.
