# Development Constraints

## Database Access

- Do not access SQLite or Postgres directly from files under `backend/src/api/routes`.
- Route handlers must go through repositories or services.
- Production write behavior must treat Postgres as the primary store when `DB_MODE=postgres`.
- SQLite writes are only allowed when `DB_MODE=sqlite` or `SQLITE_FALLBACK_ENABLED=true`.

## Schema Initialization

- Do not call `ensureSchema()` from request or websocket handlers.
- Service-owned tables must be prepared during bootstrap in `backend/src/bootstrap/persistence.ts`.
- Test-only auto-prepare is allowed inside services when `NODE_ENV=test`.
- Runtime diagnostics must be read-only. Probe routes may use `SELECT 1`, but must not create, mutate, or drop tables.

## API Contracts

- Use `sendSuccess` and `sendError` from `backend/src/core/http/api-response.ts` for REST responses.
- Success responses must follow `{ success: true, data, error: null, meta? }`.
- Failure responses must follow `{ success: false, data: null, error, code, message, meta? }`.
- Legacy top-level fields may be mirrored during migrations, but new routes must still originate from the shared envelope helpers.

## Frontend API Usage

- `frontend/src/services/api.ts` is the only supported entry point for `/api` requests.
- Direct `fetch('/api...')` calls inside `frontend/src` are blocked by `scripts/guards/check-no-direct-api-fetch.mjs`.
