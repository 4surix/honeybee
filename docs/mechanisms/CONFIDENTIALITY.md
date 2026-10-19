
# Confidentiality Mechanisms

### **1. Encryption and Authentication**

- **Algorithm**: AES-CCM-128 (16-byte key), **encrypt-then-fragment**.
- **Logical IV**: 18 bytes on-air (`List0 (2) + Sender (4) + Channel (4) + Timestamp (4) + Random (4)`); CCM nonce derived as `nonce12 = SHA256(logical IV)[0..11]` (see PACKET §3.5.1).
- **MIC**: **8 bytes (64-bit tag)** computed **once over the whole message with the packet-0 IV**, transported **at the head of Chunk[Index==0]** (`stream = tag8 ‖ ciphertext`, tag-first).

#### Encrypt-then-fragment pipeline

The sender performs, in order (see `SEND.md`, modeled by `tests/crypto_model.py`):

1. `Flag (1) + data` → `Deflate (zlib)` compression when payload > 50 bytes.
2. **Single AES-CCM encryption** of the whole plaintext with `K_chan`, `nonce12 = SHA256(List0‖Sender4‖Channel4‖Timestamp4‖Random4)[0..11]`, AAD = `V.Protocol(2)‖V.BLE‖Typ.P.(0x03)‖Sender (4)‖Channel (4)‖List0 (2)‖Timestamp (4)‖Epoch_be8 (8)`.
3. The tag (8 bytes) is **prepended to the ciphertext**: `stream = tag8 ‖ ciphertext` (tag-first; the MIC travels in Chunk of `Index == 0`).
4. `stream` is cut into **chunks of the padding class (32 or 200 bytes — constant, tail included, normative; legacy unpadded `9..200` test-only)** (Chunk 0 carries MIC 8 B + ≥1 ciphertext byte → ≥ 9 bytes either way); chunk *0* starts with the MIC, chunk *i>0* continues the ciphertext; chunk *i* becomes the payload of the fragment with `Index = i`.

Consequences (all covered by executable tests in `test_crypto_layer.py`):

- **One MIC covers the whole message**: any tampering of any fragment — a byte of ciphertext, a swapped fragment, a forged sibling — is detected at reassembly.
- **No MIC field in the old sense**: frame is `V.Proto (2) | V.BLE (1) | Typ.P. (1) | TTL (1) | List (2) | Sender (4) | Channel (4) | Timestamp (4) | Random (4) | Nonce (4, same chain copy every fragment, PACKET §3.5b) | chunk (1..200 unpadded test-only; 32 or 200 padded normative, MIC-first in Index 0) | FCS (2)` → **overhead 29 + chunk: 30 min … 229 max unpadded; 61 (short) / 229 (long) padded**; a 1-fragment message carries `8 MIC + ciphertext` in its single chunk.
- **TTL and Random are excluded from the AAD**: relays decrement TTL each hop (the MIC must survive retransmission), and `Random` is already hashed into the derived nonce.

#### Chain `Random` (IV salt, never ground) and chain `Nonce` (PoW grind target)

The IV ensures that the same plaintext encrypted twice with the same key yields different ciphertexts (prevents replication attacks). The on-air logical IV is 18 bytes (`List0 (2) + Sender (4) + Channel (4) + Timestamp (4) + Random (4)`); the CCM nonce is derived as `nonce12 = SHA256(logical IV)[0..11]`. The two 4-byte chain fields have strictly separate roles (see `PACKET.md` §3.5/§3.5b, `SEND.md` §1.1 step 5, `RELAY.md` §1b): the chain `Random` is the **CCM IV salt** — sampled uniformly at chain creation, frozen for the chain's lifetime, hashed into the IV, **never ground**; the chain `Nonce` is the **sole PoW grind target** — random-searched until `SHA256(List0‖Sender4‖Channel4‖Timestamp4‖Random4‖Nonce4)` has `d` leading zero bits (base `d=12`, escalation per `RELAY.md` §1d), replicated identically on every fragment, and **excluded from the `Packet ID`, the IV/CCM nonce and the AAD** so re-grinding never re-encrypts and never changes packet identity.

