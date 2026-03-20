#!/usr/bin/env python3
"""
AetherGuard Security Test - Phase 3: WebSocket Security Testing
Tests unauthenticated access, rate limiting, unsigned commands, cross-tenant access
"""

import requests
import json
import time
import sys
import asyncio
import threading
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# Configuration
BACKEND_URL = "http://localhost:3005"
WS_URL = "ws://localhost:3005"
DEFAULT_CREDS = {"email": "admin@aetherguard.local", "password": "eIMFrx5bNPpgYaweouM1"}

# Try to import websocket client
try:
    import websocket
    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False
    print("[!] websocket-client not installed. Some tests will be skipped.")


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


def test_3_1_unauthenticated_websocket():
    """
    Test VULN-WS-01: Unauthenticated WebSocket Access
    Target: backend/src/websocket/agent-gateway.ts
    """
    result = SecurityTestResult("VULN-WS-01", "Unauthenticated WebSocket Access", "HIGH")

    if not HAS_WEBSOCKET:
        result.add_detail("websocket-client not installed - test skipped")
        return result

    try:
        # Test 1: Try to connect without any credentials
        ws = websocket.create_connection(f"{WS_URL}/socket.io/?EIO=4&transport=websocket", timeout=5)

        # Wait for connection response
        try:
            response = ws.recv()
            result.add_detail(f"Connection response: {response[:100]}")

            # Try to emit an event
            ws.send('42["dashboard:agents:list",{}]')
            time.sleep(1)

            try:
                event_response = ws.recv()
                if "agents" in event_response or "data" in event_response:
                    result.vulnerable = True
                    result.add_detail("UNAUTHENTICATED ACCESS: Received data without auth")
                    result.add_evidence(event_response[:200])
                else:
                    result.add_detail(f"Event response: {event_response[:100]}")
            except:
                result.add_detail("No response to event (may be blocked)")

        except websocket.WebSocketTimeoutException:
            result.add_detail("No immediate response (timeout)")

        ws.close()

        # Test 2: Try with invalid token
        ws = websocket.create_connection(
            f"{WS_URL}/socket.io/?EIO=4&transport=websocket",
            header={"Authorization": "Bearer invalid_token"},
            timeout=5
        )

        try:
            response = ws.recv()
            result.add_detail(f"Invalid token response: {response[:100]}")
        except:
            pass

        ws.close()

    except websocket.WebSocketException as e:
        result.add_detail(f"WebSocket error: {e}")
    except Exception as e:
        result.add_detail(f"Connection error: {e}")

    return result


