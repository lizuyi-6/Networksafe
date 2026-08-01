# Authorization prototype (phase 10)

Ed25519-signed, time-boxed, counter-protected release authorizations.

## Files

- `ag-auth-sign.py` - runs on the OPERATOR machine; creates signed JSON.
- `ag-auth-verify.py` - installed on the Cat2 at `/usr/local/sbin/`; verifies
  and releases.
- `keys/` - local only. Private key: `authorizer-private.pem` (0600,
  gitignored, NEVER committed). Public key: committed and installed on the
  Cat2 at `/etc/aetherguard-cat2/authorizer-public.pem`.

## Key generation (operator machine, offline)

```bash
openssl genpkey -algorithm ed25519 -out keys/authorizer-private.pem
chmod 600 keys/authorizer-private.pem
openssl pkey -in keys/authorizer-private.pem -pubout -out keys/authorizer-public.pem
```

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

Signature: Ed25519 pureEdDSA over the canonical payload (sorted keys,
minimal separators, UTF-8). Both signer (py3.13) and verifier (py3.7) use
`json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=False)`
so canonical bytes match exactly.

## Honest scope

- The monotonic counter file is plain root-owned state on the Cat2: it
  resists the UNTRUSTED protected host; it does NOT resist Cat2 root and is
  NOT hardware anti-rollback. A future Secure-Element design replaces it.
- Verification order: signature first (binds everything), then fields, then
  counter, then release for the REMAINING authorized time only.
