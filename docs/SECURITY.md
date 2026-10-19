# Security Analysis

### **1 Known Vulnerabilities and Risks**

#### **1.1 Encryption and Authentication**

| Risk | Description | Impact | Mitigation? |
| ---- | ----------- | ------ | ----------- |
| **Weak Key Management**      | Static per-channel data keys, no rotation. | ~~High~~ | **Done**: hierarchical HKDF — `master_channel → K_sess(E) → K_chan(channel, E)`; epoch keys derived on demand, only 32-byte per-channel roots stored (`CONFIDENTIALITY.md` §2). Rotation every 900 s. |
| **Short Tag Size**           | AES-CCM tag 8 bytes (64 bits), one per message in Chunk of `Index == 0`.    | ~~Medium~~ | **Quantified forgery bound, not merely coverage**: an outsider forges at rate ~2⁻⁶⁴ per attempt — the 64-bit tag is not a covert channel, it is a probability. The per-key exposure window is bounded by the 900 s epoch (one key, one cycle of attempts, then rotation). The attacker's best case is a member-forgery (see §1.2 residual — not a tag-size issue). The current text describes *what* is protected, this line quantifies *how hard it is to break*: `P(forgery per attempt) ≈ 2⁻⁶⁴`, with bounded attempts per key, so the risk stays below any feasible threshold. (`CONFIDENTIALITY.md` §5 covers the encrypt-then-fragment arrangement.) |
| **No Forward Secrecy**       | Compromising the long-term group key exposes past traffic.  | Medium | **Done by derivation**: keys depend on the full epoch `E` — a `K_chan(channel, E)` compromise exposes only that channel/epoch; `E−1` and other channels (independent masters) stay secret (`test_crypto_layer`). **Residual**: compromise of a channel's **master** exposes all epochs of *that channel* (no ratchet/DHE). Mitigation: **reissue the master QR and create a new channel when membership changes** (a member leaving or a stolen phone is permanent compromise for that channel — the old channel must be abandoned and a new QR redistributed to remaining members); ECDH remains the listed upgrade path. |
| **No Key Exchange Protocol** | The protocol assumes pre-shared keys (QR) for groups. This is impractical for large-scale or dynamic groups. | Medium     | Mitigated: one QR per channel covers **all its epochs** (the root never rotates with time — only membership changes force a re-QR). A real key exchange (ECDH over GATT) remains future work. |

> **Normative note (IV stability across escalations):** the CCM IV is derived **without the Nonce**: `nonce12 = SHA256(List0‖Sender4‖Channel4‖Timestamp4‖Random4)[0..11]`. The `Nonce` chain is a **pure PoW field**: it is re-ground (random search until the hash meets the difficulty `d=12`, or `d_eff` en escalation) at each retransmission, and nothing else — the ciphertext, IV, `Timestamp` and `Random` stay **bit-identical across all retransmission cycles**. Semantic security is guaranteed by `Random` (a fresh 4-byte value per chain creation, hashed into the IV), not by the Nonce. Any implementation that "harmonises" by adding the Nonce to the IV derivation **silently breaks retransmission**: the ciphertext would differ on every attempt, deduplication becomes chaotic (two identical packets no longer match), and reconnect after a lost ACK silently corrupts the session — **without any visible error**. |

#### **1.2 Packet Integrity**

| Risk | Description | Impact | Mitigation? |
| ---- | ----------- | ------ | ----------- |
| **No Source Authentication** | The protocol does not authenticate the sender of a packet. An attacker can impersonate a device.  | intra-channel sender spoofing possible (residual, accepted) | **Membership authentication via CCM tag under K_chan(channel, E)**: only a member of the channel (who holds the channel key) can forge a valid tag, so a non-member cannot impersonate. **Individual sender authentication deliberately absent**: the `Sender ID` field is declarative and any member may emit with another member's ID — this is an accepted residual that preserves in-channel unlinkability, since binding an identity to emission would break the anonymity of members within the group. Per-member attribution would require per-member keys (future upgrade, breaks the anonymity tradeoff). **Non-repudiation**: impossible in symmetric-group cryptography (any key that verifies is held by all members) — this is a conscious choice, not a missing goal. |

