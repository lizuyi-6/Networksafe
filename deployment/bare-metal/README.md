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
sudo bash deployment/bare-metal/install.sh --source-tarball /path/release.tar.gz
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
sudo bash deployment/bare-metal/install.sh --source-tarball release.tar.gz
```

## Rollback

Releases are kept under `${AG_DEPLOY_ROOT}/releases/<sha>/` (3 most recent +
current). To roll back:

```bash
PREV_SHA=1af99c9556c6c23da4af64b1ff95f7b8f38aca85
ln -sfn /opt/aetherguard/releases/${PREV_SHA} /opt/aetherguard/current
sudo systemctl restart aetherguard-backend
```

Secrets and the database are **not** rolled back (they live under `shared/`).

## Audit archive

The installer provisions a loopback-only MinIO container and writes a complete
`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` triple into `backend.env`. The
backend then creates the `aetherguard-audit-lock` bucket with **Object Lock
COMPLIANCE / 30-day retention** on first archive. If Docker is absent, the
backend falls back to the local artifact store (the nested-key ENOENT fixed in
`artifact-store.service.ts`).

## Not covered

- **HTTPS** — the installer sets up port 80 only. Add a certificate (Let's
  Encrypt via `certbot`, or a self-signed cert for IP-only hosts) and an
  `https` server block afterward.
- **`PLATFORM_API_KEY`** — left blank; cloud-AI routes run degraded until set.
- **Multi-host / HA** — single-host only.
