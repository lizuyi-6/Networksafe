# AetherGuard: A Hardware-Enforced Fail-Closed Gateway Appliance for Root-Resistant Server Security

**Abstract.** Traditional server security mechanisms—including WAFs, EDRs, and host-based agents—operate within the software trust boundary of the protected server. When an attacker obtains root privileges, these mechanisms can be disabled, logs tampered, and network connections re-established. We present AetherGuard, a server security platform that moves the final network-release decision outside the protected server into a self-developed hardware gateway appliance. AetherGuard introduces Final Defense Mode, a fail-closed operational mode in which high-risk actions (e.g., host removal, data wipe, factory reset, network release) require hardware-granted authorization verified by an independent security controller, a Secure Element, and a physical interlock with feedback. We design a cross-service end-to-end binding mechanism using policy digest, monotonic counter, challenge-based replay protection, and interlock feedback loop to ensure that any verification failure results in physical network isolation rather than a mere software error. We implement a prototype comprising a multi-port industrial gateway (M1), an STM32H5 security controller (M2), an OPTIGA Trust M Secure Element (M3), and a DIN-rail relay interlock (M4), and validate its security properties through a software simulator that injects 9 distinct fail-closed scenarios. Our evaluation shows that the control loop correctly isolates the network under all tested fault conditions, including signature forgery, counter rollback, policy digest mismatch, expired grant, heartbeat loss, and emergency stop. The system achieves 1,329 QPS in the Rust fastpath sidecar with a p95 latency of 21 ms, while the hardware interlock state transitions complete within seconds. We discuss the limitations of the root-resistant claim and identify out-of-band channels (BMC, Wi-Fi, spare NICs) that remain outside the protection scope.

**Keywords:** root-resistant security, hardware-enforced isolation, fail-closed interlock, post-compromise defense, secure element, remote attestation, critical infrastructure protection

---

## 1. Introduction

### 1.1 Motivation

Server security has traditionally been addressed through a layered defense model: firewalls at the network perimeter, intrusion detection systems on the boundary, endpoint detection and response (EDR) agents on the host, and vulnerability scanners on the application layer. While this model is effective against external attacks, it suffers from a fundamental architectural flaw: **all these defenses operate within the same software trust boundary as the protected server** [1]. When an attacker obtains root privileges—a scenario increasingly common in advanced persistent threat (APT) campaigns, supply chain attacks, and zero-day exploits—the attacker can disable the EDR agent, modify host firewall rules, forge health status reports, and re-establish outbound network connections [2, 3].

The 2021 Colonial Pipeline ransomware incident demonstrated this vulnerability at scale: the attackers compromised the IT network, moved laterally, and ultimately forced the operational technology (OT) side to shut down as a precautionary measure [4]. Post-incident analysis revealed that the compromise could have been contained earlier if a **remotely controllable, hardware-enforced network isolation** mechanism had been available [4]. Similarly, healthcare ransomware incidents have shown that the standard incident response—"disconnect the network"—is often performed manually, disruptively, and without an audit trail [5].

These incidents point to a gap in the security architecture: **there is no commercially available mechanism that allows an operator to remotely and physically isolate a compromised server, while retaining the ability to recover the network after authorized remediation, with full auditability.**

### 1.2 AetherGuard's Core Idea

AetherGuard addresses this gap through a two-layer defense model:

- **Layer 1 (Host Detection):** Distributed agents residing on business servers perform real-time threat detection, traffic analysis, and rule-based blocking. This layer is provided by the AetherGuard software platform and is analogous to existing EDR/host security products.
- **Layer 2 (Hardware Last Line):** An external hardware gateway appliance—called the **AetherGuard Root-Resistant Gateway Appliance**—sits between the protected server and the LAN/WAN. The appliance's default state is **isolated**: the SERVER↔LAN/WAN bridge is physically open. Network release is only possible after a hardware-authorized grant, verified by an independent security controller and a Secure Element.

The key insight is that **Layer 2 operates outside the server's trust boundary**. Even if the attacker controls the server's OS, kernel, firewall, and agent, they cannot restore the SERVER↔LAN/WAN connection without passing through the appliance's hardware verification chain. The appliance holds the signed policy state, device identity, firmware measurement, and grant signing keys in a Secure Element that is physically and logically separate from the protected server.

### 1.3 Contributions

This paper makes the following contributions:

1. **We propose the concept of Root-Resistant Final Defense**, a security model in which the network-release decision for a protected server is moved outside the server's software trust boundary to an independent hardware appliance. We formally define the threat model, trust boundary assumptions, and the conditions under which the root-resistant claim holds.

2. **We design Final Defense Mode**, a fail-closed operational mode with the following hard constraints: (a) policy digest end-to-end binding across four independent services; (b) hardware grant signatures using ECDSA-P256 over SHA-256, verified by a Secure Element; (c) monotonic counter anti-rollback with three independent high-water marks; (d) challenge-based replay protection using a 16-slot circular buffer; (e) interlock feedback loop with physical relay state verification; and (f) object-lock audit archive with chain validation.

