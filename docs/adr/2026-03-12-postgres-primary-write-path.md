# ADR: Postgres as the Production Primary Write Path

- Date: 2026-03-12
- Status: Accepted

## Context

The codebase supports SQLite plus Postgres shadow storage. This is useful for local and demo workflows, but it creates ambiguity in production about which store is authoritative.

## Decision

Production validation now treats `DB_MODE=postgres` as the required configuration.

- Startup validation fails in production when `DB_MODE` is not `postgres`.
- Health/readiness reporting treats Postgres availability as a readiness blocker when the runtime is configured for Postgres.
- SQLite remains available for `dev`, `demo`, and `test`.

## Consequences

- Production deployments now have a single explicit primary data path.
- Local and demo workflows remain lightweight.
- Further repository extraction should assume Postgres-first behavior in production code paths.
