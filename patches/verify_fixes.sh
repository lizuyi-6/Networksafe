#!/bin/bash
# Security Fix Verification Script
# Run this script to verify all security patches have been applied correctly

set -e

echo "=========================================="
echo "AetherGuard Security Fix Verification"
echo "Date: $(date)"
echo "=========================================="
echo ""

PASS=0
FAIL=0

# Test 1: Verify old .env files are deleted
echo "[Test 1] Checking .env files are deleted..."
if [ -f "/mnt/x/want/fsce/.env" ]; then
    echo "  ❌ FAIL: /mnt/x/want/fsce/.env still exists!"
    ((FAIL++))
else
    echo "  ✅ PASS: Main .env file deleted"
    ((PASS++))
fi

if [ -f "/mnt/x/want/fsce/backend/.env" ]; then
    echo "  ❌ FAIL: /mnt/x/want/fsce/backend/.env still exists!"
    ((FAIL++))
else
    echo "  ✅ PASS: Backend .env file deleted"
    ((PASS++))
fi

# Test 2: Verify .env.example exists
echo ""
echo "[Test 2] Checking .env.example exists..."
if [ -f "/mnt/x/want/fsce/.env.example" ]; then
    echo "  ✅ PASS: .env.example template exists"
    ((PASS++))
else
    echo "  ❌ FAIL: .env.example not found"
    ((FAIL++))
fi

# Test 3: Verify validation.ts exists
echo ""
echo "[Test 3] Checking validation.ts exists..."
if [ -f "/mnt/x/want/fsce/backend/src/utils/validation.ts" ]; then
    echo "  ✅ PASS: validation.ts created"
    ((PASS++))
else
    echo "  ❌ FAIL: validation.ts not found"
    ((FAIL++))
fi

# Test 4: Verify query-builder.ts exists
echo ""
echo "[Test 4] Checking query-builder.ts exists..."
if [ -f "/mnt/x/want/fsce/backend/src/utils/query-builder.ts" ]; then
    echo "  ✅ PASS: query-builder.ts created"
    ((PASS++))
else
    echo "  ❌ FAIL: query-builder.ts not found"
    ((FAIL++))
fi

# Test 5: Verify path-validation.ts exists
echo ""
echo "[Test 5] Checking path-validation.ts exists..."
if [ -f "/mnt/x/want/fsce/backend/src/middleware/path-validation.ts" ]; then
    echo "  ✅ PASS: path-validation.ts created"
    ((PASS++))
else
    echo "  ❌ FAIL: path-validation.ts not found"
    ((FAIL++))
fi

# Test 6: Verify firewall-controller.ts uses execFile
echo ""
echo "[Test 6] Checking firewall-controller.ts uses execFile..."
if grep -q "execFile" /mnt/x/want/fsce/backend/src/agent/firewall-controller.ts; then
    echo "  ✅ PASS: firewall-controller.ts uses execFile (safe)"
    ((PASS++))
else
    echo "  ❌ FAIL: firewall-controller.ts does not use execFile"
    ((FAIL++))
fi

# Test 7: Verify execAsync with template strings removed
echo ""
echo "[Test 7] Checking for unsafe execAsync patterns..."
UNSAFE_COUNT=$(grep -c 'execAsync.*\`.*\${' /mnt/x/want/fsce/backend/src/agent/firewall-controller.ts 2>/dev/null || echo "0")
if [ "$UNSAFE_COUNT" -eq 0 ]; then
    echo "  ✅ PASS: No unsafe execAsync patterns found"
    ((PASS++))
else
    echo "  ❌ FAIL: Found $UNSAFE_COUNT unsafe execAsync patterns"
    ((FAIL++))
fi

echo ""
echo "=========================================="
echo "Verification Complete"
echo "=========================================="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "✅ All security patches verified successfully!"
    exit 0
else
    echo "❌ Some verification tests failed. Please review the output above."
    exit 1
fi
