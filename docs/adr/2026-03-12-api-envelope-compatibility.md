# ADR: API Envelope Compatibility

- Date: 2026-03-12
- Status: Accepted

## Context

The backend returned a mix of raw payloads and `{ success, data }` payloads. The upgrade plan requires a unified envelope without breaking existing callers.

## Decision

We introduced shared API response helpers in `backend/src/core/http/api-response.ts` and started applying them to priority endpoints.

- The canonical response shape is `{ success, data, error, meta }`.
- For compatibility, touched endpoints also preserve legacy top-level fields when existing clients rely on them.
- Frontend callers now unwrap envelope responses through shared helpers in `frontend/src/services/api.ts`.

## Consequences

- New and migrated routes can converge on a single response contract.
- Existing frontend flows continue to work during the migration window.
- Future route changes should prefer the shared helpers over ad hoc `res.json(...)`.
