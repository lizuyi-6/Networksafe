type DashboardBroadcaster = (event: string, data: any) => void;

class DashboardBroadcastService {
  private broadcaster: DashboardBroadcaster | null = null;

  setBroadcaster(fn: DashboardBroadcaster | null): void {
    this.broadcaster = fn;
  }

  broadcast(event: string, data: any): void {
    this.broadcaster?.(event, data);
  }
}

export const dashboardBroadcastService = new DashboardBroadcastService();