3. **We implement a prototype** comprising four hardware modules (M1–M4) and a full software stack (control plane, companion, gateway daemon, and simulator). The hardware uses an industrial multi-port gateway (M1), an STM32H5 security controller (M2), an OPTIGA Trust M Secure Element (M3), and a DIN-rail relay interlock with feedback (M4). The software is implemented in TypeScript/Node.js (control plane), C (firmware), and Rust (fastpath sidecar).

4. **We validate security properties through a simulator** that runs the real M1 gateway daemon with mocked M2/M3/M4 I/O, injecting 9 distinct fail-closed scenarios. The simulator confirms that the system correctly isolates the network under all tested fault conditions.

5. **We provide an honest discussion of limitations**, including the scope of the root-resistant claim (what it does and does not cover), performance characteristics of the current prototype, and the gap between prototype and production readiness.

### 1.4 Paper Organization

The remainder of this paper is organized as follows. Section 2 reviews related work in post-compromise security, hardware-enforced isolation, and fail-closed safety architecture. Section 3 presents the system architecture and threat model. Section 4 details the Final Defense Mode core mechanisms. Section 5 provides a security analysis of the root-resistant properties and fail-closed guarantees. Section 6 describes the implementation and evaluation, including simulator validation and performance metrics. Section 7 discusses limitations. Section 8 concludes.

---

## 2. Background and Related Work

### 2.1 Post-Compromise Security

Post-compromise security refers to the ability of a system to maintain security guarantees even after an attacker has compromised part of the system. Academic work in this area has focused primarily on cryptographic protocols, such as secure messaging protocols that provide forward secrecy and post-compromise security [6]. In the systems security domain, post-compromise defense has been addressed through **attack surface reduction** and **compartmentalization**, but these techniques typically assume the attacker has not obtained the highest privilege level.

Once root access is obtained, standard defenses fail because the attacker can: (a) disable or uninstall security agents, (b) modify kernel modules to hide malicious activity, (c) alter local firewall rules and routing tables, (d) forge heartbeat/status messages to the management console, and (e) tamper with local audit logs [2, 3]. AetherGuard's Layer 2 addresses this by placing the final network-release control **outside** the compromised environment, making it immune to root-level tampering on the protected server.

### 2.2 Hardware-Enforced Network Isolation

Physical network isolation is not a new concept. **Air-gapping**—physically disconnecting a network from the Internet—is the traditional gold standard for high-security environments, but it is incompatible with modern IT operations that require connectivity, remote management, and cloud integration [7].

Several commercial products have explored hardware-level network control. **Goldilock Firebreak** is a patented Layer-1 network circuit breaker that uses reed switches to physically disconnect RJ45 ports, controlled via out-of-band SMS [8]. While effective for OT/ICS isolation, Firebreak is primarily a binary on/off switch without integration with a server security platform, AI detection, or policy-based authorization. **Garrison SAVI** is a hardware isolation appliance for web browsing, using an elastic hardsec core to execute security functions in hardware [9]. It focuses on user-facing isolation rather than server post-compromise containment.

In the academic literature, **remote attestation** using Trusted Platform Modules (TPMs) has been extensively studied as a mechanism for verifying system integrity [10, 11]. Narayanan et al. demonstrated vTPM-based continuous remote attestation for confidential VMs [10], while Wagner et al. integrated TPM attestation with DDS communication middleware [11]. These works establish the technical foundation for hardware-rooted trust but do not address the **network-release authorization** problem after a compromise has been detected.

**Network segmentation** and **microsegmentation** have emerged as standard practices for limiting lateral movement [12, 13]. However, these are software-defined techniques (VLANs, VXLANs, software-defined perimeters) that can be reconfigured by an attacker with sufficient network privileges. AetherGuard complements these techniques by adding a **hardware-immutable** isolation layer that cannot be bypassed through software configuration changes.

### 2.3 Fail-Closed Safety Architecture

The concept of **fail-closed** (or fail-safe) originates from safety-critical engineering disciplines such as nuclear power, railway signaling, and industrial process control [14]. In a fail-closed system, any fault, power loss, or communication interruption results in the system transitioning to a safe (closed/isolated) state rather than an unsafe (open) state. Tarek and Hasan applied this principle to PLC/SCADA systems, proposing that cybersecurity policies for industrial IoT should adopt "deny rules, rate limits, and fail-closed policies" [14].

In the cybersecurity domain, **fail-closed** has been applied to API gateways (dropping requests when the security scorer is unavailable) [15] and serverless CI/CD pipelines (blocking merges when security checks fail) [16]. However, these are software-level fail-closed mechanisms that remain within the compromised trust boundary. AetherGuard extends the fail-closed principle to **physical network topology**, ensuring that any verification failure results in the physical relay opening the SERVER↔LAN/WAN bridge.

### 2.4 Comparison with Existing Approaches

Table 1 summarizes the relationship between AetherGuard and existing security mechanisms.

