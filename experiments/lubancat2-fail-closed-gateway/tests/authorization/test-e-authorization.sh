#!/bin/bash
# TEST E - ECDSA P-256 authorization matrix plus real Cat2 counter ordering.
set -Eeuo pipefail
. "$(dirname "$0")/../../lib/test-lib.sh"

AUTHORIZATION_ROOT=${AG_AUTH_DIR:-$AG_ROOT/protocol/authorization}
PRIVATE_KEY_PATH=${KEY_PRIV:-$AUTHORIZATION_ROOT/keys/authorizer-private.pem}
AG_TEST_CONFIG_REMOTE=${AG_TEST_CONFIG_REMOTE:-/root/aetherguard-cat2-test.conf}
LOCAL_UNIT_LOG="$AG_EVIDENCE_DIR/e-authorization-local-unit.txt"
REMOTE_AUTHORIZATION_PATH=/tmp/aetherguard-auth-under-test.json
REMOTE_FAILPOINT_MARKER=/run/aetherguard-cat2/auth-release-failpoint.marker

cleanup_remote_authorization_test() {
    ag_ssh "rm -f '$REMOTE_AUTHORIZATION_PATH' '$REMOTE_FAILPOINT_MARKER'"
}

ag_begin_test \
    "e-authorization-matrix" \
    "authorization" \
    "run strict local authorization suite; run valid, tampered, replay, strict-bool, and release-failure-counter-consumption cases on Cat2"
ag_register_cleanup cleanup_remote_authorization_test

[[ -r "$PRIVATE_KEY_PATH" ]] || {
    ag_finish_test BLOCKED 5 PRIVATE_KEY_MISSING \
        "local untracked ECDSA private key exists with mode 0600" \
        "private key is unavailable"
    exit 5
}
[[ "$(stat -c %a "$PRIVATE_KEY_PATH")" == "600" ]] || {
    ag_finish_test BLOCKED 5 PRIVATE_KEY_PERMISSIONS_UNSAFE \
        "private key mode is 0600" \
        "private key mode is $(stat -c %a "$PRIVATE_KEY_PATH")"
    exit 5
}

python3 "$AG_ROOT/tests/unit/test_authorization.py" > "$LOCAL_UNIT_LOG" 2>&1
ag_add_evidence_file "$LOCAL_UNIT_LOG"

policy_digest=$(ag_ssh "sha256sum /etc/aetherguard-cat2.conf" | awk '{print $1}')
test_policy_digest=$(ag_ssh "sha256sum '$AG_TEST_CONFIG_REMOTE'" | awk '{print $1}')
last_counter=$(ag_ssh "test -r /var/lib/aetherguard-cat2/authorizer-counter && tr -d '\\n' < /var/lib/aetherguard-cat2/authorizer-counter || echo 0")
[[ "$last_counter" =~ ^(0|[1-9][0-9]*)$ ]]

sign_standard_authorization() {
    local output_path=$1
    local counter_value=$2
    local selected_policy_digest=${3:-$policy_digest}
    python3 "$AUTHORIZATION_ROOT/ag-auth-sign.py" \
        --key "$PRIVATE_KEY_PATH" \
        --gateway-id cat2-gateway-01 \
        --server-interface "$AG_SERVER_IF" \
        --uplink-interface "$AG_UPLINK_IF" \
        --policy-digest "$selected_policy_digest" \
        --duration 20 \
        --counter "$counter_value" \
        --out "$output_path"
}

