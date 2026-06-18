
## Acknowledgement Mechanism  
  
  
> [Acknowledgement (data networks) - Wikipedia](https://en.wikipedia.org/wiki/Acknowledgement_(data_networks))

### Functioning

#### Lost ACK
If the ACK packet is lost, then nothing happens. Indeed, each packet is sent around the device; there are no specific intended recipients. The ACK serves to say, _"At least I received it!"_.

#### ELODRI logique (Ensure Least One Device Received It)

If we only wait to receive an ACK MISSING packet before resending a data packet, it's problematic if our data packet is lost without anyone receiving it. To increase the chances of a device receiving it, in backend task asynchronous, if after $\text{Numbers of packets in group} \times 3\text{s}$ there is not at least one ACK indicating that the sent data has been correctly received, then the data is resent and another $\text{Numbers of packets in group} \times 3\text{s}$  are waited. If after three attempts _(so, $3 \times \text{Numbers of packets in group} \times 3\text{s}$ after the first send, four packets sent in total)_, the process is abandoned.

```mermaid
%% Diagram of ELODRI Logic (Ensure Least One Device Received It)
flowchart TD
    %% Styles
    classDef start fill:#4CAF50,color:#fff,stroke:#2E7D32;
    classDef process fill:#E3F2FD,stroke:#90CAF9;
    classDef decision fill:#FFEB3B,stroke:#FFA000;
    classDef endNode fill:#F44336,color:#fff,stroke:#C62828;
    classDef timeout fill:#FF9800,color:#fff,stroke:#E65100;

    %% Start of the process
    A[Start: Send a packet]:::start

    %% Waiting for ACK
    B[Wait DELAY]:::process

    %% Decision: ACK received?
    C{ACK received?}:::decision

    %% If ACK received
    D[Packet received]:::process
    E[End: Success]:::endNode

    %% If no ACK received
    F[No ACK]:::decision
    G[Resend packet]:::process
    H[Wait DELAY]:::process

    %% Second attempt
    I{ACK received?}:::decision
    J[Packet received]:::process
    K[End: Success]:::endNode

    %% If still no ACK
    L[No ACK]:::decision
    M[Resend packet]:::process
    N[Wait DELAY]:::process

    %% Third attempt
    O{ACK received?}:::decision
    P[Packet received]:::process
    Q[End: Success]:::endNode

    %% After 3 attempts
    R[No ACK]:::decision
    S[Resend packet]:::process
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
        L1[DELAY = Numbers of packets in group x 3s]:::timeout
        L2[Max 3 attempts]:::process
    end
```

#### Priority
ACKs are processed with priority by the network.

### Types

| Bit    | Name        | Description |
| ------ | ----------- | ----------- |
| `0x01` | Missing     | The receiving device did not receive the packet. |
| `0x03` | Unabled     | The receiving device **cannot process** the packet. |
| `0x07` | Denied      | The receiving device **will not process** the packet. |
| `0x0F` | Duplicated  | The receiving device already received this packet. |
| `0x1F` | Succeeded   | The receiving device has received the entire packet(s) group. |
| `0x3F` | _Reserved_  | |
| `0x7F` | _Reserved_  | |
| `0xFF` | _Reserved_  | |

```mermaid
sequenceDiagram
    autonumber
    participant DeviceX as Your device
    participant DeviceN as Other device

    DeviceN ->> DeviceX: Packet Group 1 Index 1
    DeviceN ->> DeviceX: Packet Group 1 Index 2
    DeviceN ->> DeviceX: Packet Group 1 Index 3
    DeviceX ->> DeviceN: ACK Succeeded Group 1
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

    DeviceY ->> DeviceN: Packet Group 1 Index 1
    DeviceY ->> DeviceN: Packet Group 1 Index 2
    DeviceY ->> DeviceN: Packet Group 1 Index 3
    DeviceN ->> DeviceX: Packet Group 1 Index 1
    DeviceN -->> DeviceX: Lost Packet Group 1 Index 2
    DeviceN ->> DeviceX: Packet Group 1 Index 3
    DeviceX ->> DeviceN: MISSING Packet Group 1 Index 2
    DeviceN ->> DeviceX: Packet Group 1 Index 2
    DeviceX ->> DeviceN: ACK Succeeded Group 1
```
