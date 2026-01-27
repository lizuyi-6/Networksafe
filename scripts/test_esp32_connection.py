#!/usr/bin/env python3
"""
ESP32 Device Connection Test Script

Tests WebSocket communication between ESP32 deployment dongles
and the FluxGuard Control Platform.

Usage:
    python test_esp32_connection.py [--host HOST] [--port PORT]
"""

import argparse
import asyncio
import json
import sys
import time
import uuid
from datetime import datetime

try:
    import socketio
except ImportError:
    print("Error: python-socketio is required. Install with: pip install python-socketio")
    sys.exit(1)


class ESP32DeviceSimulator:
    """Simulates an ESP32 Deployment Dongle for testing"""
    
    def __init__(self, device_id: str = None, mac_address: str = None):
        self.device_id = device_id or str(uuid.uuid4())
        self.mac_address = mac_address or self._generate_mac()
        self.firmware_version = "1.2.0"
        self.status = "initializing"
        self.sio = socketio.AsyncClient()
        self.connected = False
        self.registered = False
        self.last_heartbeat = None
        
        self._setup_handlers()
    
    def _generate_mac(self) -> str:
        """Generate a random MAC address"""
        import random
        return ":".join([f"{random.randint(0, 255):02x}" for _ in range(6)]).upper()
    
    def _setup_handlers(self):
        """Setup Socket.IO event handlers"""
        
        @self.sio.event
        async def connect():
            print(f"[✓] Connected to server (device_id: {self.device_id})")
            self.connected = True
            self.status = "connected"
            await self._register()
        
        @self.sio.event
        async def disconnect():
            print(f"[✗] Disconnected from server")
            self.connected = False
            self.status = "disconnected"
        
        @self.sio.event
        async def connect_error(data):
            print(f"[!] Connection error: {data}")
            self.status = "error"
        
        @self.sio.on('command')
        async def on_command(data):
            print(f"[←] Received command: {json.dumps(data, indent=2)}")
            await self._handle_command(data)
        
        @self.sio.on('config_update')
        async def on_config_update(data):
            print(f"[←] Config update received: {json.dumps(data, indent=2)}")
        
        @self.sio.on('firmware_update')
        async def on_firmware_update(data):
            print(f"[←] Firmware update available: v{data.get('version')}")
            if data.get('force'):
                print("    [!] Force update requested")
    
    async def _register(self):
        """Register device with the server"""
        registration = {
            "deviceId": self.device_id,
            "type": "esp32",
            "macAddress": self.mac_address,
            "firmwareVersion": self.firmware_version,
            "capabilities": ["deployment", "monitoring", "console"],
            "timestamp": datetime.now().isoformat()
        }
        
        await self.sio.emit('device:register', registration)
        print(f"[→] Sent registration: {self.mac_address}")
        self.registered = True
    
    async def _handle_command(self, data: dict):
        """Handle commands from the server"""
        cmd_type = data.get('type')
        payload = data.get('payload', {})
        
        if cmd_type == 'ping':
            # Respond to ping
            await self.sio.emit('device:pong', {
                "deviceId": self.device_id,
                "timestamp": datetime.now().isoformat()
            })
            print("[→] Sent pong response")
        
        elif cmd_type == 'deploy_agent':
            # Simulate agent deployment
            target_server = payload.get('target')
            print(f"[*] Deploying agent to {target_server}...")
            await asyncio.sleep(2)  # Simulate deployment time
            
            await self.sio.emit('device:deploy_result', {
                "deviceId": self.device_id,
                "target": target_server,
                "success": True,
                "agentId": str(uuid.uuid4()),
                "timestamp": datetime.now().isoformat()
            })
            print(f"[→] Agent deployed successfully")
        
        elif cmd_type == 'run_diagnostic':
            # Simulate diagnostic
            print("[*] Running diagnostics...")
            await asyncio.sleep(1)
            
            await self.sio.emit('device:diagnostic_result', {
                "deviceId": self.device_id,
                "results": {
                    "freeHeap": 45678,
                    "uptimeMs": 123456,
                    "wifiRssi": -45,
                    "temperature": 32.5
                },
                "timestamp": datetime.now().isoformat()
            })
            print("[→] Diagnostic results sent")
        
        elif cmd_type == 'reboot':
            print("[!] Reboot command received - simulating reboot...")
            self.status = "rebooting"
            await asyncio.sleep(3)
            print("[✓] Device rebooted")
            self.status = "connected"
        
        else:
            print(f"[?] Unknown command type: {cmd_type}")
    
    async def send_heartbeat(self):
        """Send heartbeat to server"""
        heartbeat = {
            "deviceId": self.device_id,
            "status": self.status,
            "metrics": {
                "freeHeap": 48000 + (int(time.time()) % 5000),
                "uptimeMs": int(time.time() * 1000) % 10000000,
                "wifiRssi": -40 - (int(time.time()) % 20),
                "temperature": 30 + (int(time.time()) % 10)
            },
            "timestamp": datetime.now().isoformat()
        }
        
        await self.sio.emit('device:heartbeat', heartbeat)
        self.last_heartbeat = datetime.now()
        print(f"[→] Heartbeat sent (heap: {heartbeat['metrics']['freeHeap']})")
    
    async def send_alert(self, severity: str, message: str):
        """Send an alert to the server"""
        alert = {
            "deviceId": self.device_id,
            "severity": severity,
            "message": message,
            "timestamp": datetime.now().isoformat()
        }
        
        await self.sio.emit('device:alert', alert)
        print(f"[→] Alert sent: [{severity}] {message}")
    
    async def connect_to_server(self, host: str, port: int):
        """Connect to the FluxGuard Control Platform"""
        url = f"http://{host}:{port}"
        print(f"[*] Connecting to {url}...")
        
        try:
            await self.sio.connect(
                url,
                auth={
                    "type": "device",
                    "deviceId": self.device_id
                },
                wait_timeout=10
            )
        except Exception as e:
            print(f"[!] Failed to connect: {e}")
            raise
    
    async def disconnect(self):
        """Disconnect from server"""
        if self.connected:
            await self.sio.disconnect()
    
    async def run_heartbeat_loop(self, interval: int = 30):
        """Run heartbeat loop"""
        while self.connected:
            await self.send_heartbeat()
            await asyncio.sleep(interval)


