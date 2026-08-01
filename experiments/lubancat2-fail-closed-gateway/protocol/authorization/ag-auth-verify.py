#!/usr/bin/env python3
"""Verify and consume a signed Cat2 network-release authorization.

The monotonic counter is atomically persisted and fsynced before the gateway
release is attempted. A release failure burns the counter and never rolls it
back, preventing reuse after an ambiguous network-side effect.
"""

import base64
import binascii
import hashlib
import hmac
import json
import math
import os
import stat
import subprocess
import sys
import tempfile
import time

from ag_auth_common import AuthorizationError
from ag_auth_common import AuthorizationRejected
from ag_auth_common import CounterPersistenceError
from ag_auth_common import DurableCounterStore
from ag_auth_common import MAX_SAFE_INTEGER
from ag_auth_common import canonical_payload_bytes
from ag_auth_common import load_strict_json_bytes
from ag_auth_common import parse_simple_config_bytes
from ag_auth_common import require_exact_integer
from ag_auth_common import validate_authorization_document
from ag_auth_common import validate_payload_policy


CONFIG_PATH = "/etc/aetherguard-cat2.conf"
DEFAULT_PUBLIC_KEY_PATH = "/etc/aetherguard-cat2/authorizer-public.pem"
DEFAULT_COUNTER_PATH = "/var/lib/aetherguard-cat2/authorizer-counter"
DEFAULT_COUNTER_LOCK_PATH = "/var/lib/aetherguard-cat2/authorizer-counter.lock"
DEFAULT_GATEWAY_EXECUTABLE = "/usr/local/sbin/ag-cat2-gateway"
MAX_AUTHORIZATION_DOCUMENT_BYTES = 65536
MAX_CONFIG_BYTES = 65536


def read_regular_file_snapshot(file_path, description, minimum_bytes, maximum_bytes):
    """Read one regular, non-symlink file identity into an immutable snapshot."""
    try:
        path_stat = os.lstat(file_path)
    except OSError as error:
        raise AuthorizationRejected("%s cannot be inspected: %s" % (description, error))
    if not stat.S_ISREG(path_stat.st_mode):
        raise AuthorizationRejected("%s must be a regular non-symlink file" % description)
    if path_stat.st_size < minimum_bytes or path_stat.st_size > maximum_bytes:
        raise AuthorizationRejected("%s size is outside the accepted range" % description)

    open_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        file_descriptor = os.open(file_path, open_flags)
    except OSError as error:
        raise AuthorizationRejected("%s cannot be opened safely: %s" % (description, error))
    try:
        opened_stat = os.fstat(file_descriptor)
        if not stat.S_ISREG(opened_stat.st_mode):
            raise AuthorizationRejected("%s opened object is not a regular file" % description)
        if (path_stat.st_dev, path_stat.st_ino) != (opened_stat.st_dev, opened_stat.st_ino):
            raise AuthorizationRejected("%s changed while it was opened" % description)
        file_chunks = []
        bytes_read = 0
        while True:
            file_chunk = os.read(file_descriptor, min(65536, maximum_bytes + 1 - bytes_read))
            if not file_chunk:
                break
            file_chunks.append(file_chunk)
            bytes_read += len(file_chunk)
            if bytes_read > maximum_bytes:
                raise AuthorizationRejected("%s exceeds the size limit" % description)
        final_stat = os.fstat(file_descriptor)
        if (opened_stat.st_dev, opened_stat.st_ino, opened_stat.st_size) != (
            final_stat.st_dev,
            final_stat.st_ino,
            final_stat.st_size,
        ):
            raise AuthorizationRejected("%s changed while it was read" % description)
    finally:
        os.close(file_descriptor)

    file_bytes = b"".join(file_chunks)
    if len(file_bytes) < minimum_bytes or len(file_bytes) > maximum_bytes:
        raise AuthorizationRejected("%s size is outside the accepted range" % description)
    return file_bytes


