# Evaluated network topology

```text
single-path victim network namespace
  agvictim0 10.99.0.2/24, fd42:ae7e:6a7d::2/64
      |
      | logical USB RNDIS function rndis.usb1
      v
Cat2 usb1 (SERVER_IF) -- membership gate -- agbr0 -- usb2 (UPLINK_IF)
                                                    |
                                                    | rndis.usb2
                                                    v
host aguplink0 10.99.0.1/24, fd42:ae7e:6a7d::1/64
                                                    |
                                                    +-- local TCP/UDP target

operator management interface 192.168.100.1/24
      |
      | existing rndis.gs0 logical function
      v
Cat2 usb0 192.168.100.2/24 (never an agbr0 member)
```

## Properties actually tested

- Cat2 is a physically separate SBC.
- `usb1` and `usb2` are logical data interfaces on the same composite USB
  gadget/controller/cable.
- `victim` has exactly one non-loopback network interface.
- The primary upstream target is local (`10.99.0.1`) so Internet availability
  does not decide pass/fail.
- Capture occurs on Cat2 `usb2` or an explicitly configured upstream capture
  interface. `usb1` receive counters are not treated as escape evidence.

## Properties not tested

The board's `eth0` and `eth1` ports were present but not connected. No result
exists for Ethernet negotiation, duplex, VLANs, PHY reset/link flap, cable
events, inline Ethernet behavior, or throughput. The logical USB management
channel is not physically out-of-band from the data functions.

## Runtime persistence

The committed transport scripts can recreate and tear down this topology, but
no persistence units are shipped. Reboot removes the temporary data functions
and bridge. A missing data path must not be reported as successful restoration
of an isolated operational gateway.
