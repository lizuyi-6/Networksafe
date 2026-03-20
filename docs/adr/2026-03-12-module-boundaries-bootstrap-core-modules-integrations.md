# ADR: Bootstrap/Core/Modules/Integrations Boundary

- Date: 2026-03-12
- Status: Accepted

## Context

Infrastructure responsibilities such as environment validation, schema bootstrapping, health reporting, and route-local schema creation were mixed into routes and entrypoints.

## Decision

We started enforcing explicit boundaries:

- `backend/src/bootstrap/*` owns startup orchestration and persistence bootstrap.
- `backend/src/core/*` owns shared HTTP and health primitives.
- `backend/src/modules/*` owns feature-local persistence helpers and schema setup.
- existing `services/*` remain integration-heavy runtime services until they are gradually moved behind module boundaries.

The first extracted modules are deployment profiles and agent onboarding schema bootstrap.

## Consequences

- Startup behavior is easier to audit and extend.
- Route handlers can shrink toward transport concerns instead of owning storage bootstrap.
- This boundary is incremental; more services can be migrated without a large rewrite.
