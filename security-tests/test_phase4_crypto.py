#!/usr/bin/env python3
"""
AetherGuard Security Test - Phase 4: Crypto & Configuration Testing
Tests hardcoded keys, nonce replay, Redis failure mode
"""

import requests
import json
import time
import subprocess
import re
from datetime import datetime

# Configuration
BACKEND_URL = "http://localhost:3005"
DEFAULT_CREDS = {"email": "admin@aetherguard.local", "password": "eIMFrx5bNPpgYaweouM1"}
HARDCODED_API_KEY = "fe589f4f38dde88b31ad18c3ee0dc0513e51a6603a110a120fcb649a1ac11904"


class SecurityTestResult:
    def __init__(self, test_id, name, severity):
        self.test_id = test_id
        self.name = name
        self.severity = severity
        self.vulnerable = False
        self.details = []
        self.evidence = []

    def add_detail(self, detail):
        self.details.append(detail)

    def add_evidence(self, evidence):
        self.evidence.append(str(evidence)[:500])

    def to_dict(self):
        return {
            "test_id": self.test_id,
            "name": self.name,
            "severity": self.severity,
            "vulnerable": self.vulnerable,
            "details": self.details,
            "evidence": self.evidence
        }


def get_admin_token():
    """Get a valid admin token for testing"""
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json=DEFAULT_CREDS,
            timeout=10
        )
        if response.status_code == 200:
            return response.json().get("accessToken")
    except Exception as e:
        print(f"[!] Failed to get admin token: {e}")
    return None


