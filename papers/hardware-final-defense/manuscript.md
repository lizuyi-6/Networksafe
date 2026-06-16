# Hardware-Gated Authorization for Destructive Server Operations: Design and Evidence from the AetherGuard Prototype

## Abstract

Destructive server operations such as agent removal, data wiping, recovery flashing, and critical configuration changes are difficult to secure with software-only authorization. If an attacker compromises the control plane, steals administrator credentials, or obtains root on a protected host, ordinary approval workflows can become another programmable interface for damage. This paper presents AetherGuard, a prototype server security platform that adds a hardware-gated authorization path for high-risk operations. The central mechanism is a physically confirmed hardware grant: a dangerous command is converted into a command intent, bound to a payload hash, policy digest, challenge, breaker target, interlock action, expiry time, and monotonic counter, and dispatched only after a registered hardware gate returns a verifiable signature. The prototype supports two deployment boundaries. The host-companion mode protects operations mediated by a trusted local companion and interlock feedback. The root-resistant mode moves the final network release decision outside the protected server into an external network isolation gateway, with active status requiring policy match, attestation metadata, a secure element, linked data ports, an independent management path, and a healthy bridge state. We report repository-traceable evidence from the current AetherGuard workspace: focused Jest tests for hardware grants and Final Defense policy behavior, architecture guards that prevent direct route-level database access and direct frontend API fetches, simulated ESP32-compatible physical confirmation flow evidence, deployment bundle validation, and documented smoke measurements. The current evidence supports the design and software authorization path, but not yet a claim of complete real-hardware enforcement. Hardware-in-the-loop validation of the control board, secure-element provisioning, and external gateway bridge isolation remain required before stronger deployment claims can be made.

## Keywords

hardware authorization; server security; destructive operation control; physical confirmation; root-resistant defense; fail-closed design; auditability; ESP32

## 1. Introduction

Server security platforms often treat the control plane as the place where final authority resides. Administrators log in, policies are checked, and commands are sent to host agents or devices. This model is convenient, but it leaves a sharp failure mode: the very system responsible for defense may become the actuator for destructive actions once credentials, API tokens, deployment scripts, or the control-plane process are compromised.

The risk is clearest for operations that are rare, high-impact, and hard to reverse. Removing a security agent, wiping data, flashing recovery firmware, temporarily releasing an isolation bridge, or changing a critical configuration should not be equivalent to sending an ordinary authenticated API request. These operations need a final confirmation path that is not fully programmable from the compromised environment.

AetherGuard explores a practical version of that idea. The system combines a Node.js/TypeScript control plane, distributed agents, a React operations console, a Rust fastpath sidecar, and hardware-facing authorization components. Its distinctive feature is a physical confirmation gate for high-risk operations. The legacy ESP32 serial deployment dongle implements a local USB-TTL confirmation workflow for deployment and removal. The newer Final Defense path generalizes the concept: a command intent is created in the backend, but execution is withheld until a registered hardware gate confirms the request with a signed grant bound to the exact action context.

This paper is deliberately narrower than a product whitepaper. It does not claim that AetherGuard is a fully validated production defense system. Instead, it asks:

**Can a server security platform make destructive operations materially harder to automate after software compromise by requiring a signed, physically confirmed, context-bound hardware grant before dispatch?**

The answer offered here is a system design and evidence-constrained prototype report. The repository implements the authorization path, policy digest computation, active/degraded status logic, external gateway status model, API routes, command dispatch integration, and tests for the most important failure cases. It also documents what is not yet proven: real control-board hardware-in-the-loop release and feedback validation, physical secure-element provisioning, and real external gateway bridge isolation.

The paper makes four contributions:

1. It defines a hardware-gated authorization model for destructive server operations, centered on command intents and physically confirmed signed grants.
2. It presents a fail-closed Final Defense status model for host-companion and root-resistant external-gateway deployment boundaries.
3. It maps the model to an implemented AetherGuard prototype with typed backend services, API routes, device gateway integration, audit logging, and command dispatch.
4. It provides a truth-preserving evidence register that separates currently validated software behavior from future hardware-in-the-loop claims.

## 2. Problem and Threat Model

### 2.1 Destructive Operations