`Last` (chunk count − 1) is known **before** encryption (`len(plaintext) + 8` bytes of `tag8 ‖ ciphertext`, `tests/crypto_model.expected_last`), so fragment 0's `List` — and therefore the exact nonce — is fixed before any ciphertext exists.

#### Message integrity check (MIC)

The MIC (CCM tag) authenticates the **whole message with the packet-0 IV**: it binds the identity fields (`Sender4`, `Channel4`, `List0`, `Timestamp4`), the header (`V.Protocol‖V.BLE‖Typ.P.`) and the **key-rotation epoch** to the ciphertext via the AAD, and it travels **at the head of Chunk[Index==0]**. Verification requires `K_chan(channel, epoch)`; possession of that key is the *only* membership proof — the tag makes no identity claim visible to outsiders ("auth without identity claim").

### 2. Channel Management

Key hierarchy (HKDF-SHA256, RFC 5869; known-answer vectors in `test_crypto_layer.py`).

**Scope: ONE master PER CHANNEL** (locked decision) — every channel has its own 32-byte master root, distributed by its own QR:

```
master_channel (32 B, ONE PER CHANNEL, shared via QR)
   └─ K_sess(E) = HKDF-SHA256(ikm=master_channel, salt="honeybee",
                              info="honeybee/session" || E_be8, L=32)
        └─ K_chan(channel, E) = HKDF-SHA256(ikm=K_sess(E), salt="",
                              info="honeybee/channel/" || channel4 || E_be8,
                              L=16)
```

