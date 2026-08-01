#!/bin/bash
# test-lib.sh - shared helpers for AetherGuard Cat2 evaluation tests.
# Sourced by every test. Emits one JSON result (schemas/test-result.schema.json)
# plus one raw plaintext log per test under results/raw/<run>/.
set -u
AG_ROOT=${AG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
AG_RUN_DIR=${AG_RUN_DIR:-$AG_ROOT/results/raw/$(date -u +%Y%m%dT%H%M%SZ)}
AG_BOARD=${AG_BOARD:-board}          # ssh alias of the Cat2
AG_UPLINK_TARGET=${AG_UPLINK_TARGET:-192.168.3.1}   # upstream LAN gateway
AG_SERVER_IF=${AG_SERVER_IF:-PENDING}
AG_UPLINK_IF=${AG_UPLINK_IF:-PENDING}
mkdir -p "$AG_RUN_DIR"

ag_ssh() { timeout 25 ssh -o BatchMode=yes -o ConnectTimeout=8 "$AG_BOARD" "$@" 2>/dev/null; }

ag_gate_state() { ag_ssh "ag-cat2-gateway status 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"state\"])'" | tail -1; }

ag_result() {  # ag_result <testId> <category> <cmd> <exit> <expected> <observed> <passed> [latencyMs] [unauthConns] [escapedBytes]
    local test_id="$1" category="$2" command_str="$3" exit_code="$4" expected="$5" observed="$6" passed="$7"
    local latency="${8:-null}" unauth="${9:-0}" escaped="${10:-0}"
    python3 - "$AG_RUN_DIR/$test_id.json" "$test_id" "$category" "$command_str" "$exit_code" \
              "$expected" "$observed" "$passed" "$latency" "$unauth" "$escaped" <<'PYEOF'
import json, subprocess, sys, datetime
(path, test_id, category, command_str, exit_code, expected, observed,
 passed, latency, unauth, escaped) = sys.argv[1:12]
def gate_state():
    try:
        out = subprocess.check_output(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "board",
             "ag-cat2-gateway status"], stderr=subprocess.DEVNULL, timeout=20).decode()
        return json.loads(out)["state"]
    except Exception:
        return "unknown"
commit = subprocess.check_output(
    ["git", "-C", subprocess.check_output(["git", "rev-parse", "--show-toplevel"]).decode().strip(),
     "rev-parse", "HEAD"]).decode().strip()
passed_val = {"true": True, "false": False}.get(passed, passed)
doc = {
  "testId": test_id, "category": category,
  "gatewayCommit": commit,
  "cat2Hostname": "lubancat",
  "protectedHostHostname": subprocess.check_output(["hostname"]).decode().strip(),
  "serverInterface": "PENDING_UNTIL_CABLE_TEST" if "PENDING" in test_id or True else "",
  "uplinkInterface": "",
  "stateBefore": gate_state(), "stateAfter": "unknown",
  "startedAt": "", "finishedAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "command": command_str, "exitCode": int(exit_code),
  "expected": expected, "observed": observed,
  "passed": passed_val,
  "unauthorizedConnections": int(unauth), "escapedBytes": int(escaped),
  "latencyMs": None if latency in ("null", "") else float(latency),
  "notes": [],
}
with open(path, "w") as fh:
    json.dump(doc, fh, indent=2)
print("result: %s" % path)
PYEOF
}

ag_log() { tee -a "$AG_RUN_DIR/$1.txt"; }
