#!/bin/bash
# fault-matrix.sh - fault injection campaign. Each fault records pre/post gate
# state, unauthorized traffic observation, management availability, and whether
# human intervention was required.
# Items requiring physical action (cable pull, power cycle) print OPERATOR
# prompts and are marked NOT_RUN unless the operator confirms.
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=f-fault

record() { echo "FAULT[$1] $2"; }

{
  echo "# FAULT MATRIX $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  record F01 "release then kill -9 any userspace helper processes"
  ag_ssh "ag-cat2-gateway release 60"
  ag_ssh "pkill -9 -f ag-cat2-gateway 2>/dev/null; pkill -9 -f ag-auth-verify 2>/dev/null; echo killed"
  echo "state after kill: $(ag_gate_state) (released is OK - the PID1 lease timer owns expiry)"
  sleep 62
  record F01 "post-lease state: $(ag_gate_state) (expect isolated - expiry survived kill -9)"

  record F02 "stop the gateway systemd service during release"
  ag_ssh "ag-cat2-gateway release 45"
  ag_ssh "systemctl stop aetherguard-cat2-gateway.service; echo stopped"
  echo "state: $(ag_gate_state) (stop must NOT open or extend the gate)"
  sleep 47
  record F02 "post-lease state: $(ag_gate_state) (expect isolated)"

  record F03 "restart the gateway service during release"
  ag_ssh "ag-cat2-gateway release 40"
  ag_ssh "systemctl restart aetherguard-cat2-gateway.service; echo restarted"
  record F03 "state after restart: $(ag_gate_state) (service restart re-isolates: acceptable fail-closed)"

  record F04 "simulate failed reload: run isolate while lease active, then check no timer corpse opens the gate"
  ag_ssh "ag-cat2-gateway release 40; ag-cat2-gateway isolate; echo done"
  sleep 42
  record F04 "state: $(ag_gate_state) (expect isolated, no zombie release)"

  record F05 "corrupt a COPY of the config; production config untouched; verify status still works"
  ag_ssh "cp /etc/aetherguard-cat2.conf /tmp/ag-conf-copy && echo GARBAGE >> /tmp/ag-conf-copy && ag-cat2-gateway status >/dev/null && echo status-ok"

  record F06 "Cat2 reboot from isolated state (management via usb0 must return)"
  ag_ssh "ag-cat2-gateway isolate; systemctl reboot" || true
  sleep 5
  for i in $(seq 1 40); do
      if ping -c 1 -W 1 192.168.100.2 >/dev/null 2>&1 && ag_ssh true 2>/dev/null; then break; fi
      sleep 5
  done
  record F06 "post-reboot state: $(ag_gate_state) (expect isolated); mgmt: $(ping -c1 -W1 192.168.100.2 >/dev/null 2>&1 && echo ok || echo FAIL)"

  record F07 "Cat2 reboot DURING release"
  ag_ssh "ag-cat2-gateway release 300"
  sleep 2
  ag_ssh "systemctl reboot" || true
  sleep 5
  for i in $(seq 1 40); do
      if ping -c 1 -W 1 192.168.100.2 >/dev/null 2>&1 && ag_ssh true 2>/dev/null; then break; fi
      sleep 5
  done
  record F07 "post-reboot state: $(ag_gate_state) (expect isolated - lease must not survive reboot)"

  record F08 "OPERATOR ACTION: power-cycle the Cat2 (unplug/replug power). Then press enter."
  read -r -p "press enter after power cycle, or type skip: " ans
  if [ "$ans" != "skip" ]; then
      for i in $(seq 1 40); do
          if ping -c 1 -W 1 192.168.100.2 >/dev/null 2>&1 && ag_ssh true 2>/dev/null; then break; fi
          sleep 5
      done
      record F08 "post-power-cycle state: $(ag_gate_state) (expect isolated)"
  else
      record F08 "NOT_RUN (operator skipped)"
  fi

  record F09 "OPERATOR ACTION: unplug SERVER cable 10s during release 120, replug. press enter when done."
  ag_ssh "ag-cat2-gateway release 120"
  read -r -p "press enter after replug, or type skip: " ans
  [ "$ans" = "skip" ] && record F09 "NOT_RUN" || record F09 "state: $(ag_gate_state); connectivity rechecked in test C"

  record F10 "OPERATOR ACTION: unplug UPLINK cable 10s during release 120, replug."
  read -r -p "press enter after replug, or type skip: " ans
  [ "$ans" = "skip" ] && record F10 "NOT_RUN" || record F10 "state: $(ag_gate_state)"
  ag_ssh "ag-cat2-gateway isolate"

