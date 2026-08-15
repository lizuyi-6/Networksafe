#!/bin/bash
# Run the permitted USB-RNDIS hardware matrix under one immutable campaign ID.
set -Eeuo pipefail

EXPERIMENT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPOSITORY_ROOT=$(git -C "$EXPERIMENT_ROOT" rev-parse --show-toplevel)
AG_RUN_ID=${AG_RUN_ID:-"$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"}
canonical_run_directory="$EXPERIMENT_ROOT/results/raw/$AG_RUN_ID"
if [[ -n "${AG_RUN_DIR:-}" && "$AG_RUN_DIR" != "$canonical_run_directory" ]]; then
    echo "FATAL: AG_RUN_DIR must be the canonical campaign directory" >&2
    exit 2
fi
AG_RUN_DIR=$canonical_run_directory
AG_GATEWAY_COMMIT=$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)
AG_TRANSPORT=${AG_TRANSPORT:-usb-rndis}
AG_BOARD=${AG_BOARD:-board}
AG_MANAGEMENT_SOURCE_ADDRESS=${AG_MANAGEMENT_SOURCE_ADDRESS:-192.168.100.1}
AG_GATEWAY_CONFIG_REMOTE=${AG_GATEWAY_CONFIG_REMOTE:-/etc/aetherguard-cat2.conf}
AG_TEST_CONFIG_REMOTE=${AG_TEST_CONFIG_REMOTE:-/root/aetherguard-cat2-test.conf}
export AG_RUN_ID AG_RUN_DIR AG_GATEWAY_COMMIT AG_TRANSPORT
export AG_BOARD AG_MANAGEMENT_SOURCE_ADDRESS AG_TEST_CONFIG_REMOTE

verify_source_identity() {
    local allow_results_changes=$1
    python3 - "$REPOSITORY_ROOT" "$AG_GATEWAY_COMMIT" \
        "$EXPERIMENT_ROOT/results" "$allow_results_changes" <<'PYEOF'
import os
import subprocess
import sys

repository_root, expected_commit, results_directory, allow_results_changes = sys.argv[1:5]
observed_commit = subprocess.check_output(
    ["git", "-C", repository_root, "rev-parse", "HEAD"],
    text=True,
).strip()
if observed_commit != expected_commit:
    raise SystemExit("repository commit changed during campaign")

status_bytes = subprocess.check_output(
    ["git", "-C", repository_root, "status", "--porcelain=v1", "-z", "--untracked-files=all"]
)
status_records = status_bytes.split(b"\0")
results_relative_path = os.path.relpath(results_directory, repository_root).replace(os.sep, "/")
unexpected_changes = []
record_index = 0
while record_index < len(status_records):
    status_record = status_records[record_index]
    record_index += 1
    if not status_record:
        continue
    if len(status_record) < 4 or status_record[2:3] != b" ":
        raise SystemExit("cannot parse git porcelain status")
    status_code = status_record[:2].decode("ascii")
    changed_paths = [status_record[3:].decode("utf-8", "surrogateescape")]
    if "R" in status_code or "C" in status_code:
        if record_index >= len(status_records) or not status_records[record_index]:
            raise SystemExit("cannot parse renamed git path")
        changed_paths.append(status_records[record_index].decode("utf-8", "surrogateescape"))
        record_index += 1
    for changed_path in changed_paths:
        path_is_result = (
            changed_path == results_relative_path
            or changed_path.startswith(results_relative_path + "/")
        )
        if allow_results_changes != "true" or not path_is_result:
            unexpected_changes.append("%s %s" % (status_code, changed_path))
if unexpected_changes:
    raise SystemExit("source tree changed during campaign: %s" % unexpected_changes)
PYEOF
}

ag_remote() {
    timeout 25 ssh -b "$AG_MANAGEMENT_SOURCE_ADDRESS" \
        -o BatchMode=yes -o ConnectTimeout=8 "$AG_BOARD" "$@"
}

artifact_names=(gateway authorization-verifier authorization-common gateway-service)
artifact_local_paths=(
    "$EXPERIMENT_ROOT/cat2/scripts/ag-cat2-gateway"
    "$EXPERIMENT_ROOT/protocol/authorization/ag-auth-verify.py"
    "$EXPERIMENT_ROOT/protocol/authorization/ag_auth_common.py"
    "$EXPERIMENT_ROOT/cat2/systemd/aetherguard-cat2-gateway.service"
)
artifact_remote_paths=(
    /usr/local/sbin/ag-cat2-gateway
    /usr/local/sbin/ag-auth-verify.py
    /usr/local/sbin/ag_auth_common.py
    /etc/systemd/system/aetherguard-cat2-gateway.service
)
artifact_repository_paths=()
artifact_digests=()
gateway_config_digest=
test_config_digest=