run_remote_verifier() {
    local case_name=$1
    local expected_exit_code=$2
    local expected_reason_fragment=$3
    local command_prefix=${4:-}
    local case_log="$AG_EVIDENCE_DIR/e-authorization-$case_name.txt"
    set +e
    ag_ssh "$command_prefix python3 /usr/local/sbin/ag-auth-verify.py '$REMOTE_AUTHORIZATION_PATH'" \
        > "$case_log" 2>&1
    local verifier_exit_code=$?
    set -e
    ag_add_evidence_file "$case_log"
    echo "authorizationCase=$case_name verifierExitCode=$verifier_exit_code expectedExitCode=$expected_exit_code"
    [[ "$verifier_exit_code" == "$expected_exit_code" ]] || {
        AG_TEST_REASON_CODE=AUTHORIZATION_CASE_EXIT_MISMATCH
        AG_TEST_OBSERVED="case=$case_name expectedRc=$expected_exit_code observedRc=$verifier_exit_code"
        return 1
    }
    python3 - "$case_log" "$expected_exit_code" "$expected_reason_fragment" <<'PYEOF'
import json
import sys

log_path, expected_exit_code_text, expected_reason_fragment = sys.argv[1:4]
with open(log_path, "r", encoding="utf-8") as log_file:
    nonempty_lines = [line.strip() for line in log_file if line.strip()]
if not nonempty_lines:
    raise SystemExit("verifier log is empty")
document = json.loads(nonempty_lines[-1])
expected_exit_code = int(expected_exit_code_text)
if expected_exit_code == 0:
    if document.get("accepted") is not True:
        raise SystemExit("successful verifier case did not report accepted=true")
else:
    if document.get("accepted") is not False:
        raise SystemExit("rejected verifier case did not report accepted=false")
    observed_reason = document.get("reason", document.get("error", ""))
    if expected_reason_fragment not in observed_reason:
        raise SystemExit(
            "rejection reason mismatch expected fragment=%r observed=%r"
            % (expected_reason_fragment, observed_reason)
        )
PYEOF
}

valid_counter=$((last_counter + 1))
valid_document="$AG_EVIDENCE_DIR/e-valid.json"
sign_standard_authorization "$valid_document" "$valid_counter"
ag_add_evidence_file "$valid_document"
ag_scp_to_cat2 "$valid_document" "$REMOTE_AUTHORIZATION_PATH"
run_remote_verifier valid 0 ""
ag_ssh "ag-cat2-gateway isolate"

run_remote_verifier replay 2 "counter rollback or replay"

tampered_document="$AG_EVIDENCE_DIR/e-tampered-gateway-id.json"
python3 - "$valid_document" "$tampered_document" <<'PYEOF'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as input_file:
    document = json.load(input_file)
document["payload"]["gatewayId"] = "tampered-gateway"
with open(sys.argv[2], "w", encoding="utf-8") as output_file:
    json.dump(document, output_file)
PYEOF
ag_add_evidence_file "$tampered_document"
ag_scp_to_cat2 "$tampered_document" "$REMOTE_AUTHORIZATION_PATH"
run_remote_verifier tampered-gateway-id 2 "canonicalSha256 mismatch"

strict_boolean_document="$AG_EVIDENCE_DIR/e-duration-boolean.json"
python3 - "$strict_boolean_document" "$PRIVATE_KEY_PATH" "$policy_digest" "$((valid_counter + 1))" \
    "$AUTHORIZATION_ROOT" "$AG_SERVER_IF" "$AG_UPLINK_IF" <<'PYEOF'
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

output_path, private_key_path, policy_digest, counter_text, authorization_root, server_interface, uplink_interface = sys.argv[1:8]
sys.path.insert(0, authorization_root)
from ag_auth_common import SIGNATURE_ALGORITHM
from ag_auth_common import canonical_payload_bytes

issued_at = int(time.time())
payload = {
    "version": 1,
    "gatewayId": "cat2-gateway-01",
    "action": "network_release",
    "serverInterface": server_interface,
    "uplinkInterface": uplink_interface,
    "policyDigest": policy_digest,
    "nonce": "00112233445566778899aabbccddeeff",
    "counter": int(counter_text),
    "issuedAt": issued_at,
    "expiresAt": issued_at + 1,
    "durationSeconds": True,
}
canonical_payload = canonical_payload_bytes(payload)
with tempfile.NamedTemporaryFile(delete=False) as message_file:
    message_file.write(canonical_payload)
    message_path = message_file.name
