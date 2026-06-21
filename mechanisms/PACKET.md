
## Packet Mechanism

<img src="../img-frame.png">

0. [Head Common Format](#common)
1. [Informations Format](#informations)
2. [Neighbors Format](#neighbors)
3. [Message Format](#message)
4. [ACK Format](#ack)
  
---

<a name="common"></a>

### 0. Head Common Format (2 bytes)

| Field         | Bytes | Description                                  | Example              |
| ------------- | ----- | -------------------------------------------- | -------------------- |
| **ID**        | 5/8   | Protocol identifier (`10100`).               | `10100`              |
| **Type**      | 3/8   | Type of the packet.                          | `010`                |

#### 0.1 ID

The first 5 bits of the frame. Used to identify the protocol. If the frame does not begin with `10100`, then the received packet uses a different protocol. You can automatically reject it.

#### 0.2 Type

Type provide information about the type of packet.

| Bits   | Description     |
| ------ | --------------- |
| `000`  | _Reserved_      |
| `001`  | Informations    |
| `010`  | Neighbor        |
| `011`  | Message         |
| `100`  | ACK             |
| `101`  | _Reserved_      |
| `110`  | _Reserved_      |
| `111`  | _Reserved_      |

---

<a name="informations"></a>

### **1. Informations Format (7-29 bytes)**

| Field         | Bytes | Description                                    | Example              |
| ------------- | ----- | ---------------------------------------------- | -------------------- |
| **Sender**    | 2     | Identifiant of the sender.                     | `0x1234`             |
| **Role**      | 1     | Primary `0x01` ou Secondary `0x02`.            | `0x01`               |
| **Score**     | 1     |                                                | `0x12`               |
| **Neighbor**  | 1     | Number of the neighbor.                        | `0xA1`               |
| **Primary**   | 1     | Number of the primary neighbor.                | `0x01`               |
| **Devices Primary** | 24    | Contains, min 0, max 12 devices ID.      | -                    |

---

<a name="neighbors"></a>

### **2. Neighbors Format (3-29 bytes)**

| Field         | Bytes | Description                                    | Example              |
| ------------- | ----- | ---------------------------------------------- | -------------------- |
| **Sender**    | 2     | Identifiant of the sender.                     | `0x123456`           |
| **Neighbor**  | 1     | Number of the neighbor.                        | `0xA1`               |
| **Devices Neighbor** | 26    | Contains, min 0, max 13 devices ID.     | -                    |

---

<a name="message"></a>

### **3. Message Format (16-29 bytes)**

| Field         | Bytes | Description                                      | Example            |
| ------------- | ----- | ------------------------------------------------ | ------------------ |
| **TTL**       | 1     | Number of allowed relays (decremented per relay).| `0x05`             |
| **List**      | 2     | -                                                | See below          |
| **Sender**    | 2     | Identifiant of the sender.                       | `0x1234`           |
| **Channel**   | 2     | Identifiant of the channel.                      | `0x0111`           |
| **Random**    | 4     | Random number between 0 and 2^40.                | `0x12345678`       |
| **MIC**       | 6     | AES-CCM authentication tag. Message integrity check. | `0xA1B2C3D4E5` |
| **Payload**   | 1-13  | -                                                | See below          |

#### 3.1. TTL

The TTL indicates the number of times the packet must be relayed by any device. It prevents the packet from traveling too far unnecessarily.

#### 3.2. List (2 bytes, 16 bits)

| Field         | Bits  | Description                                      | Example            |
| ------------- | ----- | ------------------------------------------------ | ------------------ |
| **Chain**     | 4     | Chain ID for the actual Sender ID.               | `0010`             |
| **Last**      | 6     | Index of the last packet in the group.           | `010011`           |
| **Index**     | 6     | Position of the packet in the group.             | `000010`           |

##### 3.2.1 Chain
  
Specifies the packet chain identifier.   
A maximum of 16 chains can be created per `Sender ID`.   
Initially, the first chain value is 0.  
The value increments by 1 for each new chain created.  
Once the value reaches 15, no further chains can be created; one must wait for the `Sender ID` to change for the `Chain` value to reset to 0.  
  
##### 3.2.2 Last

This field specifies the index of the last packet in the packet chain. This makes it possible to determine how many packets make up the chain and to create the list (which will hold each packet) with the correct size.
  
##### 3.2.3 Index

The position of the packet in the chain.

#### 3.3. Sender (2 byte)

The device sent the packet.

#### 3.4. Channel (2 byte)

| **Type**             | **Binary Format**     | **Description**                          |
| -------------------- | --------------------- | ---------------------------------------- |
| **Global**           | `1XXX XXXX XXXX XXXM` | Channels used for global communications. |
| **Community**        | `0001 XXXX XXXX XXXM` | Channels used to specific communities or organizations. |
| **Team**             | `0000 0001 XXXX XXXM` | Channels used for teams or workgroups.   |
| **Private**          | `0000 0000 001X XXXM` | Channels for exchanges between a (very) small number of users.  |
| **Emergency**        | `0000 0000 0001 XXXM` | Priority channels for alerts or critical communications.   |
| **Technical & Test** | `0000 0000 0000 001M` | Channels used for testing, debugging, or technical uses.   |
| **Reserved**         | `0000 0000 0000 000M` | Channels reserved.                              |

#### 3.5. Random (4 byte)

The randomly generated number serves two purposes:
- It prevents two packets sent over the network from having the same IV.
- It prevents an attacker from predicting the next IV packet.

#### 3.6. MIC (6 bytes)

AES-CCM authentication tag. Message integrity check. 

#### 3.7. Encrypted Payload & Compressed data (1-13 bytes)

**Compression algorithms**  
  
| Algorithm | Identifier | Description                                       |
| --------- | ---------- | ------------------------------------------------- |
| SMAZ      | `0x01`     | For small data _(less, or egal, than 200 bytes)_  |
| LZ4       | `0x02`     | For large data _(more than 200 bytes)_            |

---

<a name="ack"></a>

### **4. ACK Format (7 bytes)**

| Field         | Bytes | Description                                  | Example              |
| ------------- | ----- | -------------------------------------------- | -------------------- |
| **Sender**    | 2     | The device sent the packet.                  | `0x1234`             |
| **List**      | 2     | `List` of the packet concerned.              | `0x0471`             |
| **Sender**    | 2     | `Sender ID` of the packet concerned.         | `0x1234`             |
| **Channel**   | 2     | `Channel ID` of the packet concerned.        | `0x1234`             |
| **Type**      | 1     | Type of the ACK.                             | `0x04`               |
