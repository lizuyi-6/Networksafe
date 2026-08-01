# Threat Model - AetherGuard Cat2 External Gateway Prototype

## Roles

| entity | trust | rationale |
|--------|-------|-----------|
| Cat2 hardware + PSU + cabling | **trusted** | no evidence of tampering; physical access required to attack |
| Cat2 OS + kernel (Debian buster, 4.19.232) | **trusted** | gate primitive (bridge port state) executes here |
| Cat2 management plane (usb0 RNDIS + sshd + operator key) | **trusted** | only path that can open the gate |
| nftables/bridge config + PID1 lease timers on Cat2 | **trusted** | part of the gate |
| authorization signing private key (operator machine) | **trusted** | compromise => unauthorized releases possible |
| protected host (full OS, all userspace incl. root) | **UNTRUSTED** | the whole point: assume complete compromise |
| protected host firewall / routes / MAC / logs | **UNTRUSTED** | attacker-controlled, must not affect the gate |
| upstream router | semi-trusted | out of scope if compromised |

## Attacker capabilities (in scope)

Root on the protected host. Can: flush host firewall, change routes/MAC,
send raw Ethernet frames, flood, spoof ARP/NDP, reboot the host, tamper with
or replay authorization documents, run the host's clock anywhere, kill any
host process, persist across host reboots.

Expected property: none of the above lifts Cat2 isolation or extends a
release lease.

## Out of scope (explicitly NOT defended)

- root or physical access **on the Cat2** (its kernel is the TCB);
- Cat2 kernel 0-days, supply-chain attacks on its firmware;
- side channels (power, EM, timing);
- bypass interfaces on the protected host that do not traverse the Cat2
  (WiFi, VPN tunnels, second NICs, BMC, cellular) - the protocol disables
  them during tests, but physical control is a deployment problem;
- compromised upstream router/switch;
- denial of service against the Cat2 management plane (USB unplugged,
  sshd DoS). Availability of management is measured, not guaranteed.

## Security invariants

I1. Boot / reboot / power-cycle => state=isolated before any forwarding.
I2. state=released requires a live PID1 lease timer; no timer => no release.
I3. Lease expiry is monotonic-clock based; wall-clock jumps cannot extend it.
I4. isolate is idempotent and always available locally on the Cat2.
I5. Release requires Cat2-side credentials (root shell or a valid signed
    authorization); the protected host holds neither.
I6. All state transitions are journaled with uid, duration and digests.
