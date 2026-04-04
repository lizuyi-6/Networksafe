# NEV Vendor Repository Export Guide

## Purpose

This document explains how to turn the internal template under `vendor-templates/networksafe-nev-vendor/` into the external repository that a hardware vendor may receive.

## Internal Source Of Truth

- Template: `vendor-templates/networksafe-nev-vendor/`
- Export script: `scripts/vendor/export-nev-vendor.mjs`
- Verification script: `scripts/vendor/verify-nev-vendor-export.mjs`

## What The Export Contains

- Stable contracts under `contracts/`
- Test-only ECDSA keys and HMAC secret defaults
- Mock control plane under `mock-control-plane/`
- Sanitized reference companion under `reference-companion/`
- Black-box acceptance suite under `acceptance-tests/`
- Deliverable placeholders under `deliverables/`

## What The Export Must Not Contain

- Production keys or provisioning data
- Tenant or auth internals
- Real audit pipeline logic
- Full database schema or migration history
- Unrelated AI, scanner, or dashboard modules
- Real customer logs, firmware packages, or incident data
- Current `control board v1` KiCad, gerbers, BOM, or proto hardware release files

## Export Command

```bash
node scripts/vendor/export-nev-vendor.mjs --target ..\networksafe-nev-vendor
```

Use `--force` only when you want to overwrite an existing export target.

## Recommended Verification

Run the internal smoke test before sharing:

```bash
npm run verify:vendor:nev
```

This flow exports the template to a temporary directory, checks for required and forbidden content, runs `npm install`, `npm run typecheck`, and `npm run test:acceptance` inside the exported repository.

## Share Checklist

1. Export the repository to a clean directory outside the monorepo.
2. Open `EXPORT_MANIFEST.md` in the exported repository.
3. Confirm the recorded source commit and worktree state are expected.
4. Confirm no hardware CAD or internal platform modules were exported.
5. Run install, typecheck, and acceptance tests in the exported repository.
6. Share only the exported repository with the vendor.

## Required Review Before Sharing

1. Open `EXPORT_MANIFEST.md` in the exported repository.
2. Confirm the source worktree was reviewed before export.
3. Recreate the repository outside the internal monorepo.
4. Grant the vendor access to the exported repository only.
5. Keep the final integration and production release inside the internal control-plane repository.
