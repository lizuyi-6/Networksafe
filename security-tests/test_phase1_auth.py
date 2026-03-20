#!/usr/bin/env python3
"""
AetherGuard Security Test - Phase 1: Authentication & Authorization Testing
Tests JWT hardcoded key, algorithm confusion, token revocation bypass, tenant isolation
"""

import requests
import json
import time
import sys
from datetime import datetime, timedelta
import base64
import hmac
import hashlib

# Configuration
BACKEND_URL = "http://localhost:3005"
FRONTEND_URL = "http://localhost:8080"
HARDCODED_API_KEY = "fe589f4f38dde88b31ad18c3ee0dc0513e51a6603a110a120fcb649a1ac11904"
DEFAULT_CREDS = {"email": "admin@aetherguard.local", "password": "eIMFrx5bNPpgYaweouM1"}

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
        self.evidence.append(evidence)

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
            data = response.json()
            return data.get("accessToken")
    except Exception as e:
        print(f"[!] Failed to get admin token: {e}")
    return None


def test_1_1_jwt_hardcoded_key():
    """
    Test VULN-001: JWT Hardcoded Key Exploitation
    Target: backend/src/agent/agent.ts:494
    """
    result = SecurityTestResult("VULN-001", "Hardcoded API Key JWT Forgery", "CRITICAL")

    # Try to use the hardcoded API key to authenticate
    try:
        # Test 1: Use hardcoded key as X-API-Key
        response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"X-API-Key": HARDCODED_API_KEY},
            timeout=10
        )

        if response.status_code == 200:
            result.vulnerable = True
            result.add_detail("Hardcoded API key accepted for authentication")
            result.add_evidence(f"Status: {response.status_code}, Response: {response.text[:200]}")
        elif response.status_code == 401:
            result.add_detail("Hardcoded API key rejected (mitigated)")
        else:
            result.add_detail(f"Unexpected response: {response.status_code}")

        # Test 2: Check if hardcoded key exists in agent registration
        response = requests.post(
            f"{BACKEND_URL}/api/agents/register",
            json={
                "agentId": "test-attacker-agent",
                "apiKey": HARDCODED_API_KEY,
                "hostname": "attacker-host",
                "platform": "linux"
            },
            timeout=10
        )

        if response.status_code in [200, 201]:
            result.vulnerable = True
            result.add_detail("Hardcoded API key allows agent registration")
            result.add_evidence(f"Registration response: {response.status_code}")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_1_2_jwt_algorithm_confusion():
    """
    Test VULN-005: JWT Algorithm Confusion Attack (alg: none)
    Target: backend/src/middleware/auth.middleware.ts
    """
    result = SecurityTestResult("VULN-005", "JWT Algorithm Confusion", "HIGH")

    # Create a token with alg: none
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b'=')
    payload = base64.urlsafe_b64encode(
        json.dumps({
            "userId": "admin-forged",
            "email": "attacker@evil.com",
            "role": "admin",
            "tenantId": "default",
            "exp": int((datetime.now() + timedelta(days=1)).timestamp())
        }).encode()
    ).rstrip(b'=')

    # Token with empty signature
    none_token = f"{header.decode()}.{payload.decode()}."

    try:
        response = requests.get(
            f"{BACKEND_URL}/api/admin/users",
            headers={"Authorization": f"Bearer {none_token}"},
            timeout=10
        )

        if response.status_code == 200:
            result.vulnerable = True
            result.add_detail("alg:none token accepted - CRITICAL VULNERABILITY")
            result.add_evidence(f"Token: {none_token[:50]}...")
            result.add_evidence(f"Response: {response.text[:200]}")
        elif response.status_code == 401:
            result.add_detail("alg:none token rejected (secure)")
        else:
            result.add_detail(f"Response: {response.status_code}")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    # Also test with "None", "NONE", "nOnE"
    for alg_variant in ["None", "NONE", "nOnE"]:
        header = base64.urlsafe_b64encode(
            json.dumps({"alg": alg_variant, "typ": "JWT"}).encode()
        ).rstrip(b'=')
        token = f"{header.decode()}.{payload.decode()}."

        try:
            response = requests.get(
                f"{BACKEND_URL}/api/admin/users",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )

            if response.status_code == 200:
                result.vulnerable = True
                result.add_detail(f"alg:{alg_variant} token accepted")
        except:
            pass

    return result


