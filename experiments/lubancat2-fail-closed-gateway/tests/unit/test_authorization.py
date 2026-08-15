#!/usr/bin/env python3
"""Ordinary-Linux regression tests for the Cat2 authorization protocol."""

import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
AUTHORIZATION_ROOT = os.path.join(EXPERIMENT_ROOT, "protocol", "authorization")
sys.path.insert(0, AUTHORIZATION_ROOT)

from ag_auth_common import AuthorizationRejected
from ag_auth_common import CounterPersistenceError
from ag_auth_common import DurableCounterStore
from ag_auth_common import MAX_SAFE_INTEGER
from ag_auth_common import SIGNATURE_ALGORITHM
from ag_auth_common import canonical_payload_bytes


VERIFIER_SPEC = importlib.util.spec_from_file_location(
    "ag_auth_verify",
    os.path.join(AUTHORIZATION_ROOT, "ag-auth-verify.py"),
)
VERIFIER = importlib.util.module_from_spec(VERIFIER_SPEC)
VERIFIER_SPEC.loader.exec_module(VERIFIER)


class AuthorizationProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.private_key_path = os.path.join(self.test_root, "authorizer-private.pem")
        self.public_key_path = os.path.join(self.test_root, "authorizer-public.pem")
        self.counter_path = os.path.join(self.test_root, "authorizer-counter")
        self.counter_lock_path = os.path.join(self.test_root, "authorizer-counter.lock")
        self.config_path = os.path.join(self.test_root, "gateway.conf")
        self.current_epoch = 1_700_000_000
        self.gateway_commands = []

        subprocess.run(
            [
                "openssl",
                "ecparam",
                "-name",
                "prime256v1",
                "-genkey",
                "-noout",
                "-out",
                self.private_key_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.chmod(self.private_key_path, 0o600)
        subprocess.run(
            [
                "openssl",
                "ec",
                "-in",
                self.private_key_path,
                "-pubout",
                "-out",
                self.public_key_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.write_config()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_config(self):
        with open(self.config_path, "w", encoding="ascii") as config_file:
            config_file.write("SERVER_IF=usb1\n")
            config_file.write("UPLINK_IF=usb2\n")
            config_file.write("BRIDGE_IF=br0\n")
            config_file.write("MAX_RELEASE_SECONDS=600\n")
            config_file.write("AG_GATEWAY_ID=cat2-gateway-01\n")
            config_file.write("AG_AUTHZ_PUBKEY=%s\n" % self.public_key_path)
            config_file.write("AG_COUNTER_FILE=%s\n" % self.counter_path)
            config_file.write("AG_COUNTER_LOCK_FILE=%s\n" % self.counter_lock_path)

    def policy_digest(self):
        with open(self.config_path, "rb") as config_file:
            return hashlib.sha256(config_file.read()).hexdigest()

    def build_payload(self, counter=1, **overrides):
        payload = {
            "version": 1,
            "gatewayId": "cat2-gateway-01",
            "action": "network_release",
            "serverInterface": "usb1",
            "uplinkInterface": "usb2",
            "policyDigest": self.policy_digest(),
            "nonce": "00112233445566778899aabbccddeeff",
            "counter": counter,
            "issuedAt": self.current_epoch,
            "expiresAt": self.current_epoch + 60,
            "durationSeconds": 60,
        }
        payload.update(overrides)
        return payload

    def sign_payload(self, payload):
        canonical_payload = canonical_payload_bytes(payload)
        message_path = os.path.join(self.test_root, "message-%s.bin" % os.urandom(4).hex())
        with open(message_path, "wb") as message_file:
            message_file.write(canonical_payload)
        try:
            signature_bytes = subprocess.run(
                [
                    "openssl",
                    "dgst",
                    "-sha256",
                    "-sign",
                    self.private_key_path,
                    message_path,
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            ).stdout
        finally:
            os.unlink(message_path)
        return {
            "payload": payload,
            "canonicalSha256": hashlib.sha256(canonical_payload).hexdigest(),
            "signatureAlgorithm": SIGNATURE_ALGORITHM,
            "signatureBase64": base64.b64encode(signature_bytes).decode("ascii"),
        }

    def write_document(self, document, name="authorization.json", allow_nan=False):
        document_path = os.path.join(self.test_root, name)
        with open(document_path, "w", encoding="utf-8") as document_file:
            json.dump(document, document_file, allow_nan=allow_nan)
        return document_path

    def run_command(self, command, **subprocess_arguments):
        if command[0] == "openssl":
            return subprocess.run(command, **subprocess_arguments)
        self.gateway_commands.append(command)
        return subprocess.CompletedProcess(command, 0)

    def process_document(self, document, name="authorization.json", **process_overrides):
        document_path = self.write_document(document, name=name)
        arguments = {
            "authorization_path": document_path,
            "config_path": self.config_path,
            "gateway_executable": "/test/ag-cat2-gateway",
            "current_time_function": lambda: self.current_epoch,
            "run_command": self.run_command,
        }
        arguments.update(process_overrides)
        return VERIFIER.process_authorization(**arguments)

    def test_golden_vector_canonical_bytes_and_digest(self):
        golden_payload = {
            "version": 1,
            "gatewayId": "cat2-gateway-01",
            "action": "network_release",
            "serverInterface": "usb1",
            "uplinkInterface": "usb2",
            "policyDigest": "0" * 64,
            "nonce": "00112233445566778899aabbccddeeff",
            "counter": 42,
            "issuedAt": 1_700_000_000,
            "expiresAt": 1_700_000_060,
            "durationSeconds": 60,
        }
        expected_canonical_text = (
            '{"action":"network_release","counter":42,"durationSeconds":60,'
            '"expiresAt":1700000060,"gatewayId":"cat2-gateway-01",'
            '"issuedAt":1700000000,"nonce":"00112233445566778899aabbccddeeff",'
            '"policyDigest":"%s","serverInterface":"usb1",'
            '"uplinkInterface":"usb2","version":1}' % ("0" * 64)
        )
        canonical_bytes = canonical_payload_bytes(golden_payload)
        self.assertEqual(canonical_bytes, expected_canonical_text.encode("utf-8"))
        self.assertEqual(
            hashlib.sha256(canonical_bytes).hexdigest(),
            "8a01142d6054b95ee93ec83a7d9378c631e903140bffed4a03bd207ae97f9fb3",
        )

    def test_valid_authorization_persists_counter_before_release(self):
        document = self.sign_payload(self.build_payload(counter=1))

        def ordering_command(command, **subprocess_arguments):
            if command[0] == "openssl":
                return subprocess.run(command, **subprocess_arguments)
            if command[1] == "release-authorized":
                with open(self.counter_path, "r", encoding="ascii") as counter_file:
                    self.assertEqual(counter_file.read(), "1\n")
            self.gateway_commands.append(command)
            return subprocess.CompletedProcess(command, 0)

        result = self.process_document(document, run_command=ordering_command)
        self.assertTrue(result["accepted"])
        self.assertTrue(result["counterPersistedBeforeRelease"])
        self.assertEqual(
            self.gateway_commands,
            [[
                "/test/ag-cat2-gateway",
                "release-authorized",
                "60",
                str(self.current_epoch + 60),
                self.policy_digest(),
                "cat2-gateway-01",
                "usb1",
                "usb2",
            ]],
        )

    def test_tampering_each_bound_payload_field_breaks_signature(self):
        original_payload = self.build_payload(counter=1)
        original_document = self.sign_payload(original_payload)
        mutations = {
            "gatewayId": "other-gateway",
            "action": "isolate",
            "serverInterface": "eth0",
            "uplinkInterface": "eth1",
            "policyDigest": "1" * 64,
            "durationSeconds": 59,
            "issuedAt": self.current_epoch - 1,
            "expiresAt": self.current_epoch + 59,
            "nonce": "ffeeddccbbaa99887766554433221100",
            "counter": 2,
        }
        for field_name, mutated_value in mutations.items():
            with self.subTest(field_name=field_name):
                mutated_document = json.loads(json.dumps(original_document))
                mutated_document["payload"][field_name] = mutated_value
                mutated_canonical = canonical_payload_bytes(mutated_document["payload"])
                mutated_document["canonicalSha256"] = hashlib.sha256(mutated_canonical).hexdigest()
                with self.assertRaises(AuthorizationRejected):
                    self.process_document(mutated_document, name="tamper-%s.json" % field_name)

    def test_strict_integer_fields_reject_bool_float_string_and_out_of_range(self):
        invalid_payloads = [
            self.build_payload(version=True),
            self.build_payload(durationSeconds=True, expiresAt=self.current_epoch + 1),
            self.build_payload(durationSeconds=1.5, expiresAt=self.current_epoch + 60),
            self.build_payload(durationSeconds="60"),
            self.build_payload(durationSeconds=0, expiresAt=self.current_epoch),
            self.build_payload(durationSeconds=601, expiresAt=self.current_epoch + 601),
            self.build_payload(counter=True),
            self.build_payload(counter="1"),
            self.build_payload(counter=-1),
            self.build_payload(counter=MAX_SAFE_INTEGER + 1),
            self.build_payload(issuedAt="1700000000"),
            self.build_payload(expiresAt="1700000060"),
        ]
        for sequence_number, invalid_payload in enumerate(invalid_payloads):
            with self.subTest(sequence_number=sequence_number):
                invalid_document = self.sign_payload(invalid_payload)
                with self.assertRaises(AuthorizationRejected):
                    self.process_document(invalid_document, name="strict-%02d.json" % sequence_number)

    def test_malformed_json_non_finite_values_and_duplicate_keys_reject(self):
        malformed_path = os.path.join(self.test_root, "malformed.json")
        with open(malformed_path, "w", encoding="utf-8") as malformed_file:
            malformed_file.write("{not-json")
        with self.assertRaises(AuthorizationRejected):
            VERIFIER.process_authorization(
                malformed_path,
                config_path=self.config_path,
                gateway_executable="/test/ag-cat2-gateway",
                current_time_function=lambda: self.current_epoch,
                run_command=self.run_command,
            )

        duplicate_path = os.path.join(self.test_root, "duplicate.json")
        with open(duplicate_path, "w", encoding="utf-8") as duplicate_file:
            duplicate_file.write('{"payload":{},"payload":{},"canonicalSha256":"%s",'
                                 '"signatureAlgorithm":"%s","signatureBase64":"AA=="}'
                                 % ("0" * 64, SIGNATURE_ALGORITHM))
        with self.assertRaisesRegex(AuthorizationRejected, "duplicate JSON object key"):
            VERIFIER.process_authorization(
                duplicate_path,
                config_path=self.config_path,
                gateway_executable="/test/ag-cat2-gateway",
                current_time_function=lambda: self.current_epoch,
                run_command=self.run_command,
            )

        non_finite_document = self.sign_payload(self.build_payload())
        non_finite_document["payload"]["durationSeconds"] = float("nan")
        non_finite_path = self.write_document(non_finite_document, "nan.json", allow_nan=True)
        with self.assertRaisesRegex(AuthorizationRejected, "non-finite JSON"):
            VERIFIER.process_authorization(
                non_finite_path,
                config_path=self.config_path,
                gateway_executable="/test/ag-cat2-gateway",
                current_time_function=lambda: self.current_epoch,
                run_command=self.run_command,
            )

    def test_empty_invalid_and_modified_signatures_reject(self):
        for signature_value in ("", "not@@base64", base64.b64encode(b"modified").decode("ascii")):
            with self.subTest(signature_value=signature_value):
                document = self.sign_payload(self.build_payload())
                document["signatureBase64"] = signature_value
                with self.assertRaises(AuthorizationRejected):
                    self.process_document(document, name="signature-%s.json" % len(signature_value))

    def test_replay_equal_and_rollback_counters_reject(self):
        self.process_document(self.sign_payload(self.build_payload(counter=3)), name="counter-3.json")
        for rejected_counter in (3, 2, 1):
            with self.subTest(rejected_counter=rejected_counter):
                with self.assertRaisesRegex(AuthorizationRejected, "counter rollback or replay"):
                    self.process_document(
                        self.sign_payload(self.build_payload(counter=rejected_counter)),
                        name="counter-%d-retry.json" % rejected_counter,
                    )

    def test_expired_and_future_authorizations_reject(self):
        expired_payload = self.build_payload(
            issuedAt=self.current_epoch - 120,
            expiresAt=self.current_epoch - 60,
        )
        future_payload = self.build_payload(
            issuedAt=self.current_epoch + 61,
            expiresAt=self.current_epoch + 121,
        )
        for case_name, payload in (("expired", expired_payload), ("future", future_payload)):
            with self.subTest(case_name=case_name):
                with self.assertRaises(AuthorizationRejected):
                    self.process_document(self.sign_payload(payload), name=case_name + ".json")

    def test_release_failure_consumes_counter_and_forces_isolation(self):
        document = self.sign_payload(self.build_payload(counter=7))

        def failing_release_command(command, **subprocess_arguments):
            if command[0] == "openssl":
                return subprocess.run(command, **subprocess_arguments)
            self.gateway_commands.append(command)
            if command[1] == "release-authorized":
                return subprocess.CompletedProcess(command, 1)
            return subprocess.CompletedProcess(command, 0)

        with self.assertRaisesRegex(AuthorizationRejected, "counter consumed"):
            self.process_document(document, run_command=failing_release_command)
        with open(self.counter_path, "r", encoding="ascii") as counter_file:
            self.assertEqual(counter_file.read(), "7\n")
        self.assertEqual(
            self.gateway_commands,
            [
                [
                    "/test/ag-cat2-gateway",
                    "release-authorized",
                    "60",
                    str(self.current_epoch + 60),
                    self.policy_digest(),
                    "cat2-gateway-01",
                    "usb1",
                    "usb2",
                ],
                ["/test/ag-cat2-gateway", "isolate"],
            ],
        )
        with self.assertRaisesRegex(AuthorizationRejected, "counter rollback or replay"):
            self.process_document(document, name="failed-release-retry.json")

    def test_counter_replace_failure_prevents_gateway_release(self):
        document = self.sign_payload(self.build_payload(counter=1))

        def failing_counter_store(counter_path, lock_path):
            def fail_replace(source_path, destination_path):
                raise OSError("injected replace failure")

            return DurableCounterStore(
                counter_path,
                lock_path,
                replace_function=fail_replace,
            )

        with self.assertRaisesRegex(CounterPersistenceError, "injected replace failure"):
            self.process_document(document, counter_store_factory=failing_counter_store)
        self.assertEqual(self.gateway_commands, [])
        self.assertFalse(os.path.exists(self.counter_path))

    def test_directory_fsync_failure_returns_error_without_release(self):
        document = self.sign_payload(self.build_payload(counter=9))

        def failing_counter_store(counter_path, lock_path):
            fsync_call_count = {"value": 0}

            def fail_directory_fsync(file_descriptor):
                fsync_call_count["value"] += 1
                if fsync_call_count["value"] == 2:
                    raise OSError("injected directory fsync failure")
                os.fsync(file_descriptor)

            return DurableCounterStore(
                counter_path,
                lock_path,
                fsync_function=fail_directory_fsync,
            )

        with self.assertRaisesRegex(CounterPersistenceError, "directory fsync failure"):
            self.process_document(document, counter_store_factory=failing_counter_store)
        self.assertEqual(self.gateway_commands, [])
        with open(self.counter_path, "r", encoding="ascii") as counter_file:
            self.assertEqual(counter_file.read(), "9\n")

    def test_expiry_after_counter_persistence_consumes_without_release(self):
        document = self.sign_payload(self.build_payload(counter=10))
        observed_times = iter([self.current_epoch, self.current_epoch + 60.1])
        with self.assertRaisesRegex(AuthorizationRejected, "expired after counter consumption"):
            self.process_document(
                document,
                current_time_function=lambda: next(observed_times),
            )
        self.assertEqual(self.gateway_commands, [])
        with open(self.counter_path, "r", encoding="ascii") as counter_file:
            self.assertEqual(counter_file.read(), "10\n")

    def test_counter_and_lock_aliases_are_rejected(self):
        same_path_store = DurableCounterStore(self.counter_path, self.counter_path)
        with self.assertRaisesRegex(CounterPersistenceError, "must be distinct"):
            with same_path_store.locked():
                pass

        symlink_target = os.path.join(self.test_root, "lock-target")
        with open(symlink_target, "w", encoding="ascii") as target_file:
            target_file.write("lock\n")
        os.symlink(symlink_target, self.counter_lock_path)
        symlink_store = DurableCounterStore(self.counter_path, self.counter_lock_path)
        with self.assertRaises(CounterPersistenceError):
            with symlink_store.locked():
                pass

    def test_signer_rejects_non_p256_private_key(self):
        p384_private_key_path = os.path.join(self.test_root, "p384-private.pem")
        subprocess.run(
            [
                "openssl",
                "ecparam",
                "-name",
                "secp384r1",
                "-genkey",
                "-noout",
                "-out",
                p384_private_key_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.chmod(p384_private_key_path, 0o600)
        output_path = os.path.join(self.test_root, "p384-authorization.json")
        signer_process = subprocess.run(
            [
                "python3",
                os.path.join(AUTHORIZATION_ROOT, "ag-auth-sign.py"),
                "--key",
                p384_private_key_path,
                "--gateway-id",
                "cat2-gateway-01",
                "--server-interface",
                "usb1",
                "--uplink-interface",
                "usb2",
                "--policy-digest",
                self.policy_digest(),
                "--duration",
                "60",
                "--counter",
                "1",
                "--out",
                output_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(signer_process.returncode, 2)
        self.assertIn("private key must be ECDSA P-256", signer_process.stderr)

    def test_concurrent_submission_of_same_counter_accepts_only_one(self):
        document = self.sign_payload(self.build_payload(counter=11))
        document_path = self.write_document(document, "concurrent-same.json")
        outcomes = []
        outcomes_lock = threading.Lock()

        def worker():
            try:
                VERIFIER.process_authorization(
                    document_path,
                    config_path=self.config_path,
                    gateway_executable="/test/ag-cat2-gateway",
                    current_time_function=lambda: self.current_epoch,
                    run_command=self.run_command,
                )
                outcome = "accepted"
            except AuthorizationRejected:
                outcome = "rejected"
            with outcomes_lock:
                outcomes.append(outcome)

        workers = [threading.Thread(target=worker) for _ in range(2)]
        for worker_thread in workers:
            worker_thread.start()
        for worker_thread in workers:
            worker_thread.join(timeout=10)
        self.assertEqual(sorted(outcomes), ["accepted", "rejected"])

    def test_concurrent_increasing_counters_serialize_in_order(self):
        first_document_path = self.write_document(
            self.sign_payload(self.build_payload(counter=20)),
            "counter-20.json",
        )
        second_document_path = self.write_document(
            self.sign_payload(self.build_payload(counter=21)),
            "counter-21.json",
        )
        first_release_started = threading.Event()
        allow_first_release_to_finish = threading.Event()
        outcomes = []

        def ordered_run_command(command, **subprocess_arguments):
            if command[0] == "openssl":
                return subprocess.run(command, **subprocess_arguments)
            if command[1] == "release-authorized" and not first_release_started.is_set():
                first_release_started.set()
                allow_first_release_to_finish.wait(timeout=10)
            return subprocess.CompletedProcess(command, 0)

        def worker(document_path):
            try:
                result = VERIFIER.process_authorization(
                    document_path,
                    config_path=self.config_path,
                    gateway_executable="/test/ag-cat2-gateway",
                    current_time_function=lambda: self.current_epoch,
                    run_command=ordered_run_command,
                )
                outcomes.append(result["counter"])
            except Exception as error:
                outcomes.append(type(error).__name__)

        first_worker = threading.Thread(target=worker, args=(first_document_path,))
        second_worker = threading.Thread(target=worker, args=(second_document_path,))
        first_worker.start()
        self.assertTrue(first_release_started.wait(timeout=10))
        second_worker.start()
        allow_first_release_to_finish.set()
        first_worker.join(timeout=10)
        second_worker.join(timeout=10)
        self.assertEqual(outcomes, [20, 21])


if __name__ == "__main__":
    unittest.main(verbosity=2)
