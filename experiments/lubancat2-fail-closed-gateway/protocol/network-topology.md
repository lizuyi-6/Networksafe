# Network Topology (as-built, 2026-08-01)

```
                        HOME ROUTER (LAN 192.168.3.0/24, gw 192.168.3.1)
                          ^ WiFi (wlo1, 192.168.3.140)   ^ ethernet LAN port
                          | (bypass - OFF during tests)  |
   PROTECTED HOST         |                              |
   HP laptop, Ubuntu      |                              |
   eno1 00:68:eb:77:c7:4d |                              |
        |                 |                              |
        +-----------------+---- (1) Cat2 SERVER_IF eth? --+
                            |  LubanCat-2 (RK3568)       |
                            |  br0 (STP off, no IP)      |
                            +---- (2) Cat2 UPLINK_IF eth? +
                            |                            |
                            |  usb0 192.168.100.2 <------+---- USB RNDIS cable
                            +----------------------------+        |
                                                                  |
   OPERATOR CONSOLE (same laptop): board0 192.168.100.1 ----------+
   ssh board  (out-of-band management, never crosses the bridge)
```

- Cable (1): laptop `eno1` <-> Cat2 port designated SERVER_IF
- Cable (2): Cat2 port designated UPLINK_IF <-> router LAN port
- USB cable: laptop <-> Cat2 OTG/gadget port (management + power-safe
  control channel; also how the board was managed before this experiment)

Addressing:
- br0 has NO IP. Cat2 management = 192.168.100.2 on usb0 (out-of-band).
- Protected host gets DHCP from the router THROUGH the bridge, only while
  the gate is released (or during the open-bridge baseline).
- No NAT anywhere. No IP forwarding as a router on the Cat2.

Loop prevention: exactly two bridge member ports, one path; STP off is safe
in this linear topology. The experiment aborts if a second path appears
(e.g. someone cables the laptop directly to the router while eno1<->Cat2).
