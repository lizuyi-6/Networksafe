#!/usr/bin/env python3
# ag-auth-verify.py - verify a signed release authorization ON THE CAT2 and,
# if every check passes, execute `ag-cat2-gateway release <duration>`.
#
# Security notes (honest scope):
#   * public key pinned in /etc/aetherguard-cat2/ (root-owned, 0644);
#   * counter file is local root-owned state with atomic update - it resists
#     the UNTRUSTED protected host, it does NOT resist a compromised Cat2 root
#     (no hardware anti-rollback exists on this board);
#   * every field is bound into the signature, so any mutation invalidates it.
#
# Exit codes: 0=accepted+released, 2=rejected (policy/signature), 1=error.
import json, os, subprocess, sys, tempfile, time, fcntl

CONF = "/etc/aetherguard-cat2.conf"

def load_conf(path):
    out = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                out[key.strip()] = val.strip()
    return out

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")

def reject(reason):
    print(json.dumps({"accepted": False, "reason": reason}))
    sys.exit(2)

def main():
    if len(sys.argv) != 2:
        print("usage: ag-auth-verify.py <authorization.json>", file=sys.stderr)
        sys.exit(1)
    conf = load_conf(CONF)
    gateway_id = conf.get("AG_GATEWAY_ID", "cat2-gateway-01")
    pubkey = conf.get("AG_AUTHZ_PUBKEY", "/etc/aetherguard-cat2/authorizer-public.pem")
    counter_file = conf.get("AG_COUNTER_FILE", "/var/lib/aetherguard-cat2/authorizer-counter")
    max_duration = int(conf.get("MAX_RELEASE_SECONDS", "600"))

    try:
        doc = json.load(open(sys.argv[1]))
        payload = doc["payload"]
        sig = __import__("base64").b64decode(doc["signatureBase64"])
    except Exception as exc:
        reject("malformed authorization document: %s" % exc)

    # 1) signature over the canonical payload (binds ALL fields at once)
    blob = canonical(payload)
    # ECDSA P-256 + SHA-256 via pkeyutl digest mode (openssl 1.1.1 + 3.x).
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tf.write(sig); sig_path = tf.name
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tf.write(blob); msg_path = tf.name
    base = ["openssl", "pkeyutl", "-verify", "-pubin",
            "-inkey", pubkey, "-pkeyopt", "digest:sha256",
            "-in", msg_path, "-sigfile", sig_path]
    try:
        rc = subprocess.run(base, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL).returncode
    finally:
        os.unlink(sig_path)
        os.unlink(msg_path)
    if rc != 0:
        reject("signature verification failed")

    # 2) field-level policy checks
    now = int(time.time())
    if payload.get("version") != 1:                     reject("unsupported version")
    if payload.get("action") != "network_release":      reject("unsupported action")
    if payload.get("gatewayId") != gateway_id:          reject("gatewayId mismatch")
    if payload.get("serverInterface") != conf.get("SERVER_IF"): reject("serverInterface mismatch")
    if payload.get("uplinkInterface") != conf.get("UPLINK_IF"): reject("uplinkInterface mismatch")
    digest = subprocess.check_output(["sha256sum", CONF]).decode().split()[0]
    if payload.get("policyDigest") != digest:           reject("policyDigest mismatch (gateway config changed)")
    duration = payload.get("durationSeconds")
    if not isinstance(duration, int) or duration < 1 or duration > max_duration:
        reject("duration out of range [1,%d]" % max_duration)
    issued = payload.get("issuedAt"); expires = payload.get("expiresAt")
    if not isinstance(issued, int) or not isinstance(expires, int): reject("bad timestamps")
    if expires - issued != duration:                    reject("expiresAt-issuedAt != durationSeconds")
    if issued > now + 60:                               reject("issuedAt is in the future")
    if now >= expires:                                  reject("authorization expired")
    nonce = payload.get("nonce", "")
    if not isinstance(nonce, str) or len(nonce) < 16:   reject("nonce too short")

    # 3) monotonic counter (anti replay / anti rollback) - atomic under flock
    os.makedirs(os.path.dirname(counter_file), exist_ok=True)
    fd = os.open(counter_file, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        raw = os.read(fd, 64).decode().strip() or "0"
        last = int(raw)
        counter = payload.get("counter")
        if not isinstance(counter, int) or counter <= last:
            reject("counter rollback or replay (counter=%s last=%d)" % (counter, last))
        # 4) all checks passed -> release for the REMAINING authorized time
        remaining = expires - now
        rc = subprocess.run(["/usr/local/sbin/ag-cat2-gateway", "release",
                             str(remaining)]).returncode
        if rc != 0:
            reject("gateway release failed rc=%d" % rc)
        os.lseek(fd, 0, os.SEEK_SET); os.ftruncate(fd, 0)
        os.write(fd, str(counter).encode())
    finally:
        os.close(fd)

    print(json.dumps({"accepted": True, "counter": counter,
                      "releasedSeconds": remaining,
                      "note": "lease enforced by PID1 timer; see ag-cat2-gateway"}))
    sys.exit(0)

if __name__ == "__main__":
    main()
