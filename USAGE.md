# Usage Guide

This guide explains how to **send, receive, and relay messages** using the protocol.

---

## **1. Sending a Message**

### **1.1 Steps**

1. Split the message into 12-byte fragments.
2. For each fragment:
  - Compute `Next = (group + next_next + next_payload) % 2^24`. 
  For the last `Next = 0`.
  - Encrypt the fragment with AES-CCM (unique IV, group key).
3. Send packets with:
  - `TTL` (ex: 5 for local relaying).
  - `Flags` (ex: `0x01` for urgent).
  - `Group` (ex: `0x18` for a local group).

### **1.2 Example (Python)**

```python
import os

from implementation import create_packet, generate_next


# Message to send
message = b"username: Hello! This is a test message."
fragments = [message[i:i+12] for i in range(0, len(message), 12)]

# Group key shared with receivers
GROUP_KEY = os.urandom(32)
GROUP_ID = 0x18

# Create and send packets
for i, fragment in enumerate(fragments):
    next_field = (
        b'\x00\x00\x00' if i == len(fragments) - 1 
        else 
            generate_next(fragments[i+1])
    )
    # Group (1) + Random (2) + Counter (5)
    iv = GROUP_ID + os.urandom(2) + i.to_bytes(5, byteorder='big')
    packet = create_packet(
        ttl = 5,
        flags = 0x00,
        group = GROUP_ID,
        iv = iv,
        next_field = next_field,
        payload = fragment,
        key = GROUP_KEY
    )
    # Send packet via BLE (ex: using 'bleak' library)
    print(f"Sending packet {i+1}: {packet.hex()}")
```

---

## 2. Receiving a Message

### **2.1 Steps**

1. Receive a packet.
2. Verify its protocol ID (`0xAA`).
3. Verify its AES-CCM MIC.
4. **If `Next != 0x000000`**:
  - Store the packet and wait for the next one with the matching `Next` field.
5. **If `Next == 0x000000`**:
  - Reconstruct the message by chaining packets via `Next`.
  - Verify the integrity of each packet (via `Next` and MIC).

---

## **3. Relaying a Packet**

### **3.1 Steps**

1. Receive a packet
2. Verify its protocol ID (`0xAA`).
3. Check TTL:
  - If `TTL == 0`, discard the packet.
  - Else, decrement TTL by 1.
4. Re-transmit the packet (unchanged except for TTL).

### 3.2 Example

```python
def relay_packet(packet: bytes) -> bool:
    if packet[0] != 0xAA:  # Not this protocol
        return False

    ttl = packet[1]
    if ttl == 0:
        return False  # Do not relay

    new_ttl = ttl - 1
    new_packet = bytearray(packet)
    new_packet[1] = new_ttl  # Update TTL

    # Re-transmit new_packet
    return True
```

---

## **4. Group Management**

### **4.1 Creating a Group**

1. Generate a unique key (32 bytes) for the group.
2. Share the key securely with all the people involved in the group (ex: via QR code).

### **4.2 Example (Key Generation)**

```python
import os

GROUP_KEY = os.urandom(32)  # 32-byte key
GROUP_ID = 0x18  # Example group ID
```

---

## **5. Handling Errors**

| Error               | Cause                          | Solution                                 |
| ------------------- | ------------------------------ | ---------------------------------------- |
| **Invalid MIC**        | Packet tampered or corrupted.  | Discard the packet.                      |
| **Missing Packet**      | `Next` field does not match.   | Keep and wait, or discard chain. |
| **Unknown Group**       | Group ID not recognized.       | Discard the packet.                      |
| **Invalid Protocol ID** | Not this protocol.              | Discard the packet.                      |