def test_3_2_rate_limit_race_condition():
    """
    Test VULN-004: Rate Limit Race Condition
    Target: backend/src/services/socket-rate-limit.service.ts:116-156
    """
    result = SecurityTestResult("VULN-004", "Rate Limit Race Condition", "HIGH")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    # Test HTTP rate limiting first (easier to test)
    # If HTTP has race condition, WebSocket likely does too

    num_requests = 200
    success_count = 0
    rate_limited_count = 0

    def make_request():
        nonlocal success_count, rate_limited_count
        try:
            response = requests.get(
                f"{BACKEND_URL}/api/agents",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            if response.status_code == 200:
                success_count += 1
            elif response.status_code == 429:
                rate_limited_count += 1
            return response.status_code
        except:
            return None

    # Execute requests in parallel
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = [executor.submit(make_request) for _ in range(num_requests)]
        results = [f.result() for f in futures]

    elapsed = time.time() - start_time

    result.add_detail(f"Total requests: {num_requests}")
    result.add_detail(f"Successful (200): {success_count}")
    result.add_detail(f"Rate limited (429): {rate_limited_count}")
    result.add_detail(f"Time elapsed: {elapsed:.2f}s")

    # If more than 100 requests succeeded, rate limiting is ineffective
    if success_count > 100:
        result.vulnerable = True
        result.add_detail(f"RATE LIMIT BYPASS: {success_count} requests succeeded (> 100 limit)")
        result.add_evidence(f"Success rate: {success_count}/{num_requests}")

    # If no rate limiting occurred at all
    if rate_limited_count == 0:
        result.add_detail("No rate limiting detected")
        result.vulnerable = True

    return result


def test_3_3_unsigned_commands():
    """
    Test VULN-003: Unsigned Commands Accepted
    Target: backend/src/websocket/device-gateway.ts:588-594
    """
    result = SecurityTestResult("VULN-003", "Unsigned Commands Accepted", "CRITICAL")

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    # Test HTTP endpoint for command signing
    # Check if API accepts commands without signatures

    try:
        # Test 1: Send command without signature
        response = requests.post(
            f"{BACKEND_URL}/api/devices/test-device/command",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json={
                "command": "reboot",
                "params": {},
                "timestamp": int(time.time() * 1000)
                # No signature field
            },
            timeout=10
        )

        if response.status_code == 200:
            result.vulnerable = True
            result.add_detail("UNSIGNED COMMAND ACCEPTED: API accepted command without signature")
            result.add_evidence(f"Response: {response.text[:200]}")
        elif response.status_code == 401:
            result.add_detail("Unauthorized - token issue")
        elif response.status_code == 404:
            result.add_detail("Device not found (expected if no devices)")
        elif response.status_code == 400:
            if "signature" in response.text.lower():
                result.add_detail("Signature required (secure)")
            else:
                result.add_detail(f"Bad request: {response.text[:100]}")
        else:
            result.add_detail(f"Response: {response.status_code}")

        # Test 2: Send command with invalid signature
        response = requests.post(
            f"{BACKEND_URL}/api/devices/test-device/command",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json={
                "command": "reboot",
                "params": {},
                "timestamp": int(time.time() * 1000),
                "signature": "invalid_signature_12345"
            },
            timeout=10
        )

        if response.status_code == 200:
            result.vulnerable = True
            result.add_detail("INVALID SIGNATURE ACCEPTED: Command accepted with fake signature")
        elif response.status_code == 400:
            if "signature" in response.text.lower() or "invalid" in response.text.lower():
                result.add_detail("Invalid signature rejected (secure)")
            else:
                result.add_detail(f"Rejected: {response.text[:100]}")

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_3_4_cross_tenant_websocket():
    """
    Test Cross-Tenant WebSocket Access
    Target: backend/src/websocket/agent-gateway.ts
    """
    result = SecurityTestResult("VULN-WS-04", "Cross-Tenant WebSocket Access", "MEDIUM")

    if not HAS_WEBSOCKET:
        result.add_detail("websocket-client not installed - test skipped")
        return result

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    try:
        # Connect with valid token
        ws = websocket.create_connection(
            f"{WS_URL}/socket.io/?EIO=4&transport=websocket",
            header={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        # Wait for connection
        time.sleep(1)

        # Try to subscribe to a different tenant's agent
        ws.send('42["dashboard:agent:subscribe",{"agentId":"other-tenant-agent","tenantId":"victim-tenant"}]')

        time.sleep(1)

        try:
            response = ws.recv()
            if "error" in response.lower() or "forbidden" in response.lower() or "denied" in response.lower():
                result.add_detail("Cross-tenant subscription rejected (secure)")
                result.add_evidence(response[:100])
            elif "success" in response.lower() or "subscribed" in response.lower():
                result.vulnerable = True
                result.add_detail("CROSS-TENANT ACCESS: Subscribed to other tenant's agent")
                result.add_evidence(response[:200])
            else:
                result.add_detail(f"Response: {response[:100]}")
        except websocket.WebSocketTimeoutException:
            result.add_detail("No response (may be silently ignored)")

        ws.close()

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def test_3_5_websocket_replay_attack():
    """
    Test WebSocket Message Replay
    """
    result = SecurityTestResult("VULN-WS-05", "WebSocket Replay Attack", "MEDIUM")

    if not HAS_WEBSOCKET:
        result.add_detail("websocket-client not installed - test skipped")
        return result

    token = get_admin_token()
    if not token:
        result.add_detail("Could not get admin token")
        return result

    try:
        ws = websocket.create_connection(
            f"{WS_URL}/socket.io/?EIO=4&transport=websocket",
            header={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        time.sleep(1)

        # Send same message twice
        message = '42["dashboard:agents:list",{}]'

        ws.send(message)
        time.sleep(0.5)

        try:
            response1 = ws.recv()
            result.add_detail(f"First message response: {response1[:100]}")
        except:
            pass

        # Replay exact same message
        ws.send(message)
        time.sleep(0.5)

        try:
            response2 = ws.recv()
            if response2 == response1:
                result.add_detail("Identical response to replayed message")
            else:
                result.add_detail(f"Second message response: {response2[:100]}")

            # Both responses having data might indicate no replay protection
            if "agents" in response1 and "agents" in response2:
                result.vulnerable = True
                result.add_detail("REPLAY ACCEPTED: Same message processed twice")
        except websocket.WebSocketTimeoutException:
            result.add_detail("Second message rejected or timed out")

        ws.close()

    except Exception as e:
        result.add_detail(f"Test error: {str(e)}")

    return result


def run_all_tests():
    """Run all Phase 3 tests"""
    print("=" * 60)
    print("AetherGuard Security Test - Phase 3: WebSocket Security")
    print("=" * 60)
    print()

    tests = [
        test_3_1_unauthenticated_websocket,
        test_3_2_rate_limit_race_condition,
        test_3_3_unsigned_commands,
        test_3_4_cross_tenant_websocket,
        test_3_5_websocket_replay_attack,
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
    print("Phase 3 Summary")
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
        "phase": "Phase 3: WebSocket Security",
        "timestamp": datetime.now().isoformat(),
        "results": [r.to_dict() for r in results],
        "summary": {
            "total": len(results),
            "vulnerable": sum(1 for r in results if r.vulnerable)
        }
    }

    with open("reports/phase3_results.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"Report saved to: security-tests/reports/phase3_results.json")
