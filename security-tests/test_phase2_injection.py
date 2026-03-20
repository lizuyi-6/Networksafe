#!/usr/bin/env python3
"""
AetherGuard Security Test - Phase 2: Injection Vulnerability Testing
Tests command injection, path traversal, SSRF
"""

import requests
import json
import time
import sys
import urllib.parse
from datetime import datetime

# Configuration
BACKEND_URL = "http://localhost:3005"
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


def get_or_create_test_agent(token):
    """Get an existing agent ID or create a test agent"""
    try:
        # Try to get existing agents
        response = requests.get(
            f"{BACKEND_URL}/api/agents",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        if response.status_code == 200:
            agents = response.json()
            if isinstance(agents, list) and len(agents) > 0:
                return agents[0].get("id") or agents[0].get("agentId")

        # Try to register a test agent
        response = requests.post(
            f"{BACKEND_URL}/api/agents/register",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "agentId": "test-security-agent",
                "hostname": "security-test",
                "platform": "linux"
            },
            timeout=10
        )

        if response.status_code in [200, 201]:
            return "test-security-agent"

    except Exception as e:
        print(f"[!] Failed to get/create test agent: {e}")

    return None


def test_2_1_command_injection_firewall():
    """
    Test VULN-002: Command Injection in Firewall Controller
    Target: backend/src/agent/enhanced-firewall-controller.ts:185-271
    """
    result = SecurityTestResult("VULN-002", "Command Injection (Firewall)", "CRITICAL")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    agent_id = get_or_create_test_agent(token)
    if not agent_id:
        result.add_detail("Could not get test agent - testing API endpoints directly")

    # Command injection payloads for iptables
    payloads = [
        # Basic command injection
        ("8.8.8.8; id", "semicolon"),
        ("8.8.8.8 && id", "AND operator"),
        ("8.8.8.8 || id", "OR operator"),
        ("8.8.8.8 | id", "pipe"),
        ("8.8.8.8 & id", "background"),

        # Backtick injection
        ("8.8.8.8`id`", "backticks"),

        # Subshell injection
        ("8.8.8.8$(id)", "subshell"),

        # Newline injection
        ("8.8.8.8%0aid", "newline encoded"),
        ("8.8.8.8\nid", "newline literal"),

        # Time-based blind injection
        ("8.8.8.8; sleep 3", "time-based semicolon"),
        ("8.8.8.8 && sleep 3", "time-based AND"),
    ]

    for payload, desc in payloads:
        try:
            # Test block IP endpoint
            start_time = time.time()

            response = requests.post(
                f"{BACKEND_URL}/api/agents/{agent_id}/block" if agent_id else f"{BACKEND_URL}/api/firewall/block",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={"ip": payload},
                timeout=15
            )

            elapsed = time.time() - start_time

            # Check for time-based injection
            if "sleep" in payload and elapsed >= 3:
                result.vulnerable = True
                result.add_detail(f"TIME-BASED INJECTION: {desc}")
                result.add_evidence(f"Payload: {payload}, Time: {elapsed:.2f}s")

            # Check for command execution indicators in response
            if response.status_code == 200:
                result.add_detail(f"Payload accepted ({desc}): {response.status_code}")

                # Check if response contains command output
                response_text = response.text.lower()
                if any(indicator in response_text for indicator in ["uid=", "gid=", "root", "groups="]):
                    result.vulnerable = True
                    result.add_detail(f"COMMAND OUTPUT DETECTED: {desc}")
                    result.add_evidence(f"Response: {response.text[:200]}")

            elif response.status_code == 400:
                # Check if validation error mentions specific characters
                if "invalid" in response.text.lower():
                    result.add_detail(f"Input validated/rejected ({desc})")
                else:
                    result.add_detail(f"Rejected ({desc}): {response.status_code}")

            elif response.status_code == 500:
                # Server error might indicate command execution attempt
                result.add_detail(f"Server error for payload ({desc})")

        except requests.exceptions.Timeout:
            if "sleep" in payload:
                result.vulnerable = True
                result.add_detail(f"TIMEOUT - Possible injection: {desc}")
                result.add_evidence(f"Payload caused timeout: {payload}")
        except Exception as e:
            result.add_detail(f"Error testing {desc}: {str(e)[:100]}")

    # Also test unblock endpoint
    for payload, desc in payloads[:3]:  # Test a few payloads on unblock
        try:
            response = requests.post(
                f"{BACKEND_URL}/api/agents/{agent_id}/unblock" if agent_id else f"{BACKEND_URL}/api/firewall/unblock",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={"ip": payload},
                timeout=10
            )
            result.add_detail(f"Unblock test ({desc}): {response.status_code}")
        except:
            pass

    return result