The prototype classifies server and device commands into three operational risk classes: automatic, administrator-approval required, and physical-confirmation required. In the current implementation, commands such as `host_remove`, `host_uninstall`, `wipe_data`, `factory_reset`, `recovery_flash`, `firmware_flash`, `ota_update`, `critical_config_change`, `interlock_assert`, `interlock_release`, `isolate`, `arm`, `release_temporary`, and `attest` are treated as requiring physical confirmation. This list is not a universal taxonomy; it is a concrete policy choice in the AetherGuard implementation.

The common property is not that these commands are always malicious. It is that their misuse can disable protection, destroy evidence, disconnect a host, or make recovery difficult. A system that allows them to be executed through ordinary software approval alone remains vulnerable to a sufficiently privileged attacker.

### 2.2 Adversaries

The design considers three adversary levels.

**Credential or API compromise.** The attacker can call authenticated APIs or act as an administrator, but does not possess the hardware gate or its signing key.

**Control-plane compromise.** The attacker can influence backend state or command creation. This is the threat model for which context-bound grant verification, monotonic counters, expiry, and fail-closed status checks are most important.

**Protected-host root compromise.** The attacker controls the protected host operating system, local agent, local scripts, and local logs. A host companion running on that same host is not sufficient in this model. A root-resistant claim therefore requires moving the final enforcement point outside the protected server, for example into an external network isolation gateway.

### 2.3 Trusted Boundaries

AetherGuard has two distinct boundaries.

In **host-companion gate mode**, the local companion, control board, interlock feedback, and policy file are part of the trusted path for operations mediated by that host. This mode is useful against control-plane misuse and ordinary remote compromise, but it should not be described as root-resistant if the attacker controls the companion host.

In **external network gateway mode**, the protected server's data link is physically routed through an external gateway. The gateway reports bridge state, policy digest, firmware digest, attestation time, secure-element state, data-port links, and management path. A high-risk host operation can be requested only when an active external gateway exists. This mode is the basis for the root-resistant argument, but only for links actually cabled through the gateway.

## 3. Design

### 3.1 Command Intent

A destructive command is first represented as a command intent. The intent records the tenant, scope, target, command type, risk class, payload, payload hash, requester, timestamps, confirmation session, grant id, and status. This converts an imperative request into a durable object that can be audited, inspected, and either confirmed or rejected.

The payload hash is computed over a stable JSON serialization. Stable serialization matters because the hardware grant must bind to the exact payload semantics rather than to incidental object key ordering.

### 3.2 Confirmation Session

If a command requires physical confirmation, the hardware authorization service selects an online hardware gate for the tenant and creates a confirmation session. The session includes a human-readable prompt and a summary containing the action id, scope, target id, command type, risk class, payload hash, requester, and any Final Defense context fields.

The gateway then emits a `physical_confirmation_required` command to the registered hardware gate. In the current backend implementation this is integrated with the device gateway and command dispatcher. The legacy ESP32 serial deployer uses a separate UART protocol and local state machine, but it embodies the same product principle: dangerous install or removal operations require local physical interaction.

### 3.3 Hardware Grant

A hardware grant is an envelope containing:

- gate id;
- session id;
- action id;
- tenant id;
- scope;
- target id;
- command type;
- payload hash;
- optional policy digest;
- optional challenge;
- optional breaker target;
- optional interlock action;
- issued-at timestamp;
- expiry timestamp;
- monotonic counter;
- signature;
- algorithm identifier.

The grant message is built as a deterministic newline-delimited sequence of these fields. The backend verifies the signature using the gate's registered public key. Extended Final Defense fields are part of the signed message; if they are present, legacy fallback verification is not allowed. This is important because a grant for one policy, breaker target, or challenge must not be replayed as a grant for another.

The service rejects grants when the operator did not confirm, the signature is missing, grant time fields are missing, the counter is not finite, the counter is not increasing, expiry does not match the session, a signed context field mismatches the session summary, the session is expired, the gate does not match, or signature verification fails.

### 3.4 Policy Digest

Final Defense policies define allowed actions, breaker target, release TTL, companion id, gate id, tenant id, creation time, and status. The policy digest is a SHA-256 hash over a normalized policy document. The digest is then carried in the hardware context and, when applicable, in the signed hardware grant.

