## Receive Mechanism

### 1. Deconstruction

#### 1.1 Type 3 : Message

1. **Verification**
   1. The first 5 bits must be `10100`.
   2. Get the next 3 bits (`Type`) and check if the size of the packet is logic :
      - `Type == 001` -> Minimum 9 bytes size, Max 31 bytes, Always odd.
      - `Type == 010` -> Minimum 5 bytes size, Max 31 bytes, Always odd.
      - `Type == 011` -> Minimum 18 bytes size, Max 31 bytes.
      - `Type == 100` -> Exactly 9 bytes size.
   3. If the packet is already in the cache, it is ignored. Otherwise, proceed to **Storage**.

2. **Storage**
   - Decrement the `TTL` by 1.
   - The packet is stored in the cache. Max 1000 _(by default)_ packets.
   - If the device has the key for the packet's `Channel`:
     1. Extract `Chain`, `Last`, and `Index` from the packet.
     2. Obtain the segment identifier by concatenating: `Sender ID`, `Channel ID`, and `Chain`.
        - If this identifier does not exist in the chain management map, create a new list with a size of `Last + 1` and link it to the segment identifier.
        - If this identifier exists, retrieve the existing list and integrate the packet at its corresponding `Index`.
     3. Once the list is complete, proceed to **Segment Decryption**. Otherwise, send `MISSING` ACK(s) to retrieve the missing packet(s).

3. **Segment Decryption**
   - For each 14-byte segment:
     - Decrypt the encrypted payload using `AES-CCM` with:
       - **Key**: Shared key of the channel.
       - **IV**: Constructed from the sender's identifier, channel identifier, and the random number; included in the packet.
     - The `MIC` is used to verify the integrity of the decrypted segment. If not valid, the message is rejected (integrity compromised).

4. **Decompression and Data Extraction**
   - Once all segments are decrypted and concatenated:
     - Read the first byte to determine the compression type (`SMAZ` or `ZSTD`).
     - Decompress the data using the corresponding algorithm.
     - Extract the signature (first 8 bytes) and the message data.

5. **Signature Verification**
   - The receiver recalculates the signature from the message data.
   - If the calculated signature matches the received one, the message is valid and can be processed.
   - Otherwise, the message is rejected (integrity compromised).

---

### 2. Active Dropping

Certain well-placed Primary nodes might become overloaded with traffic. Penalizing their score would cause them to demote, leading to network instability ("flapping") and further packet loss during topology reorganization.

The Primary node retains its status and score, but implements a Local Triage (Active Dropping) mechanism to protect core network operations : 
- **Traffic Classification**: All network traffic is divided into two priority tiers:
    - **High Priority (Control)**: Core routing protocol packets.
    - **Low Priority (Data)**: Standard application payloads.
- **Active Dropping**: If a Primary node exceeds its safe processing threshold *(> 10 relayed packets per second)*, it enters a defensive state. In this state, the node silently drops any newly received Low Priority (Data) packets, and send an `ACK Unabled`. High Priority (Control) packets are always processed normally. The node exits the defensive state once traffic drops back below the threshold.
