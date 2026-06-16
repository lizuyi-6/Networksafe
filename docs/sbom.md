# SBOM (Software Bill of Materials)

## Overview

A Software Bill of Materials (SBOM) is a formal, machine-readable inventory of software components and their supply-chain relationships. AetherGuard generates CycloneDX-formatted SBOMs as part of its enterprise compliance posture.

## Why SBOM

- **Enterprise compliance**: Mid-to-large enterprise procurement and SOC2/ISO27001 requirements increasingly mandate SBOMs for software supply-chain transparency.
- **Vulnerability triage**: When a new CVE affects a transitive dependency, an SBOM lets the security team immediately scope the blast radius without manual `package-lock.json` archaeology.
- **License auditing**: Ensure all third-party licenses are compatible before shipping.
- **Regulatory alignment**: CycloneDX is OWASP-recommended and aligns with NTIA minimum elements for SBOMs.

## Generating SBOMs

From the repository root:

```bash
npm run sbom:all
```

Or individually:

```bash
npm run sbom:backend   # Backend (Node.js/TypeScript) SBOM
npm run sbom:frontend  # Frontend (React/Vite/TypeScript) SBOM
```

## Output

SBOMs are written to `artifacts/sbom/`:

```
artifacts/sbom/backend.cdx.json   # Backend component SBOM
artifacts/sbom/frontend.cdx.json # Frontend component SBOM
```

Both are **CycloneDX JSON 1.5** format and include per-component:
- `name` / `version` — package identity
- `purl` — package URL (SPDX-style)
- `license` — declared license(s)
- `scope` — `required` vs `optional`
- `hashes` — SHA-1 / SHA-256
- `description` / `copyright` where available

## Integration with CI

SBOM generation will be integrated into the CI pipeline in a future sprint. The scripts are wired so that CI can call `npm run sbom:all` and then publish the resulting JSON artifacts as build artifacts or to an SBOM store (e.g., Grype,Dependency Track).

## Artifacts Directory

`artifacts/` is gitignored — SBOM files are generated locally and should not be committed. The `README.md` inside `artifacts/` is the only tracked file in that directory.

## Tooling

- **Generator**: `@cyclonedx/cyclonedx-npm` — the official npm/Node.js CycloneDX generator maintained by OWASP.
- **Format**: CycloneDX JSON 1.5 (the `spec-version 1.5` flag selects the schema version).
- **Spec reference**: https://cyclonedx.org/docs/1.5/json/
