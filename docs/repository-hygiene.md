# Repository Hygiene

This repository should stay focused on source, tests, hand-authored documentation, and explicitly promoted release evidence.

## Keep In Git

- Application source under `backend/src`, `frontend/src`, `rust-fastpath/src`, Gateway Appliance hardware source under `hardware/`, and supporting scripts. (The legacy `esp32/src` firmware directory was retired 2026-06-13 and archived out of repo; see `docs/artifact-archive-index.md`.)
- Tests and test fixtures that are small, deterministic, and required by CI.
- Hand-authored architecture, operations, hardware, and security documentation.
- KiCad source files and reviewed hardware source assets.
- Small release evidence files only when they are intentionally referenced from release-readiness documentation.

## Keep Out Of Git

- Runtime databases, local `.env` files, cookies, logs, and Playwright state.
- Generated screenshots, videos, voiceovers, soft-copyright printouts, generated user manuals, and slide decks.
- KiCad Gerbers, drill files, board-house upload folders, pick-and-place exports, scratch routing files, probe reports, and lock files.
- Local black-box QA captures, security-test report directories, and temporary acceptance outputs.
- Build output, dependency folders, compiled firmware, and local deploy bundles.

## Cleanup Workflow

1. Move large generated artifacts to `X:\repos\Networksafe-archive\<date>-<reason>\`.
2. Record the move in `docs/artifact-archive-index.md` when the artifact is useful for future inspection.
3. If a generated file was already tracked, remove it from the index with `git rm --cached <path>` after confirming the file is preserved elsewhere.
4. Re-run:

```bash
node scripts/guards/check-route-db-access.mjs
node scripts/guards/check-no-direct-api-fetch.mjs
cd backend && npm run typecheck
cd frontend && npm run typecheck
```

5. For hardware or release evidence, link to the external archive or object-store location instead of committing the generated package directly.