#### **1.3 Relay and Network Attacks**

| Risk | Description | Impact | Mitigation? |
| ---- | ----------- | ------ | ----------- |
| **TTL Manipulation**         | An attacker can set TTL to a high value to flood the network with packets.           | Medium   | Validate TTL at reception (`1 <= TTL <= 255`, `TTL_MAX = 255`): drop `TTL == 0` before cache/relay (Receive §0, Relay §2). `TTL == 0` forbidden at emission (Send §1). Flood beyond TTL mitigated by strict dedup (Relay §1), relay jitter + suppression (Relay §3), Token Bucket + Active Dropping. |
| **Relay Loops**              | Packets can loop indefinitely if devices relay them back to the sender.              | Medium   | Strict dedup cache on canonical `Packet ID` (TTL excluded): a device never relays a duplicate and cancels pending relay on re-hearing (Relay §1, §3). TTL decrement bounds hops (Relay §2). Only `03` is relayed; `01`/`02`/`04` are 1-hop so they cannot loop. Mesh links use split-horizon (Relay §5.3). |
| **Denial-of-Service (DoS)**  | An attacker can flood the network with invalid packets, exhausting device resources. | High     | Layered validation in gate order (Relay §1d): size/bearer/FCS/TTL, strict dedup, base PoW `d=12`, per-sender bucket (§1c), per-channel budget (§1d, `cost = 1 + len//64`, int-only) . Invalid `Channel`/`TTL` dropped before any budget spend. **Bounded reassembly map** (RECEIVE §1 — an index over the same LRU store, freed on completion/age-out, same N cap) closes the incomplete-chain memory exhaustion against a member flooded with never-completed valid chains. |
| **Channel-budget drain** | The `Channel ID` is declarative for a relay (no MIC check without the channel key): an attacker drains a channel's budget with invalid packets; cycling 256+ forged Channel IDs re-arms fresh `burst` buckets (LRU re-arm window). | Medium | Channel-budget drain stops at the relay via a **silent rescue**: when `avail < cost` the fragment is admitted without debit only if its PoW meets `d_eff = 12 + min(8, burst − avail)` (tokens forced to 0, no mint); otherwise it is dropped silently. The honest emitter converges on `d_eff` asynchronously by re-grinding the chain `Nonce` during its ECDRI/MISSING retransmission cycles. The demand is never sent on air (no forgeable PoW too low ACK), preventing unauthenticated CPU griefing. So an attacker's per-fragment cost **rises from 2^12 up to 2^20 as the bucket empties** (256x), not stays at 2^12. Base PoW `d=12` covers the LRU re-arm window. Cap `20` to be validated on the weakest target MCU. Tested by `tests/test_channel_bucket.py`. |
| **Forged MISSING (CPU griefing)** | MISSING escalates from cycle 1, so a forged MISSING forces the victim to grind one harder chain `Nonce` (`d = min(20, d_previous + 4)`). This CPU cost is incurred **only if the forger is connected 1-hop directly to the chain's emitter** (a MISSING is 1-hop GATT-only, Relay §4); a forger targeting a relay intermediary gets the packet relayed without any additional mining, so the attack fails against intermediate nodes. | Low | Bounded three ways, unlike the rejected unbounded "PoW too low" NACK: (a) MISSING is 1-hop GATT-only (Relay §4) — the forger must be a directly connected peer, physically proximate and identifiable by its (rotating) address, exposed to link teardown; no sender-bucket covers `04` reception, proximity *is* the bound; (b) the effect never spreads — a MISSING is never relayed nor forwarded, so only the direct victim re-grinds, and only for a chain it actually emitted (a MISSING for an unknown chain has no `d_previous` to escalate); (c) the `d = 20` cap bounds the forced work to ~2^20 hashes per cycle, identical to what genuine congestion imposes. *A forged MISSING from a direct peer forces one escalation cycle (≤ 2^20 hashes); the cost is identical to the honest congestion path and bounded by the d=20 cap — accepted residual.* |
| **Pending-spoof / rendezvous abuse** | An attacker forges Informations with Pending=1 (or replays a stale 0x82 beacon) to lure Primaries into useless GATT connects, draining battery. | Medium | Coalesce one task per Sender ID; jittered connect (0.5-2 s) + cancel if Pending clears or another Primary serves it; max 3 retries with 2/4/8 s backoff; 5 s inactivity close; optional RSSI gate (>= -90 dBm) before connecting. Pending bit is inside the relayed `Type 01 (0x01)` so replays age out with the 10 s beacon period and Sender rotation. |
| **Serving-Primary hijack** | An attacker spoofs a high-Score `Type 01 (0x01)` (or replays one) to get elected as serving Primary and attract a Secondary uploads. | Medium | Election uses directly-heard beacons only (1-hop, 20 s freshness, RSSI >= -90 dBm) + hysteresis + stickiness (Relay 6.1b); Secondary accepts only the winner and keeps Pending/outbox until Succeeded-ACK; handover never migrates state between Primaries (Relay 6.5). Spoofed Score alone cannot split an outbox across servers (single-server rule). |
| **Load-malus score-withdrawal (Sybil attachments)** | An attacker with N Sybil identities in physical proximity attaches them all to an honest Primary, inflating $N_{attached}$ and its $Malus_{\mathrm{charge}}$ (Network §3.E) to crash its broadcast `Score` — a score-withdrawal DoS that steers nearby Secondaries away from the honest Primary. | Low | Bounded by reality: each attachment requires a real GATT rendezvous with a proximate, connectable device (RSSI floor, mutex, task-queue cap 8, one rendezvous at a time) — the attacker needs N physical/radio identities held simultaneously, the same cost as running N attacking nodes. The network converges by electing a less-scored-but-honest Primary (Rule 1 demotes the victim only if a neighbor actually exceeds it — no topology hole); the malus is sub-linear in attacker effort vs. the Sybil residual already documented (N identities buy N× burst, §1.3). Accepted residual, same class as the documented Sybil caveat. |
| **Sybil injection flood**   | An attacker forges many Sender addresses to bypass per-identity rate limits and flood relay/reassembly. | Medium | Stacked defenses (Relay §1c + §1d): GATT proximity required + chain PoW (`d=12`, 2^12 hashes/chain) + per-address token bucket (burst 16, refill 4/s, LRU 512, epoch+60 s expiry) + per-channel relay budget (burst 20, 40/min shared across all senders of the channel, int-only) + strict dedup + Active Dropping. **Documented residual**: N forged identities buy N×burst sender-packets per instant — the sender bound is per identity, never global; the channel bound is aggregate per channel (40/min shared); raising `d` in `Master::params` scales attacker cost without a protocol change. Tested by `tests/test_sybil_bounds.py` + `tests/test_channel_bucket.py`. |