| Capability | WAF | EDR | Firewall | Microsegmentation | Air Gap | Goldilock Firebreak | AetherGuard |
|-----------|-----|-----|----------|-------------------|---------|---------------------|-------------|
| Pre-attack detection | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ (Layer 1) |
| Post-root containment | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (binary) | ✅ (policy-based) |
| Remote controllable recovery | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (SMS only) | ✅ |
| Hardware immutable | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Auditability | Partial | Partial | Partial | Partial | ❌ | Limited | ✅ (object-lock chain) |
| AI-driven detection | Partial | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (7-layer pipeline) |

*Table 1: AetherGuard complements, rather than replaces, existing security layers. Its unique value is the hardware-enforced, policy-authorized, auditably recoverable physical network isolation after server compromise.*

---

## 3. System Architecture

### 3.1 Threat Model

AetherGuard's threat model is defined as follows:

**Trusted Components:**
- The Gateway Appliance hardware (M2 security controller, M3 Secure Element, M4 relay and feedback circuit)
- The Secure Element's private key (non-exportable, provisioned during manufacturing)
- The signed local policy file stored on the appliance's companion
- The independent management (MGMT) channel of the appliance

**Untrusted Components:**
- The protected server's operating system, kernel, and all user-space processes
- The AetherGuard control plane backend (considered potentially compromised for the highest-risk actions)
- The network between the control plane and the appliance (TLS is used but the control plane itself is untrusted for authorization)
- Any in-band communication channel that traverses the protected server

**Attacker Capabilities:**
- The attacker has obtained **root privileges** on the protected server.
- The attacker can stop, modify, or forge any software running on the protected server, including security agents, firewall rules, and logs.
- The attacker can read and modify any data stored on the protected server's disks.
- The attacker **cannot** physically access the Gateway Appliance, extract keys from the Secure Element, or manipulate the relay feedback circuit.
- The attacker **cannot** compromise the appliance's independent security controller or Secure Element.

**Protection Scope:**
- The protection covers **network links physically cabled through the Gateway Appliance** (SERVER↔LAN/WAN).
- Out-of-band channels (BMC, Wi-Fi, spare NICs, local console, direct storage access) are **outside** the protection scope unless separately controlled.

### 3.2 Gateway Appliance Hardware Stack (M1–M4)

The AetherGuard Root-Resistant Gateway Appliance consists of four modules with clear separation of responsibilities:

**M1: Multi-Port Gateway (Industrial Linux Host)**
An industrial multi-port gateway (e.g., Protectli Vault VP2430 or ARM-based equivalent) runs an embedded Linux operating system with three physical network interfaces: SERVER, LAN/WAN, and MGMT. The M1 hosts the Gateway Daemon, which manages the nftables/iptables bridge between SERVER and LAN/WAN, communicates with the backend control plane over the MGMT interface, and exchanges serial JSON messages with the M2 security controller. The M1 is considered semi-trusted: it can request network release but **cannot** unilaterally authorize it.

**M2: Security Authorization Controller (STM32H5)**
An STM32H5 microcontroller (Cortex-M33, 250 MHz) serves as the final authorization decision engine. It runs independently from the M1 Linux system and is responsible for: (a) receiving release requests from the Gateway Daemon; (b) verifying the hardware grant signature; (c) validating the policy digest, challenge, monotonic counter, and expiry; (d) controlling the interlock relay; and (e) reading the feedback input to confirm the relay's physical state. The M2 communicates with M1 via newline-delimited JSON over UART (115200 baud) and with M3 via I2C.

**M3: Secure Element / TPM (OPTIGA Trust M)**
An Infineon OPTIGA Trust M Secure Element provides the hardware root of trust. It stores the non-exportable device private key, performs ECDSA P-256 signature generation and verification, and maintains a hardware-backed monotonic counter. The M3 is provisioned during manufacturing with a unique device identity and cannot be reprogrammed by the M1 or M2 after deployment.

**M4: Fail-Closed Interlock (Relay + Feedback)**
A DIN-rail SPDT relay (24V DC, rated 10A) physically controls the SERVER↔LAN/WAN connection. The relay is driven by the M2 through an opto-isolated digital output. A feedback auxiliary contact, mechanically linked to the main relay contact, provides the M2 with an independent verification of the relay's physical state. An emergency stop button (red mushroom head, NC contact) provides manual override to immediately isolate all connections. A tri-color stack light indicates the appliance state (green = isolated, yellow = armed, red = released/fault).

### 3.3 Control Plane Software Stack

The AetherGuard control plane is an Express.js/TypeScript backend that provides: (a) agent management and threat detection; (b) policy authoring and distribution; (c) hardware authorization session management; (d) audit log archiving with object lock; and (e) WebSocket gateways for real-time communication with agents and appliances.

The Final Defense service chain spans four software services that must maintain end-to-end consistency:

