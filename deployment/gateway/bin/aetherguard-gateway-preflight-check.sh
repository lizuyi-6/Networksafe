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

# READBACK VERIFICATION (audit 2026-08, N1-3): `nft -f` can exit 0 even when
# the kernel silently rejects parts of the batch — nft 1.0.9 does this when
# bridge-family support is missing, leaving the appliance with NO data-plane
# filter while the exit code says "success". Exit codes are not evidence here;
# our OWN tables must be readable back with the deny-forward chain loaded.
if ! "$NFT" list table bridge aetherguard >/dev/null 2>&1; then
    fail "table bridge aetherguard not present after apply — kernel bridge-family nftables may be missing (fail-closed)"
fi
if ! "$NFT" list chain bridge aetherguard forward 2>/dev/null | grep -q 'policy drop'; then
    fail "bridge aetherguard forward chain missing or not policy drop — isolation not verifiable"
fi
if ! "$NFT" list table inet aetherguard_mgmt >/dev/null 2>&1; then
    fail "table inet aetherguard_mgmt not present after apply — management plane filter missing"
fi

# Sanity: nft must be able to read the ruleset back (permissions/capabilities).
if ! "$NFT" list ruleset >/dev/null; then
    fail "nft list ruleset failed — check CAP_NET_ADMIN / nft permissions"
fi

echo "preflight: isolated_ruleset applied, bridge table + deny-forward chain + mgmt table verified by readback"
exit 0
