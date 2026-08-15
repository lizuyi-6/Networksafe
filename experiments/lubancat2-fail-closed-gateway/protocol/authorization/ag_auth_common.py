#!/usr/bin/env python3
"""Shared authorization schema, canonicalization, and durable counter storage."""

import contextlib
import fcntl
import json
import os
import re
import stat
import tempfile


AUTHORIZATION_VERSION = 1
AUTHORIZATION_ACTION = "network_release"
SIGNATURE_ALGORITHM = "ECDSA P-256 + SHA-256 (openssl dgst)"
MAX_SAFE_INTEGER = (2 ** 53) - 1
MAX_CLOCK_SKEW_SECONDS = 60

DOCUMENT_FIELDS = {
    "payload",
    "canonicalSha256",
    "signatureAlgorithm",
    "signatureBase64",
}

PAYLOAD_FIELDS = {
    "version",
    "gatewayId",
    "action",
    "serverInterface",
    "uplinkInterface",
    "policyDigest",
    "nonce",
    "counter",
    "issuedAt",
    "expiresAt",
    "durationSeconds",
}

SAFE_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
NONCE_PATTERN = re.compile(r"^[a-f0-9]{32,128}$")
CONFIG_LINE_PATTERN = re.compile(r"^([A-Z][A-Z0-9_]*)=([^\s]+)$")
COUNTER_PATTERN = re.compile(r"^(0|[1-9][0-9]*)\n?$")


class AuthorizationError(Exception):
    """Base class for authorization input and persistence failures."""


class AuthorizationRejected(AuthorizationError):
    """A well-formed request that must be rejected by policy."""


class CounterPersistenceError(AuthorizationError):
    """Counter state could not be read or made durable."""


def reject_non_finite_json(constant_name):
    """Reject NaN and infinity extensions accepted by Python's JSON parser."""
    raise AuthorizationRejected("non-finite JSON value is forbidden: %s" % constant_name)


def reject_duplicate_object_keys(object_pairs):
    """Construct an object while rejecting duplicate JSON member names."""
    parsed_object = {}
    for object_key, object_value in object_pairs:
        if object_key in parsed_object:
            raise AuthorizationRejected("duplicate JSON object key: %s" % object_key)
        parsed_object[object_key] = object_value
    return parsed_object


def load_strict_json_bytes(document_bytes, source_label="authorization document"):
    """Load UTF-8 JSON bytes with duplicate and non-finite values rejected."""
    try:
        document_text = document_bytes.decode("utf-8")
        return json.loads(
            document_text,
            object_pairs_hook=reject_duplicate_object_keys,
            parse_constant=reject_non_finite_json,
        )
    except AuthorizationRejected:
        raise
    except (UnicodeError, ValueError) as error:
        raise AuthorizationRejected("malformed %s: %s" % (source_label, error))


def load_strict_json_document(document_path):
    """Load one authorization file snapshot using the strict JSON profile."""
    try:
        with open(document_path, "rb") as document_file:
            document_bytes = document_file.read()
    except OSError as error:
        raise AuthorizationRejected("malformed authorization document: %s" % error)
    return load_strict_json_bytes(document_bytes)


def canonical_payload_bytes(payload):
    """Return project-defined canonical JSON bytes for a validated payload.

    The project profile is UTF-8, sorted object keys, compact separators, and
    no insignificant whitespace. It is deliberately not described as RFC 8785.
    """
    try:
        canonical_text = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise AuthorizationRejected("payload cannot be canonicalized: %s" % error)
    return canonical_text.encode("utf-8")


def require_exact_integer(field_name, field_value, minimum_value, maximum_value):
    """Validate a security integer without accepting bool, float, or strings."""
    if type(field_value) is not int:
        raise AuthorizationRejected("%s must be an integer" % field_name)
    if field_value < minimum_value or field_value > maximum_value:
        raise AuthorizationRejected(
            "%s must be in [%d,%d]" % (field_name, minimum_value, maximum_value)
        )
    return field_value


def require_identifier(field_name, field_value):
    if type(field_value) is not str or not SAFE_IDENTIFIER_PATTERN.fullmatch(field_value):
        raise AuthorizationRejected("%s is invalid" % field_name)
    return field_value