This prevents an attacker from asking a hardware gate to confirm an apparently similar command under a different policy. It also gives the status layer a compact way to detect drift between the control-plane policy and the policy reported by the companion or gateway.

### 3.5 Fail-Closed Status

The system reports active status only when required conditions are healthy. For host-companion mode, active status requires a fresh companion heartbeat, online companion state, secure-element presence, external power, verified feedback, acceptable interlock state, policy digest match, and no last error. Interlock state is normalized; legacy `asserted` maps to `isolated`.

For external gateway mode, active status requires a fresh gateway heartbeat, online gateway state, secure-element presence, policy digest match, firmware digest, attestation timestamp, linked server and LAN ports, independent management path, acceptable bridge state, no active isolation reason, and no last error.

The default behavior is conservative. Missing evidence creates degraded reasons rather than a silent active state.

### 3.6 Root-Resistant Gateway Gate

Root-resistant high-risk commands are blocked until an active external gateway is present for the tenant. The reason is simple: if the protected host is already compromised at root level, a host-local companion cannot be the final authority. The external gateway is the only boundary in the current design that can plausibly remain outside the protected host's control.

Temporary bridge release is also gated. A `release_temporary` gateway action is accepted only when the gateway is configured, belongs to the tenant, the action is in the allowed gateway action set, and the gateway is currently active.

## 4. Implementation

### 4.1 Backend Services

The implementation is primarily in four backend modules.

`command-risk-policy.ts` classifies command types into risk classes and identifies commands requiring physical confirmation.

`hardware-grant.ts` provides stable serialization, payload hashing, hardware grant message construction, and signature verification.

`hardware-authorization.service.ts` manages hardware gates, command intents, confirmation sessions, hardware grants, grant validation, session rejection, and intent completion.

`final-defense.service.ts` manages Final Defense policies, host-companion status, root-resistant external gateway status, and hardware-confirmation requests for protected actions.

The command dispatcher integrates this authorization layer into agent, device, and deployment workflows. If a command requires physical confirmation, it records an action run, requests hardware confirmation, and returns an approval-required result until a verified grant arrives.

### 4.2 API Surface

The Final Defense route exposes status, policy, action, and gateway endpoints. These include:

- `GET /api/final-defense/status`;
- `POST /api/final-defense/status/report`;
- `POST /api/final-defense/gateways/status/report`;
- `POST /api/final-defense/policies`;
- `POST /api/final-defense/actions`;
- `POST /api/final-defense/gateways/actions`.

The routes use shared success and error envelope helpers. Repository rules forbid route-level database access; route handlers must call services or repositories instead.

### 4.3 Device Gateway

The experimental device gateway handles device registration, heartbeat, data, alerts, OTA status, physical confirmation acknowledgments, codebook sync, and disconnects. It uses API-key validation, socket rate limiting, command signing, and audit logging. It also rejects destructive device commands in enterprise runtime unless a hardware grant is present.

The gateway is not the same as the legacy ESP32 USB-TTL serial deployer firmware. It is the backend WebSocket path for ESP32-compatible or simulated devices. The distinction matters because the current validation evidence includes a simulated device flow, while real-board USB-TTL validation remains future work.

### 4.4 Legacy ESP32 Serial Deployer

The legacy firmware implements a local deployment state machine with OLED display, buttons, RGB indicator, buzzer, and serial helper interaction. It has confirmation states for installation and critical removal. The ADR dated 2026-03-14 fixes this hardware baseline as a jumper-wire prototype: one ESP32 development board, one external CP2102, jumper wires, breadboard modules, and the existing `AG:REQ:*` plus `AG:*` protocol.

This hardware path is relevant because it demonstrates the product's physical-confirmation principle. It should not be conflated with the newer root-resistant external gateway design.

## 5. Evaluation

### 5.1 Evaluation Policy

The evaluation is evidence constrained. We report only results that are traceable to repository artifacts or to commands rerun in the current workspace. We do not report production deployment, customer traffic, or hardware-in-the-loop enforcement results because those have not been validated in the current evidence set.

### 5.2 Local Verification on 2026-05-26

Two focused Jest suites were rerun in the workspace:

```text
npx jest src/__tests__/services/hardware-authorization.service.test.ts src/__tests__/services/final-defense.service.test.ts --runInBand
```