async def run_test(host: str, port: int, duration: int = 60):
    """Run the ESP32 connection test"""
    print("=" * 60)
    print("FluxGuard ESP32 Device Connection Test")
    print("=" * 60)
    print()
    
    # Create device simulator
    device = ESP32DeviceSimulator()
    print(f"Device ID:  {device.device_id}")
    print(f"MAC Address: {device.mac_address}")
    print(f"Firmware:    v{device.firmware_version}")
    print()
    
    try:
        # Connect to server
        await device.connect_to_server(host, port)
        
        # Wait for registration
        await asyncio.sleep(1)
        
        if not device.registered:
            print("[!] Registration may have failed")
        
        # Run test scenarios
        print()
        print("-" * 40)
        print("Running test scenarios...")
        print("-" * 40)
        
        # Test 1: Send heartbeats
        print("\n[Test 1] Sending heartbeats...")
        for _ in range(3):
            await device.send_heartbeat()
            await asyncio.sleep(2)
        
        # Test 2: Send alerts
        print("\n[Test 2] Sending alerts...")
        await device.send_alert("info", "Device health check passed")
        await asyncio.sleep(1)
        await device.send_alert("warning", "WiFi signal strength low")
        await asyncio.sleep(1)
        
        # Test 3: Wait for commands
        print(f"\n[Test 3] Waiting for commands ({duration}s)...")
        print("         You can send commands from the dashboard.")
        
        start_time = time.time()
        while time.time() - start_time < duration:
            if not device.connected:
                print("[!] Lost connection")
                break
            await device.send_heartbeat()
            await asyncio.sleep(10)
        
        print()
        print("-" * 40)
        print("Test completed successfully!")
        print("-" * 40)
        
    except KeyboardInterrupt:
        print("\n[!] Test interrupted by user")
    
    except Exception as e:
        print(f"\n[!] Test failed: {e}")
        raise
    
    finally:
        await device.disconnect()
        print("[*] Disconnected from server")


def main():
    parser = argparse.ArgumentParser(
        description="Test ESP32 device connection to FluxGuard"
    )
    parser.add_argument(
        "--host",
        default="localhost",
        help="FluxGuard server host (default: localhost)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=3005,
        help="FluxGuard server port (default: 3005)"
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=60,
        help="Test duration in seconds (default: 60)"
    )
    
    args = parser.parse_args()
    
    try:
        asyncio.run(run_test(args.host, args.port, args.duration))
    except KeyboardInterrupt:
        print("\nTest aborted.")
        sys.exit(0)
    except Exception as e:
        print(f"\nTest failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
