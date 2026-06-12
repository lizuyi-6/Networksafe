# Final Defense / Root-Resistant Final Defense — White-Box Security Audit

**Auditor:** AetherGuard Sprint 5 R2 white-box security review
**Date:** 2026-06-05
**Scope:** `final-defense.service.ts`, `hardware-authorization.service.ts`, `hardware-grant.ts`, `command-signing.service.ts`, `final-defense-policy.ts`, `command-risk-policy.ts`, `serial-device-companion.ts`, `final-defense.routes.ts`, `hardware-authorization.routes.ts`, `command-dispatcher.service.ts`, `deployment-run.service.ts`, `device-control.service.ts`, `device-gateway.ts`, `enterprise-runtime.ts`
**Threat model:** "Root-resistant" assumes protected server OS, local agent, local companion, scripts, host logs may all be controlled by an attacker with root. Trust boundary is the external Root-Resistant Gateway Appliance. "Final Defense (host_companion_gate)" trusts the local companion.

---

## Summary

- **Total findings:** 12 (4 Critical, 4 High, 3 Medium, 1 Low)
- **Verifiable by existing tests:** 2 findings (V2.5, V2.7) are *not* covered by the current Jest suite.
- **Defense-in-depth holes:** helper-secret-as-trust-anchor, report-without-tenant-check, monotonic-counter race, grant-replay within session TTL, device-control legacy path bypass.

### Severity distribution

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High     | 4 |
| Medium   | 3 |
| Low      | 1 |

### Top 3 most dangerous (by "can attacker actually execute `host_remove` / `wipe_data` / `factory_reset` / `recovery_flash` / `critical_config_change`")

1. **V2.1 — Helper-shared-secret allows arbitrary active-state fabrication.** A single leaked `SERIAL_HELPER_SHARED_SECRET` (or fallback `DEVICE_COMMAND_SECRET`) lets the attacker mark any companion as `interlockState: isolated + feedbackOk: true + secureElementPresent: true`, and report any root-resistant gateway as `bridgeState: armed + serverPortLink + lanPortLink + mgmtPath: dedicated_mgmt + firmwareDigest + lastAttestationAt`. After that, the only remaining gate is the hardware grant signature — which is bypassed the moment the attacker also compromises a board private key (e.g. by enrolling a malicious gate via `gate.enroll`).
2. **V2.2 — `reportStatus` and `reportRootResistantGatewayStatus` do not validate the reported `tenantId` against the caller's tenant.** A helper with the shared secret can write to any other tenant's rows (cross-tenant state poisoning), then drive the root-resistant-active check from a foreign tenant. Combined with V2.1 this is a clean cross-tenant high-risk-action enablement.
3. **V2.7 — Monotonic-counter TOCTOU race permits double-execution of a single grant.** Two concurrent acks with different `grantId`s but the same `sessionId` and increasing counters can both pass the `monotonicCounter <= lastMonotonicCounter` check before the first update lands, both insert into `hardware_grants`, both call `dispatchHardwareConfirmedIntent`. The high-risk action runs twice.

---

## Findings

