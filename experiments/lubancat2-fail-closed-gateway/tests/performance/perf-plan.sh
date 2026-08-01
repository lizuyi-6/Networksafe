#!/bin/bash
# Performance is intentionally not run without an independent peer and Ethernet cabling.
set -Eeuo pipefail
. "$(dirname "$0")/../../lib/test-lib.sh"

ag_begin_test \
    "perf-throughput-latency" \
    "performance" \
    "NOT_RUN: requires independent iperf3 peer and physical Ethernet transport"
ag_add_note "No throughput, latency percentile, CPU, duplex, or gigabit value was measured."
ag_finish_test NOT_RUN 4 PERFORMANCE_PREREQUISITES_ABSENT \
    "independent physical peer, Ethernet cables, and a reviewed performance protocol" \
    "current transport is USB RNDIS and no independent iperf3 peer is available"
