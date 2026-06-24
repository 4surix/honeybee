## Channels Mechanism

Each channel is identified by a **3-byte (24-bit) value**, and users can create channels following typing conventions based on the position of the first `1` bit in the binary representation of this value.

### 1. Channel Structure

#### 1.1. Channel Value Format

- **Size**: 2 bytes (16 bits).
- **Representation**: Unsigned integer (0x0000 to 0xFFFF).
- **Convention**: The position of the first `1` bit (from the left) determines the channel type.

#### 1.2. Channel Types

| **Type**             | **Binary Format**     | **Number Channels** | **TTL** | **Description**                                                            |
| -------------------- | --------------------- | ------------------- | ---------------------- | -------------------------------------------------------------------------- |
| **Global**           | `1XXX XXXX XXXX XXXX` | 32 000              | High| Channels used for global communications. |
| **Community**        | `0001 XXXX XXXX XXXX` | 4 096               | Medium| Channels used to specific communities or organizations.               |
| **Team**             | `0000 001X XXXX XXXX` | 512                 | Low | Channels used for restricted teams or workgroups.                      |
| **Private**          | `0000 0000 01XX XXXX` | 64                  | Low | Channels for exchanges between a (very) small number of users.           |
| **Emergency**        | `0000 0000 0001 XXXX` | 16                  | High | Priority channels for alerts or critical communications.                   |
| **Technical & Test** | `0000 0000 0000 001X` | 2                   | Low| Channels used for testing, debugging, or technical uses.               |
| **Reserved**         | `0000 0000 0000 000X` | 2                   | - | Channels reserved.                              |

#### **1.3. Rules**

- Channel values must be unique within the same network.
- Value ranges must be respected to avoid conflicts between types.
