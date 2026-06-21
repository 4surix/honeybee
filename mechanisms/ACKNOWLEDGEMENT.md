
## Acknowledgement Mechanism  
  
> [Acknowledgement (data networks) - Wikipedia](https://en.wikipedia.org/wiki/Acknowledgement_(data_networks))

### Functioning

#### Lost ACK
If the ACK packet is lost, then nothing happens. Indeed, each packet is sent around the device; there are no specific intended recipients. The ACK serves to say, _"At least I received it!"_.

#### ELODRI logique (Ensure Least One Device Received It)

If we only wait to receive an ACK MISSING packet before resending a data packet, it's problematic if our data packet is lost without anyone receiving it. To increase the chances of a device receiving it, if after $\mathrm{Numbers\\_of\\_packets\\_in\\_chain} \times 1\mathrm{s}$ of the last packet in the chain send, there is not at least one `ACK Successed`, then the first packet of the `Chain` is resent and another $\mathrm{Numbers\\_of\\_packets\\_in\\_chain} \times 1\mathrm{s}$ are waited. If after three attempts the process is abandoned.

```mermaid
%% Diagram of ELODRI Logic (Ensure Least One Device Received It)
flowchart TD

    A[Start: Send a packet chain]:::start
    B[Wait DELAY]:::process
    C{ACK Succeeded received?}:::decision

    %% If ACK received
    D[ACK Succeeded received]:::process
    E[End: Success]:::endNode

    %% If no ACK received
    F[No ACK Succeeded]:::decision
    G[Resend the first packet of the chain]:::process
    H[Wait DELAY]:::process

    %% Second attempt
    I{ACK Succeeded received?}:::decision
    J[ACK Succeeded received]:::process
    K[End: Success]:::endNode

    %% If still no ACK
    L[No ACK Succeeded]:::decision
    M[Resend the first packet of the chain]:::process
    N[Wait DELAY]:::process

    %% Third attempt
    O{ACK received?}:::decision
    P[ACK Succeeded received]:::process
    Q[End: Success]:::endNode

    %% After 3 attempts
    R[No ACK Succeeded]:::decision
    S[Resend the first packet of the chain]:::process
    U[End: Abandon]:::endNode

    %% Connections
    A --> B --> C
    C -->|Yes| D --> E
    C -->|No| F --> G --> H --> I
    I -->|Yes| J --> K
    I -->|No| L --> M --> N --> O
    O -->|Yes| P --> Q
    O -->|No| R --> S --> U

    %% Legend
    subgraph Legend
        direction TB
        L1[DELAY = Numbers of packets in group x 1s]:::timeout
        L2[Max 3 attempts]:::process
    end
```

#### Priority
ACKs are processed with priority by the network.

### Types

| Bit    | Name        | Description |
| ------ | ----------- | ------------------------------------------------------------- |
| `0x01` | Missing     | The receiving device did not receive the packet.              |
| `0x03` | Unabled     | The receiving device **cannot process** the packet.           |
| `0x07` | Denied      | The receiving device **will not process** the packet.         |
| `0x0F` | Duplicated  | The receiving device already received this packet.            |
| `0x1F` | Succeeded   | The receiving device has received the entire packet(s) group. |
| `0x3F` | Confirmed   | The sender device confirm has received the ACK Succeeded.     |
| `0x7F` | _Reserved_  | |
| `0xFF` | _Reserved_  | |

```mermaid
sequenceDiagram
    autonumber
    participant DeviceX as Your device
    participant DeviceN as Other device

    DeviceN ->> DeviceX: Packet Chain 1 Last 3 Index 1
    DeviceN ->> DeviceX: Packet Chain 1 Last 3 Index 2
    DeviceN ->> DeviceX: Packet Chain 1 Last 3 Index 3
    DeviceX ->> DeviceX: Check no packet missing
    DeviceX ->> DeviceN: ACK Succeeded Chain 1 Last 3 Index 3
    DeviceN ->> DeviceX: ACK Confirmed Chain 1 Last 3 Index 3
```

If we are missing a packet, we must send an ACK packet with the type `MISSING` and the IV of the missing packet.

When a device receives a `MISSING`, it checks if it has the packet :
- If it has it, it doesn't relay the `MISSING` and sends the packet.
- If it doesn't have it, it relays the `MISSING`.

```mermaid
sequenceDiagram
    autonumber
    participant DeviceX as Your device
    participant DeviceN as Any device
    participant DeviceY as Other device

    DeviceY ->> DeviceN: Packet Chain 1 Last 3 Index 1
    DeviceY ->> DeviceN: Packet Chain 1 Last 3 Index 2
    DeviceY ->> DeviceN: Packet Chain 1 Last 3 Index 3

    DeviceN ->> DeviceN: Check no packet missing
    DeviceN ->> DeviceY: ACK Succeeded Chain 1 Last 3 Index 1
    DeviceY ->> DeviceN: ACK Confirmed Chain 1 Last 3 Index 1

    DeviceN ->> DeviceX: Packet Chain 1 Last 3 Index 1
    DeviceN -->> DeviceX: Lost Packet Chain 1 Last 3 Index 2
    DeviceN ->> DeviceX: Packet Chain 1 Last 3 Index 3

    DeviceX ->> DeviceX: Check no packet missing
    DeviceX ->> DeviceN: ACK Missing Chain 1 Last 3 Index 2
    DeviceN ->> DeviceX: Packet Chain 1 Last 3 Index 2

    DeviceX ->> DeviceX: Check no packet missing
    DeviceX ->> DeviceN: ACK Succeeded Chain 1 Last 3 Index 1
    DeviceN ->> DeviceX: ACK Confirmed Chain 1 Last 3 Index 1
```
