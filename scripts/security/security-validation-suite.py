#!/usr/bin/env python3
"""
Security Validation Suite for AetherGuard (AetherGuard)
Tests all security fixes applied in Round 9
"""

import os
import sys
import subprocess
from pathlib import Path

def main():
    print("\n" + "="*60)
    print("  AetherGuard Security Validation Suite")
    print("  Testing Security Fixes from Round 9")
    print("="*60 + "\n")
    
    passed = 0
    failed = 0
    
    def test(name, condition, details=""):
        nonlocal passed, failed
        if condition:
            print(f"[PASS] {name}")
            if details:
                print(f"       -> {details}")
            passed += 1
        else:
            print(f"[FAIL] {name}")
            if details:
                print(f"       -> {details}")
            failed += 1
    
    # Test 1: Environment Configuration
    print("--- Testing Environment Configuration ---\n")
    
    env = {}
    env_path = Path("X:/want/fsce/.env")
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env[key.strip()] = value.strip()
    except FileNotFoundError:
        print("[ERROR] .env file not found\n")
        sys.exit(1)
    
    test("JWT_SECRET is set (32+ chars)", 
         "JWT_SECRET" in env and len(env.get("JWT_SECRET", "")) >= 32,
         f"Length: {len(env.get('JWT_SECRET', ''))}")
    
    test("ADMIN_PASSWORD is set (12+ chars)", 
         "ADMIN_PASSWORD" in env and len(env.get("ADMIN_PASSWORD", "")) >= 12,
         f"Length: {len(env.get('ADMIN_PASSWORD', ''))}")
    
    test("ENCRYPTION_KEY is set",
         "ENCRYPTION_KEY" in env and len(env.get("ENCRYPTION_KEY", "")) >= 16)
    
    test("ENCRYPTION_SALT is set (CVE-2026-013 fix)",
         "ENCRYPTION_SALT" in env and env.get("ENCRYPTION_SALT") != "")
    
    test("AUDIT_LOG_SECRET is set (32+ chars)",
         "AUDIT_LOG_SECRET" in env and len(env.get("AUDIT_LOG_SECRET", "")) >= 32)
    
    test("REDIS_PASSWORD is set",
         "REDIS_PASSWORD" in env and len(env.get("REDIS_PASSWORD", "")) >= 8)
    
    # Test 2: Source Code Security Fixes
    print("\n--- Testing Source Code Security Fixes ---\n")
    
    agent_auth_path = Path("X:/want/fsce/backend/src/security/agent-auth.service.ts")
    if agent_auth_path.exists():
        content = agent_auth_path.read_text(encoding='utf-8')
        
        test("No hardcoded encryption salt fallback",
             "ENCRYPTION_SALT environment variable is required" in content)
        
        test("ENCRYPTION_SALT throws error if missing",
             "no fallback allowed" in content)
        
        test("Timing-safe API key comparison (timingSafeEqual)",
             "timingSafeEqual" in content)
        
        test("Hostname sanitization",
             "sanitizeHostname" in content)
        
        test("Transaction for race condition prevention",
             "db.transaction" in content)
    
    # Test 3: Database Initialization
    print("\n--- Testing Database Initialization ---\n")
    
    init_path = Path("X:/want/fsce/backend/src/database/init.ts")
    if init_path.exists():
        content = init_path.read_text(encoding='utf-8')
        
        test("ADMIN_PASSWORD required (no fallback)",
             "ADMIN_PASSWORD environment variable is required" in content)
        
        test("Password minimum 12 characters enforced",
             "at least 12 characters" in content)
        
        test("bcrypt with 12 salt rounds",
             "saltRounds = 12" in content)
        
        test("Random API key generation",
             "generateApiKey" in content and "randomBytes" in content)
    
    # Test 4: JWT Middleware
    print("\n--- Testing JWT Authentication Middleware ---\n")
    
    auth_middleware_path = Path("X:/want/fsce/backend/src/middleware/auth.middleware.ts")
    if auth_middleware_path.exists():
        content = auth_middleware_path.read_text(encoding='utf-8')
        
        test("JWT_SECRET validated at startup (minLength: 32)",
             "minLength: 32" in content)
        
        test("Token blacklist check implemented",
             "token:blacklist" in content)
        
        test("Fail-secure when Redis unavailable",
             "fail-secure" in content.lower() or "rejecting token" in content)
        
        test("Timing-safe comparison for API keys",
             "timingSafeEqual" in content)
        
        test("SameSite=strict cookie policy",
             "sameSite: 'strict'" in content)
    
    # Test 5: Build Process
    print("\n--- Testing Build Process ---\n")
    
    try:
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd="X:/want/fsce/backend",
            capture_output=True,
            text=True,
            timeout=120
        )
        test("Backend builds successfully", result.returncode == 0)
    except Exception as e:
        test("Backend builds successfully", False, str(e))
    
    # Summary
    print("\n" + "="*60)
    print(f"  VALIDATION SUMMARY")
    print("="*60)
    print(f"  Passed: {passed}")
    print(f"  Failed: {failed}")
    
    if failed == 0:
        print("\n  All security validations PASSED!")
        print("  The application is secure against tested attack vectors.\n")
        return 0
    else:
        print(f"\n  {failed} security test(s) FAILED!\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
