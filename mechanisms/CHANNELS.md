## Channels Mechanism

Each channel is identified by a **3-byte (24-bit) value**, and users can create channels following typing conventions based on the position of the first `1` bit in the binary representation of this value.

### 1. Channel Structure

#### 1.1. Channel Value Format

- **Size**: 3 bytes (24 bits).
- **Representation**: Unsigned integer (0x000000 to 0xFFFFFF).
- **Convention**: The position of the first `1` bit (from the left) determines the channel type.

#### 1.2. Channel Types

| **Type**             | **Binary Format**               | **Number of Channels** | **TTL** | **Description**                                                            |
| -------------------- | ------------------------------- | ---------------------- | ---------------------- | -------------------------------------------------------------------------- |
| **Global**           | `1XXX XXXX XXXX XXXX XXXX XXXX` | 8,388,608              | High| Channels used for global communications. |
| **Community**        | `0001 XXXX XXXX XXXX XXXX XXXX` | 2,097,152              | Medium| Channels used to specific communities or organizations.               |
| **Team**             | `0000 0001 XXXX XXXX XXXX XXXX` | 65,536                 | Low | Channels used for restricted teams or workgroups.                      |
| **Private**          | `0000 0000 0001 XXXX XXXX XXXX` | 4,096                  | Low | Channels for exchanges between a (very) small number of users.           |
| **Emergency**        | `0000 0000 0000 001X XXXX XXXX` | 2,048                  | High | Priority channels for alerts or critical communications.                   |
| **Technical & Test** | `0000 0000 0000 0001 XXXX XXXX` | 256                    | Low| Channels used for testing, debugging, or technical uses.               |
| **Reserved**         | `0000 0000 0000 0000 1XXX XXXX` | 128                    | - | Channels reserved.                              |

> **Note**: Values from `0x000000` to `0x00007F` are not assigned to any type and should be considered invalid.

#### 1.3. Communication Modes

The last bit (bit 0) of the channel value determines its communication mode:

- **Even (0)**: Listen-only *(the node can only receive messages)*.
- **Odd (1)**: Send + Listen *(the node can send and receive messages)*.

| **Mode**      | **Last Bit** | **Description**                                             |
| ------------- | ------------ | ----------------------------------------------------------- |
| Listen-only   | 0            | The node can only **receive** messages on this channel.     |
| Send + Listen | 1            | The node can **send and receive** messages on this channel. |

---

### **2. Rules**

#### **2.1. Value Assignment**

- Channel values must be unique within the same network.
- Value ranges must be respected to avoid conflicts between types.

#### **2.2. Mode Usage**

**Listen-only (even)**:
  - Used for broadcasts (ex: global announcements, read-only data streams).
  - Example: A Global channel in listen-only mode (ex: `0x800000`) can be used to broadcast updates to all nodes.

**Send + Listen (odd)**:
  - Used for interactive communications (ex: discussions, commands).
  - Example: A Team channel in send+listen mode (ex: `0x010001`) allows all team members to exchange messages.
