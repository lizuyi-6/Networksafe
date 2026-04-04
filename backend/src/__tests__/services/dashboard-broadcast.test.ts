/**
 * Dashboard Broadcast Service Tests
 */

import { dashboardBroadcastService } from '../../services/dashboard-broadcast.service';

describe('DashboardBroadcastService', () => {
  afterEach(() => {
    dashboardBroadcastService.setBroadcaster(null);
  });

  it('broadcast calls the registered broadcaster', () => {
    const mockFn = jest.fn();
    dashboardBroadcastService.setBroadcaster(mockFn);

    dashboardBroadcastService.broadcast('test-event', { key: 'value' });

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith('test-event', { key: 'value' });
  });

  it('broadcast does nothing when no broadcaster is set', () => {
    dashboardBroadcastService.setBroadcaster(null);

    expect(() => dashboardBroadcastService.broadcast('event', {})).not.toThrow();
  });

  it('setBroadcaster replaces the previous broadcaster', () => {
    const mockFn1 = jest.fn();
    const mockFn2 = jest.fn();

    dashboardBroadcastService.setBroadcaster(mockFn1);
    dashboardBroadcastService.setBroadcaster(mockFn2);

    dashboardBroadcastService.broadcast('event', {});

    expect(mockFn1).not.toHaveBeenCalled();
    expect(mockFn2).toHaveBeenCalledTimes(1);
  });

  it('setBroadcaster(null) clears the broadcaster', () => {
    const mockFn = jest.fn();

    dashboardBroadcastService.setBroadcaster(mockFn);
    dashboardBroadcastService.setBroadcaster(null);

    dashboardBroadcastService.broadcast('event', {});

    expect(mockFn).not.toHaveBeenCalled();
  });
});
