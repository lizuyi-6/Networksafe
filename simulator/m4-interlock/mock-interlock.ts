/**
 * M4: Fail-closed Interlock Mock
 *
 * Simulates:
 * - DIN-rail relay (24V SPDT/DPDT, 10A rated)
 * - Feedback auxiliary contact (mechanically linked to main contact)
 * - Emergency stop button
 * - Confirmation button
 * - Stack light (red/yellow/green + buzzer)
 *
 * In real hardware:
 * - Controller drives relay coil via optocoupled GPIO output
 * - Feedback readback via optocoupled GPIO input (must match expected state)
 * - E-stop button is normally-closed, breaks relay circuit
 * - Stack light shows appliance state (isolated=red, armed=yellow, released=green)
 */

export type RelayState = 'open' | 'closed';
export type LightColor = 'red' | 'yellow' | 'green' | 'off';

export class MockInterlock {
  private relayState: RelayState = 'open';
  private feedbackState: RelayState = 'open';
  private estopPressed: boolean = false;
  private lightColor: LightColor = 'red';
  private buzzerOn: boolean = false;

  constructor() {
    console.log('⚪ [M4 Interlock] Relay: OPEN (isolated), Feedback: OPEN');
  }

  driveRelay(state: 'assert' | 'release'): void {
    if (this.estopPressed) {
      console.log('⚪ [M4 Interlock] ⛔ E-stop active, relay cannot release');
      this.relayState = 'open';
      this.feedbackState = 'open';
      return;
    }
    this.relayState = state === 'release' ? 'closed' : 'open';
    // Simulate feedback auxiliary contact (mechanically linked, no delay in mock)
    this.feedbackState = this.relayState;
    const icon = this.relayState === 'closed' ? '⚡' : '🚫';
    console.log(`⚪ [M4 Interlock] Relay: ${this.relayState.toUpperCase()} ${icon}, Feedback: ${this.feedbackState.toUpperCase()}`);
  }

  readFeedback(): boolean {
    // In real hardware: GPIO input HIGH when relay is closed, LOW when open
    return this.feedbackState === 'closed';
  }

  getRelayState(): RelayState {
    return this.relayState;
  }

  setLight(color: LightColor, buzzer: boolean = false): void {
    this.lightColor = color;
    this.buzzerOn = buzzer;
    const icon = { red: '🔴', yellow: '🟡', green: '🟢', off: '⚫' }[color];
    const buzz = buzzer ? ' 🔊' : '';
    console.log(`⚪ [M4 Interlock] Light: ${icon}${buzz}`);
  }

  pressEstop(): void {
    this.estopPressed = true;
    this.relayState = 'open';
    this.feedbackState = 'open';
    this.setLight('red', true);
    console.log('⚪ [M4 Interlock] 🛑 E-STOP PRESSED (relay forced open)');
  }

  releaseEstop(): void {
    this.estopPressed = false;
    this.buzzerOn = false;
    console.log('⚪ [M4 Interlock] E-stop released');
  }

  isEstopPressed(): boolean {
    return this.estopPressed;
  }
}