def validate_payload_structure(payload, maximum_duration_seconds):
    """Validate exact payload fields, strict types, and context-free bounds."""
    if type(payload) is not dict:
        raise AuthorizationRejected("payload must be a JSON object")
    if set(payload) != PAYLOAD_FIELDS:
        missing_fields = sorted(PAYLOAD_FIELDS - set(payload))
        unknown_fields = sorted(set(payload) - PAYLOAD_FIELDS)
        raise AuthorizationRejected(
            "payload field set mismatch missing=%s unknown=%s"
            % (missing_fields, unknown_fields)
        )

    version = require_exact_integer(
        "version", payload["version"], AUTHORIZATION_VERSION, AUTHORIZATION_VERSION
    )
    if version != AUTHORIZATION_VERSION:
        raise AuthorizationRejected("unsupported version")
    if type(payload["action"]) is not str or payload["action"] != AUTHORIZATION_ACTION:
        raise AuthorizationRejected("unsupported action")

    require_identifier("gatewayId", payload["gatewayId"])
    require_identifier("serverInterface", payload["serverInterface"])
    require_identifier("uplinkInterface", payload["uplinkInterface"])

    if type(payload["policyDigest"]) is not str or not SHA256_PATTERN.fullmatch(payload["policyDigest"]):
        raise AuthorizationRejected("policyDigest must be 64 lowercase hexadecimal characters")
    if type(payload["nonce"]) is not str or not NONCE_PATTERN.fullmatch(payload["nonce"]):
        raise AuthorizationRejected("nonce must be 16-64 bytes encoded as lowercase hexadecimal")

    duration_seconds = require_exact_integer(
        "durationSeconds",
        payload["durationSeconds"],
        1,
        maximum_duration_seconds,
    )
    require_exact_integer("counter", payload["counter"], 1, MAX_SAFE_INTEGER)
    issued_at = require_exact_integer("issuedAt", payload["issuedAt"], 0, MAX_SAFE_INTEGER)
    expires_at = require_exact_integer("expiresAt", payload["expiresAt"], 0, MAX_SAFE_INTEGER)
    if expires_at - issued_at != duration_seconds:
        raise AuthorizationRejected("expiresAt-issuedAt must equal durationSeconds")
    return payload


def validate_authorization_document(document, maximum_duration_seconds):
    if type(document) is not dict:
        raise AuthorizationRejected("authorization document must be a JSON object")
    if set(document) != DOCUMENT_FIELDS:
        missing_fields = sorted(DOCUMENT_FIELDS - set(document))
        unknown_fields = sorted(set(document) - DOCUMENT_FIELDS)
        raise AuthorizationRejected(
            "authorization document field set mismatch missing=%s unknown=%s"
            % (missing_fields, unknown_fields)
        )
    if type(document["signatureAlgorithm"]) is not str or document["signatureAlgorithm"] != SIGNATURE_ALGORITHM:
        raise AuthorizationRejected("signatureAlgorithm mismatch")
    if type(document["canonicalSha256"]) is not str or not SHA256_PATTERN.fullmatch(document["canonicalSha256"]):
        raise AuthorizationRejected("canonicalSha256 is invalid")
    if type(document["signatureBase64"]) is not str or not document["signatureBase64"]:
        raise AuthorizationRejected("signatureBase64 must be a non-empty string")
    validate_payload_structure(document["payload"], maximum_duration_seconds)
    return document


def validate_payload_policy(payload, configuration, current_epoch, maximum_duration_seconds):
    """Validate gateway binding and time policy using a fresh locked time."""
    validate_payload_structure(payload, maximum_duration_seconds)
    expected_values = {
        "gatewayId": configuration.get("AG_GATEWAY_ID", "cat2-gateway-01"),
        "serverInterface": configuration.get("SERVER_IF"),
        "uplinkInterface": configuration.get("UPLINK_IF"),
    }
    for field_name, expected_value in expected_values.items():
        if payload[field_name] != expected_value:
            raise AuthorizationRejected("%s mismatch" % field_name)
    if payload["issuedAt"] > current_epoch + MAX_CLOCK_SKEW_SECONDS:
        raise AuthorizationRejected("issuedAt is in the future")
    if current_epoch >= payload["expiresAt"]:
        raise AuthorizationRejected("authorization expired")


def parse_simple_config_bytes(config_bytes, source_label):
    """Parse the gateway's strict unquoted KEY=value grammar from one snapshot."""
    configuration = {}
    try:
        config_text = config_bytes.decode("ascii")
    except UnicodeError as error:
        raise AuthorizationError("cannot decode config snapshot: %s" % error)
    for line_number, config_line in enumerate(config_text.splitlines(), start=1):
        if not config_line or config_line.lstrip().startswith("#"):
            continue
        match = CONFIG_LINE_PATTERN.fullmatch(config_line)
        if not match:
            raise AuthorizationError(
                "invalid config syntax at %s:%d" % (source_label, line_number)
            )
        config_key, config_value = match.groups()
        if config_key in configuration:
            raise AuthorizationError("duplicate config key: %s" % config_key)
        configuration[config_key] = config_value
    return configuration


def load_simple_config(config_path):
    """Read one config snapshot using the gateway's strict grammar."""
    try:
        with open(config_path, "rb") as config_file:
            config_bytes = config_file.read()
    except OSError as error:
        raise AuthorizationError("cannot read config: %s" % error)
    return parse_simple_config_bytes(config_bytes, config_path)