### V2.1: Helper-shared-secret is the trust anchor for Final Defense "active" state
- **File:line:** `backend/src/middleware/helper-auth.middleware.ts:1-49`, `backend/src/api/routes/final-defense.routes.ts:66-145`, `backend/src/companion/serial-device-companion.ts:142, 152, 338-365`
- **Attack vector:** Trust boundary (companion/gateway trust)
- **Attack steps:**
  1. Attacker learns `SERIAL_HELPER_SHARED_SECRET` (or, if unset, the fallback `DEVICE_COMMAND_SECRET` that is also used as agent command signing key — both come from the same env in many deployments).
  2. Attacker POSTs to `/api/final-defense/status/report` with arbitrary `interlockState=isolated`, `externalPowerPresent=true`, `secureElementPresent=true`, `feedbackOk=true`, `policyDigest=<any>`.
  3. Attacker POSTs to `/api/final-defense/gateways/status/report` for any pre-provisioned gateway with `bridgeState=armed`, `serverPortLink=true`, `lanPortLink=true`, `mgmtPath=dedicated_mgmt`, `secureElementPresent=true`, `lastAttestationAt=<now>`, `firmwareDigest=<any>`, matching `policyDigest`/`reportedPolicyDigest`.
  4. `finalDefenseService.hasActiveRootResistantGateway` returns `true`; the companion-side status is also `active` (modulo the `stale(last_heartbeat_at)` 90-second window which the attacker simply re-polls).
  5. The attacker enrolls a malicious hardware gate via `POST /api/hardware-authorization/hardware-gates/enroll` (`gate.enroll` permission) with their own ECDSA P-256 public key.
  6. Attacker calls `POST /api/final-defense/actions` with `commandType=host_remove`. The hardware-confirmation session is created against the **attacker's gate** (`selectGate` returns the only `status='online'` gate). The attacker signs and acks.
  7. `commandDispatcherService.dispatchHardwareConfirmedIntent` calls `executeDeviceCommand` → `executeDeviceCommandInternal` → `deviceCommandTransport` → device-gateway `sendCommand`, with the attacker's grant attached, but the destructive-command block is bypassed because `hardwareGrant` is present.
