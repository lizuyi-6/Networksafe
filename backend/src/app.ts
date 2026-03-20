import { createControlPlaneApp } from './bootstrap/control-plane-app';
import { getRuntimeDescriptor } from './config/platform-runtime';
export { initializeAgentSystem } from './api/routes/ai-system.routes';

const runtime = getRuntimeDescriptor();

const app = createControlPlaneApp({
  runtime,
  getAgentCount: () => 0
});

export default app;