- `E = floor(t / 900)` is the **full 15-minute epoch counter** — never wrapped, for keys *and* for the (jittered) address period: the former `%256` address wrap died with the LFSR. Deriving keys from any truncated epoch would reuse keys periodically and enable replay-as-current attacks (regression test: `test_epoch_not_truncated_256`).
- **Compartmentalization at the root** (locked decision): masters are physically distinct per channel, so compromising the master of channel A yields **nothing** for channel B — no HKDF layer needs to be trusted for cross-channel isolation (separation holds even against full KDF cryptanalysis of one channel's root). The channel id also stays in the `info` (key binding, defense in depth against accidental master reuse).
- **Epoch separation (forward secrecy below the master)**: compromising one `K_chan(channel, E)` reveals neither other epochs nor the master — past sessions stay secret after the epoch rolls, no ratchet needed (`test_channel_isolation`, `test_forward_secrecy_epochs`). **Residual**: a compromised *master* exposes all past and future epochs of **its channel only** (derivation needs no secret besides the master) — rekeying a channel = issuing a new master QR.
- **Rotation = address rotation, clocks decoupled by jitter** (locked decision): keys and addresses turn on the **same 900 s base**, but keys use the deterministic `key_epoch()` (identical on every peer — no jitter, so `chanKey(E)` matches whatever each device's address jitter is), while addresses use `addr_epoch(t, jitter_device)` with a per-device jitter `[0, 120 s]` offsetting only the **address** boundary (`IDENTIFICATION.md` §3.3). A rotated address implies the key clock ticked (or is about to, within the jitter window) in the same 15-minute cycle.
- **`secret_local` is OUT of the key hierarchy** (locked decision): the 32-byte address secret (`IDENTIFICATION.md` §3.2) never enters `session_key()`/`channel_key()` — compromising it reveals only the address sequence of ONE device (tracking capability), never any payload key; compromising a master reveals no address (separation of concerns, both directions).

**Acceptance window**: a receiver derives and accepts frames for epochs **`E−1`, `E` and `E+1`** at all times (`accepted_epochs()` — window of 3): `E` is current, `E−1` covers a frame encrypted seconds before a boundary that is relayed/decoded after it, `E+1` covers a peer already rolling ahead (clock skew, jittered local state). `E−2` and below are **never** accepted — the window is fixed at 45 minutes total, bounded deliberately: wider windows enlarge the replay surface, and the max transit time of a fragment (TTL × hop latency) fits far inside the 3-epoch coverage (`test_window_three_epochs_always`, `test_E_minus_2_never_accepted`).

**Window/budget horizon distinction (normative)**: the **key acceptance window** (`E−1, E, E+1` — 3 epochs, 45 min of coverage) is a *keying* horizon: keys rotate every 900 s, so a boundary-crossing message must be derived up to one epoch ahead and one behind; `accepted_epochs()` is deliberately **not** gated by the 120 s grace. The **sender/relay budgets** (RELAY §1c/§1d) are a *radio-timing* horizon: they tick at 60 s and bound only emission/relay (and the 15 s `ACK Unabled` slowdown), never storage/decrypt. Those are two different clocks for two different problems — do not uniformize them: widening the key window never changes relay budgets and vice versa.
**Clock calibration assumption**: `accepted_epochs()` assumes the local clock is approximately synchronized to the UNIX reference (within the 45-minute window). A device whose clock has never been calibrated (first boot without time injection) must not originate chains; see `IDENTIFICATION.md` §4.

#### Database (Binary Storage)

Channel keys are **derived on demand**; only the per-channel masters are stored.

| Field           | Bytes | Description                                                |
|-----------------|-------|------------------------------------------------------------|
| Channel         | 4     | Identifier of the channel (32-bit, retable).               |
| Master          | 32    | Root HKDF key of that channel (never shared across channels). |

**Master revocation (normative):** `master_channel` exposes **all epochs of that channel only** — there is no per-member ratchet and no forward secrecy. If a member leaves or a device holding the QR is stolen, the compromise is permanent for that channel: the only safe remediation is to **create a new channel** (new `master_channel`, new QR) and redistribute it to the remaining members; the old channel must be abandoned. Compromise of `master_channel` never reveals `secret_local` (address chain) nor other channels' masters (independent roots).

#### Key Exchange Format (Text)

`0x0130ABCD::0x<64 hex chars>::900,12`

- field 1: the 4-byte channel the master belongs to
- field 2: that channel's 32-byte master key;
- field 3: `epoch_period_s, pow_d` protocol parameters (defaults `900,12`), so future parameter changes are explicit in the shared material.

Process (unchanged pipeline, new sizes):
- Compress data with `Deflate (zlib)` **iff uncompressed payload > 50 bytes** (same 50-byte threshold as §1; `Flag` bit0 records the choice). The key-exchange text (~70 o) is above the threshold and is therefore compressed.
- Encrypt `Compressed data` (with its 1-byte `Flag`) using AES-CCM (nonce 12 B, tag 8 B) and `K_chan(channel, E)`.


### 4. Anti-Replay and Integrity

- **TTL**: Limits relay count (prevents infinite loops); excluded from the MIC and PoW preimages so per-hop decrements never invalidate a frame.
- **MIC (8 B)**: Detects tampering anywhere in the reassembled message; binds `epoch` via AAD, so replaying an epoch-`E` frame into epoch `E+1` fails closed.
- **PoW (d=12)**: Binds relayed chains to sender work; verified keylessly by relays (see `RELAY.md`).
- **Rate limit**: Per-address token bucket caps relay injection (see `RELAY.md`).

### 5. Risk of collision

#### MIC

The length of the MIC is 8 bytes (64 bits). The probability of a collision for a space of $N$ possible values (here, $2^{64}$ for a 64-bit MIC) with $k$ packets (here, $10^6$ for example) is approximated by:

$$P(\mathrm{collision}) \approx 1 - e^{-k^2 / (2N)}$$
- $N = 2^{64}$ (number of possible MIC values).
- $k = 10^6$ (number of packets exchanged).

$$P(\mathrm{collision}) \approx 1 - e^{-(10^6)^2 / (2 \times 2^{64})} \approx 1 - e^{-10^{12} / 2^{65}} \approx 2.7 \times 10^{-8}$$

The probability of a collision for a 64-bit MIC ($N = 2^{64}$) with 1 million packets ($k = 10^6$) is approximately **0.0000027%**, paid once per message.

An attacker guessing a valid tag without the key succeeds with probability $\le k / 2^{64}$ over $k$ forged attempts; the relay rate limiter caps how many attempts reach verifiers (see `RELAY.md`).