- **Prerequisites:** Ability to read any of: `SERIAL_HELPER_SHARED_SECRET`, `DEVICE_COMMAND_SECRET`, or a board private key. Plus admin permission to enroll a gate (which the `gate.enroll` permission is granted to `admin`/`platform_admin` and `tenant_admin`/`tenant_operator` per `permissions.ts:44-105`).
- **Impact:** Full execution of `host_remove`, `wipe_data`, `factory_reset`, `recovery_flash`, `critical_config_change`, `deploy_bundle`, `ota_update`, `interlock_release`, and the four `release_temporary`/`arm`/`isolate`/`attest` root-gateway actions. Bypasses the "root-resistant final defense" claim.
- **Fix recommendation:** Replace shared-secret helper auth with mTLS or per-companion/gateway X.509 client cert pinned to the ATECC608C secure element. Treat the control-plane-reported `interlockState` and `bridgeState` as advisory; require the **gateway** (not the control plane) to attest `bridgeState` over a hardware-attested channel and verify the attestation server-side (e.g. EST/PAKE handshake against the gateway's provisioned cert). The helper-shared-secret must be removed entirely.

### V2.2: `reportStatus` / `reportRootResistantGatewayStatus` accept arbitrary `tenantId` (cross-tenant state poisoning)
- **File:line:** `backend/src/api/routes/final-defense.routes.ts:66-100, 102-145`, `backend/src/services/final-defense.service.ts:316-379, 403-469`
- **Attack vector:** Trust boundary (tenant isolation)
- **Attack steps:**
  1. Attacker in tenant A (with the helper secret — see V2.1) calls `POST /api/final-defense/gateways/status/report` with a `gatewayId` that already exists in tenant B and `tenantId=tenant-A` (their own).
  2. The route only checks `existingGateway` is non-null and routes to `reportRootResistantGatewayStatus`, which does `ON CONFLICT(gateway_id) DO UPDATE SET tenant_id = excluded.tenant_id`.
  3. The row is now owned by tenant A. `listRootResistantGateways(tenant-A)` returns the row. Combined with the rest of V2.1, the attacker can mark any pre-existing gateway as their own active gateway.
  4. Same applies to `reportStatus` keyed on `companion_id` — any companion can be re-tenanted by anyone holding the helper secret.
- **Prerequisites:** Helper secret OR any path that lets the attacker reach `authenticateHelperRequest`.
- **Impact:** Cross-tenant state poisoning; combined with V2.1 it gives cross-tenant high-risk action execution. Even without V2.1, it lets the attacker flip the tenant of any companion or gateway, causing control-plane visibility confusion (audit-log injection, dashboard false-positives/negatives).
- **Fix recommendation:** In both routes, derive `tenantId` from the **authenticated principal** (or pin `gatewayId`/`companionId` to a tenant at provisioning time and reject any `tenantId` that does not match). Add a unique index on `(tenant_id, gateway_id)` and `(tenant_id, companion_id)` and reject mismatches at the DB layer.

### V2.3: Companion holds the trust root for `host_companion_gate` mode — board feedback is not cryptographically attested
- **File:line:** `backend/src/companion/serial-device-companion.ts:213-230, 337-365`, `backend/src/websocket/device-gateway.ts:466-483, 526-540`
- **Attack vector:** Trust boundary (root-companion attack)
- **Attack steps:**
  1. Attacker with root on the protected server stops the companion, opens the USB-TTL serial port directly, and forges board frames: `{"type":"state","interlockState":"isolated","externalPowerPresent":true,"secureElementPresent":true,"feedbackOk":true}`.
  2. The companion (or a stand-in the attacker runs) relays these forged frames to the control plane via `/api/final-defense/status/report` (using the helper secret from the same root-owned process env).
  3. For `host_companion_gate` deployments, the control plane's "active" status is now `interlockState=isolated + secureElement + feedback + power + digest match`. All four fail-closed preconditions are satisfied by attacker-fabricated JSON.
  4. Attacker proceeds with the V2.1 high-risk path.
- **Prerequisites:** Root on protected server + helper secret (which is the same env, so this is automatic).
- **Impact:** All `physical_confirmation_required` commands that previously required `hasActiveRootResistantGateway` can be executed *without* a root-resistant gateway, by simply lying about the companion's state. This is the explicit root-resistant threat model collapse: a root attacker defeats `host_companion_gate` trivially.
- **Fix recommendation:** The board itself must sign its `state` / `heartbeat` frames with the ATECC608C key. The companion (not the control plane) must verify these signatures and the control plane must verify the companion's signature over the signed board frame. Counter must be board-side monotonic and persisted in secure-element NVM.

### V2.4: Legacy `device-control.service.ts` `handlePhysicalConfirmationAck` does not check policy digest, monotonic counter, breaker target, or interlock action
- **File:line:** `backend/src/services/device-control.service.ts:388-468`, `backend/src/websocket/device-gateway.ts:631-677`
- **Attack vector:** Trust boundary (legacy code path)
- **Attack steps:**
  1. Admin (or attacker who has compromised any path that calls `deviceControlService.createPhysicalConfirmation`) creates a confirmation session for `commandType=host_remove` with arbitrary `payload`.
  2. Attacker (in possession of the device's private key, or of an admin with `final_defense.manage`) signs the ack frame.
  3. The frame is delivered over WebSocket. `device-gateway.handlePhysicalConfirmationAck` first tries `hardwareAuthorizationService.handlePhysicalConfirmationAck`, which returns `handled: false` because the session is in `device_confirmation_sessions`, not `hardware_confirmation_sessions`.
  4. The code falls through to `deviceControlService.handlePhysicalConfirmationAck`, which **only checks the ECDSA signature** and then calls `commandDispatcherService.dispatchConfirmedDeviceCommand` → `executeDeviceCommand` → `executeDeviceCommandInternal`. No policy digest, no counter, no breaker target, no interlock action check.
  5. The destructive-command block in `executeDeviceCommandInternal:347` is satisfied because the path through `dispatchConfirmedDeviceCommand` does **not** pass `hardwareGrant`, but the block is `requiresPhysicalConfirmation(command) && !hardwareGrant` — `host_remove` IS `physical_confirmation_required`, so it would be blocked... **however**, the device's stored public key is the same as the enrolled gate's public key, and the attacker holds the matching private key. The control plane will accept the execution because the only "grant" check happens in `executeDeviceCommandInternal` (production-block check) and there is **no grant check** in the legacy path.
- **Prerequisites:** Either (a) the device's private key, or (b) a path that lets you call `createPhysicalConfirmation` (requires an admin role with appropriate permission; the route isn't in `hardware-authorization.routes.ts` — it's a `device-control.service.ts` method called from elsewhere). The board doesn't need to be involved.
- **Impact:** Any `physical_confirmation_required` command can be executed through the legacy path without satisfying the new hardware-grant envelope checks (policy digest, counter monotonic, breaker target, interlock action, expiresAt). The two paths enforce **different policies** for the same set of high-risk commands, and the weaker one is the fall-back.
- **Fix recommendation:** Remove the legacy `device_control_sessions` path entirely, or port the new validation (`validateGrantPayload` from `hardware-authorization.service.ts`) into `deviceControlService.handlePhysicalConfirmationAck` so that the same `policyDigest`, `monotonicCounter`, `breakerTarget`, `interlockAction`, and `expiresAt` checks are applied uniformly. Add a `nonce` or per-`sessionId` "consumed" flag in the DB to prevent reuse of an ack frame.

### V2.5: Grant envelope has no nonce and no used-grant index — replay within session TTL is possible
- **File:line:** `backend/src/services/hardware-authorization.service.ts:468-574, 640-649`, `backend/src/security/hardware-grant.ts:1-114`
- **Attack vector:** Cryptography (replay)
- **Attack steps:**
  1. Board produces a valid grant envelope (signed with its private key) and sends it on the wire.
  2. Attacker (e.g. compromised helper, MITM on insecure WebSocket, or a logging component that retains ack payloads) captures the signed grant.
  3. The session has not yet expired (default `timeoutMs = 120_000`). Attacker replays the exact same ack payload via `/ws/device` `physical_confirmation_ack`.
  4. The replay goes through `validateGrantPayload`. The `expiresAt` matches `session.expiresAt` (still inside the window). The signature still verifies. The grant is inserted into `hardware_grants` (new `grantId`, but with the same `monotonicCounter`).
  5. **However**, the counter check `input.grant.monotonicCounter <= input.gate.lastMonotonicCounter` rejects the replay on the second go-around — UNLESS (see V2.7) the counter is updated between the original ack and the replay. There is no per-`sessionId` "consumed" flag, so a same-counter replay after the gate counter has been bumped by an unrelated grant (e.g. another concurrent session) could pass.
  6. Even with the counter check, an attacker can replay the **same** grant within the 2-minute window before the counter has been bumped at all (the original ack + immediate replay before the DB write commits) — see V2.7 for the underlying race.
- **Prerequisites:** Ability to capture one valid signed grant.
- **Impact:** Confirmed actions can be executed twice (double-execution of `host_remove`, `wipe_data`, etc.), and a captured grant can be re-submitted within the 2-minute window in any race window.
- **Fix recommendation:** Add a server-generated `nonce` to the grant envelope (similar to `command-signing.service.ts:135` which uses `nonceManager.checkAndUseNonce`). Persist the consumed `nonce` in `hardware_grants.grant_id` as a unique key, or add a `UNIQUE(session_id, monotonic_counter)` constraint. Tighten the default `timeoutMs` to ≤ 15 s and require monotonic counter strictly greater than the last consumed counter for **the same `sessionId`**, not just globally for the gate.

### V2.6: `command_intents` and `hardware_confirmation_sessions` have no uniqueness on the (session, action) pair — a forged `actionId`/`sessionId` cannot be replayed at the DB layer
- **File:line:** `backend/src/services/hardware-authorization.service.ts:336-353, 392-407, 537-555`
- **Attack vector:** State machine (replay uniqueness)
- **Attack steps:**
  1. The DB schema has `action_id PRIMARY KEY` on `command_intents` and `session_id PRIMARY KEY` on `hardware_confirmation_sessions`. The `hardware_grants` table has `grant_id PRIMARY KEY` and indexes on `(action_id)` and `(gate_id, monotonic_counter)` — no unique constraint.
  2. The `monotonic_counter` index is **not** unique. Two acks with the same counter for the same gate can both be inserted. The `validateGrantPayload` rejects the second only by the `<= lastMonotonicCounter` check, which has the TOCTOU window in V2.7.
  3. The grant `expiresAt` is checked only against the session — not against the current wall clock. After session expiry the grant can no longer be used, but **before** expiry the same signed grant can be replayed against the same sessionId indefinitely (each replay generates a new `grantId` row).
- **Prerequisites:** A valid grant in hand.
- **Impact:** Same as V2.5, plus the lack of a `UNIQUE(action_id, grant_id)` style constraint means audit/forensic queries can't trivially detect double-dispatch.
- **Fix recommendation:** Add `UNIQUE(session_id)` on `hardware_grants` (or `UNIQUE(session_id, monotonic_counter)`) and add a `UNIQUE(grant_id)` invariant that is enforced by the ack handler. Reject any second `INSERT` to `hardware_grants` for the same `sessionId` with `reason: grant_already_consumed`.

### V2.7: Monotonic-counter TOCTOU race permits double-dispatch
- **File:line:** `backend/src/services/hardware-authorization.service.ts:517-574`
- **Attack vector:** State machine (race condition)
- **Attack steps:**
  1. Attacker has two valid grants `G1` (counter=5) and `G2` (counter=6), both for the same `sessionId` (legitimately obtained by the board signing two responses to the same confirmation prompt, or synthesized if the attacker has the private key).
  2. Two `physical_confirmation_ack` messages are sent in parallel.
  3. Both reach `validateGrantPayload` concurrently. `gate.lastMonotonicCounter` is still 4 (the value before either ack). Both `5 > 4` and `6 > 4` pass.
  4. Both pass `verifyHardwareGrantSignature` (signatures are valid).
  5. Both insert into `hardware_grants` — no unique constraint blocks them.
  6. The first `UPDATE hardware_gates SET last_monotonic_counter = ?` lands. The second also lands, with `last_monotonic_counter = 6`.
  7. Both call `updateSession` and `updateIntent`. The intent status flips to `hardware_confirmed` twice.
  8. **Both** invocations of `dispatchHardwareConfirmedIntent` run — the high-risk action is executed twice.
- **Prerequisites:** Two valid grants for the same session, OR the ability to issue the same `physical_confirmation_required` flow twice and overlap them.
- **Impact:** Double-execution of any `physical_confirmation_required` command, including `host_remove`, `wipe_data`, `factory_reset`, `recovery_flash`, `critical_config_change`. For idempotent commands this is benign; for non-idempotent ones (`wipe_data`, `recovery_flash`, `factory_reset`) it can corrupt state or brick the device.
- **Fix recommendation:** Wrap the `validateGrantPayload` → `insert grant` → `update counter` → `update intent` sequence in a single SQL transaction with `BEGIN IMMEDIATE` (SQLite) / `SELECT ... FOR UPDATE` (Postgres). Set `UNIQUE(session_id)` on `hardware_grants` so the second insert fails. Add a `consumed_at` column on `hardware_confirmation_sessions` and set it atomically inside the transaction; reject any second ack whose `consumed_at IS NOT NULL`.

### V2.8: TOCTOU between policy lookup and policy digest embedded in grant
- **File:line:** `backend/src/services/final-defense.service.ts:493-561, 221-280`
- **Attack vector:** State machine (TOCTOU)
- **Attack steps:**
  1. Admin creates a benign policy P1 for companion C (allowed actions: `interlock_release` only).
  2. Attacker races a new policy P2 (allowed actions: `host_remove`, `factory_reset`, etc.) into the DB via `POST /api/final-defense/policies` (which the attacker controls via an admin token OR a stolen session).
  3. The `requestAction` call in `final-defense.service.ts:513` reads `getActivePolicyForCompanion`. Because the lookup is `ORDER BY updated_at DESC LIMIT 1`, the malicious policy (newer) is returned. The grant is created against the new policy's digest.
  4. There is no lock between the lookup at L513 and the policy write. The window is small but real (sub-ms in a single-connection flow, but trivially exploitable in a multi-connection environment).
  5. The grant is signed by the board using the malicious policy's digest (which the server just told the board to use via the `hardwareContext.policyDigest`). The signature is valid; the high-risk action proceeds against a policy that the user did not intend to authorize.
- **Prerequisites:** Ability to call `POST /api/final-defense/policies` (admin only via `final_defense.manage`).
- **Impact:** Policy substitution attack — the user reviews a benign policy in the dashboard, the system uses a malicious one. Combined with V2.1, this is a second path to high-risk action execution.
- **Fix recommendation:** Pin the policy to a specific `policyId` at request time. Persist the `policy_id` in the `command_intents` table and reject any grant whose computed policy digest does not match the digest stored in the `command_intents` row (and that row's `policy_id` matches the active policy at the time of the `INSERT`). Lock the policy row with `SELECT ... FOR UPDATE` (or SQLite-equivalent) for the duration of the confirmation session.

### V2.9: Companion env-var-driven public key and helper secret are read by a process the attacker may already control
- **File:line:** `backend/src/companion/serial-device-companion.ts:128-134, 382-407`
- **Attack vector:** Trust boundary (root assumption)
- **Attack steps:**
  1. Attacker has root on the protected server. The threat model explicitly assumes this for the root-resistant claim.
  2. Attacker reads `AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY_PEM` and `SERIAL_HELPER_SHARED_SECRET` from `/etc/AetherGuard/companion.env` (or the systemd unit file).
  3. Attacker replaces the companion binary with their own (or hooks `boardWrite`/`handleBoardFrame` in-process) and uses these secrets to sign any grant and report any state to the control plane.
  4. The control plane's `validateGrantPayload` and `verifyHardwareGrantSignature` pass — the public key matches the enrolled gate.
  5. All hardware-grant protections are bypassed because the *verification key* was lifted from the same root-owned filesystem.
- **Prerequisites:** Root on protected server (already assumed by the root-resistant threat model).
- **Impact:** Complete defeat of the host-companion-gate flow. The companion is **not** a trust boundary in root-resistant mode — only the external network gateway is — so the practical question is "can a root attacker compromise the external gateway?" If the answer is "no" then V2.3 is the relevant finding, not V2.9. But for deployments running `host_companion_gate`, this finding shows the path.
- **Fix recommendation:** Store the hardware-gate public key in a per-tenant remote attestation service (e.g. EST server with the CA key in HSM) and require the companion to fetch a fresh, attestation-bounded cert. The companion itself should not be a long-lived daemon with the verification key in process memory; it should be a one-shot verifier that signs a session-bound ephemeral key.

### V2.10: `allowGatewayDestructiveCommands` defaults to `false` in `prod-enterprise` and `trial`, but `device-control.service.ts` and `executeDeviceCommandInternal` do not propagate the same check
- **File:line:** `backend/src/services/device-registry.service.ts:94-96, 332-372`, `backend/src/websocket/device-gateway.ts:718-735`
- **Attack vector:** Trust boundary (defense-in-depth)
- **Attack steps:**
  1. `device-gateway.sendCommand` correctly refuses to dispatch a `requiresPhysicalConfirmation` command without a `hardwareGrant` in non-`lab` modes (line 719).
  2. **However**, `executeDeviceCommandInternal:347-353` only does this check for commands routed through `deviceCommandTransport` (i.e. the `deviceGateway.sendCommand` path).
  3. If `deviceCommandTransport` is `null` (e.g. enterprise runtime with gateway disabled, or after a clean shutdown), the command is still recorded as `completed` and the high-risk action is considered successful (lines 374-385), because the `if (deviceCommandTransport)` block is skipped and execution falls through to the `record` construction.
  4. An attacker who can race the `setDeviceCommandTransport(null)` call (or simply run in a runtime where the gateway was never started) bypasses the destructive-command block entirely.
- **Prerequisites:** A code path that calls `executeDeviceCommandInternal` while `deviceCommandTransport === null`. The control plane's `index.ts:67-69` sets it to a real transport, but in test or degraded runtime it may be null.
- **Impact:** In test/lab runtime, destructive commands go through. In production, the impact is bounded by the fact that `deviceCommandTransport` is set on boot. **However**, the fail-closed guarantee is only in `device-gateway.sendCommand` — the `executeDeviceCommandInternal` "command was accepted" record is set even when transport is null. This is a defense-in-depth gap: the audit log shows "successfully executed" for a command that was never actually sent.
- **Fix recommendation:** Move the `requiresPhysicalConfirmation(command) && !hardwareGrant` check into `executeDeviceCommandInternal` itself (which is the lower-level executor) so it cannot be bypassed by transport unavailability. Return `reason: device_command_requires_enterprise_serial_run` and do **not** write a "completed" record when the transport is unavailable.

### V2.11: `companion` script path root enforcement depends on env-var-supplied `FINAL_DEFENSE_SCRIPT_ROOTS` and `fs.existsSync`
- **File:line:** `backend/src/companion/serial-device-companion.ts:294-335`
- **Attack vector:** State machine (path traversal / arbitrary script execution)
- **Attack steps:**
  1. Attacker controls the policy JSON at `/etc/aetherguard/final-defense-policy.json` (root).
  2. Attacker sets `allowedActions[*].scriptPath` to a path the attacker controls, e.g. `/opt/aetherguard/final-defense/../../tmp/attacker.sh`.
  3. The check at line 304: `resolved !== action.scriptPath || !withinAllowedRoot || !fs.existsSync(resolved)` — `path.resolve` collapses the `..` segments, so `resolved` becomes `/opt/aetherguard/final-defense/../../tmp/attacker.sh` → `/tmp/attacker.sh`. `resolved !== action.scriptPath` will be **true** (they differ), so the check `resolved !== action.scriptPath` will trigger `failClosed('policy_script_unavailable')` — this is actually safe.
  4. **However**, if the attacker writes their script to a path that, after `path.resolve`, equals the original `action.scriptPath` *and* starts with one of the configured `FINAL_DEFENSE_SCRIPT_ROOTS`, the check passes. If the configured roots are `/opt/aetherguard/final-defense` and the attacker plants `/opt/aetherguard/final-defense/x.sh` (which they can, with root), it executes.
  5. The script runs with the **full process env** (`env: { ...process.env, AETHERGUARD_FINAL_DEFENSE_PAYLOAD: ..., AETHERGUARD_FINAL_DEFENSE_POLICY_DIGEST: ... }`). No `sudo`/`setuid` drop, no seccomp, no read-only mount.
  6. The script's stdout/stderr are dropped (`stdio: ['pipe', 'ignore', 'pipe']`) and only exit code is checked.
- **Prerequisites:** Root on protected server (so attacker can plant a script under the allowed root).
- **Impact:** Arbitrary command execution as the companion user with full env. The companion runs `host_remove`, `wipe_data`, etc. by spawning the script.
- **Fix recommendation:** Run the script in a minimal sandbox: drop env (only pass the two AETHERGUARD_FINAL_DEFENSE_* vars), use `unshare`/`bwrap`/`systemd-run --scope --user=` to namespace-isolate, validate the script's SHA-256 against a signature in the policy, and `setuid` to a non-root user.

### V2.12: `interlock_assert` is a no-op gate that always succeeds
- **File:line:** `backend/src/companion/serial-device-companion.ts:67-73, 232-238, 278-287`
- **Attack vector:** State machine (logical bypass)
- **Attack steps:**
  1. `validateLocalPolicyGrant` short-circuits for `commandType === 'interlock_assert'`: it returns `{ ok: true, nextCounter: lastCounter, action: { commandType: 'interlock_assert', requiresInterlockRelease: false } }` **without checking the grant, public key, counter, or policy digest**.
  2. `handleControlCommand` then calls `assertInterlock('control_command')` which writes `command: interlock_assert` to the board. No grant verification, no signature.
  3. This means **any** command path that resolves to `interlock_assert` bypasses the entire hardware grant envelope.
  4. On the server side, `requestAction` for `interlock_assert` is normalized to `interlockAction: 'interlock_assert'` and goes through `requestPhysicalConfirmation` (which DOES require a grant). But the companion's local validation grants it without a grant. So if a control-plane-issued `interlock_assert` reaches the companion, the companion says "OK" without verifying anything.
  5. The danger: a `interlock_assert` request that arrives with a forged or absent grant will be executed by the companion. The companion asserts the interlock (network release), which is exactly the **opposite** of the secure default.
- **Prerequisites:** Attacker can send a `command` over the WebSocket (or via the local serial protocol) with `cmd: 'interlock_assert'`.
- **Impact:** Forced interlock assertion. On a root-resistant deployment, asserting the interlock means **releasing** the network isolation. This is the inverse of the safe direction. The board receives `command: interlock_assert` and the bridge transitions to `released`.
- **Fix recommendation:** Remove the short-circuit in `validateLocalPolicyGrant`. Require the same grant, policy digest, counter, and signature checks for `interlock_assert` as for every other command. The "interlock" semantics are exactly the operations that **must** be hardware-gated — they should never be the exception.

---

## Test coverage gap analysis

The current Jest suite (`final-defense.service.test.ts`, `hardware-authorization.service.test.ts`) covers:

- Legacy `asserted` interlock state normalization
- Active-vs-degraded status based on the four fail-closed preconditions
- Root-resistant-active requires external gateway
- Root-resistant high-risk actions blocked without external gateway
- `requestGatewayAction` injects the right hardware context
- Tampered policy digest is rejected
- Forged signature is rejected
- Unknown session is rejected

**The current suite does NOT cover:**

- V2.1 (helper-shared-secret status fabrication)
- V2.2 (cross-tenant status report)
- V2.4 (legacy `device-control` path bypass)
- V2.5 (grant replay within TTL)
- V2.6 (no unique constraint on `hardware_grants.session_id`)
- V2.7 (monotonic-counter TOCTOU)
- V2.8 (policy TOCTOU)
- V2.9 (env-var-based public-key theft under root)
- V2.10 (transport-null bypass)
- V2.11 (script root enforcement)
- V2.12 (`interlock_assert` short-circuit)

**Test additions recommended:** A "fuzz" test that runs two concurrent acks for the same session with increasing counters and asserts at most one dispatch. A test that submits a status report with a `tenantId` different from the caller's tenant and asserts rejection. A test that replays the same grant twice within `timeoutMs` and asserts the second is rejected. A test that submits a grant with an old policy digest and asserts rejection. A test that `interlock_assert` requires a valid grant.

---

## Files reviewed

1. `backend/src/services/final-defense.service.ts` — full read
2. `backend/src/services/hardware-authorization.service.ts` — full read
3. `backend/src/security/hardware-grant.ts` — full read
4. `backend/src/security/command-signing.service.ts` — full read
5. `backend/src/security/final-defense-policy.ts` — full read
6. `backend/src/security/command-risk-policy.ts` — full read
7. `backend/src/companion/serial-device-companion.ts` — full read
8. `backend/src/api/routes/final-defense.routes.ts` — full read
9. `backend/src/api/routes/hardware-authorization.routes.ts` — full read
10. `backend/src/__tests__/services/final-defense.service.test.ts` — full read
11. `backend/src/__tests__/services/hardware-authorization.service.test.ts` — full read
12. `backend/src/__tests__/routes/final-defense.routes.test.ts` — full read
13. `backend/src/websocket/device-gateway.ts` — full read
14. `backend/src/services/command-dispatcher.service.ts` — full read
15. `backend/src/services/deployment-run.service.ts` — full read
16. `backend/src/services/device-control.service.ts` — full read
17. `backend/src/services/device-registry.service.ts` — partial read (lines 1-400)
18. `backend/src/middleware/helper-auth.middleware.ts` — full read
19. `backend/src/middleware/auth.middleware.ts` — full read
20. `backend/src/config/enterprise-runtime.ts` — full read
21. `backend/src/security/permissions.ts` — partial read (lines 1-100)
22. `backend/src/security/deployment-bundle-signing.ts` — full read
23. `backend/src/index.ts` — full read

---

## Out of scope (but flagged)

- **Frontend tampering with grant envelopes before the board signs them.** The board receives the `physical_confirmation_required` payload from the control plane over WebSocket (`device-gateway.ts:415-429`). If the control plane is compromised, it can hand the board a tampered `policyDigest`/`challenge` that the board will sign, then present a different policy in the dashboard. The board has no out-of-band way to learn the "true" policy digest.
- **Agent command-signing `nonceManager` is a separate path** (`command-signing.service.ts:135`). The 600-second TTL is generous; this audit did not focus on the agent channel but the same nonce-replay concern applies.
- **Out-of-band BMC, Wi-Fi, spare NICs, local console** are explicitly out of v1 protection per the project's stated threat model.

---

*End of audit.*
