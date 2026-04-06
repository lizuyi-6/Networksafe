import 'dotenv/config';
import { createServer } from 'http';
import { closeDatabase } from './config/database';
import { getRuntimeDescriptor } from './config/platform-runtime';
import { bootstrapPersistence } from './bootstrap/persistence';
import { createControlPlaneApp } from './bootstrap/control-plane-app';
import { validateRuntimeEnvironment } from './bootstrap/runtime-env';
import logger from './utils/logger';
import { AgentGateway } from './websocket/agent-gateway';
import { DeviceGateway } from './websocket/device-gateway';
import { setAgentGateway } from './api/routes/agents.routes';
import {
  initializeAgentSystem,
  setAgentGateway as setAISystemAgentGateway
} from './services/agent-system.service';
import {
  getDeviceById,
  executeDeviceCommandInternal,
  setDeviceCommandTransport
} from './services/device-registry.service';
import { scannerTaskService } from './services/scanner-task.service';
import { runtimeEmulatorService } from './services/runtime-emulator.service';
import { commandDispatcherService } from './services/command-dispatcher.service';
import { postgresShadowStoreService } from './services/postgres-shadow-store.service';
import { notificationDispatcherService } from './services/notification-dispatcher.service';
import { deviceControlService } from './services/device-control.service';
import { artifactStoreService } from './services/artifact-store.service';
import { jobQueueService } from './services/job-queue.service';
import { dashboardBroadcastService } from './services/dashboard-broadcast.service';

const runtime = getRuntimeDescriptor();
let agentGateway: AgentGateway | null = null;
let deviceGateway: DeviceGateway | null = null;

const app = createControlPlaneApp({
  runtime,
  getAgentCount: () => agentGateway?.getOnlineCount() || 0
});
const httpServer = createServer(app);

function configureRealtimeRuntime(): void {
  if (runtime.gatewayEnabled) {
    agentGateway = new AgentGateway(httpServer);
    deviceGateway = new DeviceGateway(httpServer);
    dashboardBroadcastService.setBroadcaster((event, data) => {
      agentGateway?.broadcastToDashboards(event, data);
    });
    deviceGateway.setDashboardBroadcaster((event, data) => {
      dashboardBroadcastService.broadcast(event, data);
    });
    deviceControlService.setGatewayEmitter((deviceId, command, params) =>
      deviceGateway!.sendCommand(deviceId, command, params)
    );

    setAgentGateway(agentGateway);
    setAISystemAgentGateway(agentGateway);
    commandDispatcherService.setAgentGateway(agentGateway);
    commandDispatcherService.setDeviceAdapter({
      getDevice: getDeviceById,
      executeCommand: executeDeviceCommandInternal
    });
    setDeviceCommandTransport((deviceId, command, params) =>
      deviceGateway!.sendCommand(deviceId, command, params)
    );
    scannerTaskService.setBroadcaster((event, data) => {
      dashboardBroadcastService.broadcast(event, data);
    });

    if (runtime.emulatorEnabled) {
      runtimeEmulatorService.start(agentGateway);
    } else {
      runtimeEmulatorService.stop();
    }
    return;
  }

  setAgentGateway(null);
  setAISystemAgentGateway(null as any);
  commandDispatcherService.setAgentGateway(null);
  commandDispatcherService.setDeviceAdapter(null);
  setDeviceCommandTransport(null);
  deviceControlService.setGatewayEmitter(null);
  dashboardBroadcastService.setBroadcaster(null);
  scannerTaskService.setBroadcaster(() => undefined);
  runtimeEmulatorService.stop();
}

async function start(): Promise<void> {
  const port = Number(process.env.PORT || 8080);

  try {
    const envReport = validateRuntimeEnvironment();
    await bootstrapPersistence();
    configureRealtimeRuntime();

    if (runtime.workerEnabled) {
      await scannerTaskService.startWorker();
    }

    notificationDispatcherService.startWorker();

    if (runtime.schedulerEnabled) {
      postgresShadowStoreService.startResyncLoop();
    }

    if (runtime.apiEnabled) {
      try {
        await initializeAgentSystem();
        logger.info('Multi-Agent Decision System initialized');
      } catch (agentError: any) {
        logger.warn('Multi-Agent System initialization failed, continuing without AI agents', {
          error: agentError.message
        });
      }
    }

    httpServer.listen(port, () => {
      logger.info('AetherGuard Control Platform started', {
        port,
        runtime,
        queueBackend: jobQueueService.backend(),
        artifactStore: artifactStoreService.describe(),
        shadowStore: postgresShadowStoreService.describe(),
        envWarnings: envReport.warnings
      });
    });
  } catch (error: any) {
    logger.error('Failed to start server', { error: error?.message || error });
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  try {
    scannerTaskService.stopWorker();
    notificationDispatcherService.stopWorker();

    if (agentGateway) {
      agentGateway.close();
      agentGateway = null;
    }
    if (deviceGateway) {
      deviceGateway.close();
      deviceGateway = null;
    }
    dashboardBroadcastService.setBroadcaster(null);

    runtimeEmulatorService.stop();

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch(() => undefined);

    await postgresShadowStoreService.close();
    closeDatabase();

    logger.info('Shutdown complete');
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error?.message || error });
  }

  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});

// Export for routes to access device gateway
export function getDeviceGateway(): DeviceGateway | null {
  return deviceGateway;
}

void start();

export default app;
export { agentGateway, start };