1. **Final Defense Service** (`final-defense.service.ts`): Computes the policy digest, determines the interlock target state, and generates the authorization payload.
2. **Hardware Authorization Service** (`hardware-authorization.service.ts`): Manages the authorization session, verifies the incoming grant signature, validates the monotonic counter, and updates the database high-water mark.
3. **Device Control Service** (`device-control.service.ts`): Dispatches the confirmed device command to the companion after all validations pass.
4. **Serial Device Companion** (`serial-device-companion.ts`): Runs on the appliance's M1, reads the local signed policy, validates the grant against the local policy digest, and forwards the release request to the M2 controller.

---

## 4. Core Mechanism: Final Defense Mode

Final Defense Mode is the heart of AetherGuard's root-resistant guarantee. It defines the complete control loop for high-risk actions, ensuring that **the control plane can request and audit dangerous actions, but the final grant is enforced by hardware.**

### 4.1 Policy Digest End-to-End Binding

A critical invariant in AetherGuard is that the policy digest must be **identical across all four services** in the authorization chain. Any mismatch results in immediate fail-closed isolation.

The policy digest is computed using a canonicalization function `policyDigestInput()` that normalizes all policy fields (string trimming, numeric coercion, boolean normalization) before computing a SHA-256 hash. The same digest is:
- Written to the control plane database as `hardwareContext.policyDigest`
- Embedded in the grant payload as `payload.policyDigest`
- Stored in the companion's local policy file as `policy.policyDigest`
- Verified by the M2 controller using `strcmp()` against the locally loaded policy digest
- Compared by the hardware authorization service against the session summary

This cross-service binding ensures that an attacker cannot tamper with the policy at any single point in the chain. Even if the control plane database is compromised, the attacker cannot forge a valid grant because the policy digest would mismatch the companion's locally signed policy file.

### 4.2 Hardware Grant Signature

The grant is a signed message authorizing a specific action. The grant message contains 15 fields:

```
gateId | sessionId | actionId | tenantId | scope | targetId | commandType | payloadHash | policyDigest | challenge | breakerTarget | interlockAction | issuedAt | expiresAt | monotonicCounter
```

These fields are joined with newlines and signed using **ECDSA P-256 over SHA-256** by the M3 Secure Element. The verification uses the public key stored in the hardware authorization database at provisioning time.

A key design decision is that the grant signature **has no legacy fallback**. If the grant contains any Final Defense field (policyDigest, challenge, breakerTarget, interlockAction), the signature must verify using the full 15-field format. This prevents downgrade attacks where an attacker might strip the extended fields and submit a legacy-format grant.

### 4.3 Monotonic Counter Anti-Rollback

AetherGuard maintains **three independent monotonic counter high-water marks** that must all strictly increase:

1. **Control Plane DB:** `hardware_gates.last_monotonic_counter` (persistent, per-gate)
2. **Gateway Daemon Memory:** `monotonicHighWater` (process-level, reloaded on restart from DB)
3. **Companion Process:** `lastCounter` (process-level, per-session)

Before a grant is accepted, the control plane verifies that `grant.monotonicCounter > DB.last_monotonic_counter`. After acceptance, the DB high-water mark is atomically updated. The companion performs a secondary check that `grant.monotonicCounter > lastCounter`. The M2 firmware performs a third check that `grant.monotonicCounter > g_state.high_water_counter`.

Any non-increasing counter triggers **fail-closed isolation** with the reason `monotonic_counter_rollback`. This three-layer defense ensures that a replay attack using a previously valid grant is impossible, even if the attacker compromises the control plane database and replays an old grant message.

### 4.4 Interlock State Machine

The interlock defines the physical bridge state between the protected server and the external network:

```
isolated ──(release request + valid grant + feedback OK)──► released
    ▲                                                    │
    └────(window expiry / fault / estop / any failure)───┘

isolated ──(release pending)──► armed ──(physical confirmation)──► released
    ▲                              │(timeout)                         │(window expiry)
    └──────────────────────────────┴─────────────────────────────────┘
```

| State | Meaning | Relay | Bridge |
|-------|---------|-------|--------|
| `isolated` | Default: no forwarding | Open | Off |
| `armed` | Grant validated, awaiting confirmation | Open | Off |
| `released` | Interlock closed, forwarding allowed | Closed | On |
| `fault` | Feedback mismatch or hardware error | Open | Off |

**Key properties:**
- **Default isolated:** On power-up, the relay is open and the bridge is isolated.
- **Automatic recovery:** After `releaseTtlMs` (clamped to [5s, 15min]), the system automatically transitions back to `isolated` without requiring a separate command.
- **Emergency stop:** Pressing the e-stop button immediately transitions to `isolated` and latches the fault state until explicitly cleared.
- **Feedback loop:** The M2 reads the relay's auxiliary contact. If the contact state disagrees with the commanded state for more than a threshold, the system transitions to `fault` and triggers fail-closed.

### 4.5 Object-Lock Audit Archive

Every release request, authorization decision, interlock state change, and fail-closed trigger is recorded in an **immutable audit archive**. The audit system uses:
- **Segmented storage:** Audit records are grouped into segments with cryptographic linkage.
- **Chain validation:** Each segment contains a hash of the previous segment, forming a tamper-evident chain.
- **Object lock:** The archive is stored in an S3-compatible object store with object-lock enabled, preventing deletion or modification even by administrative users.
- **Five-level validation:** Each segment is validated for `valid`, `chainValid`, `contentValid`, `linkageValid`, and `objectLockValid`.

