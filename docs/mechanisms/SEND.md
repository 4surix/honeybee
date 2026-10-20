# Send Mechanism

> [DEFLATE (zlib) - Wikipedia](https://en.wikipedia.org/wiki/DEFLATE)  
> [Authenticated encryption - Wikipedia](https://en.wikipedia.org/wiki/Authenticated_encryption) | [CCM mode - Wikipedia](https://en.wikipedia.org/wiki/CCM_mode)  
> FCS : [Cyclic redundancy check - Wikipedia](https://en.wikipedia.org/wiki/Cyclic_redundancy_check)  
> Segmentation fragment : [Maximum transmission unit - Wikipedia](https://en.wikipedia.org/wiki/Maximum_transmission_unit)  
> [Padding (cryptography) - Wikipedia](https://en.wikipedia.org/wiki/Padding_(cryptography))  

### 1. Construction

#### 1.1 Type 3 : Message

1. Check `1 <= TTL <= 255` (`TTL_MAX = 255`). `TTL == 0` is forbidden at creation: refuse and return an error, do not emit.
2. The data, if size is upper than 50, is compressed using `Deflate (zlib)`.
3. A byte is added at the beginning to indicate the compression type: `Type (1)` + `Compressed? Data (...)`.
4. **Compute the chain metadata before encryption (normative padding, SECURITY §3.1)**: 
    - sample `Timestamp` (u32 UNIX seconds, frozen for the chain)  
    - compress FIRST (`Deflate (zlib)` iff uncompressed payload > 50 bytes)  
    - then choose the padding class on the USEFUL size (data after compression) — exactly two constant sizes: `chunk_size = 32 (short, the chat class)` if `len(compressed) ≤ 200`, else `chunk_size = 200 (long)` _(threshold on the data, not on the padded stream — a 190..200 B message stays short at 7×32 = 224 B rather than jumping to 2×200 = 400 B; compression before class choice maximizes short-class traffic)_.  
    - Then pad the plaintext: `plaintext = Flag' (1) | real_len_be16 (2) | data | zero padding` where `Flag' = Flag | 0x02` (bit1 = padded), `data` is the payload after compression when bit0 is set (`real_len_be16 = len(compressed)`, never `len(uncompressed)` — the receiver MUST trim by `real_len` before handing the exact bytes to the zlib decompressor: without `real_len` the compressed/padding boundary is unknowable, and feeding padding to the decompressor is at best decoder luck, at worst a Deflate error), and the zeros are sized so `stream_len = 8 + 3 + len(plaintext)` is an exact multiple of `chunk_size` — every fragment on air, last one included, carries exactly `chunk_size` bytes; the real length travels encrypted inside fragment 0 and is trimmed only after MIC verification. 
    - `Last = stream_len / chunk_size − 1` (exact division), `List0 = Chain | Last | Index=0`. (Chunk 0 still carries the 8-byte MIC so every chunk is at least 11 bytes.)
5. **Grind the chain PoW `Nonce` (replicated on every fragment)**: 
    - pick a random 4-byte chain `Random` (the CCM IV salt — never ground), then search a 4-byte `Nonce` such that `SHA256(List0 || Sender4 || Channel4 || Timestamp4 || Random4 || Nonce4)` has `d` leading zero bits. The base difficulty is `d = 12` (~2^12 SHA-256 ≈ 4096 hashes, a few ms on a phone; see `RELAY.md`). On retransmission, escalate by re-grinding **only the `Nonce`** and rewrite the same fresh copy on **every** fragment — **MISSING-driven** from the first cycle (`d = min(20, d_previous + 4)` per cycle, 12 → 16 → 20)
    - **ECDRI-driven** (no ACK `Succeeded` observed) re-emits with a fresh Nonce at unchanged `d` on the first silent cycle (light re-grind at the same difficulty — benign radio loss pays no *harder* grind; the fresh Nonce routes around evicted relay entries) and escalates `d = min(20, d_previous + 4)` only from the second silent cycle (12 → 12 → 16 → 20, convergence in at most 3–4 cycles) — `Random`, the IV and the ciphertext stay untouched, so no re-encryption is needed and the `Packet ID` is unchanged (the `Nonce` is excluded from it).
    - ECDRI silence alone (from the second cycle) is a sufficient escalation signal: a chain dropped at a congested intermediate relay (no downstream MISSING possible) still converges to `d_eff` instead of looping at `d = 12` until abandon. 
    - Escalation is per failure streak, never a ratchet: `d` returns to the base 12 as soon as an ACK `Succeeded` is observed for the chain. The emitter may provision a higher `d` from the start (e.g. `d = 16`) if it has recently observed MISSING on this channel — a local heuristic, never negotiated with the relay. `Random` remains the CCM nonce component; the `Nonce` is the pure PoW proof.
6. **Encrypt the WHOLE message once** (encrypt-then-fragment): `AES-CCM-128 (nonce12 = SHA256(List0‖Sender4‖Channel4‖Timestamp4‖Random4)[0..11], tag = 8, aad = V.Protocol(2)‖V.BLE‖Typ.P.(0x03)‖Sender4‖Channel4‖List0‖Timestamp4‖Epoch_be8(8))` over `Flag+data` → `ciphertext + tag8`, then `stream = tag8 ‖ ciphertext` (tag-first: the MIC goes in Chunk of `Index == 0`, bound to the packet-0 IV).
7. **Cut `stream` (tag-first) into chunks of `chunk_size` bytes** (the chosen padding class: 32 or 200 — constant, tail included, SECURITY §3.1). For each chunk *i* (0-based, `Index = i`), create the packet `V.Proto|V.BLE|Typ.P.|TTL|List-2(Chain|Last|i)|Sender-4|Channel-4|Timestamp-4|Random-4|Nonce-4|FCS-2|chunk` (see `PACKET.md` §3; the same chain-`Nonce` copy rides every fragment, so any fragment verifies the chain proof at the rescue gate). Chunk 0 = `MIC(8) + ciphertext head`. With padding, ALL chunks are exactly `chunk_size` bytes (no short tail: the stream length was rounded up in step 4).


### 2. Delay: Token Bucket Algorithm
  
[Wikipedia - Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)  
  
#### 2.1. Principles

The algorithm regulates the flow of data packets while allowing for short bursts, which is essential for transmitting fragmented messages.

- **Token Regeneration Rate ($R$):** 4 tokens per second. 1 token per second for 15 seconds if an `ACK Unabled` received — **per Unabled-emitter, not global**: the penalty is keyed by the Primary that emitted the `Unabled` (it throttles the rate *toward that overloaded Primary*); on handover to a new healthy Primary (Relay §6.5) the Secondary resumes the nominal rate so Phase A drains the intact outbox fast. If the new Primary in turn emits `Unabled`, a fresh 15 s penalty keyed by *it* applies — a flooder hopping Primaries is re-throttled at each victim, no evasion.
- **Bucket Capacity ($C$):** 16 tokens. This is an **emission-side** packet-rate guard, independent from the **reception-side Active Dropping** triage of Primary nodes (RECEIVE §2, > 30 relayed packets/s): the two thresholds live on different paths and are not aligned by design.
- **Token Consumption:** Each Message _(Type 03)_ **fragment** sent consumes exactly one token — **padding included**: the bucket is a **packet-rate guard, not an airtime meter**. A padded short-class message costs up to **7 tokens** (7 × 32 B blocks), so the burst of 16 ≈ 2 max-size short messages + spare; the steady rate stays 4 fragments/s, far below the Active Dropping threshold (30 relayed packets/s) whatever the padding (`test_channel_bucket.TestEconomicBounds`).
- **Who bounds airtime:** this per-address bucket never binds before the shared network budget — the relay-side channel budget (RELAY §1d: 40 tokens/min, size-aware `cost = 1 + len//64`) is the real network bottleneck (600 tokens/15 min vs 3616 here). Regime throughput of useful compressed data per channel per 15 min, bounded by that channel budget: **≈ 6 KB (10 B chat) to ≈ 25 KB (1000 B messages)**, ≈ 12–17 KB for typical chat sizes (pinned by `TestEconomicBounds.test_channel_budget_throughput_600_tokens`).
- **Padding effect (honest):** vs unpadded emission, a boundary-size short message (189 B) pays 7 relay tokens instead of 4 (+75%) and ~13% more airtime (224 vs 198 B) — the known price of uniform on-air sizes (SECURITY §3.1), paid once per message.

#### 2.2. Traffic Classification and Priority

HoneyBee distinguishes between two tiers of traffic for the Token Bucket implementation:

1.  **Low Priority (Data):** Includes all Message (Type 03) packets and their associated fragments. These packets must consume a token before transmission. If the bucket is empty, packets wait in the device queue — **the queue of this section IS the outbox of §2.5 (one store, one 1000-packet budget, same FIFO, same drop-oldest / Data-`Type 03`-first policy — no second copy)**: connected, frames wait for a token; disconnected (Secondary with no serving Primary), they wait for the rendezvous.
2.  **High Priority (Control):** Includes Informations, Neighbor, and ACK packets. These packets bypass the Token Bucket and are transmitted immediately to ensure routing stability and rapid acknowledgement of received data.
3.  **Bucket Check:**
    - If **Tokens $\ge 1$**: Decrement tokens and transmit.
    - If **Tokens $< 1$**: Queue packet until a token is regenerated.

#### 2.3. Retransmission Logic (ECDRI & ACK MISSING)

When the ECDRI mechanism triggers a retransmission (after the fixed **1 s DELAY** without an ACK, measured from the last transmitted fragment — see ACKNOWLEDGEMENT), or an ACK MISSING is received, the retransmitted packet:  

- Consumes a token from the bucket like a new message.
- Is placed at the head of the transmission queue to prioritize the completion of existing message chains over new data.
- Must be bit-identical to the original (same `List`, `Sender`, `Channel`, `Timestamp`, `Random`, chunk bytes incl. MIC-first Chunk 0; same TTL as first emission) — **except** the chain `Nonce`, which follows the escalation curve of §1.1 step 5 (MISSING from cycle 1, ECDRI-silence from cycle 2 with a fresh Nonce at unchanged `d` on the first silent cycle, reset to base on ACK `Succeeded`) and is rewritten on all fragments, with the FCS recomputed per frame. Never regenerate `Timestamp`/`Random` or re-encrypt: strict dedup keys on `Packet ID` (TTL and `Nonce` excluded), so any other mutation breaks dedup and `MISSING` recovery.
- Is jittered per Relay §3 (GATT window 0-500 ms, independent emission) before TX.

#### 2.4. Bearer selection (normative, see [frame overview](../images/img-frame.png))

- `Type 01 Informations` → BLE Advertising 4.2+ only (16 B protocol + Adv overhead).
- `Type 02 / 03 / 04` → BLE GATT 4.2+ only (never in Advertising), behind `Code/Attribut` overhead.

#### 2.5. Secondary outbox and Pending flag (normative)

- A Secondary with no GATT connection to a Primary must not drop its GATT traffic : it appends each frame to a per-device FIFO outbox — **the same single store as the §2.2 queue (one 1000-packet budget shared connected/disconnected, same drop-oldest / Data-first policy)** — (recommended cap: same 1000-packet budget as the relay cache; drop-oldest beyond cap, Data `Type 03 (0x03)` first). Only its own `03` Messages are relay-eligible beyond the Primary; its own 1-hop Control (02/04) is queued only for the direct rendezvous peer (consumed locally there, never forwarded). High Priority Control (02/04) precedes Data (03) in-session; per chain, lowest Index first (Index 0 = MIC-carrying fragment first) so the Primary can reassemble.
- While the outbox holds at least one `03` (or any undelivered Control for its future direct peer), the Secondary sets `Pend.=1` (`0x01` = non-empty flag, never a count), `Primary?` = serving Primary ID in its next periodic Informations (Advertising, ~10 s, 17 bytes protocol, 4-byte Sender). When the outbox becomes empty, it clears `Pend.=0` / `Primary?` stays (still attached) at the next emission. No extra Advertising frame is emitted just for Pending: the flag rides the existing 10 s beacon (coalesced, at most one toggle per period).
- Token Bucket still applies at flush time (see Relay 6): tokens are consumed when frames actually leave over GATT, not when they enter the outbox. Outbox entry does not consume a token.
- Single-server rule: the Secondary uploads its outbox ONLY to its elected serving Primary (Relay 6.1b) and accepts a rendezvous ONLY from it. Frames stay queued (Pending=1) until ACKed Succeeded by that server; they are never split across several Primaries and never re-uploaded to another Primary except on handover (Relay 6.5), bit-identically.
- Retransmission identity (2.3) is preserved end-to-end: frames keep original List/Sender/Channel/Timestamp/Random/chunk (MIC-first Chunk 0) and original TTL; only the relaying node decrements TTL after validation. The Secondary must never regenerate Random or re-encrypt a queued frame. (PoW note: the first ECDRI retransmission re-emits with a fresh Nonce at unchanged `d` (light re-grind, same difficulty); every MISSING-driven cycle and every further silent ECDRI cycle re-grinds the chain `Nonce` upward (`d = min(20, d_previous + 4)`, up to d=20); `d` resets to base on ACK `Succeeded`. Relays recognize the chain in the PoW cache — see `RELAY.md` §PoW.)
