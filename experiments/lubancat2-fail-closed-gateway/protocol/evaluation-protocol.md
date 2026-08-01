# Evaluation Protocol - AetherGuard Cat2 External Gateway Prototype

Machine-readable mirror: [evaluation-protocol.json](evaluation-protocol.json).
Status values used everywhere: `PASSED | FAILED | NOT_RUN | BLOCKED`.

## Phase 0 - machine identification (DONE)

Collected per inventory/*.json. Identification by silicon (`/proc/cpuinfo`
Hardware = EmbedFire LubanCat-2, aarch64) not by hostname.

## Phase 1 - interface mapping (BLOCKED until cables)

Ports `eth0`/`eth1` exist (driver st_gmac). Role assignment requires the
operator to plug one cable at a time while `ip monitor link` is watched:
first port to gain carrier = SERVER_IF (toward protected host), second =
UPLINK_IF (toward router). Verification checklist: link up both, ethtool
readable, 1000Mb/s full duplex expected, no flap for 60s, no driver resets
in dmesg.

## Phase 2 - backup & auto-rollback (before ANY network change)

`ag-cat2-backup.sh` snapshots files + runtime state under
`/root/aetherguard-cat2-backup/<ts>/` with SHA256SUMS. Before each risky
step a PID1 timer runs `aetherguard-network-rollback.sh` at +5min unless
cancelled after verification. The rollback never deletes backups and never
touches usb0 unless it is actually broken.

## Phase 3 - tooling

Cat2 already has: iproute2, ethtool, bridge, iperf3, curl, openssl, python3,
nc. Missing (install only if needed): tcpdump, jq, socat, arping. nftables
intentionally NOT installed (kernel unsupported, see inventory). No dist
upgrades. Protected host: NetworkManager, nftables 1.1.6, iproute2 6.19;
missing: iperf3, socat, arping, nmap (install via apt, versions recorded).

## Phase 4 - temporary transparent bridge

Order: (a) auto-rollback timer armed; (b) `br0` created, STP off; (c)
UPLINK_IF enslaved; (d) SERVER_IF enslaved **and immediately port-disabled**;
(e) verify: bridge link/fdb, no loop (watch for duplicate frames/storm on
upstream), management over usb0 OK; (f) temporarily set SERVER port
forwarding to confirm the protected host gets DHCP via the Cat2 and can
reach the upstream gateway; (g) port back to disabled. Management stays on
usb0; br0 carries no IP (documented deviation from the generic plan: the
out-of-band USB link is strictly safer than in-band management).

## Phase 5 - fail-closed gate (substitute for nftables on this kernel)

Gate = bridge port state of SERVER_IF inside br0. Release = PID1 transient
timer (systemd-run --on-active) registered BEFORE opening; timer fires
`ag-cat2-gateway _expire` which sets port state disabled. Verified properties:
no timer no open; kill -9 of helpers does not extend; reboot clears;
wall-clock jumps do not shorten/extend (monotonic).

## Phase 6 - persistence

NetworkManager profiles: `aetherguard-br0` (bridge, stp off, no IP) +
`aetherguard-uplink-slave` (UPLINK_IF enslaved). SERVER_IF gets **no**
profile: at boot it is not a bridge member until
`aetherguard-cat2-gateway.service` (Before=network-online.target) enslaves
and disables it. Service failure can never open the gate. 10-minute rollback
timer is armed before the validation reboot.

## Phase 7 - protected host

Scripts under protected-host/scripts. experiment-mode disables WiFi/VPN/
extra NICs with a PID1 auto-restore timer (default 30 min) and refuses to
run without an independent management path. Nothing is permanently disabled.

## Phase 8/9 - tests and fault injection

See tests/. Each entry logs: inject time, command, gate state before/after,
unauthorized traffic count, escaped bytes (port counters), management
availability, recovery steps, human intervention required (bool).

## Phase 10 - authorization prototype

protocol/authorization/. Ed25519 over canonical JSON (sorted keys, minimal
separators, UTF-8). Verifier checks signature first, then every field, then
monotonic counter under flock; only then releases for the remaining time.

## Phase 11 - performance

Requires a third machine as iperf3 peer. If absent: perf-plan.sh marks
NOT_RUN and prints exact rerun commands. No fabricated numbers.

## Phase 12 - results

results/raw/<ts>/{test}.{txt,json}; normalized summary; SHA256SUMS;
manifest.json with schema validation.
