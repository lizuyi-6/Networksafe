#!/usr/bin/env bash
sleep 28
echo "=== $(date -u +%H:%M:%S) milestones ==="
tail -n 8 /mnt/x/repos/Networksafe/ml/logs/milestones.log 2>/dev/null