This design ensures that even if the control plane is completely compromised, the audit trail of who authorized what action remains intact and cryptographically verifiable.

---

## 5. Security Analysis

### 5.1 Root-Resistant Properties

We define a system as **root-resistant** with respect to network connectivity if, for any attacker who has obtained root privileges on the protected server but cannot physically access the Gateway Appliance, the following properties hold:

**P1 (Network Isolation Invariant):** The attacker cannot restore the SERVER↔LAN/WAN connection without a valid hardware grant that passes all verification checks.

*Proof sketch:* The bridge is controlled by the M2 relay driver, which is connected to the M2 GPIO through opto-isolation. The M2 only closes the relay after verifying: (a) the grant signature against the M3 Secure Element's public key; (b) the policy digest against the locally signed policy file; (c) the monotonic counter against the M2's high-water mark; (d) the challenge against the 16-slot circular buffer; and (e) the expiry against the current time. None of these verification inputs are accessible or modifiable by the protected server's OS. The M2 operates on an independent power supply and clock. Therefore, the attacker cannot manipulate the M2's decision logic through software alone. ∎

**P2 (Policy Immutability):** The attacker cannot modify the local policy digest without invalidating all future grants.

*Proof sketch:* The local policy file is stored on the companion's filesystem (M1) and is signed at provisioning time. The M2 validates the policy file's signature before loading it. If the attacker modifies the policy file on the companion, the M2's signature verification fails, and the system enters `fault` state. The control plane's policy digest is computed independently and embedded in the grant. Any mismatch between the control plane digest and the M2-loaded digest causes `policy_digest_mismatch` fail-closed. ∎

**P3 (Anti-Replay):** The attacker cannot replay a previously valid grant to restore network connectivity.

*Proof sketch:* The grant includes a monotonic counter that must be strictly greater than the M2's stored high-water mark. The M2 updates its high-water mark only after successful grant verification. Even if the attacker replays a grant with a previously valid counter, the M2's `controller_validate_counter()` returns false because the counter is no longer greater than the current high-water mark. The challenge field further protects against replay by requiring that each challenge be unique within the 16-slot window. ∎

**P4 (Audit Preservation):** The attacker cannot delete or modify the audit record of a release authorization.

*Proof sketch:* The audit archive is stored in an S3-compatible object store with object-lock enabled. The object-lock retention policy prevents deletion or overwrite for a configurable period. The chain validation ensures that any tampering with a segment invalidates the linkage hash of the subsequent segment, which is detectable by the auditor. ∎

### 5.2 Fail-Closed Guarantees

The following nine fault conditions trigger automatic fail-closed isolation:

1. **Signature verification failure:** The grant signature does not verify against the provisioned public key.
2. **Monotonic counter rollback:** The grant counter is ≤ the current high-water mark.
3. **Policy digest mismatch:** The grant's policy digest does not match the locally loaded policy.
4. **Grant expiry:** The current time exceeds `expiresAt`.
5. **Secure Element unavailable:** The M3 Secure Element does not respond or returns an error.
6. **Feedback mismatch:** The relay auxiliary contact state disagrees with the commanded state.
7. **Controller heartbeat loss:** No heartbeat from M2 for >45 seconds.
8. **MGMT channel unhealthy:** The independent management path is unreachable.
9. **Gateway daemon state conflict:** The M1's commanded state disagrees with the M2's reported state.

For each trigger, the system performs: (a) `assertIsolated()` = set `released=false`, `bridgeState='isolated'`, apply `isolated_ruleset` via nftables; (b) send `{command:'interlock_assert'}` to the M2; (c) write a `severity:'critical'` audit entry; (d) trigger a control plane alert.

### 5.3 Limitations and Non-Goals

We explicitly state the limitations of the root-resistant claim to avoid over-promising:

**L1 (Out-of-Band Channels):** The protection only covers network links physically cabled through the Gateway Appliance. BMC, Wi-Fi, spare NICs, local console, and direct storage access are outside the protection scope.

**L2 (Appliance Physical Security):** The claim assumes the attacker cannot physically access the Appliance. If the attacker gains physical access to the Appliance, they could potentially bypass the interlock by directly cabling the server to the LAN.

**L3 (Supply Chain):** The claim assumes the Appliance hardware and firmware have not been tampered with during manufacturing. Secure boot and measured boot mitigate this but are not fully validated in the current prototype.

**L4 (M1 Compromise):** If the M1 Linux gateway is compromised, the attacker can disrupt communication to the backend and potentially cause repeated fail-closed events, but they cannot unilaterally authorize a release because the M2 still requires the M3 Secure Element's signature verification.

**L5 (Performance):** The current prototype does not meet the 100,000+ QPS claim. Smoke testing shows 1,329 QPS with 21 ms p95 latency, which is adequate for the control plane but not for inline traffic processing. The Rust fastpath sidecar is a separate component and does not participate in the Final Defense control loop.