class DurableCounterStore:
    """Serialize and atomically persist a monotonic authorization counter."""

    def __init__(
        self,
        counter_path,
        lock_path,
        fsync_function=os.fsync,
        replace_function=os.replace,
    ):
        self.counter_path = counter_path
        self.lock_path = lock_path
        self.fsync_function = fsync_function
        self.replace_function = replace_function
        self.lock_file_descriptor = None

    def validate_paths(self):
        counter_directory = os.path.realpath(os.path.dirname(self.counter_path))
        lock_directory = os.path.realpath(os.path.dirname(self.lock_path))
        canonical_counter_path = os.path.join(counter_directory, os.path.basename(self.counter_path))
        canonical_lock_path = os.path.join(lock_directory, os.path.basename(self.lock_path))
        if counter_directory != lock_directory:
            raise CounterPersistenceError("counter and lock must use the same directory")
        if canonical_counter_path == canonical_lock_path:
            raise CounterPersistenceError("counter and lock paths must be distinct")
        return counter_directory

    def ensure_counter_directory(self, counter_directory):
        if os.path.exists(counter_directory):
            directory_stat = os.stat(counter_directory)
            if not stat.S_ISDIR(directory_stat.st_mode):
                raise CounterPersistenceError("counter parent is not a directory")
            if directory_stat.st_uid != os.geteuid() or directory_stat.st_mode & 0o022:
                raise CounterPersistenceError("counter directory ownership or permissions are unsafe")
            return

        parent_directory = os.path.dirname(counter_directory)
        if not os.path.isdir(parent_directory):
            raise CounterPersistenceError("counter parent directory must be provisioned")
        os.mkdir(counter_directory, 0o700)
        parent_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        parent_file_descriptor = os.open(parent_directory, parent_flags)
        try:
            self.fsync_function(parent_file_descriptor)
        finally:
            os.close(parent_file_descriptor)

    @contextlib.contextmanager
    def locked(self):
        counter_directory = self.validate_paths()
        try:
            self.ensure_counter_directory(counter_directory)
            lock_open_flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
            self.lock_file_descriptor = os.open(
                self.lock_path,
                lock_open_flags,
                0o600,
            )
            lock_stat = os.fstat(self.lock_file_descriptor)
            if not stat.S_ISREG(lock_stat.st_mode):
                raise CounterPersistenceError("counter lock is not a regular file")
            if os.path.exists(self.counter_path):
                counter_stat = os.lstat(self.counter_path)
                if (counter_stat.st_dev, counter_stat.st_ino) == (lock_stat.st_dev, lock_stat.st_ino):
                    raise CounterPersistenceError("counter and lock resolve to the same inode")
            os.fchmod(self.lock_file_descriptor, 0o600)
            fcntl.flock(self.lock_file_descriptor, fcntl.LOCK_EX)
            yield self
        except CounterPersistenceError:
            raise
        except OSError as error:
            raise CounterPersistenceError("counter lock failed: %s" % error)
        finally:
            if self.lock_file_descriptor is not None:
                try:
                    os.close(self.lock_file_descriptor)
                finally:
                    self.lock_file_descriptor = None

    def read_counter(self):
        if self.lock_file_descriptor is None:
            raise CounterPersistenceError("counter lock is not held")
        if not os.path.exists(self.counter_path):
            return 0
        try:
            counter_stat = os.lstat(self.counter_path)
            if not stat.S_ISREG(counter_stat.st_mode):
                raise CounterPersistenceError("counter state is not a regular file")
            if counter_stat.st_size > 32:
                raise CounterPersistenceError("counter state exceeds maximum length")
            with open(self.counter_path, "r", encoding="ascii") as counter_file:
                counter_text = counter_file.read()
        except CounterPersistenceError:
            raise
        except (OSError, UnicodeError) as error:
            raise CounterPersistenceError("counter read failed: %s" % error)

        if not COUNTER_PATTERN.fullmatch(counter_text):
            raise CounterPersistenceError("counter state is malformed")
        counter_value = int(counter_text.strip())
        if counter_value < 0 or counter_value > MAX_SAFE_INTEGER:
            raise CounterPersistenceError("counter state is outside the safe range")
        return counter_value

    def persist_counter(self, counter_value):
        if self.lock_file_descriptor is None:
            raise CounterPersistenceError("counter lock is not held")
        require_exact_integer("counter", counter_value, 1, MAX_SAFE_INTEGER)

        counter_directory = os.path.dirname(self.counter_path)
        temporary_file_descriptor = None
        temporary_path = None
        try:
            temporary_file_descriptor, temporary_path = tempfile.mkstemp(
                prefix=".authorizer-counter.",
                dir=counter_directory,
            )
            os.fchmod(temporary_file_descriptor, 0o600)
            with os.fdopen(temporary_file_descriptor, "w", encoding="ascii") as temporary_file:
                temporary_file_descriptor = None
                temporary_file.write("%d\n" % counter_value)
                temporary_file.flush()
                self.fsync_function(temporary_file.fileno())

            self.replace_function(temporary_path, self.counter_path)
            temporary_path = None
            os.chmod(self.counter_path, 0o600)

            directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
            directory_file_descriptor = os.open(counter_directory, directory_flags)
            try:
                self.fsync_function(directory_file_descriptor)
            finally:
                os.close(directory_file_descriptor)
        except AuthorizationRejected:
            raise
        except OSError as error:
            raise CounterPersistenceError("counter persistence failed: %s" % error)
        finally:
            if temporary_file_descriptor is not None:
                os.close(temporary_file_descriptor)
            if temporary_path is not None:
                try:
                    os.unlink(temporary_path)
                except OSError:
                    pass