try:
    signature = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", private_key_path, message_path],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
finally:
    os.unlink(message_path)
document = {
    "payload": payload,
    "canonicalSha256": hashlib.sha256(canonical_payload).hexdigest(),
    "signatureAlgorithm": SIGNATURE_ALGORITHM,
    "signatureBase64": base64.b64encode(signature).decode("ascii"),
}
with open(output_path, "w", encoding="utf-8") as output_file:
    json.dump(document, output_file)
PYEOF
ag_add_evidence_file "$strict_boolean_document"
ag_scp_to_cat2 "$strict_boolean_document" "$REMOTE_AUTHORIZATION_PATH"
run_remote_verifier duration-boolean 2 "durationSeconds must be an integer"

failure_counter=$((valid_counter + 1))
release_failure_document="$AG_EVIDENCE_DIR/e-release-failure.json"
sign_standard_authorization "$release_failure_document" "$failure_counter" "$test_policy_digest"
ag_add_evidence_file "$release_failure_document"
ag_scp_to_cat2 "$release_failure_document" "$REMOTE_AUTHORIZATION_PATH"
ag_ssh "rm -f '$REMOTE_FAILPOINT_MARKER'"
test_mode_prefix="AG_TEST_MODE=1 AG_GATEWAY_CONFIG=$AG_TEST_CONFIG_REMOTE AG_STATE_DIR=/run/aetherguard-cat2 AG_SYS_CLASS_NET=/sys/class/net AG_TEST_COMMAND_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin AG_GATEWAY_EXECUTABLE=/usr/local/sbin/ag-cat2-gateway AG_TEST_FAILPOINT=timer_register_failure AG_TEST_FAILPOINT_MARKER=$REMOTE_FAILPOINT_MARKER"
run_remote_verifier release-failure-counter-consumed 2 "gateway release failed" "$test_mode_prefix"
[[ "$(ag_ssh "cat '$REMOTE_FAILPOINT_MARKER'")" == "timer_register_failure" ]] || {
    ag_finish_test FAILED 1 AUTHORIZATION_RELEASE_FAILPOINT_NOT_REACHED \
        "the authorization release reaches the requested timer registration failpoint" \
        "failpoint marker missing or unexpected"
}

persisted_counter=$(ag_ssh "tr -d '\\n' < /var/lib/aetherguard-cat2/authorizer-counter")
[[ "$persisted_counter" == "$failure_counter" ]] || {
    ag_finish_test FAILED 1 COUNTER_NOT_CONSUMED_BEFORE_RELEASE_FAILURE \
        "counter is durably consumed before injected gateway release failure" \
        "expectedCounter=$failure_counter observedCounter=$persisted_counter"
    exit 1
}
run_remote_verifier failed-release-replay 2 "counter rollback or replay" "$test_mode_prefix"
[[ "$(ag_gate_state)" == "isolated" ]] || {
    ag_finish_test FAILED 1 RELEASE_FAILURE_DID_NOT_ISOLATE \
        "gateway remains isolated after release failure and counter consumption" \
        "observed gate state=$(ag_gate_state)"
    exit 1
}
ag_management_available || {
    ag_finish_test FAILED 1 MANAGEMENT_UNAVAILABLE \
        "management remains available after authorization matrix" \
        "Cat2 SSH management failed"
    exit 1
}

ag_add_note "Local suite covers all field mutations, malformed/base64/signature cases, strict bool/float/string types, replay/rollback/equal, expiry/future, concurrent counters, replace/fsync failures, and the canonical golden vector."
ag_finish_test PASSED 0 AUTHORIZATION_MATRIX_AND_COUNTER_ORDER_CONFIRMED \
    "local strict matrix passes; Cat2 accepts valid ECDSA authorization; rejects tamper/replay/bool; release failure consumes counter and retry rejects" \
    "validCounter=$valid_counter failureCounter=$failure_counter finalCounter=$persisted_counter finalState=isolated"
