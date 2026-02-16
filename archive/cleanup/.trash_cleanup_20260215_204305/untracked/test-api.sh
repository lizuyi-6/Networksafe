#!/bin/sh
# Test login API
curl -s -X POST -H "Content-Type: application/json" -d '{"email":"admin@fluxguard.com","password":"admin123"}' http://localhost:3005/api/auth/login
