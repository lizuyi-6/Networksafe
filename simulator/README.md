# Gateway Appliance Simulator

Software simulation of the AetherGuard Root-Resistant Gateway Appliance (M1-M4 four-module integration) for end-to-end control-loop verification before hardware arrival.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Simulator Process                           │
│                                                                 │
│  ┌──────────────┐   serial JSON   ┌──────────────────────┐     │
│  │ M1 Gateway   │◄────────────────►│ M2 Controller        │     │
│  │ Daemon       │                  │ (simulated STM32)    │     │
│  │ (real code)  │                  └──────┬───────────────┘     │
│  └──────┬───────┘                         │ I2C commands        │
│         │ nftables mock                   │                     │
│         │ (console log)          ┌────────▼─────────┐           │
│         │                        │ M3 Secure        │           │
│         │                        │ Element mock     │           │
│         │                        │ (crypto.sign)    │           │
│         │                        └──────────────────┘           │
│         │                                  │                    │
│         │          ┌───────────────────────┘                    │
│         │          │ GPIO mock                                  │
│         │          ▼                                            │
│         │   ┌──────────────────┐                                │
│         │   │ M4 Interlock     │                                │
│         └───►│ relay + feedback │                                │
│             │ (LED console)    │                                │
│             └──────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
         ▲                                      │
         │ POST /api/.../actions                │ POST /api/.../status/report
         │                                      ▼
    ┌────┴──────────────────────────────────────────┐
    │  Backend Control Plane (real)                 │
    └───────────────────────────────────────────────┘
```

## What This Simulates

✅ **Real code, mocked I/O:**
- M1 Gateway Daemon: **real** `backend/src/companion/gateway-daemon.ts` (238 lines)
- M2 Controller: **simulated** STM32 state machine (serial JSON, 12 core tasks)
- M3 Secure Element: **simulated** ECDSA signing (Node crypto, same algorithm)
- M4 Interlock: **simulated** relay + feedback (console LED indicators)

✅ **End-to-end flow:**
1. Backend sends `POST /api/final-defense/gateways/actions` with grant
2. M1 Gateway Daemon verifies signature, requests M2 Controller
3. M2 Controller validates grant, drives M3 SE to sign, drives M4 relay
4. M4 Interlock releases, feedback confirms
5. M1 applies `released_ruleset` (console log: "🟢 BRIDGE RELEASED")
6. Window expires → auto-reasserts `isolated` (console log: "🔴 BRIDGE ISOLATED")

✅ **Fail-closed triggers (all 9):**
- PRD #1: invalid signature
- PRD #2: monotonic counter rollback
- PRD #4: grant expired
- PRD #5: SE unavailable
- PRD #6: feedback mismatch
- PRD #7: controller heartbeat stale
- PRD #9: daemon/controller state divergence
- window expiry
- E-stop (simulated keypress)

## What This Does NOT Simulate

❌ Real network bridging (nftables/iptables rules)
❌ Real I2C timing and hardware failures
❌ Real relay contact bounce / arc suppression
❌ Physical button debounce
❌ True TrustZone / secure boot
❌ UART baud rate / framing errors

## Usage

### 1. Run Simulator (standalone)

```bash
cd simulator
npm install
npm run sim
```

Output:
```
🔴 [M1 Gateway] Boot: BRIDGE ISOLATED (default fail-closed)
🟡 [M2 Controller] Heartbeat started (every 5s)
🔵 [M3 SE] Provisioned: device-gw-sim-001 (ECDSA P-256)
⚪ [M4 Interlock] Relay: OPEN (isolated), Feedback: OPEN

[t+5.2s] Backend → POST /api/final-defense/gateways/actions
         { action: 'release_temporary', targetId: 'server-1', ttl: 30s }
[t+5.3s] M1 → M2: command interlock_release { grant: {...} }
[t+5.4s] M2: Verifying grant signature via M3 SE...
[t+5.5s] M3 SE: Signature VALID ✅
[t+5.6s] M2 → M4: GPIO HIGH (drive relay coil)
[t+5.7s] M4: Relay CLOSED ⚡, Feedback: CLOSED ✅
[t+5.8s] M2 → M1: interlock_result { state: 'released', feedbackOk: true }
🟢 [M1 Gateway] BRIDGE RELEASED (30s window)
         nftables: applying released_ruleset
         SERVER ↔ LAN/WAN: FORWARDING ✅

[t+35.8s] Release window expired
🔴 [M1 Gateway] BRIDGE ISOLATED (window_expired)
         nftables: applying isolated_ruleset
         SERVER ↔ LAN/WAN: BLOCKED 🚫
```

### 2. Run with Backend Integration

Terminal 1 (backend):
```bash
cd backend
npm run dev
```

Terminal 2 (simulator):
```bash
cd simulator
BACKEND_URL=http://127.0.0.1:8080 npm run sim:integrated
```

Simulator registers to backend, receives real grant requests, reports status.

### 3. Trigger Fail-Closed Scenarios

```bash
# Test invalid signature
npm run sim:test -- --trigger=invalid-signature

# Test counter rollback
npm run sim:test -- --trigger=counter-rollback

# Test heartbeat stale
npm run sim:test -- --trigger=heartbeat-stale

# Test E-stop
npm run sim:test -- --trigger=estop
```

Each prints the fail-closed response + reason.

## Files

- `sim.ts` — main simulator entry point
- `m1-gateway/` — wrapper around real GatewayDaemon
- `m2-controller/mock-controller.ts` — simulated STM32 state machine
- `m3-secure-element/mock-se.ts` — simulated ECDSA signing (Node crypto)
- `m4-interlock/mock-interlock.ts` — simulated relay + feedback (LED console)
- `package.json` — dependencies (none beyond backend's)

## Next Steps After Simulation

1. ✅ Verify control-loop logic (this simulation proves it)
2. Initialize real STM32 firmware project (`firmware/controller-stm32h5/`)
3. Port M2 controller logic to C/C++ for STM32
4. Replace M3 mock with real OPTIGA Trust M I2C driver
5. Replace M4 mock with real GPIO relay driver
6. Hardware bring-up with NUCLEO + breadboard relay

## References

- Gateway Daemon: `backend/src/companion/gateway-daemon.ts`
- Grant signature: `backend/src/security/hardware-grant.ts`
- PRD: `docs/root-resistant-gateway-prd.md`
- Phase 0 status: `docs/hardware-phase0-status.md`
