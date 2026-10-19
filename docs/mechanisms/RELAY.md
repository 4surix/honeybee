# Relay Mechanism

### 1. Strict deduplication cache (normative)

> [Data deduplication - Wikipedia](https://en.wikipedia.org/wiki/Data_deduplication)

**Key:** canonical `Packet ID` defined in Packet §0.3. **TTL is never part of the key.** Comparison is on `Packet ID` equality, never on raw bytes (raw bytes differ at each hop because TTL is decremented).  

**Capacity:** the last N `Type 03 Message` packets are kept in RAM for dedup + `MISSING` recovery (same store serves both). N is a **`Master::params`** knob (default 1000 on phone-class targets; **256 or fewer on MCU-class**). Cost ≈ N x (max frame 230 B for every `Index` (chain `Nonce` on all fragments), + ~48 B entry metadata (upper bound — short `packet_id` ref ~10 B + `chain_key` (Sender4+Channel4+Chain1+Timestamp4+Random4 ≈ 17 B) + `epoch` 8 B + `ttl_decremented` 1 B + `rx_timestamp` up to 8 B + bearer/PHY 1 B + flags 2 B + `pow_fail_count` 1 B, incl. 32-bit struct padding on nRF52-class targets): 1000 ≈ 278 KB (phone-class only — too large for a 256 KB nRF52840 that also runs the BLE stack), 256 ≈ 71 KB, 64 ≈ 18 KB. A fingerprint-only dedup mode (store a hash of the `Packet ID` instead of the frame) is a documented future option for tiny targets — but it forfeits `MISSING` recovery, which needs the stored frames, so it is **not** the default. `Type 01 (0x01)`/`Type 02 (0x02)`/`Type 04 (0x04)` are 1-hop (never relayed, see §4): keep only a small refresh cache (latest `Type 01 (0x01)` per Sender for election/`Pend.`+`Primary?`, latest `Type 02 (0x02)` per Sender, short-lived `Type 04 (0x04)`) for local processing, never for relay.

**Entry schema (normative — two key spaces, one store):** each entry is `{packet_id, chain_key, epoch, ttl_decremented, rx_timestamp, ingress bearer/PHY, pow_validated, admitted, sender_charged, pow_fail_count}`. `sender_charged` records that the per-sender bucket (§1c) was already debited for this `Packet ID` — re-gates never re-debit (see §1c). `pow_fail_count` counts consecutive PoW re-verification failures on this entry (case 2 below) — reset to 0 on any validation. The store keeps **two indexes**: (1) `packet_id` → entry, the per-fragment dedup key (Packet §0.4; includes `List`/`Index` and `Chunk`, excludes TTL/FCS/`Nonce`); (2) `chain_key = (Sender, Channel, Chain, Timestamp, Random)` → the **anchor** entry (the `Index == 0` fragment). `pow_validated` records that this fragment's PoW passed (§1b); `admitted` records that it cleared the whole §1d gate and was enqueued for relay.  

**Policy:**  

- Lookup happens **after** size/ID/bearer/FCS/TTL validation, **before** decrement (see Receive §0). Invalid frames (bad FCS, `TTL == 0`, bad size, wrong bearer) are dropped and **never inserted**.
- On miss: insert the entry with `pow_validated = false` and `admitted = false` **before** processing (closes re-entrancy during jitter window); the §1d steps then flip the flags as they pass.
- On hit, three cases:  
    - `pow_validated = true` **and** `admitted = true` → **drop as duplicate**. Do not reprocess, do not re-queue for relay. Optionally emit one rate-limited `ACK Duplicated (0x0F)` for `Type 03 (0x03)` (never relayed). Cancel any pending relay timer for that `Packet ID` (heard-it-again suppression).
    - `pow_validated = false` → **re-verify the PoW** on the just-received frame (its `Nonce` may be a fresh escalation) instead of dropping; if it passes, set `pow_validated = true`, reset `pow_fail_count` to 0, and continue the gate. If it fails, increment `pow_fail_count`; **an entry whose re-verification failed N times (recommended N = 3, `Master::params` knob) is evicted** — the next legit frame re-inserts it fresh as a **complete miss** (sender-bucket step 4 included — there is no fast re-insert path) with one re-insertion + one re-verify, benign for the honest sender whose PoW is always valid. This bounds the zero-grind CPU valve where an attacker floods PoW-invalid copies of one entry: each entry costs the relay at most N hashes before eviction. Stated limit: eviction makes the valve *per-entry-costly*, not closed — the attacker can reopen a fresh entry (one free re-verify), the ratio stays ~1:1 per frame, bounded by GATT bandwidth. Anti-poisoning: an entry inserted from a PoW-invalid frame cannot silently shadow the real one.
    - `pow_validated = true` **and** `admitted = false` → **re-gate** (§1d steps 4–6: sender-bucket, TTL, channel-bucket/rescue) against the re-received frame's PoW. This makes an escalation meaningful: a fragment dropped at the channel bucket gets a fresh chance when the emitter returns with a harder chain `Nonce` (on any retransmission cycle — MISSING-driven or ECDRI-driven, see §1b). If it passes, set `admitted = true` and enqueue; else it stays eligible for a future re-gate. Step 4 does **not** re-debit the sender bucket when `sender_charged` is already set (one debit per `Packet ID`, see §1c). TTL is **not** decremented again: the node ignores the TTL carried by the newly received frame (already validated `1..255` at reception per Receive §0 — a stale-but-valid value, never an invalid one), uses the entry’s `ttl_decremented` value (`original ingress TTL − 1`) for the outgoing frame, and recomputes the FCS accordingly — otherwise a packet re-gated *n* times would lose *n* TTL for a single hop; the retransmission is bit-identical except for the fresh `Nonce`, and the stored TTL keeps relaying idempotent. (If the stored decremented TTL is 0 the packet is local-only and never re-gated toward relay.)
- Eviction: LRU. A `Packet ID` whose Sender ID rotated (see Identification, 15-min epoch) must not collide: Sender rotation changes the key, old entries age out naturally.

This replaces the former contradictory rule (*"still returns it even if already received"*): a device **never relays a duplicate**.

#### 1.1 Chain PoW (normative, keyless, one proof per chain)

> [Proof of work - Wikipedia](https://en.wikipedia.org/wiki/Proof_of_work)

Relayed `03` frames must carry a sender-side Proof-of-Work on their chain. **Relays verify it WITHOUT any channel key** (a Primary relays `Type 03 (0x03)` it cannot decrypt): every control plane check in HoneyBee is keyless.

- **Preimage**: `List0 (2) || Sender (4) || Channel (4) || Timestamp (4) || Random (4) || Nonce (4)` — the fragment-0 `List` plus the dedicated PoW `Nonce` (see `PACKET.md` §3.5b). **TTL and FCS are excluded** (they mutate per hop: a proof must remain valid after any number of decrements). The `Nonce` is **included** so the emitter can re-grind it (escalation, §1d) without touching the frozen `Timestamp`/`Random`.
- **Condition**: `SHA256(preimage)` starts with `d = 12` zero bits at admission (parameter `pow_d` shared in `Master::params`; ~2^12 = 4096 hashes ≈ few ms grind for the sender — see `SEND.md` §1.1 step 5). In a channel-budget deficit the gate (§1d) may demand a harder `d_eff = 12 + min(8, burst − avail)` (silent rescue), which the emitter meets by re-grinding the `Nonce`.
- **Verification point**: in the reception pipeline, **after** size/ID/bearer/FCS/TTL checks and **after** dedup (§1), **before** relay enqueue (§3). Invalid PoW → silent drop (never cached as relayable, never re-requested via `MISSING`).
- **One proof per chain**: only `Index == 0` defines the PoW subject (`List0`), but **every fragment carries the same chain-`Nonce` copy** (`PACKET.md` §3.5b). Sibling fragments (`Index > 0`) repeat the same `Timestamp`+`Random`+`Nonce`; the relay accepts them **iff** the chain key `(Sender, Channel, Chain, Timestamp, Random)` already has a **validated** anchor (`Index == 0` entry with `pow_validated = true`) in the **unified dedup/PoW store** (§1) under the current epoch. An anchor inserted from a frame whose PoW failed (`pow_validated = false`) **never** admits siblings — this closes the cache-poisoning vector where an attacker who observed `Timestamp`/`Random` on the air injects a PoW-invalid fragment-0 to become a bogus chain anchor. In a channel-budget deficit (§1d step 6), each fragment’s own `Nonce` copy is verifiable, so each sibling passes the silent rescue on its own proof — no chain re-grind needed, no arrival-order dependency. Result: verification cost is one SHA-256 per *chain*, linear in chains, not in fragments (`test_sybil_bounds.test_one_proof_per_chain_not_per_fragment`).
- **Epoch binding**: the cache stores the key epoch with each chain. A chain re-injected under a new epoch (`E+1`) misses the cache and must prove itself again (anti-replay of stored chains across rotations).
- **Retransmission** (ECDRI / `MISSING`): `Timestamp`+`Random` never change (Send §2.3), so a retransmitted chain keeps its `Packet ID` and is a cache hit in the unified store. Escalation is **per chain, per current failure streak** — never a ratchet: `d` returns to the base `pow_d` (12) as soon as an ACK `Succeeded` is observed for the chain, and the next failure streak restarts from the base. Within a streak the curve distinguishes the two signals: a **MISSING-driven** retransmission re-grinds the chain `Nonce` immediately (`d = min(20, d_previous + 4)` from the first MISSING cycle — MISSING proves a receiver saw the chain incomplete, not a mute radio loss); an **ECDRI-driven** retransmission (pure silence, no ACK `Succeeded`) re-emits **with a fresh Nonce at unchanged `d` on the first cycle** (light re-grind at the same difficulty — the likely cause is benign radio loss, so no *harder* grind is paid; the fresh Nonce still routes around a relay whose entry was evicted, via a clean re-verify instead of a stale hit) and escalates `d = min(20, d_previous + 4)` only from the **second** silent cycle on. The emitter still needs no signal telling it *why* the chain did not arrive: ECDRI silence alone escalates from cycle 2, so a chain dropped at a congested intermediate relay converges to `d_eff` in 3–4 cycles instead of looping at `d = 12` until abandon — one extra cycle versus the MISSING path, traded against skipping a useless 2^16+ grind on every benign radio loss. Every escalated cycle rewrites the same fresh `Nonce` copy on every fragment (§1d).
- **Who checks**: every relay Primary before enqueueing a `03`. Secondaries do not relay, so they never gate on PoW (they only upload their own outbox). Receivers decrypting their own chains may also verify, but decryption correctness never depends on PoW (PoW is an anti-flood gate, not an authenticity proof).

#### 1.2 Anti-Sybil rate limiting (normative, per rotating address)

> [Sybil attack - Wikipedia](https://en.wikipedia.org/wiki/Sybil_attack)

Distinct from the sender-side emission Token Bucket (Send §2.1): this is the **relay-side admission control** on `Type 03 (0x03)` reception (after dedup, alongside PoW).

- **Token bucket per `Sender` address**: burst `16`, refill `4/s` (continuous). Each admitted `Type 03 (0x03)` consumes 1 token — **exactly once per `Packet ID`**: the first passage of step 4 sets the entry’s `sender_charged` flag (§1), and later re-gates of the same packet (§1 case 3) never re-debit. Empty bucket → silent drop (no ACK, no cache insert as relayable).
- **Bounded state**: LRU of `512` buckets, keyed by `Sender (4)`; bucket entries expire after `epoch + 60 s` of inactivity (same horizon as the key-rotation grace). Memory is fixed regardless of address churn.
- **Rotation-aware**: the `Sender` address rotates every 15-min epoch (Identification) — each fresh address restarts with a full burst. This is intentional: honest senders must be able to speak right after rotating, and the rotation *is* part of the anonymity design.
- **Documented limitation (normative caveat)**: the limit is **per identity**, not global. An attacker forging `N` fresh addresses obtains `N × burst` relayed packets per instant (`test_sybil_bounds.test_sybil_bound_is_n_times_burst`, `test_identity_rotation_lru_bounds_memory_not_grants`). The rate limiter does not and cannot erase this: it bounds *sustained* abuse per identity and bounds *memory* under address churn.
- **Mitigation stack** (defense in depth, each layer narrows the margin):
  1. **GATT range**: injection requires a BLE connection, not passive advertising — physical proximity required.
  2. **PoW (§1b)**: `2^12` hashes *per chain* — raising `d` is a protocol parameter, tunable in `Master::params`.
  3. **Rate limit (this section)**: caps how many poisoned frames reach the dedup/reassembly machinery per identity.
  4. **Active Dropping** (Receive 2): unchanged global overload valve.

#### 1.3 Relay emission budget per Channel ID (normative, int-only, local)

Distinct from §1c (per-`Sender` neighborhood limit) and from the sender-side
emission bucket (Send §2.1): this is the **relay-side airtime budget** at the
emission queue. RX is free; only relay TX of `03` pays. Budgets are strictly
local: no inter-node sync (contention is local, like airtime).

- **Bucket per `Channel ID`**: `burst = 20` (int tokens), refill `40/min`
  (`+2` tokens every `3 s`). Each admitted `03` fragment consumes
  `cost_frag = 1 + len(chunk) // 64` (int floor): `9 B -> 1`, `64 B -> 2`,
  `128 B -> 3`, `192..200 B -> 4`. Only `03` is debited (`01/02/04` are
  1-hop, never relayed, never debited).
  **Padding interaction (normative, SECURITY §3.1)**: with the constant
  classes the cost splits as `32 B short -> 1` and `200 B long -> 4` —
  the floor of 1 means short fragments cost *more per byte* (32 B/token
  vs 50 B/token for 200 B), which is honest: every BLE packet carries its
  own preamble/address/CRC + 2×IFS, so small packets genuinely cost more
  airtime per payload byte. Effect on the budget: short-class traffic
  admits `40 frags/min` (1280 B airtime/min), long-class `10 frags/min`
  (2000 B/min) — regime cap for useful compressed data per channel per
  15 min ≈ **6 KB (10 B chat) to ≈ 25 KB (1000 B messages)**, ≈ 12–17 KB
  for chat sizes (vs unpadded: a 189 B message now pays 7 tokens instead
  of 4 — the +75% privacy tax of uniform sizes, pinned by
  `test_channel_bucket.TestEconomicBounds`).
- **Lazy refill, no timer (normative)**: `avail(T)` is a pure function of
  `(tokens, lastUpdate)` with int seconds (monotonic):
  `add = (elapsed * 40) // 60`, `avail = min(burst, tokens + add)`,
  `lastUpdate` advances only by the time effectively converted
  (`(add * 60) // 40`), so the sub-token remainder is kept (no drift).
  No float anywhere (MCU-friendly, deterministic test vectors).
- **Bounded state**: LRU of `256` buckets (~3 Ko); entries expire after
  `epoch + 60 s` of inactivity (same horizon as §1c: no budget state
  survives a rotation). An evicted-then-seen channel restarts at `burst`
  (known re-arm window, covered by base PoW `d=12` — see SECURITY §1.3).
- **Channel-budget backpressure + silent rescue (normative)**: when
  `avail < cost` the relay does **not** mint tokens and there is **no new
  packet type, no NACK, no round-trip**. Instead the gate (step 6 below)
  applies a **silent rescue**: the fragment is admitted **without debit**
  (tokens forced to 0) **iff** its PoW meets `d_eff = 12 + min(8, burst −
  avail)` (so up to `d_eff = 20` on a fully empty bucket). Otherwise it is
  dropped **silently**. Missing fragments are reclaimed through the
  existing **MISSING** mechanism (`ACKNOWLEDGEMENT.md`): the receiver,
  knowing `Last` from every fragment, requests the absent indexes. But a
  chain dropped at an intermediate relay never reaches any downstream
  receiver, so no MISSING can come back — the emitter’s own ECDRI
  (no ACK `Succeeded` observed) is therefore an equally valid escalation
  signal. A **MISSING-driven** retransmission escalates from the first cycle
  (`d = min(20, d_previous + 4)`); an **ECDRI-driven** retransmission
  (pure silence) re-emits with a fresh Nonce at unchanged `d` on the first cycle and escalates
  only from the second silent cycle (§1b — benign radio loss pays no grind).
  Either way the emitter raises its PoW by re-grinding the chain `Nonce`,
  converging on `d_eff` in at most 3–4 silent cycles (12 → 12 → 16 → 20). The emitter may *provision* a
  higher `d` from the start (e.g. `d=16`) if it has recently observed MISSING
  on this channel — a purely local heuristic, never negotiated with the
  relay. Because the rescue demand is never communicated, this gives the
  honest sender the same upward pressure as a relay-driven rescue **without**
  an unauthenticated griefing channel (a "PoW too low" ACK could be forged
  by anyone to force victims into 1 M-hash grinds; here only a retransmission
  cycle (MISSING from the first cycle, ECDRI-silence from the second —
  which the emitter already answers) drives the escalation, capped at `d=20`).
- **Ordered gate (normative, cheapest first — never pay a PoW check for a
  packet dedup would drop)**. The channel-bucket deficit is redeemed by the
  silent rescue in step 6 (PoW ≥ `d_eff`) plus retransmission cycles
  with chain-`Nonce` escalation (MISSING from cycle 1, ECDRI-silence from cycle 2, §1 above):
  ```
  1. FCS valid? else drop
  2 & 3. Dedup & base PoW (d=12) validation (see §1 policy — the gate
     never drops a seen-but-not-admitted packet blindly):
     - Miss: insert the entry first (pow_validated=false, admitted=false,
       sender_charged=false, pow_fail_count=0 — closes re-entrancy),
       then validate base PoW d=12 (drop if fail); on pass set
       pow_validated=true and proceed to 4.
     - Hit (admitted=true): drop as duplicate (optional in-session `ACK Duplicated (0x0F)`, rate-limited, never relayed; cancel any pending
       relay timer for that Packet ID — heard-it-again suppression).
     - Hit (pow_validated=false): re-verify the just-received frame’s
       fresh Nonce (drop + pow_fail_count++ — evict after N=3 — if
       fail); on pass set pow_validated=true, reset pow_fail_count=0,
       proceed to 4.
     - Hit (pow_validated=true, admitted=false): skip to step 4 (re-gate).
  4. sender-bucket (§1c)? else drop (no re-debit when sender_charged)
  5. TTL > 0? else drop
  6. channel-bucket: avail >= cost? debit & pass.
     else silent rescue: PoW >= d_eff = 12 + min(8, burst - avail)?
        yes -> pass WITHOUT debit (tokens forced to 0)
        no  -> drop silently
  -> enqueue (priority §1d queue + §3 jitter)
  ```
- **Service priority (queue order, never a bypass)**: `Emergency (0) >
  Public = Private (1) > Team (2) > Testing = Reserved (3)` (see
  CHANNELS.md priority table), FIFO within a class. `MISSING`-triggered
  retransmits and ECDRI retransmits go first (mesh reliability core),
  with two anti-abuse guards: (a) a MISSING is only served for fragments
  already seen/stored (verifiable via the Receive store), (b) a served
  MISSING still pays the normal `cost_frag` — scheduling priority, not a
  budget exemption. Modeled by `tests/crypto_model.py: ChannelRelayLimiter`
  and pinned by `tests/test_channel_bucket.py`.

### 2. TTL rules (normative)

> [Time To Live - Wikipedia](https://en.wikipedia.org/wiki/Time_to_live)

Only a Primary relays packets it receives, and **only if** TTL validation passed at reception (`1 <= TTL <= 255`, `TTL_MAX = 255`). A Secondary never relays: it uploads its own outbox to its single serving Primary (§6) and receives downloads from it; it never forwards third-party traffic.

The maximum number of relays is 255. If you use this value when sending a packet, it means it will pass through 255 devices (potentially multiple times the same device, though strict dedup prevents re-relay by the same device). At Long Range 125 kb/s, we can reach an average distance of up to 200 meters. 255 x 200 = 51,000 meters (51 km). But sometimes, we don't need to go that far; just a few hundred meters is enough, or 1-2 km. In this case, it's advisable to use a low TTL value (10-15) to avoid unnecessarily overloading the network.

- After validation, decrement TTL by 1. Relay **only if** decremented TTL `> 0`. If it becomes `0`: process locally (reassembly/decrypt) but do not enqueue for relay.
- Only `Type 03` carries TTL. `Type 01/02/04` have no TTL and are never relayed nor forwarded: each node emits only its own `01` beacon (fresh emission every ~10 s, not a relay), and exchanges `02`/`04` with direct peers only. Only `03` follows TTL-gated relay.
- Never modify `Timestamp`/`Random`/`Chunk` on relay; only TTL mutates (then FCS is recomputed). Re-encrypting or regenerating `Timestamp`/`Random` breaks dedup, `MISSING` recovery, and the chain PoW (§1b).

### 3. Relay with jitter (normative)

> [Brodcast radiation - Wikipedia](https://en.wikipedia.org/wiki/Broadcast_radiation)

Immediate rebroadcast causes broadcast storms and BLE collisions (worse with dual 1 Mbps + 125 kbps TX) — **and** it creates an observable stimulus→response link: an active observer sees packet A arrive, packet B leave, and correlates relay to input. Every relay is therefore scheduled **independently on the node's own emission schedule**, never as an immediate response, and suppressed if heard again:

- On cache miss + relayable (ordered gate §1d: FCS/dedup/PoW-base/sender-bucket/TTL/channel-budget-or-silent-rescue pass, Active Dropping pass):
  - Enqueue `(is_retransmit, channel_priority, seq, Packet ID, frame with decremented TTL)` in the Message relay queue (`Type 03 (0x03)` only; `MISSING`-triggered retransmits and ECDRI retransmits first, then lowest channel-priority value per §1d, then FIFO `seq`; per chain lowest Index first). Service order is queue order only — never a bypass of any §1d control.
  - Schedule GATT TX at `now + uniform(0, 500 ms)` (**window 0–500 ms**, `relay_jitter_ms()`/`RELAY_JITTER_MS_MAX` in `tests/crypto_model.py`, `test_crypto_layer.TestRelayJitter`). The delay is drawn **from the relay's own slot schedule**: the node emits on its own intervals, so a received packet never triggers an emission inside the same short reaction time — the link stimulus→response is broken for an active scanning observer. This jitter is the anti-collision jitter serving a second purpose: **anti-tracking** (traffic mixing).
  - If a duplicate `Packet ID` is received before the timer fires → cancel the pending relay (suppression). If ECDRI/`MISSING` needs the packet, it is re-queued as a new jittered relay (still consuming a token for `Type 03 (0x03)`).
- **Independent emission rule (anti-reflex, normative)**: a relay MUST NOT emit within a deterministic delay of the reception that triggered it. The 0–500 ms draw is the *upper* bound of a per-packet uniform distribution — not a fixed reaction time — and successive relays MUST draw independently (no reuse of the previous delay, no queue-drain bursts): consecutive emissions are spread on the node's own schedule, intermixed with its own beacons/control (`traffic mixing`). Local delivery/reassembly is unaffected (processing is immediate, only the TX is delayed).
- Jitter applies to Message relay only, not to local delivery/reassembly. Initial `Type 03 (0x03)` emissions follow Send Token Bucket; retransmissions (ECDRI/`MISSING`) also draw from the same 0–500 ms window.
- Uniform random must be per-packet and unpredictable (use CSPRNG or `Random` field mixed with local entropy — `relay_jitter_ms()` with `seed=None` uses `SystemRandom`), so neighboring nodes desynchronize **and** an observer cannot infer the next emission from the last reception.

### 4. Bearer and relay scope (normative, see [frame overview](../images/img-frame.png))

- **Only `Type 03 Message` packets are relayed, and only in GATT.** Every relay dequeues a validated, TTL-decremented (`> 0`) `03` and forwards it over GATT connections (never in Advertising payloads).
- **Advertising**: carries only fresh `Type 01 Informations` beacons (17 bytes protocol + Adv overhead, 4-byte Sender + `Primary?`) emitted by their own sender every ~10 s. A node never relays another node 01: on reception it processes it locally (election, `Pend.`+`Primary?` detection per Receive 0.1) and drops it after processing.
- **GATT 1-hop (never relayed)**: `Type 02 Neighbors` (topology snapshot for direct peers) and `Type 04 ACK` (reception acknowledgement to direct peers, including `MISSING`/`Succeeded`/`Duplicated`). A node that receives a `02`/`04` consumes it locally and never forwards it. Exception without relay: a node holding a packet requested by an in-session `MISSING` emits that `03` itself (it does not forward the `MISSING`).
- **Who relays (hard rule): only Primaries relay `03`.** `Primary` nodes relay `03` on GATT (mesh §5 + serving their attached Secondaries §6) and emit `01` beacons. `Secondary` nodes never relay and never forward: their only GATT emission is the upload of their own outbox to their single serving Primary on a Primary-initiated rendezvous (see §6). This supersedes the former Relay text that let every device relay everything.
- **Canonical pipeline (normative example):** `Secondary S --(upload, own `Type 03 (0x03)`)--> Primary P1 --(relay, mesh)--> Primary P2 --(download)--> its attached Secondaries`, then `P2 --(relay, mesh)--> P3 ...`. Each `Type 03 (0x03)` is validated + TTL-decremented at every Primary hop (§2); duplicates are suppressed by Packet ID (§1, §3). A Secondary that originates a Message sends it only to its serving Primary (Phase A upload); fan-out to other Secondaries happens exclusively as Phase B downloads from each serving Primary.

### 5. Primary-Primary GATT mesh (normative)

Primaries form the GATT relay backbone: they connect to each other to exchange `Type 03 (0x03)` Messages (plus 1-hop `Type 02 (0x02)`/`Type 04 (0x04)` with each direct peer). Secondaries never mesh between themselves and never initiate mesh links.

#### 5.1 Discovery (via 1-hop 001 beacons)

- Each Primary learns neighboring Primaries from their `Type 01 (0x01)` beacons (masked role `Role & 0x7F == 0x01`), heard directly (no relay). It records (Primary Sender ID, Score, RSSI/PHY, last-seen). Stale entries (> 30 s without fresh beacon, i.e. ~3 periods) are purged.
- Selection: connect to up to `M` mesh peers (recommended `M = 3`): highest Score first, then strongest RSSI_EMA, skipping IDs already connected and IDs in demotion cooldown (Network Rule 0). Re-evaluate at most once per 10 s beacon period (no flap). Mesh peers are Primaries only; attached Secondaries are served separately via §6 (never counted in M).
- Tie-break to avoid double-connect: when two Primaries discover each other simultaneously, the one with the higher (Score, Sender ID) initiates; the other accepts and cancels its own attempt for that peer (jittered 0.5-2.0 s before initiating, same desync as §6.1).

#### 5.2 Connection (Primary <-> Primary, symmetric GATT)

- Either side may be GATT Central after the tie-break; the link is symmetric once up (both directions carry `Type 03 (0x03)` relay + in-session `Type 02 (0x02)`/`Type 04 (0x04)`). Short connection interval (15-30 ms), supervision timeout >= 2 s.
- Keep-alive: while the link is up, each side sends its `Type 02 (0x02)` snapshot at most once per 10 s and its `Type 01 (0x01)` beacons stay in Advertising (not inside GATT). Idle links (no `Type 03 (0x03)` relayed either way for 30 s) may be dropped; busiest links are kept.
- Failure: reconnect with backoff 2 s, 4 s, 8 s (max 3 attempts), then wait for fresh beacons before retrying.

#### 5.3 Exchange (only 011 relayed)

- Each side forwards only cache-miss `Type 03 (0x03)` frames with decremented TTL `> 0` (validated per Receive §0, jittered 0-500 ms per §3 — independent emission, never an immediate response), except back to the ingress peer (split-horizon: never send a packet back over the link it arrived on).
- `Type 02 (0x02)`/`Type 04 (0x04)` on a mesh link are 1-hop only: each Primary shares its own Neighbors snapshot and its own ACKs with that direct peer; it never forwards a third node `Type 02 (0x02)`/`Type 04 (0x04)` over the mesh.
- Token Bucket (Send 2.1-2.2) applies per sender for each `Type 03 (0x03)`; Control bypasses it. Active Dropping (Receive 2) applies symmetrically: an overloaded Primary answers `ACK Unabled` in-session instead of accepting.
- Fan-out to attached Secondaries: besides meshing `011` to peer Primaries, each Primary downloads (Phase B, §6.3) every newly learned relay-eligible `Type 03 (0x03)` (TTL `> 0` after decrement, not a duplicate for that peer) to each of its attached Secondaries at their next rendezvous session (or immediately if already connected). One GATT session per Secondary at a time (§6.5 mutex).

#### 5.4 Interaction with the Secondary rendezvous

- A Primary serves at most 1 GATT session initiation at a time across mesh + rendezvous (BLE connection budget): mesh links are persistent, rendezvous (§6) are on-demand and preempt idle mesh dialing (never drop an active `Type 03 (0x03)` flush to dial). Recommended budget: `M = 3` persistent mesh peers + 1 on-demand rendezvous slot.
- Frames learned over the mesh enter the normal dedup cache (§1) and become eligible for Phase B download to a rendezvous Secondary (if TTL `> 0` and not a duplicate for that peer).

### 6. Exclusive Secondary<->Primary attachment + rendezvous (normative)

Goal: a disconnected Secondary cannot deliver its GATT packets over Advertising (forbidden by bearer rules). When a Primary sees Pending=1 from a Secondary, it schedules a GATT connection so the Secondary uploads its outbox while the Primary downloads its own unsent packets to that Secondary in the same session.

**Exclusivity rule: a Secondary is attached to at most ONE serving Primary at a time (single GATT link, single uploader, single downloader).** This forbids several Primaries connecting in turn to the same Secondary for the same outbox (no round-robin draining, no duplicate uploads, no divergent downloads). Multi-homing is forbidden; re-attachment to another Primary happens only via explicit handover (§6.5).

#### 6.1 Detection (Primary side)

- Trigger: a Primary directly hears a Type 01 beacon (01 is 1-hop, never relayed) whose masked role is Secondary (Role & 0x7F == 0x02) with `Pend. == 0x01`. It proceeds only if `Primary?` == self or (unattached + winner == self); if `Primary?` names another Primary, cancel (already served).
- The Primary records (Secondary Sender ID, last-seen timestamp, ingress PHY/RSSI). Duplicate Pending beacons refresh the timestamp; they do not create duplicate connection tasks (one pending task per Secondary ID, coalesced).
- Selection: if several Secondaries advertise Pending, serve highest Score first, then strongest RSSI, then oldest timestamp (fairness). A Primary serves at most 1 rendezvous at a time (BLE connection limit); others wait in a bounded task queue (recommended cap 8; drop-oldest beyond cap).
- Scheduling: wait jittered delay `T_connect = uniform(0.5 s, 2.0 s)` before initiating, to desynchronize competing Primaries. Cancel per mutex §6.5 (already served: link busy, Pending=0 drained, or Secondary listed in a peer Primary 010 snapshot). Only the Secondary-elected winner ( §6.1b) should persist; non-winners cancel on next beacon.

#### 6.1b Election of the serving Primary (Secondary side, normative)

A Secondary chooses its single serving Primary deterministically from directly-heard `001` beacons (1-hop, masked role `0x01`), so all nearby Primaries converge on the same decision without negotiation:

**Rationale for Secondary-side election (information asymmetry):** the Secondary is the only node that knows the quality of **all** its candidate links — a Primary does hear the Secondary (it must, to detect `Pending`/`Primary?`, and it may apply an RSSI gate, SECURITY §1.4), but it cannot assess how that Secondary hears its competitors. The decision therefore belongs to the node holding the complete view: a Primary-side election would let a strong-receiver Primary pull a Secondary onto a link that Secondary cannot see as good.

1. Candidate set: Primaries heard within the last 20 s (~2 beacon periods) with RSSI >= -90 dBm (same reliability floor as Network overlap). Entries older than 20 s are purged.
2. Score: rank by `(S_global desc, RSSI_EMA desc (higher/less-negative wins), Sender ID asc)` using the beacon Score field and locally smoothed RSSI_EMA (alpha 0.2, same filter as Network mobility). Highest rank wins; Sender ID ascending (4-byte lexicographic) breaks ties deterministically. (Caution: sort key is `-RSSI` ascending or `RSSI` descending — ascending raw RSSI elects the *weakest* signal; proven by `tests/test_election.py`.)
3. Stickiness (anti-flap): the Secondary keeps its current serving Primary unless the winner beats it by hysteresis `H = 5 + round(5 * V_rel)` (reuses the Network dynamic-hysteresis shape, lighter than the Primary-purger threshold) evaluated at most once per 10 s beacon period, OR the current Primary vanishes (> 20 s silence) OR it answers `ACK Unabled` twice in a row (overload: current is excluded from the winner pick, best of the *rest* wins) OR its beacons demote it (role flips to `0x02`).
4. Publication: the Secondary announces its choice explicitly in its `01` beacon — `Primary?` = elected serving Primary ID (`0x00000000` while electing). It accepts a GATT rendezvous ONLY from that Primary and rejects (or ignores) attempts from any other Primary while attached.
5. Fresh Secondary (no serving Primary yet): same ranking, no hysteresis on first pick; it accepts the first rendezvous only from the current winner. While unattached it still beacons Pending=1, so several Primaries may schedule tasks — but §6.5 mutex guarantees only the winner connects.

#### 6.2 Connection (Primary = initiator / GATT Central, Secondary = GATT Peripheral)


- Only the Primary initiates the GATT connection. The Secondary never initiates for flush; it only advertises Pending and accepts. This **initiator asymmetry** avoids *double-connect* collisions — **both endpoints dialing each other simultaneously**. It is a distinct mechanism from the **multi-Primary race** (several Primaries wanting to serve the same Secondary), which is handled by the `Primary?` lock + §6.5 mutex; the two are complementary defenses, not the same problem.
- The Secondary must keep its Peripheral role connectable while Pending=1. After accepting, it stops advertising Pending=1 only when its outbox is empty (cleared at the next 10 s beacon after flush, not mid-connection).
- Connection parameters: short connection interval (recommended 15-30 ms), supervision timeout >= 2 s. If connect fails, exponential backoff: retry after 2 s, 4 s, 8 s (max 3 attempts), then drop task and wait for a fresh Pending beacon.
- MTU: relayed frames are <= 229 bytes protocol (29 overhead + max 200 chunk; padded normative 61 short / 229 long) per Packet format; no additional segmentation is introduced by the rendezvous itself.

#### 6.3 Bidirectional flush order (same GATT session)

- Phase A - upload first (Secondary -> Primary): the Secondary sends its outbox FIFO over GATT (its own 1-hop Control 02/04 for that direct peer first, then its Data 03; per chain lowest Index first, Index 0 = MIC-carrying fragment first). Only the 03 part is relay-eligible beyond the Primary; the 02/04 part is consumed locally by the Primary (never forwarded). The Primary processes each frame through the normal Receive path (size/ID/bearer/TTL/dedup) and ACKs per Acknowledgement mechanism. Upload consumes no Primary token; it consumes the Secondary token bucket at actual TX time (Send 2.1-2.2).
- Phase B - download (Primary -> Secondary): immediately after upload (same connection), the Primary sends what the Secondary still lacks: (a) relayed `03` frames whose decremented TTL > 0 queued for that Secondary, (b) ECDRI retransmits and MISSING-satisfying `03` packets, (c) its own 1-hop Control (02/04) for that direct peer (never third-party Control). Download consumes the Primary token bucket for each 03 (Send 2.1-2.2); Control bypasses it.
- Ordering rationale: upload first lets the Primary learn what the Secondary already has (dedup hits), so Phase B skips duplicates and only pushes truly missing frames.
- Dedup/TTL interplay: frames already in either cache (same Packet ID) are ACKed (Succeeded/Duplicated) but not re-queued. Relayed 03 frames carry TTL decremented once by the relaying node after validation (Relay 2); the rendezvous itself never decrements twice for one hop.
- Close: when both directions report empty (outbox empty + no queued relay/retransmit for that peer) or a 5 s inactivity timeout fires, either side may disconnect. The Secondary clears Pending at its next 10 s beacon if its outbox is empty.

#### 6.4 Interaction with existing rules

- Bearer split (Relay 4) unchanged: `Type 01 (0x01)` stays in Advertising; `Type 02 (0x02)`/`Type 03 (0x03)`/`Type 04 (0x04)` only over this GATT session, never advertised.
- Jitter/suppression (Relay 3) unchanged: flushed frames enter the normal relay queue with the independent GATT jitter (0-500 ms, drawn on the node's own schedule); heard-again duplicates cancel pending relays.
- ACK/`Type 02 (0x02)` 1-hop rule (Relay 4) unchanged: ACKs and Neighbors exchanged in-session are terminal (never relayed/forwarded). MISSING handling unchanged: a node holding the requested packet emits that `Type 03 (0x03)` itself in-session.
- Active Dropping (Receive 2) applies: an overloaded Primary may answer ACK Unabled in-session instead of accepting upload; the Secondary keeps frames queued and Pending=1.

#### 6.5 Single-link mutex + handover (normative)

- **Mutex (Primary side, `Primary?`-gated):** before initiating, a Primary reads `Primary?` from the Secondary beacon and checks the Secondary is not already served: it proceeds only if `Primary?` == self (or unattached + winner == self) and cancels its task if (a) it directly hears that Secondary in an active GATT connection (link-layer busy / connectable = false), or (b) it hears a fresh beacon from that Secondary with Pending=0 (drained by someone — but per election this should be its winner; if the winner is not self, cancel), or (c) a peer Primary lists that Secondary in its **attached-Secondaries snapshot** (`Typ. N.` = `0x03`, see below) — a Secondary merely *heard* by the peer (`Typ. N.` = `0x02`) is NOT a cancel trigger. One task per Secondary ID, first-winner-connects: if two Primaries race, the loser observes the link busy on its jittered attempt (0.5-2.0 s desync, §6.1) and backs off (2/4/8 s, max 3), then cancels on next beacon if still served.
- **Mutex (Secondary side):** while attached (GATT connected to its serving Primary), the Secondary refuses/ignores all other GATT connection attempts (reply busy/unavailable at link layer; no data exchanged). It processes only its serving Primary frames in-session.
- **Attachment advertisement (for mutex convergence):** each Primary lists the Sender IDs of its currently attached Secondaries in a dedicated `Type 02 (0x02)` Neighbors packet with entry kind **`Typ. N.` = `0x03`** (attached-Secondaries kind, PACKET §2), emitted once per Neighbor cycle (~10 s) on its mesh links — separate from the `Typ. N.` = `0x02` kind, which lists Secondary *neighbors merely heard*. A Primary builds this list by reading `Primary? == self` in the beacons of its attached Secondaries. **Peer Primaries** use this to cancel redundant tasks: a Primary seeing Secondary X listed in Primary P's kind-`0x03` snapshot (P != self) cancels its own task for X. (Secondaries are not consumers of this snapshot: kind `0x03` rides GATT mesh links between Primaries only — a Secondary never hears it, and never needs it, since it holds no connection task, §6.2.) The entry count of the kind-`0x03` packet **is** $N_{attached}$ (Network §3.E, load malus): peers may read it for load awareness, but they never compute the malus themselves — the emitter's broadcast `Score` already carries it (PACKET §1).
- **Handover (Secondary-initiated only):** re-attachment happens only when the Secondary re-elects (§6.1b: vanish/overload/demotion/hysteresis-beaten). Sequence: (1) Secondary disconnects from old Primary (or link times out); (2) it keeps Pending=1 + outbox intact (nothing is deleted until ACKed Succeeded by the new server); (3) it accepts only the new winner; (4) old Primary drops per-peer queued downloads for X after 20 s silence and stops advertising X as attached. The Send §2.1 `Unabled` rate penalty is keyed by the emitting Primary: it does **not** follow the Secondary to the new server (Phase A drains at the nominal rate), but a fresh `Unabled` from the new server starts a fresh penalty keyed by it. No state migrates between Primaries (daisy-chaining forbidden): the new server re-learns X outbox via Phase A upload; duplicates against the mesh-wide dedup cache (§1) are ACKed, not re-relayed.
- **Failure safety:** if the serving Primary dies mid-upload, uploaded-but-unACKed frames stay queued (Pending=1) and are re-uploaded to the next winner bit-identically (Send §2.3 identity). Downloaded-but-unprocessed frames are idempotent via Packet ID dedup (Receive §0 step 5).

### 7. ECDRI / MISSING interaction

The relayed Message chains follow the same ECDRI logic at each GATT hop as the acknowledgement mechanism: each hop waits for the `ACK Succeeded` of the connected peer (or of the downstream holder) before considering that hop delivered.

Since the ECDRI DELAY (1 s, ACKNOWLEDGEMENT) stays below the 5 s inactivity close (§6.3), an in-session hop can retransmit before the link tears down; if the link does close first, the un-ACKed frames stay queued (§6.5 failure safety) and the chain is re-sent at the next rendezvous, bit-identical (SEND §2.3).

The last N *(default 1000 phone-class, 256 or fewer MCU-class — `Master::params`, see §1)* `Type 03 Message` packets received are kept in RAM, for the `MISSING` part of the acknowledgement mechanism — **same store as the dedup cache §1, no second copy**: `MISSING` recovery serves the stored frames directly.
