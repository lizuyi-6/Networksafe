# Hardware-Gated Final Defense Submission Package

This directory contains a truth-constrained journal submission package for the
AetherGuard hardware-gated authorization work.

Files:

- `manuscript.md`: English manuscript draft aimed at a systems/security journal.
- `evidence-register.md`: claim-by-claim traceability map to repository artifacts
  and the latest local verification performed on 2026-05-26.
- `submission-plan.zh.md`: Chinese journal recommendation and submission plan.

Truth policy:

- The manuscript treats AetherGuard as an implemented research prototype and
  engineering artifact.
- It does not claim production deployment, real-board hardware-in-the-loop
  validation, secure-element provisioning completion, or 100k+ QPS.
- It distinguishes the legacy ESP32 serial deployer from the newer Final Defense
  control-board and external network-gateway designs.
- It states that root-resistant protection applies only to links physically
  routed through the external gateway.

