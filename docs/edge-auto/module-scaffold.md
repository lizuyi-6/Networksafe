# Edge & Auto Module Scaffold

The internal scaffold entrypoint is:

```bash
npm run create:edge-auto-module -- --kind protocol --module canbus
```

Supported kinds:

- `protocol`
- `node_capability`
- `device_command_pack`

What the scaffold creates:

- backend module stub
- agent stub
- frontend manifest stub
- docs entry
- example manifest

Additional files for `protocol`:

- Rust evaluator stub
- fixture JSON
- backend test stub

The scaffold does not auto-register the module. After generation:

1. Register the manifest in `backend/src/services/protocol-module-registry.service.ts`.
2. Register the agent observer or adapter in `backend/src/agent/agent.ts`.
3. Register the Rust plugin in `rust-fastpath/src/protocols/registry.rs`.
4. Keep the frontend reading manifests from `GET /api/edge-auto/modules`; demo-only fixtures belong in `frontend/src/services/demo-data.ts`.
5. Add fixtures and end-to-end tests without editing the shared aggregation flow.
