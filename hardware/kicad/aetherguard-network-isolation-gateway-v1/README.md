# AetherGuard Network Isolation Gateway v1

Root-resistant final defense hardware for AetherGuard.

This board is the first KiCad prototype for the external network isolation gateway. It is designed to sit physically in front of a protected server:

```text
Protected server NIC -> SERVER [AetherGuard Gateway] LAN/WAN -> network
                                  |
                                  +-> MGMT independent control/audit path
```

## Hardware Boundary
- `SERVER` and `LAN/WAN`: dual 1GbE transparent L2 bridge ports controlled by KSZ9563R.
- `MGMT`: independent W5500 10/100 management Ethernet, not a bridge member.
- `ESP32-S3-WROOM-1`: gateway policy state, secure boot chain, switch register control, UI and USB logs.
- `ATECC608C`: non-exportable identity key for signed grant/attestation envelopes.
- Default failure action: `isolated`.

## Fail-Closed Behavior
- KSZ9563R reset/power-gate is held safe by default.
- MCU must verify signed local policy, policy digest, firmware digest, ATECC identity, link state and management independence before moving to `armed`.
- Temporary release is TTL-bound. Watchdog failure, heartbeat loss, policy mismatch, firmware mismatch or link fault returns the bridge to `isolated`.

## Prototype Files
- `generate_gateway_v1.py`: deterministic KiCad/release generator.
- `aetherguard-network-isolation-gateway-v1.kicad_pro`: KiCad 9 project.
- `aetherguard-network-isolation-gateway-v1.kicad_sch`: root schematic with five child sheets.
- `aetherguard-network-isolation-gateway-v1.kicad_pcb`: board-fab review PCB.
- `release/v1-proto/`: BOM, position file, export logs and fabrication outputs.

## Production Caveat
This is a fab-review prototype, not a finished production high-speed Ethernet design. Before production, complete vendor reference-design cross-checks, controlled-impedance stackup, MDI pair SI review, ESD/EMC design and firmware secure-boot/provisioning validation.