def test_2_2_path_traversal():
    """
    Test VULN-010: Path Traversal in Code Analysis Agent
    Target: backend/src/ai-agents/investigation/agents/code-analysis.agent.ts:243-358
    """
    result = SecurityTestResult("VULN-010", "Path Traversal", "MEDIUM")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    payloads = [
        ("../../../etc/passwd", "basic traversal"),
        ("..\\..\\..\\windows\\win.ini", "windows traversal"),
        ("....//....//....//etc/passwd", "double dot bypass"),
        ("..%2f..%2f..%2fetc/passwd", "url encoded"),
        ("..%252f..%252f..%252fetc/passwd", "double url encoded"),
        ("%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd", "full url encoded"),
        ("..%c0%af..%c0%af..%c0%afetc/passwd", "unicode bypass"),
        ("/etc/passwd%00", "null byte"),
        ("....//....//....//etc/shadow", "shadow file"),
        ("../../../proc/self/environ", "proc environ"),
    ]

    for payload, desc in payloads:
        try:
            # Test AI investigation endpoint
            response = requests.post(
                f"{BACKEND_URL}/api/ai/investigate",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={
                    "codeContext": {
                        "filePath": payload
                    }
                },
                timeout=10
            )

            if response.status_code == 200:
                response_text = response.text

                # Check for file content indicators
                if any(indicator in response_text for indicator in [
                    "root:", "nobody:", "daemon:",  # /etc/passwd content
                    "[boot loader]", "[fonts]",  # Windows ini content
                    "PATH=", "HOME=", "USER="  # environ content
                ]):
                    result.vulnerable = True
                    result.add_detail(f"FILE CONTENT EXPOSED: {desc}")
                    result.add_evidence(f"Payload: {payload}")
                    result.add_evidence(f"Response: {response_text[:300]}")

            elif response.status_code == 400:
                result.add_detail(f"Rejected ({desc}): validation active")
            elif response.status_code == 404:
                result.add_detail(f"Not found ({desc})")
            elif response.status_code == 500:
                result.add_detail(f"Server error ({desc})")

        except Exception as e:
            result.add_detail(f"Error ({desc}): {str(e)[:50]}")

    # Also test scanner endpoint if available
    for payload, desc in payloads[:3]:
        try:
            response = requests.post(
                f"{BACKEND_URL}/api/scanner/scan",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={"target": payload},
                timeout=10
            )
            result.add_detail(f"Scanner test ({desc}): {response.status_code}")
        except:
            pass

    return result


def test_2_3_ssrf():
    """
    Test SSRF vulnerabilities
    """
    result = SecurityTestResult("SSRF", "Server-Side Request Forgery", "HIGH")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    # SSRF payloads targeting internal services
    payloads = [
        ("http://169.254.169.254/latest/meta-data/", "AWS metadata"),
        ("http://metadata.google.internal/computeMetadata/v1/", "GCP metadata"),
        ("http://169.254.169.254/metadata/v1/", "Azure metadata"),
        ("http://localhost:6379/", "Redis internal"),
        ("http://127.0.0.1:6379/", "Redis localhost"),
        ("http://localhost:15432/", "PostgreSQL internal"),
        ("http://127.0.0.1:3005/api/admin/users", "Internal API"),
        ("http://[::1]:3005/", "IPv6 localhost"),
        ("file:///etc/passwd", "file protocol"),
        ("gopher://localhost:6379/_INFO", "gopher protocol"),
    ]

    for url, desc in payloads:
        try:
            # Test scanner endpoint
            response = requests.post(
                f"{BACKEND_URL}/api/scanner/scan",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={"target": url},
                timeout=15
            )

            if response.status_code == 200:
                response_text = response.text

                # Check for internal service responses
                indicators = [
                    "ami-id", "instance-id", "placement",  # AWS
                    "projectId", "numericProjectId",  # GCP
                    "redis_version", "connected_clients",  # Redis
                    "pg_version", "postgresql",  # PostgreSQL
                    "accessToken", "users",  # Internal API
                ]

                for indicator in indicators:
                    if indicator in response_text:
                        result.vulnerable = True
                        result.add_detail(f"INTERNAL SERVICE EXPOSED: {desc}")
                        result.add_evidence(f"URL: {url}")
                        result.add_evidence(f"Indicator: {indicator}")
                        break

            elif response.status_code in [400, 403]:
                result.add_detail(f"Blocked ({desc})")
            else:
                result.add_detail(f"Response ({desc}): {response.status_code}")

        except requests.exceptions.Timeout:
            result.add_detail(f"Timeout ({desc}) - service may exist")
        except Exception as e:
            result.add_detail(f"Error ({desc}): {str(e)[:50]}")

    return result