Both suites passed: 2 test suites, 8 tests.

The hardware authorization tests verify that a signed hardware grant can be accepted and dispatched, and that tampered Final Defense context is rejected. The Final Defense tests verify active/degraded status behavior, root-resistant gateway requirements, blocking of high-risk actions before an external gateway is active, temporary gateway release through hardware confirmation, and inclusion of policy digest, challenge, breaker target, and interlock action in grants.

Two repository architecture guards were also rerun:

```text
node scripts/guards/check-route-db-access.mjs
node scripts/guards/check-no-direct-api-fetch.mjs
```

Both passed. This supports the implementation claim that route handlers avoid direct database access and frontend API calls go through the centralized API client.

### 5.3 Previously Recorded Workspace Evidence

The validated capability report dated 2026-03-08 records a Docker runtime with backend, frontend, fastpath, Postgres, and Redis; deployment bundle generation and static validation for nginx, Apache, Caddy, Docker Compose, binary agent, and Kubernetes daemonset; object-lock-backed audit archive verification; notification outbox behavior; configurable AI routing and fastpath integration; and a simulated ESP32-compatible device flow including registration, heartbeat, OTA status, physical confirmation requirement, physical confirmation acknowledgment, and follow-up reboot dispatch.

The same report records a smoke performance snapshot of 1329.79 QPS and 21 ms p95 latency for the fastpath path. This is a smoke result, not a production-scale performance claim.

The deployment bundle validation report records all six bundle targets passing their static or containerized validations. The release readiness report, however, records an overall no-go decision because external Linux binary-agent install/healthcheck/upgrade/rollback evidence failed at the healthcheck step. This no-go result is important: the paper should not imply a completed external host lifecycle validation.

### 5.4 Security Properties Supported by Current Evidence

The current evidence supports the following properties at the software-prototype level.

**Context binding.** Grants bind to action identity, payload hash, policy digest, challenge, breaker target, interlock action, expiry, and monotonic counter.

**Tamper rejection.** A grant with mismatched Final Defense context is rejected.

**Replay resistance within gate state.** Monotonic counters must increase relative to the gate's last accepted counter, and grants expire with their session.

**Fail-closed active status.** Missing or mismatched health evidence produces degraded reasons rather than active status.

**Root-resistant precondition.** High-risk root-resistant actions require an active external gateway before a hardware confirmation request is accepted.

**Architectural separation.** The repository guards enforce important implementation boundaries: route handlers do not directly access the database, and frontend API calls do not bypass the central API service.

### 5.5 Properties Not Yet Demonstrated

The current evidence does not demonstrate:

- physical Gateway Appliance security controller release and feedback behavior;
- ATECC608C secure-element provisioning and signing ceremony;
- physical Root-Resistant Gateway Appliance bridge isolation and release;
- secure boot or measured boot for gateway firmware;
- resistance to all physical bypasses;
- production-scale deployment or production traffic outcomes.

These limitations are not editorial weaknesses to hide. They define the boundary of the honest contribution.

## 6. Discussion

### 6.1 Why Physical Confirmation Helps

Physical confirmation adds value when the attacker can issue software commands but cannot press a local button or obtain the hardware signing key. It changes the attack from a purely remote API problem into a problem involving physical presence or hardware compromise. For destructive operations, that is a meaningful shift.

The design is not equivalent to general multifactor authentication. Ordinary MFA can authorize a user session, after which the session can still be abused. AetherGuard binds confirmation to an operation-specific grant: the exact action, payload, policy, target, challenge, and expiry are part of what is signed.

### 6.2 Why Physical Confirmation Is Not Enough

Physical confirmation does not solve every threat. An attacker with root on a protected host can still damage local data, disable host-local logs, manipulate local scripts, or use network paths not routed through the gateway. This is why the paper distinguishes host-companion mode from external-gateway mode.

Even external gateway mode is conditional. The protected link must actually pass through the gateway; otherwise, the gateway cannot enforce isolation. Out-of-band BMC, spare NICs, Wi-Fi, local console, and direct storage access are outside the v1 guarantee unless separately controlled.

### 6.3 Usability and Operations

Hardware gates can slow down legitimate emergency response. A practical deployment therefore needs action classification, clear prompts, timeout behavior, fallback procedures, and audit trails. AetherGuard's command-risk policy and command-intent records are an initial step, but real deployments would need organization-specific policy authoring and operator training.