#### **1.4 Bluetooth-Specific Risks**

| Risk | Description | Impact | Mitigation? |
| ---- | ----------- | ------ | ----------- |
| **BLE Long Range Vulnerabilities** | BLE Long Range (125 kbps) is more susceptible to interference and jamming. | Medium | Use adaptive hopping or fallback to standard BLE if jamming is detected.                  |


#### **1.5 Group Management Risks**

| Risk | Description | Impact | Mitigation? |
| ---- | ----------- | ------ | ----------- |
| **Group Key Leakage**       | If a channel's **master** (32-byte root of one 4-byte channel) is leaked, that channel is compromised (every epoch, past and future — derivation needs only the master). | Critical | **Scope is per channel by design**: masters are distinct roots, so the leak is contained to ONE channel (other channels' masters unaffected — `test_channel_isolation`). For the affected channel: rekey-by-reissue (new `Master::params` QR for that channel) — all old derived keys die with the old master. |
| **Physical extraction of `secret_local`** | `secret_local` (the HMAC key for rotating addresses) is generated on-device, stored in protected flash, and **never transmitted** — but it is not in a secure element. | High | **Device capture is the residual**: extraction requires defeating APPROTECT first (a locked device resists remote and opportunistic access); a disarmed/captured unit is the residual risk. This compromises **that device's identity and all its channel masters** — consistent with the §1.5 "reissue" mitigation (a stolen phone must be abandoned and its QR redistributed). Remote extraction and opportunistic cloning are stopped; only a captured unit is at risk. (`IDENTIFICATION.md` §3.2) |