def test_1_3_token_revocation_bypass():
    """
    Test VULN-006: Token Revocation Bypass on WebSocket
    Target: backend/src/websocket/agent-gateway.ts:333-347
    Note: This tests the HTTP endpoint behavior
    """
    result = SecurityTestResult("VULN-006", "Token Revocation Bypass", "HIGH")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get initial token for testing")
        return result

    try:
        # Test 1: Verify token works
        response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        if response.status_code != 200:
            result.add_detail("Initial token validation failed")
            return result

        result.add_detail("Initial token validated successfully")

        # Test 2: Logout (revoke token)
        response = requests.post(
            f"{BACKEND_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        result.add_detail(f"Logout response: {response.status_code}")

        # Test 3: Try to use the revoked token
        response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        if response.status_code == 200:
            result.vulnerable = True
            result.add_detail("Revoked token still accepted - VULNERABILITY")
            result.add_evidence("Token used after logout successfully")
        elif response.status_code == 401:
            result.add_detail("Revoked token rejected (secure)")
        else:
            result.add_detail(f"Unexpected response after revocation: {response.status_code}")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_1_4_tenant_isolation():
    """
    Test VULN-009: Cross-Tenant Access
    Target: backend/src/core/tenant/tenant-context.ts
    """
    result = SecurityTestResult("VULN-009", "Tenant Isolation Bypass", "MEDIUM")

    admin_token = get_admin_token()
    if not admin_token:
        result.add_detail("Could not get admin token for testing")
        return result

    try:
        # Test 1: Admin should be able to see all tenants
        response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )

        result.add_detail(f"Admin agents list: {response.status_code}")

        # Test 2: Try to access with manipulated tenantId
        response = requests.get(
            f"{BACKEND_URL}/api/agents?tenantId=attacker-tenant",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            # Check if we got data from a different tenant
            result.add_detail(f"Cross-tenant query response: {response.status_code}")
            result.add_evidence(f"Response data: {json.dumps(data)[:200]}")

        # Test 3: Try to create agent in different tenant
        response = requests.post(
            f"{BACKEND_URL}/api/agents",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "agentId": "cross-tenant-test",
                "tenantId": "victim-tenant",
                "hostname": "test"
            },
            timeout=10
        )

        result.add_detail(f"Cross-tenant creation attempt: {response.status_code}")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_1_5_timing_attack_api_key():
    """
    Test VULN-007: API Key Timing Attack
    Target: backend/src/websocket/device-gateway.ts:60-66
    """
    result = SecurityTestResult("VULN-007", "API Key Timing Attack", "MEDIUM")

    correct_key = HARDCODED_API_KEY
    wrong_keys = [
        "a" * 64,  # Same length, wrong key
        "b" * 64,
        "fe589f4f38dde88b31ad18c3ee0dc0513e51a6603a110a120fcb649a1ac11905",  # One char different
        "x" * 32,  # Half length
        "y" * 128,  # Double length
    ]

    times_correct = []
    times_wrong = []

    # Measure correct key timing (multiple samples)
    for _ in range(5):
        start = time.perf_counter()
        try:
            requests.get(
                f"{BACKEND_URL}/api/agents",
                headers={"X-API-Key": correct_key},
                timeout=10
            )
        except:
            pass
        times_correct.append(time.perf_counter() - start)

    # Measure wrong key timing
    for key in wrong_keys:
        start = time.perf_counter()
        try:
            requests.get(
                f"{BACKEND_URL}/api/agents",
                headers={"X-API-Key": key},
                timeout=10
            )
        except:
            pass
        times_wrong.append(time.perf_counter() - start)

    avg_correct = sum(times_correct) / len(times_correct)
    avg_wrong = sum(times_wrong) / len(times_wrong)

    result.add_detail(f"Average correct key time: {avg_correct:.4f}s")
    result.add_detail(f"Average wrong key time: {avg_wrong:.4f}s")

    # If timing difference is significant (> 10ms), vulnerable
    if abs(avg_correct - avg_wrong) > 0.01:
        result.add_detail(f"Timing difference detected: {abs(avg_correct - avg_wrong)*1000:.2f}ms")
        result.vulnerable = True
        result.add_evidence("Timing variance suggests non-constant-time comparison")
    else:
        result.add_detail("Timing difference negligible - likely constant-time comparison")

    return result


def run_all_tests():
    """Run all Phase 1 tests"""
    print("=" * 60)
    print("AetherGuard Security Test - Phase 1: Auth & Authorization")
    print("=" * 60)
    print()

    tests = [
        test_1_1_jwt_hardcoded_key,
        test_1_2_jwt_algorithm_confusion,
        test_1_3_token_revocation_bypass,
        test_1_4_tenant_isolation,
        test_1_5_timing_attack_api_key,
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
            for detail in result.details:
                print(f"        - {detail}")

            if result.vulnerable:
                vulnerable_count += 1

        except Exception as e:
            print(f"    [ERROR] Test failed: {e}")

        print()

    # Summary
    print("=" * 60)
    print("Phase 1 Summary")
    print("=" * 60)
    print(f"Total tests: {len(results)}")
    print(f"Vulnerable: {vulnerable_count}")
    print(f"Secure: {len(results) - vulnerable_count}")
    print()

    return results


if __name__ == "__main__":
    results = run_all_tests()

    # Save results to file
    report = {
        "phase": "Phase 1: Authentication & Authorization",
        "timestamp": datetime.now().isoformat(),
        "results": [r.to_dict() for r in results],
        "summary": {
            "total": len(results),
            "vulnerable": sum(1 for r in results if r.vulnerable)
        }
    }

    with open("reports/phase1_results.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"Report saved to: security-tests/reports/phase1_results.json")
