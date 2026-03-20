# ADR: Startup Entrypoint Unification

- Date: 2026-03-12
- Status: Accepted

## Context

The backend had overlapping startup paths in `backend/src/index.ts`, `backend/src/app.ts`, and `backend/src/server.ts`.
Middleware, route registration, and health behavior diverged over time, which made runtime behavior harder to reason about and increased regression risk.

## Decision

We introduced a shared control-plane app builder in `backend/src/bootstrap/control-plane-app.ts`.

- `backend/src/index.ts` is the runtime entrypoint and owns process startup/shutdown.
- `backend/src/app.ts` now reuses the shared app builder instead of defining a parallel Express stack.
- `backend/src/server.ts` is reduced to a thin alias that delegates to `index.ts`.

## Consequences

- Route and middleware registration now live in one place.
- Health endpoints and API surface are consistent across runtime and imported app instances.
- Future startup concerns should be added to bootstrap modules instead of copied into another entrypoint.