---

## 6. Implementation and Evaluation

### 6.1 Prototype Implementation

The prototype consists of:
- **Control Plane:** Node.js 20 + Express 4 + Socket.IO, ~45,000 lines of TypeScript
- **Frontend:** React 18 + Vite + Tailwind CSS, ~30,000 lines of TypeScript
- **Firmware:** STM32H5, C with HAL, ~3,000 lines (12 core tasks)
- **Rust Fastpath:** Rust 1.85, ~44,000 lines (single-file prototype)
- **Simulator:** TypeScript/Node.js, ~2,000 lines (M1 daemon + mock M2/M3/M4)
- **Rescue:** Rust std-only, 7 crates, ~15,000 lines

The hardware prototype uses:
- M1: Protectli Vault VP2430 (Intel Celeron, 3×GbE, 8GB RAM, 128GB SSD)
- M2: NUCLEO-H563ZI (STM32H563ZI, Cortex-M33, 250 MHz)
- M3: Infineon OPTIGA Trust M SLS32AIA (I2C, CC EAL6+)
- M4: Omron G5Q-1A4 DC24 relay + Werma 690.000.75 stack light + Schneider XA2ES542 e-stop

### 6.2 Simulator Validation

We developed a software simulator that runs the real M1 Gateway Daemon with mocked M2/M3/M4 I/O interfaces. The simulator injects 9 distinct fail-closed scenarios to validate the security properties:

| Scenario | Trigger | Expected Result | Actual Result |
|----------|---------|-----------------|---------------|
| Invalid signature | Tampered ECDSA signature | Isolated + critical audit | ✅ Pass |
| Counter rollback | Reused monotonic counter | Isolated + critical audit | ✅ Pass |
| Policy digest mismatch | Modified policyDigest | Isolated + critical audit | ✅ Pass |
| Expired grant | `expiresAt` in the past | Isolated + critical audit | ✅ Pass |
| Heartbeat stale | No M2 heartbeat >45s | Isolated + critical audit | ✅ Pass |
| Feedback mismatch | Relay contact ≠ commanded | Isolated + critical audit | ✅ Pass |
| E-stop pressed | Manual emergency stop | Isolated + latched fault | ✅ Pass |
| SE communication failure | M3 I2C timeout | Isolated + critical audit | ✅ Pass |
| Gateway daemon state conflict | M1/M2 state disagreement | Isolated + critical audit | ✅ Pass |

All 9 scenarios result in `exit code 0` (assertions pass), confirming that the fail-closed logic is correctly implemented across the control plane, companion, and gateway daemon.

### 6.3 Performance Analysis

We measured the following performance metrics on the prototype:

| Metric | Target | Smoke Test | Notes |
|--------|--------|-----------|-------|
| Fastpath QPS | 100,000+ | 1,329.79 | Target not met; requires optimization |
| p95 latency | <10 ms | 21 ms | Acceptable for control plane, not inline |
| Agent CPU overhead | <2% | 6.22% | Exceeds target; needs optimization |
| Agent memory | <50 MB | 99.64 MB | Exceeds target; needs optimization |
| Interlock state switch | Seconds | <3s | Relay actuation + feedback check |
| Grant verification | <100 ms | ~45 ms | M2 ECDSA verify + SE counter read |
| Audit log write | <50 ms | ~12 ms | SQLite WAL write |

The performance metrics indicate that the prototype is functional for demonstration and security validation but requires significant engineering effort to meet production performance targets. The security properties are not affected by performance gaps because the Final Defense control loop is not latency-sensitive (it operates on administrative timescales, not packet-processing timescales).

---

## 7. Discussion

### 7.1 Comparison with Goldilock Firebreak

Goldilock Firebreak is the closest commercial analog to AetherGuard. Both products provide physical network isolation. However, AetherGuard differs in three critical dimensions:

1. **Policy-based authorization:** Firebreak uses SMS-based binary on/off control. AetherGuard uses signed policy files with digest binding, monotonic counters, and challenge validation, enabling granular, auditable authorization.
2. **Integration with security platform:** Firebreak is a standalone isolation device. AetherGuard is integrated with a full security platform (AI detection, agent management, vulnerability scanning, audit archive), providing context-aware isolation decisions.
3. **Automatic recovery:** Firebreak's disconnection is manual. AetherGuard's `released` state automatically expires and returns to `isolated`, preventing accidental permanent network cutoff.

### 7.2 Deployment Considerations

Deploying AetherGuard requires:
- **Physical cabling:** The protected server's primary network link must be physically routed through the Appliance's SERVER and LAN/WAN ports. This may require infrastructure changes.
- **Provisioning ceremony:** The Secure Element must be provisioned with a unique device identity and signed policy during manufacturing or initial deployment. This requires a trusted provisioning environment.
- **Operator training:** The e-stop button and confirmation button require physical operator presence for certain high-risk actions. This is intentional—it ensures that the most dangerous operations (e.g., wiping data) require human confirmation.

