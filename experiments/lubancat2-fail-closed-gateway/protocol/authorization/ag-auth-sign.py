#!/usr/bin/env python3
"""Create an ECDSA P-256 + SHA-256 Cat2 release authorization."""

import argparse
import base64
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import time

from ag_auth_common import AUTHORIZATION_ACTION
from ag_auth_common import AUTHORIZATION_VERSION
from ag_auth_common import AuthorizationRejected
from ag_auth_common import SIGNATURE_ALGORITHM
from ag_auth_common import canonical_payload_bytes
from ag_auth_common import validate_payload_structure


def validate_private_key_permissions(private_key_path):
    private_key_stat = os.stat(private_key_path)
    if not stat.S_ISREG(private_key_stat.st_mode):
        raise AuthorizationRejected("private key is not a regular file")
    if private_key_stat.st_mode & 0o077:
        raise AuthorizationRejected("private key permissions must not grant group or other access")
    key_process = subprocess.run(
        ["openssl", "pkey", "-in", private_key_path, "-text", "-noout"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    key_description = key_process.stdout.decode("utf-8", errors="replace")
    if key_process.returncode != 0 or not (
        "ASN1 OID: prime256v1" in key_description or "NIST CURVE: P-256" in key_description
    ):
        raise AuthorizationRejected("private key must be ECDSA P-256")


def sign_payload(private_key_path, canonical_payload):
    message_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as message_file:
            message_file.write(canonical_payload)
            message_file.flush()
            message_path = message_file.name
        return subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", private_key_path, message_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout
    finally:
        if message_path is not None:
            try:
                os.unlink(message_path)
            except OSError:
                pass


def write_authorization_atomically(output_path, authorization_document):
    output_directory = os.path.dirname(os.path.abspath(output_path))
    temporary_file_descriptor, temporary_path = tempfile.mkstemp(
        prefix=".authorization.",
        dir=output_directory,
    )
    try:
        os.fchmod(temporary_file_descriptor, 0o600)
        with os.fdopen(temporary_file_descriptor, "w", encoding="utf-8") as output_file:
            temporary_file_descriptor = None
            json.dump(authorization_document, output_file, indent=2, ensure_ascii=False)
            output_file.write("\n")
            output_file.flush()
            os.fsync(output_file.fileno())
        os.replace(temporary_path, output_path)
        temporary_path = None
        directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_file_descriptor = os.open(output_directory, directory_flags)
        try:
            os.fsync(directory_file_descriptor)
        finally:
            os.close(directory_file_descriptor)
    finally:
        if temporary_file_descriptor is not None:
            os.close(temporary_file_descriptor)
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def build_argument_parser():
    argument_parser = argparse.ArgumentParser(description="sign a Cat2 release authorization")
    argument_parser.add_argument("--key", required=True, help="ECDSA P-256 private key PEM (0600)")
    argument_parser.add_argument("--gateway-id", required=True)
    argument_parser.add_argument("--server-interface", required=True)
    argument_parser.add_argument("--uplink-interface", required=True)
    argument_parser.add_argument(
        "--policy-digest",
        required=True,
        help="SHA-256 hex digest of the exact gateway config",
    )
    argument_parser.add_argument("--duration", type=int, required=True)
    argument_parser.add_argument(
        "--counter",
        type=int,
        required=True,
        help="monotonic counter; must be greater than the gateway high-water mark",
    )
    argument_parser.add_argument("--out", required=True, help="output JSON file")
    argument_parser.add_argument(
        "--issued-at",
        type=int,
        default=None,
        help="epoch seconds (default: now; explicit values are for tests)",
    )
    argument_parser.add_argument("--nonce", default=None, help="lowercase hexadecimal nonce")
    argument_parser.add_argument(
        "--maximum-duration",
        type=int,
        default=600,
        help="signer policy ceiling; must match or be below the gateway ceiling",
    )
    return argument_parser


def main():
    arguments = build_argument_parser().parse_args()
    try:
        validate_private_key_permissions(arguments.key)
        issued_at = arguments.issued_at if arguments.issued_at is not None else int(time.time())
        payload = {
            "version": AUTHORIZATION_VERSION,
            "gatewayId": arguments.gateway_id,
            "action": AUTHORIZATION_ACTION,
            "serverInterface": arguments.server_interface,
            "uplinkInterface": arguments.uplink_interface,
            "policyDigest": arguments.policy_digest,
            "nonce": arguments.nonce or os.urandom(16).hex(),
            "counter": arguments.counter,
            "issuedAt": issued_at,
            "expiresAt": issued_at + arguments.duration,
            "durationSeconds": arguments.duration,
        }
        validate_payload_structure(payload, arguments.maximum_duration)
        canonical_payload = canonical_payload_bytes(payload)
        signature_bytes = sign_payload(arguments.key, canonical_payload)
        authorization_document = {
            "payload": payload,
            "canonicalSha256": hashlib.sha256(canonical_payload).hexdigest(),
            "signatureAlgorithm": SIGNATURE_ALGORITHM,
            "signatureBase64": base64.b64encode(signature_bytes).decode("ascii"),
        }
        write_authorization_atomically(arguments.out, authorization_document)
    except (AuthorizationRejected, OSError, subprocess.CalledProcessError) as error:
        print("REFUSED: %s" % error, file=sys.stderr)
        return 2

    print(
        "wrote %s (counter=%d duration=%ds canonicalSha256=%s)"
        % (
            arguments.out,
            arguments.counter,
            arguments.duration,
            authorization_document["canonicalSha256"],
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
