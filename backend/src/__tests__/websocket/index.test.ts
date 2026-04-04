describe('websocket/index', () => {
  it('exports AgentGateway', () => {
    const { AgentGateway } = require('../../websocket');
    expect(AgentGateway).toBeDefined();
    expect(typeof AgentGateway).toBe('function');
  });
  it('exports DeviceGateway', () => {
    const { DeviceGateway } = require('../../websocket');
    expect(DeviceGateway).toBeDefined();
    expect(typeof DeviceGateway).toBe('function');
  });
  it('AgentGateway is a class constructor', () => {
    const { AgentGateway } = require('../../websocket');
    // AgentGateway should be a class (function with prototype)
    expect(AgentGateway.prototype.constructor).toBe(AgentGateway);
  });
  it('DeviceGateway is a class constructor', () => {
    const { DeviceGateway } = require('../../websocket');
    expect(DeviceGateway.prototype.constructor).toBe(DeviceGateway);
  });
});