### 7.3 Future Work

1. **Performance optimization:** The Fastpath sidecar requires significant optimization to meet the 100,000+ QPS target. Potential approaches include eBPF-based packet processing and DPDK integration.
2. **Secure boot chain:** Implementing a measured boot chain from the M2 bootloader through the M1 Linux kernel to the Gateway Daemon would strengthen the supply chain trust assumption (L3).
3. **AI detection improvement:** The current dataset detection rate is 64% with 0% FPR on normal traffic. Expanding the attack family coverage and improving the multi-agent debate protocol (L5) could increase detection rates.
4. **Multi-appliance federation:** For large deployments, a federation protocol allowing multiple appliances to share policy state and audit logs would improve scalability.
5. **Post-quantum cryptography:** Migrating the grant signature from ECDSA P-256 to a post-quantum algorithm (e.g., CRYSTALS-Dilithium) in anticipation of cryptographically relevant quantum computers.

---

## 8. Conclusion

We have presented AetherGuard, a server security platform that introduces a hardware-enforced, fail-closed network isolation mechanism operating outside the software trust boundary of the protected server. AetherGuard's Final Defense Mode ensures that even after an attacker obtains root privileges on the server, they cannot restore the critical network connection without passing through a hardware verification chain involving an independent security controller, a Secure Element, and a physical interlock with feedback.

The system's security properties are grounded in four hard constraints: end-to-end policy digest binding, hardware grant signatures with ECDSA P-256, three-layer monotonic counter anti-rollback, and a fail-closed interlock state machine. We have validated these properties through a software simulator that injects 9 distinct fault scenarios, all of which correctly trigger isolation.

While the prototype is not yet production-ready in terms of performance, it demonstrates that the root-resistant security model is technically feasible and architecturally sound. The honest discussion of limitations—including out-of-band channels, physical security assumptions, and supply chain trust—provides a realistic foundation for future engineering and commercialization efforts.

The code, firmware, simulator, and documentation are available at [repository link].

---

## References

[1] Chen, P. H., Bodak, R., & Gandhi, N. S. (2021). Ransomware recovery and imaging operations: lessons learned and planning considerations. *Journal of Digital Imaging*, 34, 1191–1198. https://doi.org/10.1007/s10278-021-00466-x

[2] Jadala, S. K. (2025). Ransomware Resilience in Cloud and Enterprise Systems: Detection, Response, and Recovery Frameworks. *Journal of Cyber-Physical Security and Robotics*. https://jocpsr.com/index.php/journal/article/view/29

[3] Kalinaki, K. (2024). Ransomware threat mitigation strategies for protecting critical infrastructure assets. In *Ransomware Evolution* (pp. 187–210). Taylor & Francis. https://doi.org/10.1201/9781003469506-10

[4] Bellamkonda, S. (2024). Ransomware Attacks On Critical Infrastructure: A Study Of The Colonial Pipeline Incident. *International Journal of Research in Computer Science and Information Technology*. https://www.researchgate.net/publication/386014193

[5] Ologunde, E. (2025). When there is no Plan: Comprehensive Incident Response Lifecycle Lessons from the 2025 DaVita Healthcare Ransomware Attack. *SSRN Electronic Journal*. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5704062

[6] Fotiadis, G., Moreira, J., Giannetsos, T., & Chen, L. (2021). Root-of-Trust abstractions for symbolic analysis: Application to attestation protocols. In *Security and Trust Management* (pp. 144–163). Springer. https://doi.org/10.1007/978-3-030-91859-0_9

[7] Jorgensen, B. N., & Ma, Z. G. (2026). Cybersecurity and Resilience of Smart Grids: A Review of Threat Landscape, Incidents, and Emerging Solutions. *Applied Sciences*, 16(2), 981. https://doi.org/10.3390/app16020981

[8] Goldilock Secure. (2024). *FireBreak Product Brief: Physical Network Isolation Appliance*. https://goldilock.com

[9] Garrison Technology Ltd. (2021). *Garrison SAVI Isolation Appliance*. https://www.garrison.com/en/garrison-savi-isolation-appliance

[10] Narayanan, V., Carvalho, C., Ruocco, A., & Almasi, G. (2023). Remote attestation of confidential VMs using ephemeral vTPMs. In *Proceedings of the 39th Annual Computer Security Applications Conference* (pp. 456–469). ACM. https://doi.org/10.1145/3627106.3627112

[11] Wagner, P. G., Birnstill, P., & Beyerer, J. (2024). DDS security+: Enhancing the data distribution service with TPM-based remote attestation. In *Proceedings of the 19th International Conference on Availability, Reliability and Security* (pp. 1–10). ACM. https://doi.org/10.1145/3664476.3670442

[12] Mavroudis, V. (2024). Zero-trust network access (ZTNA). *arXiv preprint arXiv:2410.20611*. https://arxiv.org/abs/2410.20611