### 6.4 Research Maturity

The work is best described as a system prototype with an implemented authorization path and early validation. It is not yet a complete empirical study of hardware-gated operations in production. A stronger future paper should add hardware-in-the-loop experiments, latency measurements for physical confirmation workflows, bypass tests, and operator usability measurements.

## 7. Threats to Validity

**Internal validity.** The strongest current tests are focused service tests. They exercise important grant and policy behavior but do not cover every integration path.

**External validity.** The validation environment is a local workspace and Docker stack, not a production fleet. Results may not generalize to large deployments without further measurement.

**Construct validity.** Passing software tests does not prove physical security. Hardware enforcement claims require real boards, secure elements, wiring, and gateway bridge tests.

**Implementation drift.** The repository includes legacy and newer hardware paths. Papers and product materials must avoid mixing claims from the ESP32 serial deployer, host companion, control board, and external gateway unless the deployment boundary is explicit.

## 8. Future Work

The most important next validation steps are:

1. Run a real Gateway Appliance security controller hardware-in-the-loop confirmation for at least one destructive operation and one interlock release.
2. Validate rejection cases on hardware: invalid signature, policy digest mismatch, expired grant, monotonic counter rollback, wrong gate, and disconnect during confirmation.
3. Provision a physical secure element and document the key ceremony.
4. Test a Root-Resistant Gateway Appliance with real traffic, measuring bridge isolation, release, failure recovery, heartbeat loss, and management-path independence.
5. Add a red-team bypass matrix for spare NICs, BMC, Wi-Fi, local console, direct disk access, and policy-file tampering.
6. Package the code and evidence register as supplemental material or an archived artifact with a permanent identifier.

## 9. Conclusion

AetherGuard demonstrates a concrete way to make destructive server operations less dependent on software-only approval. By converting dangerous commands into auditable intents and requiring a signed, physically confirmed, context-bound hardware grant before dispatch, the prototype creates a stronger barrier against credential misuse and control-plane compromise. Its root-resistant design further recognizes that host-local enforcement is not enough when the protected server may already be compromised, and therefore moves the final network release decision to an external gateway. The current repository evidence supports the software authorization path, fail-closed status logic, and architectural boundaries. It does not yet support unconditional real-hardware or production-scale claims. That boundary is precisely what makes the paper publishable with integrity: the contribution is a defensible system design and prototype, with clearly stated validation gaps.

## Acknowledgments and Disclosure

This draft was prepared with AI-assisted editorial support for structure, wording, and evidence organization. The technical claims, repository evidence, and final responsibility for accuracy must be reviewed and approved by the human authors before submission.

## Data and Code Availability

The manuscript is based on the AetherGuard repository at the time of preparation. If submitted, the authors should provide an archived source snapshot, commit hash, and supplemental evidence register. Any secrets, private keys, operational credentials, customer data, and unsafe deployment artifacts must be removed before archival.

## Conflict of Interest

To be completed by the authors. If AetherGuard is a commercial or product-development project by the authors, that relationship should be disclosed.

## Funding

To be completed by the authors.

## Selected References

1. J. H. Saltzer and M. D. Schroeder, "The Protection of Information in Computer Systems," Proceedings of the IEEE, 1975.
2. NIST, "Zero Trust Architecture," Special Publication 800-207, 2020.
3. NIST, "Digital Identity Guidelines: Authentication and Lifecycle Management," Special Publication 800-63B, 2017.
4. NIST, "Security and Privacy Controls for Information Systems and Organizations," Special Publication 800-53 Revision 5, 2020.
5. OWASP Foundation, "OWASP Application Security Verification Standard."
6. OWASP Foundation, "OWASP Core Rule Set."
7. MITRE, "ATT&CK Enterprise Matrix."
8. M. Bellare, R. Canetti, and H. Krawczyk, "Keying Hash Functions for Message Authentication," CRYPTO, 1996.
9. P. A. Karger and R. R. Schell, "Thirty Years Later: Lessons from the Multics Security Evaluation," ACSAC, 2002.
10. AetherGuard repository artifacts listed in `papers/hardware-final-defense/evidence-register.md`.

