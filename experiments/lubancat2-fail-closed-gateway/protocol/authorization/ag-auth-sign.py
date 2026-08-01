#!/usr/bin/env python3
# ag-auth-sign.py - create a signed AetherGuard Cat2 network-release authorization.
# Runs OFFLINE on the operator machine (protected host). Private key never
# leaves this machine and is never committed (see .gitignore).
#
# Canonical form: RFC8785-style minimal JSON (sorted keys, no whitespace,
# UTF-8) implemented with the stdlib so signer (py3.13) and verifier
# (py3.7 on the Cat2) produce byte-identical output.
import argparse, base64, json, os, subprocess, sys, time

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")

def main():
    ap = argparse.ArgumentParser(description="sign a Cat2 release authorization")
    ap.add_argument("--key", required=True, help="Ed25519 private key PEM (0600)")
    ap.add_argument("--gateway-id", required=True)
    ap.add_argument("--server-interface", required=True)
    ap.add_argument("--uplink-interface", required=True)
    ap.add_argument("--policy-digest", required=True,
                    help="sha256 hex of the gateway config the release applies to")
    ap.add_argument("--duration", type=int, required=True)
    ap.add_argument("--counter", type=int, required=True,
                    help="monotonic counter; must be > last counter used on the gateway")
    ap.add_argument("--out", required=True, help="output JSON file")
    ap.add_argument("--issued-at", type=int, default=None, help="epoch (default: now) - testing only")
    ap.add_argument("--nonce", default=None, help="hex nonce (default: random 16B)")
    args = ap.parse_args()

    issued = args.issued_at if args.issued_at is not None else int(time.time())
    payload = {
        "version": 1,
        "gatewayId": args.gateway_id,
        "action": "network_release",
        "serverInterface": args.server_interface,
        "uplinkInterface": args.uplink_interface,
        "policyDigest": args.policy_digest,
        "nonce": args.nonce or os.urandom(16).hex(),
        "counter": args.counter,
        "issuedAt": issued,
        "expiresAt": issued + args.duration,
        "durationSeconds": args.duration,
    }
    blob = canonical(payload)
    sig = subprocess.run(
        ["openssl", "pkeyutl", "-sign", "-inkey", args.key, "-rawin"],
        input=blob, stdout=subprocess.PIPE, check=True).stdout
    doc = {"payload": payload,
           "canonicalSha256": __import__("hashlib").sha256(blob).hexdigest(),
           "signatureAlgorithm": "Ed25519 (RFC 8032, pureEdDSA)",
           "signatureBase64": base64.b64encode(sig).decode()}
    with open(args.out, "w") as fh:
        json.dump(doc, fh, indent=2)
    os.chmod(args.out, 0o600)
    print("wrote %s (counter=%d duration=%ds)" % (args.out, args.counter, args.duration))

if __name__ == "__main__":
    main()