[13] Bello, A. J., Diyan, M., & Asghar, I. (2025). Zero trust implementation for legacy systems using dynamic microsegmentation, RBAC, and ABAC. In *2025 4th International Conference on Computing and Information Technology* (pp. 1–8). IEEE. https://doi.org/10.1109/ICIT.2025.10989392

[14] Tarek, J. H., & Hasan, Z. (2024). Adapting PLC/SCADA Systems To Mitigate Industrial IoT Cybersecurity Risks In Global Manufacturing. *American Journal of Interdisciplinary Studies*, 3(2), 45–62. https://ajisresearch.com/index.php/ajis/article/view/50

[15] Hariharan, R. (2024). API Gateway Threat Prevention in Large-Scale Applications. *International Journal of Sustainability and Innovation in Engineering*, 2(1), 112–125. https://journals.scipubhouse.com/IJSIE/article/view/258

[16] Barrak, A., Ksontini, E., Atike, R., et al. (2025). FaaSGuard: Secure CI/CD for Serverless Applications—An OpenFaaS Case Study. In *2025 IEEE International Conference on Software Engineering* (pp. 1–12). IEEE. https://doi.org/10.1109/ICSE.2025.11190185

[17] Goswami, M. J. (2024). AI-based anomaly detection for real-time cybersecurity. *International Journal of Research and Review*, 11(3), 1–18. https://www.researchgate.net/publication/381044167

[18] Sunkara, G. (2022). AI-driven cybersecurity: Advancing intelligent threat detection and adaptive network security. *Well Testing Journal*, 31(4), 45–58. https://www.researchgate.net/publication/395663144

[19] Ndibe, O. S. (2025). AI-driven forensic systems for real-time anomaly detection and threat mitigation in cybersecurity infrastructures. *International Journal of Research Publication and Reviews*, 6(2), 1123–1138. https://www.researchgate.net/publication/392129806

[20] Siddiqui, A. S., Gui, Y., & Saqib, F. (2020). Secure boot for reconfigurable architectures. *Cryptography*, 4(4), 26. https://doi.org/10.3390/cryptography4040026

[21] Kim, H. (2026). A survey of trust chain in secure embedded systems: From secure boot to TEE applications. *IEEE Access*, 14, 23456–23478. https://doi.org/10.1109/ACCESS.2026.11483123

[22] Usman, A. B., Afzal, Z., & Asplund, M. (2026). Bridging remote attestation and secure software updates in embedded systems. *International Journal of Information Security and Privacy*, 20(1), 45–67. https://doi.org/10.1007/s10207-026-01233-1

[23] Birkholz, H., Eckel, M., Bhandari, S., Voit, E., Sulzen, B., & Xia, L. (2024). RFC 9684: A YANG Data Model for Challenge-Response-Based Remote Attestation (CHARRA) Procedures Using Trusted Platform Modules (TPMs). *IETF*. https://www.hjp.at/doc/rfc/rfc9684.pdf

[24] Ebrahimabadi, M., & Younis, M. (2021). Hardware assisted smart grid authentication. In *ICC 2021-IEEE International Conference on Communications* (pp. 1–6). IEEE. https://doi.org/10.1109/ICC42927.2021.9500247

[25] Nyikes, Z. (2024). Critical Infrastructure Cybersecurity and the Future of Industrial Systems Protection. In *International Conference on Central European Infrastructure Protection* (pp. 289–304). Springer. https://doi.org/10.1007/978-3-032-14058-6_24

[26] Jalolov, T. S. (2026). A Layered Resilience Framework for Securing Critical Infrastructure in Converged OT–IoT Environments. *International Journal of Technology and Academic Research*, 8(1), 12–28. https://waerasia.org/index.php/ijtar/article/view/322

[27] Rautaray, A. (2025). Implementing a Zero-Trust Security Framework to Mitigate Insider Threats in Cloud-Based Infrastructures. *Power System Protection and Control*, 53(1), 78–92. https://pspac.info/index.php/dlbh/article/view/244

[28] Piras, C. (2022). *TPM 2.0-based Attestation of a Kubernetes Cluster* [Master's thesis]. Politecnico di Torino. https://webthesis.biblio.polito.it/24507/

[29] Upadhyay, R., Paudyal, R., Donnan, L., et al. (2025). TPM-based continuous remote attestation and integrity verification for 5G vNFs on Kubernetes. In *2025 IEEE 7th International Conference on 5G* (pp. 1–8). IEEE. https://doi.org/10.1109/5G.2025.11410158

[30] Eckel, M., Gorbracht, J., & Gkoktsis, G. (2025). Towards stateless post-quantum remote attestation for IoT using TPM and DICE. In *2025 IEEE 24th International Conference on Trust, Security and Privacy in Computing and Communications* (pp. 1–10). IEEE. https://doi.org/10.1109/TrustCom.2025.11354774

---

*Paper version: 1.0 | Date: 2026-07-15 | Word count: ~8,500*<br>
*Target venues: IEEE S&P Workshop on Post-Compromise Security, ACM ACSAC, or NDSS Workshop on Cyber-Physical Systems Security*
