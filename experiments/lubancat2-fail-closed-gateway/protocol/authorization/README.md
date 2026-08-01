# Cat2 authorization protocol

The operator signs network-release documents with **ECDSA P-256 + SHA-256**.
The private key remains untracked on the operator machine with mode `0600`.
Only the public key is installed on the Cat2.

## Canonical payload

The signature input is project-defined canonical JSON:

- UTF-8 encoding;
- object keys sorted by Python's string ordering;
- compact separators `,` and `:`;
- no insignificant whitespace;
- no non-finite numbers;
- an exact payload field set containing only strings and bounded integers.

This profile is deliberately **not** described as complete RFC 8785. The
golden-vector test fixes both canonical bytes and SHA-256 across the operator
and Cat2 Python versions.

## Signed fields

```text
version, gatewayId, action, serverInterface, uplinkInterface,
policyDigest, nonce, counter, issuedAt, expiresAt, durationSeconds
```

The outer document additionally has exact values for `canonicalSha256`,
`signatureAlgorithm`, and strict base64 `signatureBase64`. Duplicate JSON keys,
unknown fields, `NaN`, and infinities are rejected.

Security integers use `type(value) is int`; JSON booleans, floats, numeric
strings, negatives, zero duration, duration above the configured maximum, and
counters above `2^53-1` are rejected.

## Counter ordering

The verifier uses the stable lock:

```text
/var/lib/aetherguard-cat2/authorizer-counter.lock
```

While holding it, the verifier validates the complete document, reads the
high-water mark, requires a strictly greater counter, writes a same-directory
temporary file with mode `0600`, flushes and fsyncs it, atomically replaces the
counter file, and fsyncs the directory. Only then does it call
`ag-cat2-gateway release`.

Release failure consumes the counter and triggers `isolate`; the same document
cannot be retried. This intentionally permits loss of one authorization but
not repeated consumption after an ambiguous side effect.

The file counter is not hardware anti-rollback and does not resist Cat2 root,
storage replacement, or Cat2 kernel compromise.

## Key generation and signing

```bash
openssl ecparam -name prime256v1 -genkey -noout \
  -out keys/authorizer-private.pem
chmod 600 keys/authorizer-private.pem
openssl ec -in keys/authorizer-private.pem -pubout \
  -out keys/authorizer-public.pem

python3 ag-auth-sign.py \
  --key keys/authorizer-private.pem \
  --gateway-id cat2-gateway-01 \
  --server-interface usb1 \
  --uplink-interface usb2 \
  --policy-digest "$(sha256sum /etc/aetherguard-cat2.conf | awk '{print $1}')" \
  --duration 60 --counter 1 --out authorization.json
```

The signer validates the same exact payload bounds and writes the document
atomically. It refuses unsafe private-key permissions.

## Tests

`tests/unit/test_authorization.py` covers strict types, all signed-field
mutations, malformed/base64/signature cases, replay/rollback/equal counters,
expiry/future timestamps, concurrent same/increasing counters, release failure
consumption, replace/fsync failures, and the canonical golden vector. The
hardware campaign additionally verifies the deployed Cat2 verifier and real
counter ordering.