def test_4_1_hardcoded_keys_search():
    """
    Test VULN-001: Hardcoded Keys in Source Code
    Target: backend/src/agent/agent.ts:494
    """
    result = SecurityTestResult("VULN-001", "Hardcoded Keys in Source", "CRITICAL")

    # Patterns to search for hardcoded secrets
    patterns = [
        (HARDCODED_API_KEY, "Known hardcoded API key"),
        (r"apiKey\s*=\s*['\"][a-f0-9]{64}['\"]", "64-char hex API key"),
        (r"secretKey\s*=\s*['\"][^'\"]+['\"](?!.*process\.env)", "Hardcoded secret key"),
        (r"JWT_SECRET\s*=\s*['\"][^'\"]+['\"]", "Hardcoded JWT secret"),
        (r"password\s*=\s*['\"][^'\"]+['\"](?!.*env)", "Hardcoded password"),
    ]

    # Search in backend source files
    backend_path = "X:/github-repos/Networksafe/backend/src"

    try:
        # Use grep equivalent on Windows
        for pattern, desc in patterns:
            try:
                # Use findstr or grep
                cmd = f'grep -r "{pattern}" {backend_path} 2>/dev/null || echo "No matches"'
                proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
                output = proc.stdout

                if output and "No matches" not in output:
                    result.vulnerable = True
                    result.add_detail(f"FOUND: {desc}")
                    result.add_evidence(output[:300])

            except subprocess.TimeoutExpired:
                result.add_detail(f"Timeout searching for: {desc}")
            except Exception as e:
                result.add_detail(f"Search error for {desc}: {str(e)[:50]}")

        # Direct check for the known hardcoded key
        try:
            with open(f"{backend_path}/agent/agent.ts", "r") as f:
                content = f.read()
                if HARDCODED_API_KEY in content:
                    result.vulnerable = True
                    result.add_detail("CONFIRMED: Hardcoded API key found in agent.ts")
                    result.add_evidence(f"Key: {HARDCODED_API_KEY}")
        except FileNotFoundError:
            result.add_detail("agent.ts not found for direct check")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_4_2_nonce_replay():
    """
    Test VULN-NONCE: Nonce Replay Attack
    Target: backend/src/security/command-signing.service.ts:133-143
    """
    result = SecurityTestResult("VULN-NONCE", "Nonce Replay Attack", "HIGH")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    # Test if we can replay the same command twice
    try:
        # Get a valid nonce by sending a command
        timestamp = int(time.time() * 1000)
        command = {
            "command": "status",
            "params": {},
            "timestamp": timestamp,
            "nonce": "test-nonce-12345"
        }

        # First request
        response1 = requests.post(
            f"{BACKEND_URL}/api/devices/test-device/command",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json=command,
            timeout=10
        )

        result.add_detail(f"First request: {response1.status_code}")

        # Immediate replay with same nonce
        response2 = requests.post(
            f"{BACKEND_URL}/api/devices/test-device/command",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json=command,  # Same command with same nonce
            timeout=10
        )

        result.add_detail(f"Replay request: {response2.status_code}")

        if response2.status_code == 200:
            result.vulnerable = True
            result.add_detail("REPLAY ACCEPTED: Same nonce used twice successfully")
            result.add_evidence(f"Both requests returned 200")
        elif response2.status_code == 400:
            if "nonce" in response2.text.lower() or "replay" in response2.text.lower():
                result.add_detail("Replay rejected with nonce error (secure)")
            else:
                result.add_detail(f"Replay rejected: {response2.text[:100]}")
        elif response2.status_code == 404:
            result.add_detail("Device not found (expected if no devices)")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_4_3_redis_failure_mode():
    """
    Test VULN-008: Redis Failure Mode (Fail-Open)
    Target: backend/src/security/redis.service.ts:93-133
    """
    result = SecurityTestResult("VULN-008", "Redis Failure Mode", "HIGH")

    # Note: This test would require stopping Redis
    # We'll test the behavior by checking configuration

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    try:
        # Check if there's an env var that controls behavior when Redis is down
        # by examining error responses

        # Test rate limiting behavior
        responses = []
        for i in range(150):
            response = requests.get(
                f"{BACKEND_URL}/api/agents",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5
            )
            responses.append(response.status_code)

        success_count = sum(1 for r in responses if r == 200)
        rate_limited = sum(1 for r in responses if r == 429)

        result.add_detail(f"150 requests: {success_count} success, {rate_limited} rate limited")

        if rate_limited == 0:
            result.add_detail("No rate limiting detected - possible Redis failure mode issue")
            result.vulnerable = True

        # Check if memory fallback is working
        if success_count > 100:
            result.add_detail("Memory fallback may allow excessive requests")
            result.vulnerable = True

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    # Check for ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN in code
    try:
        with open("X:/github-repos/Networksafe/backend/src/middleware/auth.middleware.ts", "r") as f:
            content = f.read()
            if "ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN" in content:
                result.add_detail("Found ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN config")
                result.add_evidence("Code contains fail-open configuration option")
                # This is actually a secure design if it defaults to fail-closed
    except:
        pass

    return result


