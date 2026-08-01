# Authorization prototype (phase 10)

ECDSA P-256 signed, time-boxed, counter-protected release authorizations.

## Files

- `ag-auth-sign.py` - runs on the OPERATOR machine; creates signed JSON.
- `ag-auth-verify.py` - installed on the Cat2 at `/usr/local/sbin/`; verifies
  and releases.
- `keys/` - local only. Private key: `authorizer-private.pem` (0600,
  gitignored, NEVER committed). Public key: committed and installed on the
  Cat2 at `/etc/aetherguard-cat2/authorizer-public.pem`.

## Key generation (operator machine, offline)

```bash
openssl ecparam -genkey -name prime256v1 -noout -out keys/authorizer-private.pem
chmod 600 keys/authorizer-private.pem
openssl pkey -in keys/authorizer-private.pem -pubout -out keys/authorizer-public.pem
```

Algorithm: **ECDSA P-256 + SHA-256** (openssl `dgst -sha256 -sign/-verify`),
chosen over Ed25519 because the Cat2's OpenSSL 1.1.1n (Debian buster) cannot
perform Ed25519 verify operations at all (`pkeyutl` reports "operation not
supported for this keytype", verified 2026-08-01). The `dgst` path is the
only CLI flow verified to behave identically on 1.1.1n (Cat2) and 3.x
(operator laptop); `pkeyutl` ECDSA digest mode breaks across the two.

## Authorization document

```json
{
  "version": 1, "gatewayId": "cat2-gateway-01", "action": "network_release",
  "serverInterface": "...", "uplinkInterface": "...",
  "policyDigest": "<sha256 of /etc/aetherguard-cat2.conf>",
  "nonce": "<>=16 hex chars>", "counter": 1,
  "issuedAt": <epoch>, "expiresAt": <epoch>, "durationSeconds": 60
}
```

Signature: ECDSA P-256 + SHA-256 over the canonical payload (sorted keys,
minimal separators, UTF-8). Both signer (py3.13) and verifier (py3.7) use
`json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=False)`
so canonical bytes match exactly.

## Honest scope

- The monotonic counter file is plain root-owned state on the Cat2: it
  resists the UNTRUSTED protected host; it does NOT resist Cat2 root and is
  NOT hardware anti-rollback. A future Secure-Element design replaces it.
- Verification order: signature first (binds everything), then fields, then
  counter, then release for the REMAINING authorized time only.
