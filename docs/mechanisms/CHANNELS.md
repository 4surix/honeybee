# Channels Mechanism

Each channel is identified by a **4-byte (32-bit) value**, and users can create channels following typing conventions based on the position of the **first non-zero quartet (nibble of 4 bits)**, scanned from the MSB (bit 31) down to the LSB (bit 0). Each type corresponds to a quartet holding a non-zero value `0x1`–`0xF` at a fixed position; the remaining 28 bits are free, which yields `15 × 2^28` channels for Public, `15 × 2^24` for Private, and so on. Two alias groups are used by the relay service order (§3) and the packet overview (`PACKET.md` §3.4): **`Global` = Public + Private**, **`Technical` = Testing + Reserved**.

### 1. Channel Structure (32-bit, retable)

> Only the 4-byte values below are valid.

#### 1.1. Channel Value Format

- **Size**: 4 bytes (32 bits).
- **Representation**: Unsigned integer (0x00000000 to 0xFFFFFFFF).
- **Convention**: The position of the first non-zero quartet (nibble of 4 bits), scanned from bit 31 down to bit 0, determines the channel type. A quartet holds 4 bits; a non-zero value `0x1`–`0xF` in that quartet selects the type.

#### 1.2. Channel Types (32-bit retable)

| **Type**             | **Hex range (32-bit)**           | **First non-zero quartet**        | **Number Channels** | **Description**                                                 |
| -------------------- | -------------------------------- | --------------------------------- | ------------------- | --------------------------------------------------------------- |
| **Public**           | `0x10000000` – `0xFFFFFFFF`      | Quartet 1 (bits 31–28) = `0x1`–`0xF` | 4 026 531 840 | Channels used for global communications.                        |
| **Private**          | `0x01000000` – `0x0FFFFFFF`      | Q1 = `0x0`, Quartet 2 (bits 27–24) = `0x1`–`0xF` | 251 658 240   | Channels used to specific communities or organizations.         |
| **Emergency**        | `0x00100000` – `0x00FFFFFF`      | Q1–Q2 = `0x0`, Quartet 3 (bits 23–20) = `0x1`–`0xF` | 15 728 640    | Priority channels for alerts or critical communications.        |
| **Team**             | `0x00010000` – `0x000FFFFF`      | Q1–Q3 = `0x0`, Quartet 4 (bits 19–16) = `0x1`–`0xF` | 983 040       | Channels used for teams or workgroups.                          |
| **Testing**          | `0x00001000` – `0x0000FFFF`      | Q1–Q4 = `0x0`, Quartet 5 (bits 15–12) = `0x1`–`0xF` | 61 440        | Channels used for testing, debugging, or technical uses.        |
| **Reserved**         | `0x00000000` – `0x00000FFF`      | Q1–Q7 = `0x0`; only quartet 8 (bits 11–0) may be non-zero | 4 096         | Channels reserved (see §2).                                     |

> Counts: Public `15 × 2^28` = 4 026 531 840; Private `15 × 2^24` = 251 658 240; Emergency `15 × 2^20` = 15 728 640; Team `15 × 2^16` = 983 040; Testing `15 × 2^12` = 61 440; Reserved `2^12` = 4 096 (incl. `0x00000000`). Total address space = 4 294 967 296 = 2^32; attributable channels = 4 294 967 295 after excluding `0x00000000`.

### 2. Channel Zero (0x00000000)

The value `0x00000000` is a technical special identifier and is **not attributable**. It must never be emitted, received, or relayed as a channel ID. Any implementation **shall reject `0x00000000`** at ingress and egress, before any channel-budget or PoW computation, to avoid uninitialized-memory bugs (an unassigned variable defaults to 0 and would otherwise be mistaken for a valid channel).

- **Status**: Invalid / No-Channel (non-routable).
- **Reserved usable range**: `0x00000001` – `0x00000FFF` (4 095 channels).

### 3. Relay queue service priority (normative, Relay §1d)

Service order only, never a bypass of any admission control:

| Priority | Channel types | Aliases |
| -------- | ------------- | ------- |
| `0` | **Emergency** | — |
| `1` | **Public**, **Private** | `Global` |
| `2` | **Team** | — |
| `3` | **Testing**, **Reserved** | `Technical` |

Priority `0` is the highest service class and **is served first** (lower index first); within a class, packets are served FIFO. `MISSING`/ECDRI retransmits first (reliability core), still paying the normal channel budget (guards in Relay §1d).

### 4. Routing & Packet Behaviors

- **Port Multiplexing:** Multiple applications on the same device can listen to different Channels simultaneously over the single BLE radio.
- **Data Agnostic:** The payload attached to a Channel is purely binary. Interpreting whether the bytes are JSON, Protobuf, audio, or game states is delegated to the destination application.
- **TTL:** Priority and TTL are specified in the packet header, independent of the Channel ID.