def test_4_4_encryption_key_management():
    """
    Test Encryption Key Management
    """
    result = SecurityTestResult("CRYPTO-01", "Encryption Key Management", "MEDIUM")

    # Check if encryption keys are properly managed
    try:
        # Check .env.example for key requirements
        with open("X:/github-repos/Networksafe/.env.example", "r") as f:
            content = f.read()

            if "ENCRYPTION_KEY" in content:
                result.add_detail("ENCRYPTION_KEY required in config")

            if "ENCRYPTION_SALT" in content:
                result.add_detail("ENCRYPTION_SALT required in config")

        # Check if keys have minimum length requirements
        with open("X:/github-repos/Networksafe/backend/src/security/env-validator.service.ts", "r") as f:
            content = f.read()

            if "minLength" in content and "32" in content:
                result.add_detail("Key minimum length validation exists")
            else:
                result.add_detail("No key length validation found")
                result.vulnerable = True

    except FileNotFoundError as e:
        result.add_detail(f"File not found: {e}")
    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_4_5_session_management():
    """
    Test Session Management Security
    """
    result = SecurityTestResult("CRYPTO-02", "Session Management", "MEDIUM")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    try:
        # Test 1: Check token expiration
        import base64
        import json as json_mod

        parts = token.split('.')
        if len(parts) == 3:
            payload = json_mod.loads(base64.urlsafe_b64decode(parts[1] + "=="))

            if 'exp' in payload:
                exp_time = datetime.fromtimestamp(payload['exp'])
                now = datetime.now()
                duration = exp_time - now

                result.add_detail(f"Token expires at: {exp_time}")
                result.add_detail(f"Token duration: {duration}")

                if duration.total_seconds() > 86400:  # More than 24 hours
                    result.add_detail("Token duration exceeds 24 hours")
                    result.vulnerable = True
            else:
                result.add_detail("No expiration in token")
                result.vulnerable = True

        # Test 2: Check if refresh token is properly separated
        response = requests.post(
            f"{BACKEND_URL}/api/auth/refresh",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            if "accessToken" in data and "refreshToken" in data:
                result.add_detail("Token refresh returns both access and refresh tokens")
            elif "accessToken" in data:
                result.add_detail("Token refresh returns access token only (good)")
        else:
            result.add_detail(f"Refresh endpoint response: {response.status_code}")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_4_6_cookie_security():
    """
    Test Cookie Security Settings
    """
    result = SecurityTestResult("CRYPTO-03", "Cookie Security", "LOW")

    try:
        # Login and check cookie settings
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json=DEFAULT_CREDS,
            timeout=10
        )

        cookies = response.cookies

        for cookie in cookies:
            result.add_detail(f"Cookie: {cookie.name}")
            result.add_detail(f"  - Secure: {cookie.secure}")
            result.add_detail(f"  - HttpOnly: {cookie.has_nonstandard_attr('HttpOnly')}")
            result.add_detail(f"  - SameSite: {cookie.get_nonstandard_attr('SameSite')}")

            if not cookie.secure:
                result.add_detail(f"Cookie '{cookie.name}' missing Secure flag")
                result.vulnerable = True

            if not cookie.has_nonstandard_attr('HttpOnly'):
                result.add_detail(f"Cookie '{cookie.name}' missing HttpOnly flag")
                result.vulnerable = True

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def run_all_tests():
    """Run all Phase 4 tests"""
    print("=" * 60)
    print("AetherGuard Security Test - Phase 4: Crypto & Configuration")
    print("=" * 60)
    print()

    tests = [
        test_4_1_hardcoded_keys_search,
        test_4_2_nonce_replay,
        test_4_3_redis_failure_mode,
        test_4_4_encryption_key_management,
        test_4_5_session_management,
        test_4_6_cookie_security,
    ]

    results = []
    vulnerable_count = 0

    for test_func in tests:
        print(f"[*] Running: {test_func.__doc__.strip().split(chr(10))[0]}")
        try:
            result = test_func()
            results.append(result)

            status = "[VULNERABLE]" if result.vulnerable else "[SECURE]"
            print(f"    {status} {result.test_id}: {result.name}")
            for detail in result.details[:5]:
                print(f"        - {detail}")
            if len(result.details) > 5:
                print(f"        ... and {len(result.details) - 5} more details")

            if result.vulnerable:
                vulnerable_count += 1

        except Exception as e:
            print(f"    [ERROR] Test failed: {e}")

        print()

    # Summary
    print("=" * 60)
    print("Phase 4 Summary")
    print("=" * 60)
    print(f"Total tests: {len(results)}")
    print(f"Vulnerable: {vulnerable_count}")
    print(f"Secure: {len(results) - vulnerable_count}")
    print()

    return results


if __name__ == "__main__":
    results = run_all_tests()

    # Save results
    report = {
        "phase": "Phase 4: Crypto & Configuration",
        "timestamp": datetime.now().isoformat(),
        "results": [r.to_dict() for r in results],
        "summary": {
            "total": len(results),
            "vulnerable": sum(1 for r in results if r.vulnerable)
        }
    }

    with open("reports/phase4_results.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"Report saved to: security-tests/reports/phase4_results.json")