def test_2_4_sql_injection():
    """
    Test SQL injection vulnerabilities
    """
    result = SecurityTestResult("SQLI", "SQL Injection", "CRITICAL")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    payloads = [
        ("' OR '1'='1", "basic OR"),
        ("' OR 1=1--", "comment bypass"),
        ("admin'--", "comment after user"),
        ("' UNION SELECT NULL--", "union null"),
        ("' UNION SELECT 1,2,3--", "union numbers"),
        ("1; DROP TABLE users--", "drop table"),
        ("' AND SLEEP(5)--", "time-based MySQL"),
        ("'; WAITFOR DELAY '0:0:5'--", "time-based MSSQL"),
        ("' AND pg_sleep(5)--", "time-based PostgreSQL"),
    ]

    # Test various endpoints
    endpoints = [
        ("/api/agents", "agentId"),
        ("/api/devices", "deviceId"),
        ("/api/users", "userId"),
        ("/api/alerts", "alertId"),
    ]

    for endpoint, param in endpoints:
        for payload, desc in payloads:
            try:
                # Test query parameter
                start_time = time.time()
                response = requests.get(
                    f"{BACKEND_URL}{endpoint}?{param}={urllib.parse.quote(payload)}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=15
                )
                elapsed = time.time() - start_time

                # Time-based detection
                if "sleep" in payload.lower() or "waitfor" in payload.lower():
                    if elapsed >= 5:
                        result.vulnerable = True
                        result.add_detail(f"TIME-BASED SQLi: {endpoint} ({desc})")
                        result.add_evidence(f"Payload: {payload}, Time: {elapsed:.2f}s")

                # Error-based detection
                if response.status_code == 500:
                    error_indicators = [
                        "sql", "syntax", "mysql", "postgresql", "sqlite",
                        "ORA-", "PLS-", "unclosed quotation"
                    ]
                    if any(ind in response.text.lower() for ind in error_indicators):
                        result.vulnerable = True
                        result.add_detail(f"ERROR-BASED SQLi: {endpoint} ({desc})")
                        result.add_evidence(f"Error: {response.text[:200]}")

            except requests.exceptions.Timeout:
                if "sleep" in payload.lower():
                    result.vulnerable = True
                    result.add_detail(f"TIMEOUT SQLi: {endpoint} ({desc})")
            except Exception as e:
                pass

    return result


def run_all_tests():
    """Run all Phase 2 tests"""
    print("=" * 60)
    print("AetherGuard Security Test - Phase 2: Injection Vulnerabilities")
    print("=" * 60)
    print()

    tests = [
        test_2_1_command_injection_firewall,
        test_2_2_path_traversal,
        test_2_3_ssrf,
        test_2_4_sql_injection,
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
            for detail in result.details[:5]:  # Limit output
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
    print("Phase 2 Summary")
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
        "phase": "Phase 2: Injection Vulnerabilities",
        "timestamp": datetime.now().isoformat(),
        "results": [r.to_dict() for r in results],
        "summary": {
            "total": len(results),
            "vulnerable": sum(1 for r in results if r.vulnerable)
        }
    }

    with open("reports/phase2_results.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"Report saved to: security-tests/reports/phase2_results.json")
