import { createControlPlaneApp } from './bootstrap/control-plane-app';
import { getRuntimeDescriptor } from './config/platform-runtime';
export { initializeAgentSystem } from './services/agent-system.service';

const runtime = getRuntimeDescriptor();

const app = createControlPlaneApp({
  runtime,
  getAgentCount: () => 0
});

export default app;
