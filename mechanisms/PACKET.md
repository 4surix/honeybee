
## Packet Mechanism

<img src="../img-frame.png">

### 0. Common Format (3 bytes)

| Field         | Bytes | Description                                        | Example              |
| ------------- | ----- | -------------------------------------------------- | -------------------- |
| **ID**        | 1     | Protocol identifier (`0xAA`).                      | `0xAA`               |
| **TTL**       | 1     | Number of allowed relays (decremented per relay).  | `0x05`               |
| **Type**      | 1     | Type of the packet.                                | `0x01`               |

#### 0.1 ID

The first 8 bits of the frame. Used to identify the protocol. If the frame does not begin with `0xAA`, then the received packet uses a different protocol. You can automatically reject it.

#### 0.2 TTL

The TTL indicates the number of times the packet must be relayed by any device. It prevents the packet from traveling too far unnecessarily.

#### 0.3 Type

Type provide information about the type of packet?

| Bit    | Description |
| ------ | ----------- |
| `0x01` | Informations    |
| `0x03` | Neighbor    |
| `0x07` | Message  |
| `0x0F` | ACK  |
| `0x1F` | _Reserved_  |
| `0x3F` | _Reserved_  |
| `0x7F` | _Reserved_  |
| `0xFF` | _Reserved_  |

---

### **1. Informations Format (31 bytes)**

| Field         | Bytes | Description                                        | Example              |
| ------------- | ----- | -------------------------------------------------- | -------------------- |
| **Sender**    | 3     | Identifiant of the sender.                         | `0x123456`           |
| **Role**      | 1     | Primary `0x01` ou Secondary `0x02`.                | `0x01`               |
| **Score**     | 1     |                                                    | `0x12`               |
| **Neighbor**  | 1     | Number of the neighbor.                            | `0xA1`               |
| **Primary**   | 1     | Number of the primary neighbor.                    | `0x01`               |
| **Devices ID Primary** | 21    | Contains max seven (7) devices ID.        |                      |

---

### **2. Neighbors Format (31 bytes)**

| Field         | Bytes | Description                                        | Example              |
| ------------- | ----- | -------------------------------------------------- | -------------------- |
| **Sender**    | 3     | Identifiant of the sender.                         | `0x123456`           |
| **Neighbor**  | 1     | Number of the neighbor.                            | `0xA1`               |
| **Devices ID Neighbor** | 24    | Contains max eight (8) devices ID.       |                      |

---

### **3. Message Format (31 bytes)**

| Field         | Bytes | Description                                        | Example              |
| ------------- | ----- | -------------------------------------------------- | -------------------- |
| **Sender**    | 3     | Identifiant of the sender.                         | `0x123456`           |
| **Channel**   | 3     | Identifiant of the channel.                        | `0x011145`           |
| **Random**    | 5     | Random number between 0 and 2^40.                  | `0x1234567890`       |
| **MIC**       | 5     | AES-CCM authentication tag. Message integrity check.   | `0xA1B2C3D4`     |
| **Encrypted** | 12    | Contains `Next (2) + Payload (10)` (encrypted).    | See below            |

#### 3.2. Channel (3 byte)

| **Type**             | **Binary Format**               | **Description**                          |
| -------------------- | ------------------------------- | ---------------------------------------- |
| **Global**           | `1XXX XXXX XXXX XXXX XXXX XXXX` | Channels used for global communications. |
| **Community**        | `0001 XXXX XXXX XXXX XXXX XXXX` | Channels used to specific communities or organizations. |
| **Team**             | `0000 0001 XXXX XXXX XXXX XXXX` | Channels used for teams or workgroups.   |
| **Private**          | `0000 0000 0001 XXXX XXXX XXXX` | Channels for exchanges between a (very) small number of users.  |
| **Emergency**        | `0000 0000 0000 001X XXXX XXXX` | Priority channels for alerts or critical communications.   |
| **Technical & Test** | `0000 0000 0000 0001 XXXX XXXX` | Channels used for testing, debugging, or technical uses.   |
| **Reserved**         | `0000 0000 0000 0000 1XXX XXXX` | Channels reserved.                              |


#### 3.3. Random (5 byte)

The randomly generated number serves two purposes:
- It prevents two packets sent over the network from having the same IV.
- It prevents an attacker from predicting the next IV packet.

#### 3.4. MIC (5 bytes)

AES-CCM authentication tag. Message integrity check.  

#### 3.5. Encrypted Payload (12 bytes)

| Field       | Bytes | Description                                                                   |
| ----------- | ----- | ----------------------------------------------------------------------------- |
| **Next**    | 2     | Link to next packet: `hash(channel + next_next + next_payload) % 2^16`. </br>`0x000000` for last packet. |
| **Payload** | 10    | Actual data.                                                                  |

Calculating the Next value strengthens the chain's integrity. By performing `hash(Channel + Next (next packet) + Payload (next packet))` in the packet's Next value, each packet is cryptographically linked to:
- Channel (to prevent confusion between channel).
- Next value of the following packet (to prevent packet reordering).
- Payload of the following packet (to prevent modifications).

Furthermore, an attacker can no longer replace a packet with one from a different channel, because the Next value would be different.

---

### **4. ACK Format (31 bytes)**

| Field         | Bytes | Description                                        | Example              |
| ------------- | ----- | -------------------------------------------------- | -------------------- |
| **Sender**    | 3     | Identifiant of the sender.                         | `0x123456`           |
| **Channel**   | 3     | Identifiant of the channel.                        | `0x123456`           |
| **IV**        | 11    | IV of the packet concerned.                        | `0xA1B2C3D4E5F6A7B8C9A1B2` |
| **Type**      | 1     | Type of the ACK.                                   | `0x04`               |