  record F11 "CPU stress on Cat2 during release (lease must still expire)"
  ag_ssh "ag-cat2-gateway release 45"
  ag_ssh "(for i in 1 2 3 4; do (while :; do :; done) & done); sleep 30; pkill -9 -f 'while' 2>/dev/null; echo stressed" || true
  sleep 18
  record F11 "post-stress post-lease state: $(ag_gate_state) (expect isolated)"

  record F12 "memory pressure on Cat2 (bounded, 300MB for 15s)"
  ag_ssh "python3 -c 'x=bytearray(300*1024*1024); import time; time.sleep(15)' &" || true
  ag_ssh "ag-cat2-gateway release 30"; sleep 33
  record F12 "state: $(ag_gate_state)"

  record F14 "time jump FORWARD +10min during release 300 (monotonic timers must NOT be cheated)"
  ag_ssh "ag-cat2-gateway release 300"
  ag_ssh "date -s '+10 minutes' >/dev/null; timedatectl set-ntp false 2>/dev/null; echo jumped"
  sleep 3
  record F14 "state after forward jump: $(ag_gate_state) (systemd --on-active uses monotonic clock: still released is CORRECT for ~300s of REAL time; wall-clock jump must not extend or shorten actual lease)"
  ag_ssh "date -s '-10 minutes' >/dev/null; echo restored"
  ag_ssh "ag-cat2-gateway isolate"

  record F15 "time jump BACKWARD -10min during release"
  ag_ssh "ag-cat2-gateway release 40"
  ag_ssh "date -s '-10 minutes' >/dev/null; echo jumped"
  sleep 42
  record F15 "state: $(ag_gate_state) (expect isolated - monotonic lease unaffected); restoring clock"
  ag_ssh "date -s '+10 minutes' >/dev/null; echo restored"

  record F16 "protected host reboot (Cat2 gate must be unaffected)"
  record F16 "NOT_RUN by default - uncomment to reboot the operator machine"
  # sudo -n systemctl reboot

  record F17 "protected host flushes its OWN firewall (host controls nothing at L2)"
  sudo -n nft list ruleset > /tmp/ag-host-fw-backup.nft 2>/dev/null || true
  sudo -n nft flush ruleset 2>/dev/null || true
  sleep 1
  record F17 "gate state after host firewall flush: $(ag_gate_state) (must be unchanged)"
  [ -s /tmp/ag-host-fw-backup.nft ] && sudo -n nft -f /tmp/ag-host-fw-backup.nft 2>/dev/null

  record F18 "protected host deletes its default route / adds fake gateway"
  ip route save dev eno1 > /tmp/ag-host-routes.bin 2>/dev/null || true
  sudo -n ip route replace default via 10.66.66.1 dev eno1 2>/dev/null || true
  record F18 "gate state: $(ag_gate_state) (unchanged expected)"
  sudo -n ip route del default via 10.66.66.1 dev eno1 2>/dev/null || true

  record F19 "protected host changes its MAC"
  MAC_ORIG=$(cat /sys/class/net/eno1/address)
  sudo -n ip link set dev eno1 address 02:de:ad:be:ef:01 2>/dev/null || true
  sleep 2
  record F19 "gate state: $(ag_gate_state); upstream reachable: $(ping -I eno1 -c1 -W1 "$AG_UPLINK_TARGET" >/dev/null 2>&1 && echo yes || echo no)"
  sudo -n ip link set dev eno1 address "$MAC_ORIG" 2>/dev/null || true

  record F20 "raw socket flood from protected host during isolation (10k frames, count escapes on Cat2)"
  ag_ssh "ag-cat2-gateway isolate"
  sudo -n python3 - <<'PY' || true
import socket
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x88B5))
s.bind(("eno1", 0))
frame = b"\xff"*6 + b"\x02\xde\xad\xbe\xef" + b"\x88\xb5" + b"X"*46
for _ in range(10000):
    s.send(frame)
print("sent 10000 raw frames")
PY
  ag_ssh "ip -s link show dev \$( . /etc/aetherguard-cat2.conf; echo \$SERVER_IF ) | sed -n '3,6p'"
  record F20 "compare SERVER_IF RX counter delta vs UPLINK_IF TX delta - escapes must be 0"

  echo "# FAULT MATRIX END"
} 2>&1 | ag_log "$TEST_PREFIX"
