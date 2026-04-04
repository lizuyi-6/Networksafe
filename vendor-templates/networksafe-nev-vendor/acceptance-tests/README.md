# Acceptance Tests

The acceptance suite launches the mock control plane and the sanitized reference companion, then verifies:

- Register -> heartbeat -> data flow
- OTA dispatch and status progression
- Physical confirmation auto-flow for one high-risk command
- Negative-path confirmation rejection for stale counters and stale timestamps
- Offline device rejection after the companion disconnects
