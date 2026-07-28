# AetherGuard bare-metal installer

Idempotent, non-destructive one-command installer for a single-host AetherGuard
deployment (backend + frontend + rust-fastpath + Postgres + Redis + local MinIO,
behind nginx). It supersedes the one-shot `.cursor-native-*.sh` scripts, which
are safe to run **exactly once on a blank host** and **destroy the running
deployment on any repeat** (`rm -rf /opt/aetherguard`, drop database,
`docker system prune --all`).

> ⚠️ **Do not re-run `.cursor-native-deploy.sh` or `.cursor-native-activate.sh`
> on an existing deployment.** They are preserved only for forensic reference.
> Use this installer instead.

## Quick start

```bash
# From a checkout of the repo, on the target host:
sudo bash deployment/bare-metal/install.sh            # deploys HEAD

# Or a specific commit / tag:
sudo bash deployment/bare-metal/install.sh v1.2.3

# Read-only preflight (checks OS, memory, disk, exits 0 if ok):
sudo bash deployment/bare-metal/install.sh --check

# Offline install from a prebuilt tarball:
SOURCE_SHA=0123456789abcdef0123456789abcdef01234567
sudo bash deployment/bare-metal/install.sh \
  --source-tarball /path/release.tar.gz \
  --source-sha "${SOURCE_SHA}"
```

Credentials are written to `/root/aetherguard-credentials.txt` (chmod 600).

## What makes this safe to re-run

| Property | Old scripts | This installer |
|---|---|---|
| `rm -rf /opt/aetherguard` on every run | yes | **never** — only its own release dirs |
| `rm -rf /var/www/*` (all tenants) | yes | **never** — only `/var/www/aetherguard` |
| `DROP DATABASE` on re-run | yes | **never** unless `--reset-db --confirm-destructive` |
| `docker system prune` | yes | **never** |
| Secrets regenerated each run | yes | **no** — generated once, reused |
| Builds re-done if already present | always | cached per-commit |
| nginx: disables other sites | yes (`rm sites-enabled/*`) | **no** — only enables its own |

The script has a path-guard (`assert_owned_path`) that **refuses to `rm -rf`
any path outside the prefixes it owns** (`/opt/aetherguard/releases/*`,
`/opt/aetherguard/shared/*`, `/var/www/aetherguard[/.new/.old]`). It exits 78
(EX_CONFIG) rather than proceed.

## Configuration

All optional, via environment:

| Var | Default | Purpose |
|---|---|---|
| `AG_DEPLOY_ROOT` | `/opt/aetherguard` | release/shared tree root |
| `AG_FRONTEND_DIR` | `/var/www/aetherguard` | nginx docroot |
| `AG_APP_USER` | `aetherguard` | service account |
| `AG_PUBLIC_HOST` | auto (primary IPv4) | used in `ALLOWED_ORIGINS` + credentials |
| `AG_BACKEND_PORT` | `3005` | backend listen port |
| `AG_NODE_HEAP_MB` | `1024` | `--max-old-space-size` for the service |
| `AG_BUILD_JOBS` | `1` | cargo parallelism (raise on >4GB hosts) |
| `AG_SKIP_FASTPATH` | `0` | `1` = don't build/install rust-fastpath |
| `AG_MINIO_IMAGE` | `minio/minio:RELEASE.2025-02-18T16-25-55Z` | pinned MinIO server image for new installations |
| `AG_MINIO_DATA_DIR` | `/var/lib/minio/data` | persistent host path mounted at MinIO `/data` |
| `AG_MINIO_CREDENTIALS_DIR` | `/root` | root-only directory holding MinIO credential files |
| `AG_DEPLOY_LOCK_FILE` | `/run/lock/aetherguard-deployment.lock` | shared installer/rollback operation lock |
| `AG_ALLOW_UNPINNED_MINIO_IMAGE` | `0` | emergency-only opt-in for a non-`RELEASE.*` MinIO image |

## Low-memory hosts (≤2GB)

The installer:
- creates a 4GB swap if none exists,
- builds with `CARGO_BUILD_JOBS=1`,
- caps backend heap at `AG_NODE_HEAP_MB`,
- runs the frontend Vite build with `2 × AG_NODE_HEAP_MB`.

If Vite still OOMs on a 1.5GB box, build the frontend **on a dev machine** and
ship a tarball:

```bash
# dev machine
cd frontend && npm run build && cd ..
tar czf release.tar.gz backend/src backend/dist backend/package*.json \
  frontend/dist rust-fastpath Cargo.toml ...
# host
sudo bash deployment/bare-metal/install.sh \
  --source-tarball release.tar.gz \
  --source-sha "$(git rev-parse HEAD)"
```

`--source-sha` is mandatory for tarball installs so the release directory,
credentials record, and rollback target retain the exact source identity.

## Rollback

Releases are kept under `${AG_DEPLOY_ROOT}/releases/<sha>/` (3 most recent +
current). The installer places a validated rollback helper at
`/usr/local/sbin/aetherguard-rollback`. To roll back the backend and frontend
together:

```bash
PREV_SHA=1af99c9556c6c23da4af64b1ff95f7b8f38aca85
sudo aetherguard-rollback "${PREV_SHA}"
```

The release identifier is mandatory. Automatic selection is intentionally
disabled because a newer release directory may be a staged build that never
passed activation health checks.

The helper stages and atomically switches both application layers, verifies
internal and nginx-proxied readiness, and restores the starting release if the
target fails. Secrets, PostgreSQL, Redis, MinIO, and files under `shared/` are
**never** rolled back. Automatic database restoration could discard writes
made after deployment, so it requires a separate reviewed recovery procedure.

Each release carries `deployment/bare-metal/database-compatibility-epoch`.
Rollback fails closed when the current and target epochs differ. Increment the
epoch only for a migration that is intentionally incompatible with the prior
application release. Releases created before this marker existed are rejected
by default. After manually reviewing schema compatibility, a one-time legacy
rollback can be requested explicitly:

```bash
sudo aetherguard-rollback --allow-legacy-database-epoch "${PREV_SHA}"
```

The installer and rollback helper share a non-blocking `flock`, so concurrent
activation operations are rejected. The installer also persists custom deploy
root, frontend path, backend port, and lock path values in the root-owned
`/etc/aetherguard/rollback.conf`; no secrets are stored there.

## Audit archive

The installer provisions a loopback-only MinIO container and writes a complete
`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` triple into `backend.env`. The
backend then creates the `aetherguard-audit-lock` bucket with **Object Lock
COMPLIANCE / 30-day retention** on first archive. If Docker is absent, the
backend falls back to the local artifact store (the nested-key ENOENT fixed in
`artifact-store.service.ts`).

New installations use the same dated MinIO image as canonical Compose. On an
upgrade, the installer never replaces or downgrades an existing MinIO data
container automatically. It verifies the `/data` mount, recovers the original
container credentials, requires both published ports to remain bound to
`127.0.0.1`, starts a stopped compatible container, and emits a warning when
the existing image differs from the current pin. An arbitrary image override
is rejected unless `AG_ALLOW_UNPINNED_MINIO_IMAGE=1` is explicitly supplied.

## Not covered

- **HTTPS** — the installer sets up port 80 only. Browser-trusted production
  TLS normally requires a controlled DNS name resolving to the host before a
  certificate can be issued. A self-signed IP certificate is suitable only
  for explicitly managed private trust stores, not as public delivery proof.
- **`PLATFORM_API_KEY`** — left blank; cloud-AI routes run degraded until set.
- **Multi-host / HA** — single-host only.