verify_remote_deployment() {
    local artifact_index local_digest remote_digest observed_gateway_config_digest observed_test_config_digest
    for artifact_index in "${!artifact_names[@]}"; do
        local_digest=$(sha256sum "${artifact_local_paths[$artifact_index]}" | awk '{print $1}')
        remote_digest=$(ag_remote "sha256sum '${artifact_remote_paths[$artifact_index]}'" | awk '{print $1}')
        [[ "$local_digest" =~ ^[a-f0-9]{64}$ && "$remote_digest" == "$local_digest" ]] || {
            echo "FATAL: deployed artifact differs from repository: ${artifact_names[$artifact_index]}" >&2
            return 1
        }
        if [[ -n "${artifact_digests[$artifact_index]:-}" && "${artifact_digests[$artifact_index]}" != "$local_digest" ]]; then
            echo "FATAL: deployment artifact changed during campaign: ${artifact_names[$artifact_index]}" >&2
            return 1
        fi
        artifact_digests[$artifact_index]=$local_digest
        artifact_repository_paths[$artifact_index]=$(realpath --relative-to="$REPOSITORY_ROOT" "${artifact_local_paths[$artifact_index]}")
    done
    observed_gateway_config_digest=$(ag_remote "sha256sum '$AG_GATEWAY_CONFIG_REMOTE'" | awk '{print $1}')
    observed_test_config_digest=$(ag_remote "sha256sum '$AG_TEST_CONFIG_REMOTE'" | awk '{print $1}')
    [[ "$observed_gateway_config_digest" =~ ^[a-f0-9]{64}$ \
        && "$observed_test_config_digest" =~ ^[a-f0-9]{64}$ ]] || return 1
    [[ -z "$gateway_config_digest" || "$gateway_config_digest" == "$observed_gateway_config_digest" ]] || return 1
    [[ -z "$test_config_digest" || "$test_config_digest" == "$observed_test_config_digest" ]] || return 1
    gateway_config_digest=$observed_gateway_config_digest
    test_config_digest=$observed_test_config_digest
}

verify_source_identity false
verify_remote_deployment

mkdir -p -- "$(dirname "$AG_RUN_DIR")"
mkdir -m 0700 -- "$AG_RUN_DIR"
mkdir -m 0700 -- "$AG_RUN_DIR/evidence"

campaign_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 - "$AG_RUN_DIR/campaign.json" "$AG_RUN_ID" "$campaign_started_at" \
    "$AG_GATEWAY_COMMIT" "$AG_TRANSPORT" \
    "${artifact_repository_paths[0]}" "${artifact_remote_paths[0]}" "${artifact_digests[0]}" \
    "${artifact_repository_paths[1]}" "${artifact_remote_paths[1]}" "${artifact_digests[1]}" \
    "${artifact_repository_paths[2]}" "${artifact_remote_paths[2]}" "${artifact_digests[2]}" \
    "${artifact_repository_paths[3]}" "${artifact_remote_paths[3]}" "${artifact_digests[3]}" \
    "$AG_GATEWAY_CONFIG_REMOTE" "$gateway_config_digest" \
    "$AG_TEST_CONFIG_REMOTE" "$test_config_digest" <<'PYEOF'
import json
import os
import sys

campaign_path, run_id, started_at, gateway_commit, transport = sys.argv[1:6]
artifact_arguments = sys.argv[6:18]
gateway_config_path, gateway_config_digest, test_config_path, test_config_digest = sys.argv[18:22]
artifact_names = ("gateway", "authorization-verifier", "authorization-common", "gateway-service")
expected_tests = [
    ("a-usb-bridge-baseline", "connectivity"),
    ("b-isolated-multiprotocol", "isolation"),
    ("c-timed-release-expiry", "authorization"),
    ("repeated_release_timer_registration_failure_must_close_gate", "fault"),
    ("e-authorization-matrix", "authorization"),
    ("f01-helper-crash-after-gate-open", "fault"),
    ("f02-service-stop-lease-expiry", "fault"),
    ("f03-service-restart-isolates", "fault"),
    ("f06-post-reboot-topology", "reboot"),
    ("f07-reboot-during-release", "reboot"),
    ("f08-physical-power-cycle", "reboot"),
    ("eth0-eth1-inline-gateway", "topology"),
    ("ethernet-vlan-forwarding", "topology"),
    ("ethernet-phy-link-flap", "fault"),
    ("ethernet-gigabit-negotiation", "performance"),
    ("independent-physical-host-root-attacker", "isolation"),
    ("perf-throughput-latency", "performance"),
]
document = {
    "resultKind": "campaign",
    "schemaVersion": 1,
    "runId": run_id,
    "startedAt": started_at,
    "finishedAt": None,
    "complete": False,
    "gatewayCommit": gateway_commit,
    "transport": transport,
    "sourceTreeDirty": False,
    "deploymentArtifacts": [
        {
            "name": artifact_names[artifact_index],
            "repositoryPath": artifact_arguments[artifact_index * 3],
            "remotePath": artifact_arguments[artifact_index * 3 + 1],
            "sha256": artifact_arguments[artifact_index * 3 + 2],
        }
        for artifact_index in range(len(artifact_names))
    ],
    "runtimeConfiguration": {
        "gatewayConfigPath": gateway_config_path,
        "gatewayConfigSha256": gateway_config_digest,
        "testConfigPath": test_config_path,
        "testConfigSha256": test_config_digest,
    },
    "expectedTests": [
        {"testId": test_id, "category": category}
        for test_id, category in expected_tests
    ],
}
with open(campaign_path, "x", encoding="utf-8") as campaign_file:
    os.chmod(campaign_path, 0o600)
    json.dump(document, campaign_file, indent=2, sort_keys=True)
    campaign_file.write("\n")
    campaign_file.flush()
    os.fsync(campaign_file.fileno())
