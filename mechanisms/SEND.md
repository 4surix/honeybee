## Send Mechanism

### 1. Construction

#### 1.1 Type 3 : Message

1. Check if `TTL > 0`.
2. The data, if size is upper than 50, is compressed using `Deflate (zlib)`.
3. A byte is added at the beginning to indicate the compression type: `Type (1)` + `Compressed? Data (...)`.
4. The compression is divided into 13-byte segments. Starting from the end, we work backward to the first segment. For each segment, a packet is created:
    1. A random number between 0 and 2^32 is generated.
    2. The IV is constructed using: the list info, the sender identifier, the channel identifier, and the random number.
    3. The 13-byte portion is encrypted using `AES-CCM (IV=10, MIC=6)`, resulting in a 6-byte MIC.

### 2. Delay: Token Bucket Algorithm
  
[Wikipedia - Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)  
  
#### 2.1. Principles

The algorithm regulates the flow of data packets while allowing for short bursts, which is essential for transmitting fragmented messages.

- **Token Regeneration Rate ($R$):** 2 tokens per 2 seconds. 1 token per 2 seconds for 15 seconds if an `ACK Unabled` received. This maintains the required average throughput of approximately 840 bytes per minute.
- **Bucket Capacity ($C$):** 10 tokens. This limit is aligned with the **Active Dropping** threshold of Primary nodes to prevent silent packet rejection.
- **Token Consumption:** Each Message _(Type 011)_ packet sent consumes exactly one token.

#### 2.2. Traffic Classification and Priority

HoneyBee distinguishes between two tiers of traffic for the Token Bucket implementation:

1.  **Low Priority (Data):** Includes all Message (Type 011) packets and their associated fragments. These packets must consume a token before transmission. If the bucket is empty, packets are queued in a local buffer (up to 1000 packets).
2.  **High Priority (Control):** Includes Informations, Neighbor, and ACK packets. These packets bypass the Token Bucket and are transmitted immediately to ensure routing stability and rapid acknowledgement of received data.
3.  **Bucket Check:**
    - If **Tokens $\ge 1$**: Decrement tokens and transmit.
    - If **Tokens $< 1$**: Queue packet until a token is regenerated.

#### 2.3. Retransmission Logic (ELODRI & ACK MISSING)

When the ELODRI mechanism triggers a retransmission (after $\mathrm{Chain_size} \times 1\mathrm{s}$ without an ACK), or an ACK MISSING is received, the retransmitted packet: 
- Consumes a token from the bucket like a new message.
- Is placed at the head of the transmission queue to prioritize the completion of existing message chains over new data.
