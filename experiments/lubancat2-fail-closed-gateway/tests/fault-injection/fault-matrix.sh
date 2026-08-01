#!/bin/bash
# Safe hardware fault subset. Reboot, clock, firewall, route, and MAC faults are excluded.
set -Eeuo pipefail

case_name=${1:-all}
if [[ "$case_name" == "all" ]]; then
    echo "FATAL: use scripts/run-hardware-campaign.sh so all cases share immutable campaign metadata" >&2
    exit 2
fi

. "$(dirname "$0")/../../lib/test-lib.sh"
AG_TEST_CONFIG_REMOTE=${AG_TEST_CONFIG_REMOTE:-/root/aetherguard-cat2-test.conf}

record_status_evidence() {
    local status_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-status.json"
    ag_ssh "ag-cat2-gateway status" > "$status_path"
    ag_validate_gateway_status_file "$status_path"
    ag_add_evidence_file "$status_path"
}

assert_final_isolated() {
    local final_state final_timer_count
    final_state=$(ag_gate_state)
    final_timer_count=$(ag_ssh "ag-cat2-gateway status" \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["activeLeaseTimerCount"])')
    [[ "$final_state" == "isolated" && "$final_timer_count" == "0" ]]
}

restore_gateway_service_state() {
    local original_service_state=$1
    if [[ "$original_service_state" == "active" ]]; then
        ag_ssh "systemctl start aetherguard-cat2-gateway.service"
    else
        ag_ssh "systemctl stop aetherguard-cat2-gateway.service"
    fi
}

case "$case_name" in
    helper-crash)
        ag_begin_test \
            "f01-helper-crash-after-gate-open" \
            "fault" \
            "SIGKILL helper at after_gate_open failpoint; run reconcile; require isolated and zero timers"
        ag_ssh "ag-cat2-gateway isolate"
        test_mode_prefix="AG_TEST_MODE=1 AG_GATEWAY_CONFIG=$AG_TEST_CONFIG_REMOTE AG_STATE_DIR=/run/aetherguard-cat2 AG_SYS_CLASS_NET=/sys/class/net AG_TEST_COMMAND_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin AG_GATEWAY_EXECUTABLE=/usr/local/sbin/ag-cat2-gateway"
        set +e
        ag_ssh "$test_mode_prefix AG_TEST_FAILPOINT=after_gate_open AG_TEST_FAILPOINT_ACTION=kill ag-cat2-gateway release 8"
        helper_exit_code=$?
        set -e
        [[ "$helper_exit_code" -ne 0 ]] || {
            ag_finish_test FAILED 1 HELPER_SIGKILL_NOT_OBSERVED \
                "fault point terminates the release helper" \
                "fault-injected helper returned zero"
            exit 1
        }
        set +e
        ag_ssh "ag-cat2-gateway reconcile"
        reconcile_exit_code=$?
        set -e
        [[ "$reconcile_exit_code" -ne 0 ]] || {
            ag_finish_test FAILED 1 RECONCILE_DID_NOT_REPORT_INCOMPLETE_TRANSITION \
                "reconcile reports and closes the prepared open state" \
                "reconcile returned zero"
            exit 1
        }
        assert_final_isolated
        record_status_evidence
        ag_finish_test PASSED 0 HELPER_CRASH_RECONCILED_ISOLATED \
            "SIGKILL after gate_open leaves a prepared lease that reconcile closes" \
            "helperRc=$helper_exit_code reconcileRc=$reconcile_exit_code finalState=isolated timers=0"
        ;;
    service-stop)
        ag_begin_test \
            "f02-service-stop-lease-expiry" \
            "fault" \
            "release 6; stop aetherguard-cat2-gateway.service; wait for identified PID1 timer; require isolated"
        original_service_state=$(ag_ssh "systemctl is-active aetherguard-cat2-gateway.service || true")
        ag_register_cleanup restore_gateway_service_state "$original_service_state"
        ag_ssh "ag-cat2-gateway isolate"
        ag_ssh "ag-cat2-gateway release 6"
        ag_ssh "systemctl stop aetherguard-cat2-gateway.service"
        sleep 8
        assert_final_isolated
        record_status_evidence
        ag_management_available
        ag_finish_test PASSED 0 SERVICE_STOP_DID_NOT_CANCEL_EXPIRY \
            "stopping the oneshot service does not extend or cancel an active lease" \
            "after lease window state=isolated timers=0 managementAvailable=true"
        ;;
    service-restart)
        ag_begin_test \
            "f03-service-restart-isolates" \
            "fault" \
            "release 20; restart aetherguard-cat2-gateway.service; require immediate isolated and zero timers"
        ag_ssh "ag-cat2-gateway isolate"
        ag_ssh "ag-cat2-gateway release 20"
        ag_ssh "systemctl restart aetherguard-cat2-gateway.service"
        assert_final_isolated
        record_status_evidence
        ag_management_available
        ag_finish_test PASSED 0 SERVICE_RESTART_FORCED_ISOLATION \
            "service restart executes isolate then reconcile" \
            "finalState=isolated timers=0 managementAvailable=true"
        ;;
    *)
        echo "usage: $0 {all|helper-crash|service-stop|service-restart}" >&2
        exit 2
        ;;
esac
