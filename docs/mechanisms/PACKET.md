# Packet Mechanism

![Frame overview](../images/img-frame.png)

0. [Head Common Format](#common)
1. [Informations Format](#informations)
2. [Neighbors Format](#neighbors)
3. [Message Format](#message)
4. [ACK Format](#ack)
  
---

<a name="common"></a>

### 0. Head Common Format (4 bytes) + BLE Overhead

| Field           | Bytes | Description | Example |
| --------------- | ----- | ----------- | ------- |
| **V. Protocol** | 2     | Protocol version, currently `0xBEE0`. Else drop. | `0xBEE0` |
| **V. BLE**      | 1     | Target BLE PHY: `0x00` = 4.2 1 Mbps, `0x01` = 5.0 1 Mbps, `0x02` = 5.0 125 kbps. Others drop. | `0x01` |
| **Typ. P.**     | 1     | Packet type: `0x01` Informations, `0x02` Neighbor, `0x03` Message, `0x04` ACK. Others drop. | `0x03` |

#### 0.1 V. Protocol

`Overhead` in the schema is NOT protocol (BLE framing, never in FCS/MIC/PoW): Advertising `Len/Type/Value/Len/Type/UUID` (Type 1), GATT `Code/Attribut` (Types 2/3/4). Protocol starts at `V. Protocol`.

##### Service discovery (normative, SECURITY §3 anti-fingerprint)

- **No HoneyBee-specific Service UUID.** The GATT server exposes a **generic service** (a neutral standard UUID, e.g. the Generic Access `0x1800`-class appearance) — a fixed vendor UUID in the advertisement or in `discoverServices()` is a stable beacon telling every urban scanner "a HoneyBee device is at this place at this time" (see SECURITY.md §3).
- **Peer recognition** rides the **Manufacturer Specific Data** of the advertising payload (the field exactly designed for it), carrying the protocol's 5-bit signature (`10100`, the `header()` marker) plus the rotating protocol fields. The manufacturer/company identifier is fixed for filtering purposes but reveals only "HoneyBee exists here", never "which device" — the rotating 4-byte Sender inside the payload does the device-level identification, one-way per epoch (`IDENTIFICATION.md` §3).
- Scan filters therefore match the (fixed, non-identifying) manufacturer ID — no HMAC matching in the filter, full scan filtering stays cheap — while the on-air identity remains the rotating address. Once connected, the generic service reveals nothing protocol-specific in the GATT discovery.

#### 0.2 V. BLE

| Value  | Description     |
| ------ | --------------- |
| `0x00` | BLE 4.2, 1 Mbps (4.0-compatible) |
| `0x01` | BLE 5.0, 1 Mbps |
| `0x02` | BLE 5.0, 125 kbps (Long Range) |
| others | _Reserved_ → drop |


#### 0.3 Typ. P.

Typ. P. values:

| Value  | Description     |
| ------ | --------------- |
| `0x00` | _Reserved_      |
| `0x01` | Informations    |
| `0x02` | Neighbor        |
| `0x03` | Message         |
| `0x04` | ACK             |
| others | _Reserved_ → drop |

Bearer is normative and derived from `Type` (see [frame overview](../images/img-frame.png)):

| Type   | Name         | Bearer                      | Relayable |
| ------ | ------------ | --------------------------- | --------- |
| `0x01` | Informations | BLE Advertising 4.2+        | No (1-hop beacon; re-emitted, never relayed) |
| `0x02` | Neighbor     | BLE GATT 4.2+               | No (1-hop exchange; never relayed) |
| `0x03` | Message      | BLE GATT 4.2+               | Yes, if `TTL > 0` after decrement (GATT only) |
| `0x04` | ACK          | BLE GATT 4.2+               | No (1-hop; never relayed, see Relay §4) |


#### 0.4 Packet ID (canonical deduplication key)

The `Packet ID` is the only key used by the strict deduplication cache (see Relay mechanism). It is computed before any TTL decrement. TTL and FCS are never part of the Packet ID. 

- `Type 01`: Everything. `V.Protocol (2) + V.BLE (1) + Typ.P. (1) + Sender (4) + Role (1) + Score (1) + Prim. (1) + Secd. (1) + Pend. (1) + Primary? (4)`. `Pend.` and `Primary?`: a `0x00 -> 0x01` transition is a new Packet ID.
- `Type 02`: Everything. `V.Protocol (2) + V.BLE (1) + Typ.P. (1) + Sender (4) + Prim. (1) + Secd. (1) + Typ.N. (1) + Devices (4xN)`. 
- `Type 03`: Everything, except TTL/FCS/Nonce. `V.Protocol (2) + V.BLE (1) + Typ.P. (1) + List (2) + Sender (4) + Channel (4) + Timestamp (4) + Random (4) + Chunk (1-200, MIC-in-Index-0 included)`. 
    Referenced **short Packet ID** = `List (2) + Sender (4) + Channel (4)` = 10 bytes.  
    The PoW `Nonce` (same chain copy on every fragment) is never part of the `Packet ID`: an escalated retransmission keeps the same `Packet ID` as the original.
- `Type 04`: Everything. `V.Protocol (2) + V.BLE (1) + Typ.P. (1) + Sender (4, replier) + referenced Packet ID (List (2) + Sender (4) + Channel (4)) + ACK Type (1)`.

Two receptions with equal `Packet ID` are the same packet, even if received on different PHY (1 Mbps / 125 kbps) or different bearer instances.

---

<a name="informations"></a>

### **1. Informations Format (17 bytes protocol + Adv Overhead)**

| Field | Bytes | Description | Example |
| ----- | ----- | ----------- | ------- |
| **V. Protocol** | 2 | See §0.1 (`0xBEE0`). | `0xBEE0` |
| **V. BLE** | 1 | See §0.2. | `0x01` |
| **Typ. P.** | 1 | `0x01`. | `0x01` |
| **Sender** | 4 | Identifiant of the sender (32-bit). | `0x12345678` |
| **Role** | 1 | Base role: Primary `0x01`, Secondary `0x02`. Others dropped. | `0x01` |
| **Score** | 1 | $S_{global}$ of the sender (Network §3.D, not $S_{base}$ ; recompute on every attachment change and before each beacon emission). | `0x12` |
| **Prim.** | 1 | Number of Primary neighbors seen. | `0x01` |
| **Secd.** | 1 | Number of Secondary neighbors seen. | `0xA1` |
| **Pend.** | 1 | Pending flag: `0x00` = outbox empty, `0x01` = at least one GATT packet queued. | `0x01` |
| **Primary?** | 4 | Attachment: Sender ID (32-bit) of the serving Primary this node is attached to; `0x00000000` = unattached/electing. When a Primary sees `Pend.=1` it dials this node only if `Primary?` is self or unattached-and-winner (Relay §6). | `0x9A8B7C6D` |

#### 1.1. Emit packet

Each node re-emits only its own Informations every ~10 s; do not toggle `Pend.` more often than the period.

#### 1.2. Primary? attachment

- A Secondary sets `Primary?` to its elected serving Primary (`Score, RSSI, Sender ID` + hysteresis, Relay §6.1b), or `0x00000000` while electing/unattached.
- A Primary attached to a peer mesh parent MAY set its parent's ID; a mesh root sets `0x00000000`.
- A Primary that sees `Pend.=1` initiates a rendezvous (Central) only if `Primary?` == self or (`Primary?` == 0 and election winner == self); if it names another Primary, cancel the task (Relay §6.5 mutex).

---

<a name="neighbors"></a>

### **2. Neighbors Format (11+ bytes protocol, GATT variable)**

| Field | Bytes | Description | Example |
| ----- | ----- | ----------- | ------- |
| **V. Protocol** | 2 | See §0.1 (`0xBEE0`). | `0xBEE0` |
| **V. BLE** | 1 | See §0.2. | `0x01` |
| **Typ. P.** | 1 | `0x02`. | `0x02` |
| **Sender** | 4 | Identifiant of the sender (**32-bit**). | `0x12345678` |
| **Prim.** | 1 | Number of Primary neighbors seen (mirrors Type 1 count). | `0x01` |
| **Secd.** | 1 | Number of Secondary neighbors seen (mirrors Type 1 count). | `0xA1` |
| **Typ. N.** | 1 | Entry kind of the Devices list: `0x01` = **Primary** neighbors, `0x02` = **Secondary** neighbors merely heard, `0xFF` = **Attached** Secondaries _(elected serving Primary is the sender; emitted by a Primary only)_ (see Relay §6.5). | - |
| **Devices** | 4xN | Neighbor device IDs, **4 bytes each** (was 3). | - |

#### Per-kind emission discipline. 

A node emits one Neighbor (0x02) packet **per kind**:

- one packet containing exclusively Primary IDs (`Typ. N.` = `0x01`)
- and one packet containing exclusively Secondary IDs (`Typ. N.` = `0x02`). 

A Primary additionally emits a third packet containing exclusively the IDs of its **attached Secondaries** (`Typ. N.` = `0x03`); a Secondary never emits this kind (it has no attached nodes).   
  
The `Prim.` and `Secd.` header fields count the total entries known to the sender for each role, independently of the current packet's kind — **including for kind `0x03`** (where `Secd.` remains the total known Secondary neighbors, not the attached count).  
  
**$N_{attached}$** (Network §3.E) = entry count of the Primary's kind-`0x03` packet, and of that kind-`0x03` packet only. This separation lets a Secondary infer its own Critical Bridge status (state-machine Rule 3, see `NETWORK.md` §4) by **combining** what it receives **in-session** from its serving Primary (Phase B Control, RELAY §6.3c) with the `Type 01` beacons it scans over the air — a Secondary never hears a third party's `Type 02` (1-hop GATT bearer, PACKET §0.3) — and lets a peer Primary distinguish Secondaries it merely *hears* (kind `0x02`) from those it *serves* (kind `0x03`) for the mutex (Relay §6.5).

---

<a name="message"></a>

### **3. Message Format (30+ bytes protocol, + GATT overhead)**

| Field         | Bytes  | Description                                      | Example            |
| ------------- | ------ | ------------------------------------------------ | ------------------ |
| **V. Protocol** | 2    | See §0.1.                                        | `0xBEE0`           |
| **V. BLE**    | 1      | See §0.2.                                        | `0x01`             |
| **Typ. P.**   | 1      | `0x03`.                                          | `0x03`             |
| **TTL**       | 1      | Number of allowed relays (decremented per relay).| `0x05`             |
| **List**      | 2      | Chain/Last/Index (see 3.2). `Chain` (4-bit chain counter) is unrelated to `Channel` (32-bit channel identifier, §CHANNELS) — the relay `chain_key` carries both (RELAY §1). | See below          |
| **Sender**    | 4      | Identifiant of the sender (**32-bit**).          | `0x12345678`       |
| **Channel**   | 4      | Identifiant of the channel (**32-bit**, retable).| `0x0130ABCD`       |
| **Timestamp** | 4      | UNIX seconds at chain creation, identical in all fragments (see 3.4). | `0x67123456` |
| **Random**    | 4      | Chain nonce / IV salt; frozen per chain, part of Packet ID + chain key (see 3.5). Not the PoW grind target. | `0x12345678` |
| **Nonce**     | 4      | Chain PoW proof (every `Index`, same copy): grind target so `SHA256(List0‖Sender‖Channel‖Timestamp‖Random‖Nonce)` meets `d` (see 3.5b). Excluded from Packet ID, chain key, IV and AAD. | `0x9A3BCDEF` |
| **FCS**       | 2      | CRC-16/CCITT-FALSE over header\|TTL\|List\|Sender\|Channel\|Timestamp\|Random\|Nonce\|chunk. | `0x29B1` |
| **Chunk**     | 1-200  | `Index==0`: `MIC(8) + ciphertext head`; `Index>0`: ciphertext continuation (see 3.6-3.7). On-air order: `...|Random(4)|Nonce(4)|chunk|FCS(2)` — chunk precedes FCS. | See 3.7 |

#### 3.1. TTL

The TTL indicates the number of times the packet must be relayed by any device. It prevents the packet from traveling too far unnecessarily.

Rules (normative):

- `TTL` is `1 byte`, valid range at emission and reception: `1 <= TTL <= 255` (`TTL_MAX = 255`).
- Only `Type 03 Message` carries a TTL. Types `01/02/04` have no TTL field and are strictly 1-hop: never relayed nor forwarded (see Relay §4).
- At emission, `TTL == 0` is forbidden (see Send mechanism).
- At reception, TTL is validated **before** deduplication lookup and **before** decrement (see Receive mechanism): `TTL == 0` or length inconsistent → drop, no cache insert, no ACK, no relay.
- After validation, decrement by 1. If result is `0`, process locally but do not relay.
- `Random` and `Chunk` (ciphertext stream slice) must be preserved bit-identical on relay; only `TTL` mutates (then FCS is recomputed). On any retransmission cycle (MISSING-driven or ECDRI-driven) the emitter re-grinds the chain `Nonce` upward (escalation, RELAY §1d) and rewrites the same fresh copy on every fragment — `Nonce` is excluded from the `Packet ID`, so dedup and `MISSING` recovery are unaffected. Otherwise strict deduplication breaks.

#### 3.2. List (2 bytes, 16 bits)

| Field         | Bits  | Description                                      | Example            |
| ------------- | ----- | ------------------------------------------------ | ------------------ |
| **Chain**     | 4     | Chain ID for the actual Sender ID.               | `0010`             |
| **Last**      | 6     | Index of the last packet in the group.           | `010011`           |
| **Index**     | 6     | Position of the packet in the group.             | `000010`           |

##### 3.2.1 Chain
  
Specifies the packet chain identifier. A maximum of 16 chains can be created per `Sender ID`. Initially, the first chain value is 0. The value increments by 1 for each new chain created. Once the value reaches 15, no further chains can be created; one must wait for the `Sender ID` to change for the `Chain` value to reset to 0.  
  
##### 3.2.2 Last

This field specifies the index of the last packet in the packet chain. This makes it possible to determine how many packets make up the chain and to create the list (which will hold each packet) with the correct size.
  
##### 3.2.3 Index

The position of the packet in the chain.

#### 3.3. Sender (4 bytes)

The device that sent the packet (32-bit rotating ID).

#### 3.4. Channel (4 bytes, retable) + Timestamp (4 bytes)

| **Type**             | **Binary Format**     | **Description**                          |
| -------------------- | --------------------- | ---------------------------------------- |
| **Public**           | see CHANNELS.md §1.2 retable (**32-bit**) | Channels used for global communications (alias group `Global` with Private). |
| **Private**          | see CHANNELS.md §1.2 retable (**32-bit**) | Channels used for specific communities or organizations (alias group `Global` with Public). |
| **Emergency**        | see CHANNELS.md §1.2 retable (**32-bit**) | Priority channels for alerts or critical communications. |
| **Team**             | see CHANNELS.md §1.2 retable (**32-bit**) | Channels used for teams or workgroups.   |
| **Testing**          | see CHANNELS.md §1.2 retable (**32-bit**) | Channels used for testing, debugging, or technical uses (alias group `Technical` with Reserved). |
| **Reserved**         | see CHANNELS.md §1.2 retable (**32-bit**) | Channels reserved (alias group `Technical` with Testing; `0x00000000` never emitted). |

##### Timestamp

Unsigned 32-bit big-endian UNIX seconds sampled at chain creation, identical in every fragment. Roles: 

- part of logical IV (§3.5) and PoW preimage — old-chain replay under a new epoch misses the PoW cache and fails AAD epoch binding
- reassembly-map disambiguator (`Sender‖Channel‖Chain‖Timestamp`, Chain wraps every 16)
- anti-replay hint (`|now−Timestamp|>600s` → suspect). It NEVER selects the decryption epoch alone (see §3.6).

##### Chain exhaustion (rate limit)

`Chain` is encoded on 4 bits (values 0–15; see `List` field, §3.2), so a device can emit at most **16 distinct chains per channel during one address period** (900 s). `Chain` resets to 0 whenever the address changes (`IDENTIFICATION.md` §3.3). Once the 16th chain is used, the device cannot start a new chain on that channel until the next address rotation — this is an **intentional per-channel rate limit**, not a bug. Beyond this limit, the device must wait for the next rotation or apply a backoff before re-emitting on the same channel.

#### 3.5. Random (4 bytes) + IV (18 bytes logical, 12-byte CCM nonce derived)

The chain nonce serves three purposes:  

- It makes the CCM IV unique per message (same plaintext + same key → different ciphertext).
- It is identical across all fragments (the IV's `Index` is frozen to `0` inside the nonce — one message, one nonce, see 3.5.1).
- It is frozen per chain and is not the PoW grind target (the dedicated `Nonce`, §3.5b, is). `Random` stays in the PoW preimage, the chain key and the IV; it is chosen at random, never ground, so re-grinding a proof never touches it.

#### 3.6. PoW Nonce (4 bytes, `Index==0` only, normative)

The `Nonce` is a dedicated 4-byte chain Proof-of-Work field carried **by every fragment** (the same copy on all `Index`, like `Timestamp`/`Random` — every fragment is self-sufficient, so the rescue gate, Relay §1d, can verify `PoW ≥ d_eff` on any fragment in deficit). Roles: 

- it is the grind target. The sender searches a 4-byte value such that `SHA256(List0 ‖ Sender4 ‖ Channel4 ‖ Timestamp4 ‖ Random4 ‖ Nonce4)` starts with `d` zero bits (base `d = 12`, ~2^12 hashes; escalation up to `d = 20` on every retransmission cycle — MISSING-driven or ECDRI-driven — RELAY §1d). The proof is a proof *of the chain* (`List0` with `Index = 0` reconstructed), one grind covers all fragments
- it is excluded from the `Packet ID`, the chain key, the IV/CCM nonce and the AAD. Re-grinding it never re-encrypts the message and never changes the packet identity, so an escalated retransmission stays a cache hit for dedup/`MISSING` and needs only an FCS recomputation per frame. 4 bytes (not 2) are required so `d = 20` (~2^20 trials) is always reachable in range. It is covered by each frame’s FCS (transport) but not by the MIC (end-to-end): the PoW is a relay-local resource gate, not an integrity field.

##### 3.7 IV layout (normative, per schema)

On-air logical IV (18 B): `List (2) + Sender (4) + Channel (4) + Timestamp (4) + Random (4)`, in that order. `List` packs `Chain (4b) + Last (6b) + Index (6b)` (see 3.2) — `Chain` is the 4-bit per-address chain counter (stored as 1 byte in relay state), unrelated to the 32-bit `Channel` identifier; fragment-0 form (`Index = 0`) is used for every fragment — one message, one nonce, one tag. `Last` is computable before encryption: `stream = tag8 ‖ ciphertext` length is known from plaintext length.

AES-CCM needs a 12-byte nonce, so it is derived (normative): `nonce12 = SHA256(List0 ‖ Sender4 ‖ Channel4 ‖ Timestamp4 ‖ Random4)[0..11]` (see Confidentiality §1). The PoW `Nonce` (§3.5b) is deliberately absent from this derivation and from the AAD: re-grinding it must not change the ciphertext.  
  
**Decision (normative):** the CCM IV is derived WITHOUT the PoW Nonce — the IV must remain stable across escalations (only the Nonce is re-ground); the Nonce protects admission, not confidentiality. An implementation that folds the Nonce into the IV derivation silently breaks retransmission (new ciphertext → de-facto new Packet ID → chaotic re-gate/dedup).

#### 3.8. MIC (8 bytes, in Chunk[Index==0])

The AES-CCM tag (8 B) is computed **once over the whole message with the packet-0 IV**, and transported **at the head of the `Index == 0` Chunk**:

- `nonce12 = SHA256(List0 ‖ Sender4 ‖ Channel4 ‖ Timestamp4 ‖ Random4)[0..11]`; `aad = V.Protocol(2) ‖ V.BLE ‖ Typ.P.(0x03) ‖ Sender4 ‖ Channel4 ‖ List0 ‖ Timestamp4 ‖ Epoch_be8`; `plaintext = Flag(1) + data`.
- `ciphertext, tag8 = AES-CCM-Encrypt(K_chan, nonce12, aad, plaintext)`; `stream = tag8 ‖ ciphertext` (tag-first).
- `stream` cut into chunks of the padding class (32 or 200 — constant, last included; normative); chunk 0 = `tag8 + first ciphertext bytes` (always ≥ 9 bytes: MIC 8 + ≥1 ciphertext byte), chunks i>0 = continuation. Legacy unpadded `chunk_size ∈ [9..200]` with a short tail (each ≥ 1 byte) remains parse-compatible but is test-only (see §3.7).
- Receiver: collect chunks 0..Last → `stream` → split `stream[0:8]`/`stream[8:]` → verify under accepted epochs. Invalid under all → reject whole chain, no `MISSING` re-requests for an unverifiable chain.  
  
> **Why index 0:** the MIC is bound to the packet-0 IV, so `nonce ↔ tag` are co-located; loss of fragment 0 is detected immediately as `MISSING Index 0` (highest re-request priority, see Receive §1). Forgery odds unchanged (64-bit).

#### 3.9. Chunk of encrypted stream (padding class 32 or 200 bytes)

| Field           | Bytes | Description                                      | Example            |
| --------------- | ----- | ------------------------------------------------ | ------------------ |
| **MIC**         | 8     | AES-CCM 64-bit tag of the whole message (bound to the packet-0 IV); travels tag-first at the head of Chunk[`Index==0`] (§3.6). |                    |
| **Flag**        | 1     | Compressed = `0000 0001`. Padded 200 bytes = `0000 0010`    | `0000 0011` |
| **Lenght**      | 2     | Real lenght of the data (N).                     |                    |
| **Data**        | N     |                                                  |                    |

##### 1-byte Flag

- bit0 = `Compressed?` (`0x00` = no compression for payload ≤ 50 bytes, `0x01` = Deflate/zlib)
- bit1 = `Padded?` (`0x00` = padding 32 bytes, `0x02` = padding 200 bytes, see below). It sits in the plaintext before encryption, hence covered by the MIC.  

##### Padding (normative, SECURITY §3.1 — uniform observable size)

- **Two constant classes only, short = 32 B, long = 200 B**: chosen after compression on the USEFUL size: `len(compressed) ≤ 200` → short, else long. The threshold is on the data, NOT on the padded stream, so a 190..200 B message stays short: 7×32 = 224 B instead of 2×200 = 400 B. Every chunk of the message, including the last, is exactly the class size on air (no short tail): the plaintext is zero-padded so `stream_len` (MIC included) is an exact multiple of the class.
- **The real length is never observable**: it travels as `real_len_be16` (length of the data after compression when bit0 is set) INSIDE the encrypted, MIC-covered plaintext of fragment 0; the receiver trims only AFTER successful MIC verification. Padding bytes are zeros chosen by the sender (no filler entropy to leak).
- **Why two sizes**: constant chunk size removes the payload-length fingerprint (each fragment size was a re-linking vector); two classes — not three or four — bound the remaining granularity to a coarse "chat vs control" split, since every added size recreates a fingerprinting axis.

**Compression algorithms**  
  
| Algorithm        | Identifier | Description                                       |
| ---------------- | ---------- | ------------------------------------------------- |
| _No compression_ | `0x00`     | For small data _(less, or egal, than 50 bytes)_   |
| Deflate (zlib)   | `0x01`     | For large data _(more than 50 bytes)_             |

---

<a name="ack"></a>

### **4. ACK Format (19 bytes protocol-fixed, GATT)**

| Field | Bytes | Description | Example |
| ----- | ----- | ----------- | ------- |
| **V. Protocol** | 2 | See §0.1 (`0xBEE0`). | `0xBEE0` |
| **V. BLE** | 1 | See §0.2. | `0x01` |
| **Typ. P.** | 1 | `0x04`. | `0x04` |
| **Sender** | 4 | Device replying with this ACK (the replier, 32-bit). | `0x12345678` |
| **List** | 2 | `List` (Chain/Last/Index) of the concerned Message packet. | `0x0471` |
| **Sender** | 4 | `Sender ID` of the concerned Message packet (32-bit). | `0x12345678` |
| **Channel** | 4 | `Channel ID` of the concerned Message packet (32-bit). | `0x0130ABCD` |
| **Type** | 1 | ACK kind (see Acknowledgement mechanism). | `0x1F` |
