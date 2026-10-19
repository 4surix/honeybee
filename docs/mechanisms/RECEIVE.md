# Receive Mechanism

### 0. Normative reception order (all Types)

Every received frame must pass these steps **in this order**. Fail at any step → silent drop (no cache insert, no relay, no ACK), except Active Dropping which may send `ACK Unabled`.

1. **Size check** by `Typ. P.` (protocol bytes after BLE overhead; header is 4 bytes `V.Proto(2)+V.BLE(1)+Typ.P.(1)`):
   - `Typ. P. == 0x01` -> Exactly 17 bytes protocol fixed (4 header + 4 Sender + 1 Role + 1 Score + 1 Prim. + 1 Secd. + 1 Pend. + 4 Primary?).
   - `Typ. P. == 0x02` -> Minimum 11 bytes protocol empty (4 header + 4 Sender + 1 Prim. + 1 Secd. + 1 Typ.N. + 0 entries), +4 per Device entry (15 min with 1 device). Variable GATT length, Device entries of 4 bytes.
   - `Typ. P. == 0x03` -> Minimum 30 bytes protocol (29 overhead + 1 chunk; Chunk 0 is at least 9 bytes: 8 MIC + ≥1 ciphertext byte), up to 229 bytes protocol (29 + 200). Padded normative: 61 (short class 32) or 229 (long class 200).
   - `Typ. P. == 0x04` -> Exactly 19 bytes protocol fixed (4 header + 4 replier Sender + 2 List + 4 Sender + 4 Channel + 1 Type).
   - Unknown `Typ. P.` (not `0x01..0x04`) or size mismatch → drop.