def verify_p256_public_key(public_key_path, run_command):
    try:
        key_process = run_command(
            ["openssl", "pkey", "-pubin", "-in", public_key_path, "-text", "-noout"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except OSError as error:
        raise AuthorizationError("public key inspection failed: %s" % error)
    key_description = key_process.stdout.decode("utf-8", errors="replace")
    if key_process.returncode != 0 or not (
        "ASN1 OID: prime256v1" in key_description or "NIST CURVE: P-256" in key_description
    ):
        raise AuthorizationError("authorization public key is not ECDSA P-256")


def verify_ecdsa_signature(public_key_path, canonical_payload, signature_base64, run_command):
    try:
        signature_bytes = base64.b64decode(signature_base64, validate=True)
    except (binascii.Error, ValueError, TypeError) as error:
        raise AuthorizationRejected("signatureBase64 is invalid: %s" % error)
    if not signature_bytes:
        raise AuthorizationRejected("signature is empty")
    if len(signature_bytes) < 64 or len(signature_bytes) > 80:
        raise AuthorizationRejected("signature DER length is invalid for ECDSA P-256")

    signature_path = None
    message_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as signature_file:
            signature_file.write(signature_bytes)
            signature_file.flush()
            signature_path = signature_file.name
        with tempfile.NamedTemporaryFile(delete=False) as message_file:
            message_file.write(canonical_payload)
            message_file.flush()
            message_path = message_file.name

        verification_process = run_command(
            [
                "openssl",
                "dgst",
                "-sha256",
                "-verify",
                public_key_path,
                "-signature",
                signature_path,
                message_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as error:
        raise AuthorizationError("signature verifier execution failed: %s" % error)
    finally:
        if signature_path is not None:
            try:
                os.unlink(signature_path)
            except OSError:
                pass
        if message_path is not None:
            try:
                os.unlink(message_path)
            except OSError:
                pass

    if verification_process.returncode != 0:
        raise AuthorizationRejected("signature verification failed")


def parse_maximum_duration(configuration):
    maximum_duration_text = configuration.get("MAX_RELEASE_SECONDS", "600")
    if not maximum_duration_text.isdigit() or maximum_duration_text.startswith("0"):
        raise AuthorizationError("MAX_RELEASE_SECONDS is not a canonical positive integer")
    maximum_duration_seconds = int(maximum_duration_text)
    if maximum_duration_seconds < 1 or maximum_duration_seconds > 86400:
        raise AuthorizationError("MAX_RELEASE_SECONDS is outside the safety range")
    return maximum_duration_seconds


def run_gateway_release(gateway_executable, release_seconds, payload, run_command):
    try:
        return run_command(
            [
                gateway_executable,
                "release-authorized",
                str(release_seconds),
                payload["policyDigest"],
                payload["gatewayId"],
                payload["serverInterface"],
                payload["uplinkInterface"],
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
    except OSError as error:
        raise AuthorizationError("gateway release execution failed: %s" % error)


def force_gateway_isolated(gateway_executable, run_command):
    try:
        return run_command(
            [gateway_executable, "isolate"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
    except OSError:
        return 1


def process_authorization(
    authorization_path,
    config_path=CONFIG_PATH,
    gateway_executable=DEFAULT_GATEWAY_EXECUTABLE,
    current_time_function=time.time,
    run_command=subprocess.run,
    counter_store_factory=DurableCounterStore,
):
    """Validate, durably consume, and execute one authorization."""
    config_bytes = read_regular_file_snapshot(
        config_path,
        "gateway config",
        2,
        MAX_CONFIG_BYTES,
    )
    configuration = parse_simple_config_bytes(config_bytes, config_path)
    maximum_duration_seconds = parse_maximum_duration(configuration)
    public_key_path = configuration.get("AG_AUTHZ_PUBKEY", DEFAULT_PUBLIC_KEY_PATH)
    counter_path = configuration.get("AG_COUNTER_FILE", DEFAULT_COUNTER_PATH)
    counter_lock_path = configuration.get("AG_COUNTER_LOCK_FILE", DEFAULT_COUNTER_LOCK_PATH)
    counter_store = counter_store_factory(counter_path, counter_lock_path)
    authorization_bytes = read_regular_file_snapshot(
        authorization_path,
        "authorization input",
        2,
        MAX_AUTHORIZATION_DOCUMENT_BYTES,
    )
    document = load_strict_json_bytes(authorization_bytes)
    validate_authorization_document(document, maximum_duration_seconds)
    payload = document["payload"]
    canonical_payload = canonical_payload_bytes(payload)

    calculated_canonical_digest = hashlib.sha256(canonical_payload).hexdigest()
    if not hmac.compare_digest(document["canonicalSha256"], calculated_canonical_digest):
        raise AuthorizationRejected("canonicalSha256 mismatch")
    verify_p256_public_key(public_key_path, run_command)
    verify_ecdsa_signature(
        public_key_path,
        canonical_payload,
        document["signatureBase64"],
        run_command,
    )

    expected_policy_digest = hashlib.sha256(config_bytes).hexdigest()
    if not hmac.compare_digest(payload["policyDigest"], expected_policy_digest):
        raise AuthorizationRejected("policyDigest mismatch (gateway config changed)")

    with counter_store.locked():
        current_epoch = int(current_time_function())
        validate_payload_policy(
            payload,
            configuration,
            current_epoch,
            maximum_duration_seconds,
        )
        previous_counter = counter_store.read_counter()
        authorization_counter = require_exact_integer(
            "counter",
            payload["counter"],
            1,
            MAX_SAFE_INTEGER,
        )
        if authorization_counter <= previous_counter:
            raise AuthorizationRejected(
                "counter rollback or replay (counter=%d last=%d)"
                % (authorization_counter, previous_counter)
            )

        # Security ordering: consume durably first. Never roll back on release failure.
        counter_store.persist_counter(authorization_counter)
        release_time = float(current_time_function())
        remaining_seconds = min(
            payload["durationSeconds"],
            math.floor(payload["expiresAt"] - release_time),
        )
        if remaining_seconds < 1:
            raise AuthorizationRejected(
                "authorization expired after counter consumption and before release"
            )
        release_exit_code = run_gateway_release(
            gateway_executable,
            remaining_seconds,
            payload,
            run_command,
        )
        if release_exit_code != 0:
            isolation_exit_code = force_gateway_isolated(gateway_executable, run_command)
            raise AuthorizationRejected(
                "gateway release failed rc=%d; counter consumed; isolate rc=%d"
                % (release_exit_code, isolation_exit_code)
            )

    return {
        "accepted": True,
        "counter": authorization_counter,
        "releasedSeconds": remaining_seconds,
        "counterPersistedBeforeRelease": True,
        "note": "lease enforced by identified PID1 timer; see ag-cat2-gateway",
    }


def main():
    if len(sys.argv) != 2:
        print("usage: ag-auth-verify.py <authorization.json>", file=sys.stderr)
        return 1
    config_path = CONFIG_PATH
    if os.environ.get("AG_TEST_MODE") == "1":
        config_path = os.environ.get("AG_GATEWAY_CONFIG", "")
        if not config_path:
            print(json.dumps({"accepted": False, "error": "AG_GATEWAY_CONFIG is required in test mode"}, sort_keys=True), file=sys.stderr)
            return 1
    try:
        result = process_authorization(sys.argv[1], config_path=config_path)
    except AuthorizationRejected as error:
        print(json.dumps({"accepted": False, "reason": str(error)}, sort_keys=True))
        return 2
    except (AuthorizationError, CounterPersistenceError) as error:
        print(json.dumps({"accepted": False, "error": str(error)}, sort_keys=True), file=sys.stderr)
        return 1
    except Exception as error:
        print(json.dumps({"accepted": False, "error": "unexpected verifier error: %s" % error}, sort_keys=True), file=sys.stderr)
        return 1

    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
