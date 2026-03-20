# Productionization Status

## Completed

- Backend startup is unified through the bootstrap path rooted at `backend/src/index.ts`.
- Runtime environment validation now enforces production-safe defaults, including `DB_MODE=postgres`.
- `backend/src/api/routes` no longer performs direct database access. Route-level SQL was moved into repositories or services.
- The route DB guard allowlist is empty and enforced by `scripts/guards/check-route-db-access.mjs`.
- Core API slices now return the shared envelope shape with legacy compatibility fields where older clients still depend on them.
- Pipeline diagnostics are read-only. The `/api/pipeline/verify` route no longer creates or drops probe tables.
- Bootstrap persistence prepares the main runtime services up front, including audit, scanner, tenant oversight, device control, and security operations.
- Frontend direct `/api` fetches remain blocked by `scripts/guards/check-no-direct-api-fetch.mjs`.

## Remaining

- Several routes still use legacy `res.json(...)` instead of `sendSuccess/sendError` consistently across every branch, especially in `admin.routes.ts` and some oversight endpoints.
- The Jest runtime in this environment is currently not executing successfully even after config cleanup, so route/integration verification remains incomplete here.
- Tenant fallback cleanup is still incomplete in unrelated route files such as `agents.routes.ts`, `config.routes.ts`, `deployments.routes.ts`, and `traffic.routes.ts`.
- Postgres-primary semantics are now applied to the newly introduced repositories, but older service internals still contain mixed SQLite-first assumptions that should be normalized in a follow-up pass.

## Acceptance Snapshot

- Route-level DB access: complete
- Runtime bootstrap preparation: mostly complete for the listed production services
- REST envelope migration: partial, with the highest-risk routes covered
- Release guard cleanup: complete for route DB access and frontend direct API access