directory_descriptor = os.open(os.path.dirname(campaign_path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PYEOF

campaign_failed=0
run_case() {
    local permitted_exit_codes=$1
    shift
    local case_exit_code=0
    set +e
    "$@"
    case_exit_code=$?
    set -e
    if [[ ",$permitted_exit_codes," != *",$case_exit_code,"* ]]; then
        campaign_failed=1
    fi
}

run_case 0 "$EXPERIMENT_ROOT/tests/connectivity/test-a-bridge-baseline.sh"
run_case 0 "$EXPERIMENT_ROOT/tests/isolation/test-b-isolation.sh"
run_case 0 "$EXPERIMENT_ROOT/tests/authorization/test-c-timed-release.sh"
run_case 0 "$EXPERIMENT_ROOT/tests/authorization/test-d-repeated-release.sh"
run_case 0 "$EXPERIMENT_ROOT/tests/authorization/test-e-authorization.sh"
for fault_case in helper-crash service-stop service-restart; do
    run_case 0 "$EXPERIMENT_ROOT/tests/fault-injection/fault-matrix.sh" "$fault_case"
done
for unavailable_case in f06 f07 power-cycle physical-ethernet vlan phy-flap gigabit independent-host; do
    run_case 3,4 "$EXPERIMENT_ROOT/tests/not-run/record-unsupported-matrix.sh" "$unavailable_case"
done
run_case 4 "$EXPERIMENT_ROOT/tests/performance/perf-plan.sh"

verify_source_identity true
verify_remote_deployment
campaign_finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 - "$AG_RUN_DIR/campaign.json" "$AG_RUN_DIR" "$campaign_finished_at" <<'PYEOF'
import json
import os
import sys
import tempfile

campaign_path, run_directory, finished_at = sys.argv[1:4]
with open(campaign_path, "r", encoding="utf-8") as campaign_file:
    campaign = json.load(campaign_file)
expected_ids = {expected_test["testId"] for expected_test in campaign["expectedTests"]}
observed_ids = set()
for result_name in os.listdir(run_directory):
    if not result_name.endswith(".result.json"):
        continue
    result_path = os.path.join(run_directory, result_name)
    with open(result_path, "r", encoding="utf-8") as result_file:
        test_result = json.load(result_file)
    test_id = test_result.get("testId")
    if test_id in observed_ids:
        raise SystemExit("duplicate testId before campaign completion: %s" % test_id)
    observed_ids.add(test_id)
if observed_ids != expected_ids:
    raise SystemExit(
        "campaign incomplete missing=%s unexpected=%s"
        % (sorted(expected_ids - observed_ids), sorted(observed_ids - expected_ids))
    )
campaign["finishedAt"] = finished_at
campaign["complete"] = True
file_descriptor, temporary_path = tempfile.mkstemp(prefix=".campaign-complete.", dir=run_directory)
try:
    os.fchmod(file_descriptor, 0o600)
    with os.fdopen(file_descriptor, "w", encoding="utf-8") as temporary_file:
        json.dump(campaign, temporary_file, indent=2, sort_keys=True)
        temporary_file.write("\n")
        temporary_file.flush()
        os.fsync(temporary_file.fileno())
    os.replace(temporary_path, campaign_path)
    directory_descriptor = os.open(run_directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
except Exception:
    try:
        os.close(file_descriptor)
    except OSError:
        pass
    try:
        os.unlink(temporary_path)
    except OSError:
        pass
    raise
PYEOF

python3 "$EXPERIMENT_ROOT/scripts/generate-evidence.py" --run-id "$AG_RUN_ID"
python3 "$EXPERIMENT_ROOT/scripts/validate-results.py" --run-id "$AG_RUN_ID"
verify_source_identity true
verify_remote_deployment
echo "CAMPAIGN_COMPLETE runId=$AG_RUN_ID failedCases=$campaign_failed"
exit "$campaign_failed"