#### **1.6 Privacy / Local-Surveillance Risks**

An application designed for anonymity can become a local surveillance tool: every radio observable (address sequence, rotation timing, service ID, relay timing, packet sizes) is a re-linking vector. Each is addressed individually; the **residual** that no cryptography removes is documented in §3 (not hidden).

| Risk | Description | Impact | Mitigation? |
| ---- | ----------- | ------ | ----------- |
| **Predictable rotating addresses** | The former LFSR address was reversible from the UUID tail + clock: anyone could recompute a device's past *and future* addresses. | ~~High~~ | **Done**: one-way `addr = HMAC-SHA256(secret_local, epoch)[0..3]`; `secret_local` generated on-device, never provisioned, never transmitted (`IDENTIFICATION.md` §3, `test_crypto_layer.TestAddressHMAC`). |
| **Correlated rotation boundaries** | All devices rotating on the same 15-min wall-clock tick lets an observer cluster and match rotations across devices (period-boundary correlation — the flaw LE privacy fixed). | ~~Medium~~ | **Done**: per-device jitter `[0, 120 s]` on the **address** boundary only (keys stay deterministic) (`IDENTIFICATION.md` §3.3, `test_jitter_misaligns_rotation_boundaries`). |
| **Fixed Service UUID beaconing** | A HoneyBee-specific GATT/advertised Service UUID lets any urban scanner log "HoneyBee device seen at 14:32, door C". | ~~Medium~~ | **Done**: generic service UUID + recognition via Manufacturer Specific Data (fixed company ID says "HoneyBee exists here", never *which* device) (`PACKET.md` §0.1b). |
| **Reflexive relay timing** | Immediate rebroadcast exposes a stimulus→response link: an active observer correlates "packet in → packet out" to pin relays. | ~~Medium~~ | **Done**: independent emission — per-packet uniform jitter **0–500 ms** on the node's own slot schedule, never a deterministic reaction delay; traffic mixing (`RELAY.md` §3, `test_crypto_layer.TestRelayJitter`). |
| **Length/timing fingerprints** | Variable fragment sizes, metronomic 10 s beacons and TX-power steps are distinctive per device — each observable feature is a re-linking vector. | ~~Medium~~ | **Done**: padding to two constant classes (32/200 B, tail included, real length encrypted), advertising jitter ±2 s, constant TX power (`PACKET.md` §3.7, `NETWORK.md` §5.A, `test_crypto_layer.TestPadding`). |
| **Continuous-presence tracking (stalker mode)** | A close, patient observer follows a device by *not losing sight of it* — no identification needed, just continuity of radio presence. | High (residual) | **Not solvable by cryptography**: the parade is *presence obfuscation* — product-level security features in §3 (random emission windows, configurable silence, invisible RX-only mode). Documented as a first-class limitation, not an advanced option. |


---

### **2 Threat Model**

#### **2.1 Assumptions**

- Attackers have physical access to the BLE network (within radio range).
- Attackers can capture, or inject packets.
- Attackers do not have access to group keys or device private keys (unless compromised).
- Devices are trusted (start from the principle that no malicious insiders in the group).

#### **2.2 Attacker Capabilities**

| Capability                | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| **Passive Eavesdropping** | Capture BLE packets using an SDR.                          |
| **Active Injection**      | Inject crafted packets into the network.                   |
| **Jamming**               | Disrupt BLE communications with noise.                     |
| **Sybil Attacks**         | Create multiple fake device identities.                    |
| **Physical Access**       | Tamper with devices to extract keys or modify firmware.    |

#### **2.3 Security ideas**

| Goal                | Description                                          |
| ------------------- | ---------------------------------------------------- |
| **Authentication**  | Devices can verify the sender's identity. Membership authentication: goal, met (CCM under K_chan); individual sender authentication: not a goal — deliberately excluded to preserve in-channel unlinkability (§1.2).    |
| **Forward Secrecy** | Compromised keys cannot decrypt past communications. |
| **Availability**    | The network remains operational despite attacks.     |
| **Non-Repudiation** | Senders cannot deny sending a message. Not a goal — impossible in symmetric group cryptography, by design (§1.2).   |

---

### **3 Privacy Analysis**

