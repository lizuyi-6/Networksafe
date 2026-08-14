#!/bin/bash
#
# AetherGuard Gateway Appliance — systemd ExecStartPre preflight check
#
# SECURITY FIX (audit 2026-08, DP-006): the systemd unit has referenced
# /usr/local/bin/aetherguard-gateway-preflight-check since it was written, but
# install.sh never installed the binary — every service start depended on an
# operator hand-rolling it, so the "apply isolated ruleset before the daemon
# runs" guarantee was missing in practice (only ExecStopPost + Restart were
# left as backstops).
#
# This script provides the guarantee: exit 0 ONLY when the isolated ruleset is
# verifiably loaded. systemd refuses to start the daemon otherwise
# (ExecStartPre failure), which is the fail-closed outcome.
#
# Exits: 0 = isolated ruleset applied and nft usable; 1 = anything else.

set -euo pipefail

NFT="${NFT_BIN:-/usr/sbin/nft}"
ISOLATED="/etc/aetherguard/nftables/isolated_ruleset.nft"

fail() {
    echo "preflight: $1" >&2
    exit 1
}

[ -x "$NFT" ] || fail "nftables binary not found at $NFT"
[ -f "$ISOLATED" ] || fail "isolated ruleset missing at $ISOLATED"

# Apply the isolated (deny-forward) ruleset BEFORE the daemon starts.
if ! "$NFT" -f "$ISOLATED"; then
    fail "could not apply isolated_ruleset.nft — refusing to start the daemon"
fi

# Sanity: nft must be able to read the ruleset back (permissions/capabilities).
if ! "$NFT" list ruleset >/dev/null; then
    fail "nft list ruleset failed — check CAP_NET_ADMIN / nft permissions"
fi

echo "preflight: isolated_ruleset applied and verified (fail-closed baseline set)"
exit 0
