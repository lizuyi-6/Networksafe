#!/bin/bash
# TEST E - authorization protocol: Ed25519-signed release authorizations.
# Fully local (no cables needed): runs the verifier on the Cat2 against a
# battery of valid/tampered/replayed/expired authorizations.
# Prereq: keys generated (see protocol/authorization/README) and the public
# key installed at /etc/aetherguard-cat2/authorizer-public.pem on the Cat2.
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=e-authorization
AG_AUTH_DIR=${AG_AUTH_DIR:-$AG_ROOT/protocol/authorization}
KEY_PRIV=${KEY_PRIV:-$AG_AUTH_DIR/keys/authorizer-private.pem}
COUNTER_FILE_LOCAL=/tmp/ag-auth-counter

next_counter() {
    local last
    last=$(cat "$COUNTER_FILE_LOCAL" 2>/dev/null || echo 0)
    echo $((last + 1)) | tee "$COUNTER_FILE_LOCAL"
}

sign_and_try() {  # sign_and_try <case-name> <extra sign args...> ; expects verifier exit code on stdout
    local name="$1"; shift
    local out="/tmp/ag-auth-$name.json"
    python3 "$AG_AUTH_DIR/ag-auth-sign.py" --key "$KEY_PRIV" \
        --gateway-id cat2-gateway-01 \
        --server-interface "$AG_SERVER_IF" --uplink-interface "$AG_UPLINK_IF" \
        --policy-digest "$(ag_ssh 'sha256sum /etc/aetherguard-cat2.conf' | awk '{print $1}')" \
        --duration 60 --counter "$(next_counter)" --out "$out" "$@" >/dev/null 2>&1
    scp -q -o BatchMode=yes "$out" board:/tmp/auth-under-test.json
    ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?"
}

tamper_and_try() {  # tamper_and_try <case-name> <jq-style python expr on payload>
    local name="$1" expr="$2" out="/tmp/ag-auth-$name.json"
    python3 "$AG_AUTH_DIR/ag-auth-sign.py" --key "$KEY_PRIV" \
        --gateway-id cat2-gateway-01 \
        --server-interface "$AG_SERVER_IF" --uplink-interface "$AG_UPLINK_IF" \
        --policy-digest "$(ag_ssh 'sha256sum /etc/aetherguard-cat2.conf' | awk '{print $1}')" \
        --duration 60 --counter "$(next_counter)" --out "/tmp/ag-auth-base.json" >/dev/null 2>&1
    python3 - "/tmp/ag-auth-base.json" "$out" "$expr" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
exec(sys.argv[3])
json.dump(doc, open(sys.argv[2], "w"))
PY
    scp -q -o BatchMode=yes "$out" board:/tmp/auth-under-test.json
    ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?"
}

{
  echo "# TEST E authorization $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ag_ssh "ag-cat2-gateway isolate"

  echo "## case: valid authorization (expect RC=0, release happens)"
  sign_and_try valid | tee /tmp/ag-e-valid.txt
  ag_ssh "ag-cat2-gateway isolate"   # close again after success

  echo "## tamper cases (expect RC=2 reject for all)"
  tamper_and_try tamper-duration   "doc['payload']['durationSeconds']=600"
  tamper_and_try tamper-interface  "doc['payload']['serverInterface']='eth9'"
  tamper_and_try tamper-gatewayid  "doc['payload']['gatewayId']='evil-gateway'"
  tamper_and_try tamper-digest     "doc['payload']['policyDigest']='0'*64"
  tamper_and_try tamper-expires    "doc['payload']['expiresAt']=doc['payload']['expiresAt']+3600"
  tamper_and_try tamper-nonce      "doc['payload']['nonce']='aa'*16"
  tamper_and_try tamper-counter    "doc['payload']['counter']=doc['payload']['counter']+100"
  tamper_and_try forged-signature  "doc['signatureBase64']='QUJD'*22"

  echo "## structural rejection cases (valid signature, bad semantics)"
  python3 "$AG_AUTH_DIR/ag-auth-sign.py" --key "$KEY_PRIV" --gateway-id cat2-gateway-01 \
      --server-interface "$AG_SERVER_IF" --uplink-interface "$AG_UPLINK_IF" \
      --policy-digest "$(ag_ssh 'sha256sum /etc/aetherguard-cat2.conf' | awk '{print $1}')" \
      --duration 601 --counter "$(next_counter)" --out /tmp/ag-auth-overdur.json >/dev/null 2>&1
  scp -q -o BatchMode=yes /tmp/ag-auth-overdur.json board:/tmp/auth-under-test.json
  ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?" | sed 's/^/over-duration: /'

  echo "## replay: reuse the previously-accepted authorization (expect RC=2)"
  scp -q -o BatchMode=yes /tmp/ag-auth-valid.json board:/tmp/auth-under-test.json
  ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?" | sed 's/^/replay: /'

  echo "## counter rollback: sign with an old counter (expect RC=2)"
  python3 "$AG_AUTH_DIR/ag-auth-sign.py" --key "$KEY_PRIV" --gateway-id cat2-gateway-01 \
      --server-interface "$AG_SERVER_IF" --uplink-interface "$AG_UPLINK_IF" \
      --policy-digest "$(ag_ssh 'sha256sum /etc/aetherguard-cat2.conf' | awk '{print $1}')" \
      --duration 60 --counter 1 --out /tmp/ag-auth-rollback.json >/dev/null 2>&1
  scp -q -o BatchMode=yes /tmp/ag-auth-rollback.json board:/tmp/auth-under-test.json
  ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?" | sed 's/^/counter-rollback: /'

  echo "## expired authorization (issued 2h ago, duration 60s) (expect RC=2)"
  python3 "$AG_AUTH_DIR/ag-auth-sign.py" --key "$KEY_PRIV" --gateway-id cat2-gateway-01 \
      --server-interface "$AG_SERVER_IF" --uplink-interface "$AG_UPLINK_IF" \
      --policy-digest "$(ag_ssh 'sha256sum /etc/aetherguard-cat2.conf' | awk '{print $1}')" \
      --duration 60 --counter "$(next_counter)" --issued-at $(( $(date +%s) - 7200 )) \
      --out /tmp/ag-auth-expired.json >/dev/null 2>&1
  scp -q -o BatchMode=yes /tmp/ag-auth-expired.json board:/tmp/auth-under-test.json
  ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?" | sed 's/^/expired: /'

  echo "## future issuedAt (expect RC=2)"
  python3 "$AG_AUTH_DIR/ag-auth-sign.py" --key "$KEY_PRIV" --gateway-id cat2-gateway-01 \
      --server-interface "$AG_SERVER_IF" --uplink-interface "$AG_UPLINK_IF" \
      --policy-digest "$(ag_ssh 'sha256sum /etc/aetherguard-cat2.conf' | awk '{print $1}')" \
      --duration 60 --counter "$(next_counter)" --issued-at $(( $(date +%s) + 3600 )) \
      --out /tmp/ag-auth-future.json >/dev/null 2>&1
  scp -q -o BatchMode=yes /tmp/ag-auth-future.json board:/tmp/auth-under-test.json
  ag_ssh "python3 /usr/local/sbin/ag-auth-verify.py /tmp/auth-under-test.json; echo VERIFIER_RC=\$?" | sed 's/^/future-issuedAt: /'

  ag_ssh "ag-cat2-gateway status"
} 2>&1 | ag_log "$TEST_PREFIX"