> **Opening principle**: *make every observable deterministic and uniform, so that the only variable left is the encrypted content.* Tracking is a correlation problem before it is a cryptography problem — each distinctive radio characteristic (address sequence, rotation timing, service identifier, relay timing, packet sizes, beacon cadence, TX power) is a **re-linking vector** that lets an observer stitch identity back across address changes. The protocol therefore treats uniformity as a normative security requirement, not an optimization (§1.6 lists what each measure closes).

#### 3.1 Residual limit — continuous-presence tracking (the "stalker mode")

**This limit is stated explicitly, in plain words, by design.** Even with every measure in §3.1, an adversary who stays **close and present for a long period** can follow a device **by continuous presence alone**: it does not need to *identify* the device (addresses, keys, signatures are irrelevant to it) — it only needs to **not lose sight of it**. A radio source that keeps appearing in the same physical vicinity, moving from one observation point to the next, can be tailed across address rotations by simple physical continuity: RSSI trajectory, angle of arrival, co-movement of two receivers, or plain "the signal never left my range".

- **This is not a cryptography bug — no cipher, MAC or key schedule can fix it.** The device *does* emit, and emission is presence. The parade is therefore **behavioral, not cryptographic**: presence obfuscation (§3.2) — reduce *when* the device is visible at all.
- The threat is called out here (and in §1.6) because an anonymity application that hides it would misrepresent its own security model: this is the difference between *unlinkability* (which the protocol enforces) and *unfollowability* (which only silence guarantees).

#### 3.2 Presence obfuscation (normative product security features)

These are **security features of the product — first-class, documented in this spec — not hidden advanced options.** A UI that buries them in an "advanced" menu misrepresents the threat model of §3.2.

| Feature | Behavior |
| ------- | -------- |
| **Random emission windows** | The device emits inside pseudo-random windows (e.g. bursts of N slots per M seconds, drawn per cycle) instead of a steady duty cycle: an observer sampling continuously sees gaps it cannot predict, breaking "never out of sight" continuity. **Protocol-compatibility guard**: the random window MUST retain a maximal silence gap below the protocol timeouts (stale-beacon 20 s, RELAY §6.1b — entries older than 20 s are purged; neighbor expiry horizon) — a Primary that goes dark longer than the horizon is purged by neighbors (erroneous purge / re-election) and a Secondary whose Pending rendezvous is delayed beyond the timeout loses the slot. The window are drawn per cycle, but bounded, so the network does not degrade under the mode. |
| **Configurable silence** | A user-settable silent interval (minutes to hours) during which **no** advertising, no relay TX, no ACK, no retransmission leaves the device. |
| **Invisible mode (RX-only, strict)** | The device cuts **all** RF emission — no advertising, no relay, no ACK, no MISSING retransmission — while still **listening and decoding** (received messages are still displayed). |
| **No invisibility beacon** | Invisible mode emits **no indicator by definition**: an "invisible" flag in the advertising would be an invisibility beacon. Peers are notified **before** going dark via an in-channel soft-leave ("going invisible"), optionally; then total radio silence. To neighbors the node simply disappears — indistinguishable from a standby, which is exactly the point. |
| **Triggering** | Manual toggle + configurable duration (default: indefinite until manual exit) + automatic triggers (battery below threshold, geofence, e.g. "invisible during working hours"). |

**Costs and limits — documented in the spec, in bold:**

- **An invisible node is a free-rider**: it consumes the mesh (membership, dedup, received traffic) without serving it (no relay, no ACK). Invisible mode is an **exceptional personal-protection posture**, not a battery-saving mode — for lower duty there is the *Secondary* role (`NETWORK.md`), which emits less but still serves the mesh as prescribed there.
- **What obfuscation does NOT stop**: a close physical observer can still have tailing windows from *past* emission periods (the stalker of §3.1 only needs one unbroken window), and **the return from silence is itself a correlatable event** (re-advertising after silence marks a "reappearance"). The pre-silence soft-leave at least gives the silence a plausible explanation ("went standby"), so the gap is not uniquely attributable to a mode change.
- Silence breaks protocol duties while active (no relay, no ACK, no rendezvous upload) — pending messages queue locally (Secondary-style outbox) until the device re-emits.