2. **Versions**: `V. Protocol` identifies the protocol → else drop; `V. BLE` must be a value the node supports (`0x00` for 4.0-only, `0x00..0x02` for 5.0) → else drop.
3. **Bearer check**: `0x01` must arrive via Advertising; `0x02/0x03/0x04` must arrive via GATT → else drop (misbeared frame).
4. **TTL validation (Type 03 only)**: `1 <= TTL <= 255` (`TTL_MAX = 255`). If `TTL == 0` or field missing/truncated → drop with no further processing. Types `01/02/04` have no TTL and skip this step. *TTL is validated at reception (before cache) so a `TTL == 0` or malformed frame can never pollute the dedup cache, trigger reassembly, or be relayed. TTL is excluded from the `Packet ID` because it mutates at each hop; comparing raw bytes would never deduplicate. The decrement happens after admission (§0 step 6 → after the gate), never before: a second decrement at a hit would break re-gate idempotence.*
5. **FCS verification (Type 03)**: recompute CRC-16/CCITT-FALSE over `V.Proto|V.BLE|Typ.P.|TTL|List|Sender4|Channel4|Timestamp4|Random4|Nonce4|chunk` (the chain `Nonce` rides every fragment, PACKET §3.5b — it is covered by each frame's FCS) and compare with the on-air FCS (last 2 bytes). Mismatch → silent drop (never cached, never relayed).
6. **Strict deduplication & PoW**: compute canonical `Packet ID` per Packet §0.3 **on the frame as received (TTL excluded from the key)**. Apply the unified cache state machine (see Relay §1 and the ordered gate, Relay §1d steps 2&3 — the gate never drops a seen-but-not-admitted packet blindly): a hit with `admitted=true` is dropped as duplicate (optional in-session `ACK Duplicated 0x0F` for `03` only, rate-limited, never relayed); a hit with `pow_validated=false` triggers PoW re-verification against the incoming frame's fresh `Nonce`; a hit with `pow_validated=true, admitted=false` is re-gated (§1d steps 4–6); a miss inserts the entry first (closes re-entrancy during the jitter window) and validates the base PoW (`d=12`). **Admission (steps 4–6) gates RELAY only. Local processing (Storage/reassembly/decrypt, §1) requires steps 1–3 (FCS, dedup, base PoW) and happens regardless of the channel/sender budgets — a congested relay that is a channel member still receives its own channel's traffic; the budgets only stop it from re-emitting.** Only admitted packets proceed to TTL decrement and relay enqueue; Storage/reassembly/decrypt (§1) proceeds per the bold rule above.
7. **Storage / reassembly / decrypt** per Type (see §1).

> Rationale: TTL is validated at reception (before cache) so a `TTL == 0` or malformed frame can never pollute the dedup cache, trigger reassembly, or be relayed. TTL is excluded from the `Packet ID` because it mutates at each hop; comparing raw bytes would never deduplicate.

#### 0.1 Informations Pending extraction (normative)

- For Type 01, after size/version/bearer checks pass: read Role byte R (base role = R & 0x7F, must be 0x01 Primary or 0x02 Secondary; else drop) and `Pend.` byte P (Pending = P == 0x01). Read `Primary?` (attachment ID, `0x00000000` = unattached).
- If base role is Secondary and Pending=1: the receiver (if Primary) checks `Primary?`: creates/refreshes one rendezvous task for that Sender ID per Relay 6.1 ONLY if `Primary?` == self or (`Primary?` == 0 and election winner == self); if `Primary?` names another Primary, cancel any task (already served). A Secondary receiving another Secondary Pending beacon processes it locally (election) and drops it after processing like any 001 (001 is never relayed; it must not initiate GATT).
- Pending never triggers an ACK (01 has no ACK semantics); it only schedules a future GATT connection.
- Single-server accept (Secondary side): a Secondary accepts a GATT rendezvous ONLY from the Primary named in its `Primary?` (Relay 6.1b); connection attempts from any other Primary are refused/ignored while attached. A Primary creates/refreshes a rendezvous task for a Pending Secondary, but must cancel it if that Secondary is already served (attached list in a peer 010, link busy, or election winner is not self — see Relay 6.5).

### 1. Deconstruction

#### 1.1 Type 3 : Message

1. **Verification**: apply §0 steps 1–5 above (size, ID, bearer GATT, TTL `1..255`, dedup). `TTL == 0` → drop, no `MISSING`, no `Succeeded` (**admission-independent path per §0 step 6: steps 1–3 + base PoW only**).

2. **Storage**
   - **Admission marker (new, three states)**: each cache entry carries `admitted` (relayed), `stored_locally` (processed here but NOT admitted — relay refused by the sender budget or a PoW-gated relay), or both. `admitted=true` is never set unless the relay gate (Relay §1d) accepted at receipt time; `stored_locally=true` is set as soon as the message decrypted here; it is a property of the anchor fragment (Index 0, first entry) and is copied onto the other fragments of the same chain. The marker decides only where the packet is forwarded, never whether it is processed.
   - TTL has already been validated then decremented by 1 **after admission** (see §0 step 6, after the gate). A packet whose TTL becomes `0` after decrement is processed locally and NOT marked relayable.
   - The packet (`Packet ID` + decremented TTL + reception timestamp + ingress bearer/PHY) is in the cache. Max 1000 _(by default)_ Message entries (LRU, see Relay mechanism).
   - **Chain-completion tracking (key-independent, normative — ACKNOWLEDGEMENT "Per-hop delivery confirmation")**: extract `Chain`, `Last`, and `Index` from the packet and track chain completeness in the store (keyed on the cache's `chain_key` index) **regardless of channel membership**. Once the store holds all fragments (`Index` 0..`Last`) of a chain, the device answers `ACK Succeeded (0x1F)` to the direct GATT peer(s) that sent it (a re-heard complete chain is answered the rate-limited `Duplicated (0x0F)` per §0 step 6 — the emitter counts both as delivery success). Completeness is a cache fact, not a plaintext fact: a non-member relay confirms each hop exactly like a member.
   - If the device has the key for the packet's `Channel`:
     1. Extract `Chain`, `Last`, and `Index` from the packet.
     2. Obtain the chain identifier by concatenating: `Sender ID`, `Channel ID`, `Chain`, and `Timestamp` (see `PACKET.md` §3.4: `Chain` wraps every 16, `Timestamp` disambiguates reuses).
        - If this identifier does not exist in the chain management map, create a new list with a size of `Last + 1` and link it to the chain identifier.
        - If this identifier exists, retrieve the existing list and integrate the packet's chunk at its corresponding `Index` (first arrival wins; duplicates were already dropped by §0 step 6).
        - **Bounding (normative — bounded-state doctrine, RELAY §1/§7)**: the chain management map is an **index over the same bounded store** — it references cached frames by `Packet ID` and never copies chunks (no second copy, same doctrine as dedup + `MISSING` sharing one store). Its entries are freed when: (a) the chain is consumed by decryption — accepted (data extracted) **or** rejected (MIC failure already drops all its chunks, §1.3); (b) the chain's fragments age out of the LRU store (anchor eviction, RELAY §1); or (c) the entry's age exceeds the **reassembly horizon** (default 30 s, `Master::params` — aligned with the beacon-purge horizon, SECURITY §3.2), whichever comes first. Hard cap: same `Master::params` N as the dedup cache, LRU eviction beyond. A member receiving chains the emitter later abandons (ECDRI gave up, or the fragment never arrives) holds them for at most the reassembly horizon — never unboundedly.
     3. Once the list is complete, proceed to **Message Decryption**. Otherwise, send `MISSING` ACK(s) to the direct GATT peer(s) to retrieve the missing packet(s). `MISSING` is 1-hop and never relayed: only a direct peer holding the packet answers with that `Type 03 (0x03)` itself.

3. **Message Decryption (one MIC for the whole message)**

   The receiver **buffers the chain before verification**: no per-fragment MIC exists anymore (`PACKET.md` §3.6).
   - Concatenate chunks by `Index` (0..Last) → `stream = tag8 ‖ ciphertext` (**tag-first**; Chunk 0 starts with the 8-byte MIC computed with the packet-0 IV). If Chunk 0 (`MISSING Index 0`) is absent, request it first (highest priority): without it neither decryption nor MIC verification can start.
   - Derive `K_chan(channel, E)` for each accepted epoch `E ∈ {current−1, current, current+1}` — the 3-epoch acceptance window applies **at all times** (`CONFIDENTIALITY.md` §2), with no 120 s grace gating.
   - Decrypt/verify with `AES-CCM`:
     - **Key**: `K_chan(channel, E)`.
     - **Nonce (12 B derived)**: `nonce12 = SHA256(List0(Index=0) ‖ Sender4 ‖ Channel4 ‖ Timestamp4 ‖ Random4)[0..11]` (PACKET §3.5.1).
     - **AAD**: `V.Protocol ‖ V.BLE ‖ Typ.P.(0x03) ‖ Sender4 ‖ Channel4 ‖ List0 ‖ Timestamp4 ‖ E_be8` — TTL excluded (decremented per hop), `Random` excluded (hashed into the nonce).
   - Tag invalid under every accepted epoch → **reject the whole message** (integrity compromised or wrong epoch): drop all its chunks, no `MISSING` re-requests for a chain that cannot verify.
   - Verification success under `E` → accept; the discovered `E` may update the receiver's epoch hint. `MISSING Index 0` has highest priority — without Chunk 0 (MIC + ciphertext head) neither MIC verification nor decryption can start; request it before any other missing index.

4. **Decompression and Data Extraction**
   - Once the message is decrypted...
   - ...read the first byte (Flag): **bit0** = compression type (`No compression` or `Deflate (zlib)`), **bit1** = `Padded?`.
   - If **bit1 is set** (padding class, PACKET §3.7): read `real_len_be16` at plaintext[1:3] and **trim** `data = body[2 : 2+real_len]` — **only now**, after MIC verification (the length never existed as observable metadata). The zero tail is discarded.
   - Extract the (trimmed) data; decompress if bit0 is set.

---

### 2. Active Dropping

Certain well-placed Primary nodes might become overloaded with traffic. Penalizing their score would cause them to demote, leading to network instability ("flapping") and further packet loss during topology reorganization.

The Primary node retains its status and score, but implements a Local Triage (Active Dropping) mechanism to protect core network operations.

**Traffic Classification**
All network traffic is divided into two priority tiers:
- **High Priority (Control)**: Core routing protocol packets.
- **Low Priority (Data)**: Standard application payloads.

**Active Dropping**
If a Primary node exceeds its safe processing threshold *(> 30 relayed packets per second)*, it enters a defensive state. In this state, the node drops any newly received Low Priority (Data) packets, and answers `ACK Unabled` to the direct peer that sent the frame. High Priority (Control) packets are always processed normally. The node exits the defensive state once traffic drops back below the threshold. Devices that receive an `ACK Unabled` must slow down their packet transmission for 15 seconds. In a rendezvous upload (Relay 6), an `ACK Unabled` means the Secondary keeps its outbox queued and Pending=1; it must not delete flushed-then-refused frames.

**Scope (normative):** `ACK Unabled` is emitted **only toward the direct GATT peer that sent the dropped frame** — the attached Secondary uploading in-session, or a direct mesh peer. It is 1-hop, never relayed nor forwarded (Relay §4): a distant source never receives it and converges via ECDRI/MISSING escalation instead of any slowdown. The 15 s slowdown (Send §2.1) is keyed per emitting Primary and binds **that immediate neighbour only** — a direct mesh peer slows its rate *toward that emitter* but propagates nothing further, so penalties never cascade. This is by design, not a gap: the Silent Rescue (Relay §1d) was chosen over NACKs precisely because 1-hop signals cannot reach distant sources.
