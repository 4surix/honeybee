
# Identification Mechanism

### **1. Introduction**

Generate a unique 4-byte (32-bit) rotating identifier derived **one-way** from a device-local secret, changing every 15-minute period (offset by a per-device jitter), without any provisioning, central synchronization or transmission of the secret. With each address change, the value of `Chain` is reset to zero.

---

### **2. General Architecture**

#### **2.1 Basic Principles**

- **One-way derivation**: `addr = truncate(HMAC-SHA256(secret_local, epoch), 32 bits)`. Everyone can observe (and verify the freshness of) the current address; **nobody** — including other members of the same channel — can predict the next one without `secret_local`, and no captured address reveals the secret.
- **No provisioning**: `secret_local` is generated **on-device** at first boot, stored in protected flash, and **never transmitted** (no QR, no pairing exchange, no cloud).
- **Non-aligned rotation**: each device offsets **its own** address rotation boundary by a random jitter `[0, 120 s]` drawn once at first boot — devices do not rotate at the same wall-clock instant (see §3.3).
- **Uniqueness**: addresses are unique per device at any time because secrets are independently generated per device (2²⁵⁶ secret space, 32-bit truncated output). By the birthday paradox, collision probability reaches ≈1 % at ~9 200 simultaneous devices and ≈50 % at ~65 000; the risk is therefore **negligible at local mesh scale** but not at city-wide scale. If two devices temporarily share an address, their frames remain distinct by (`Sender`, `Channel`, `Chain`, `Timestamp`) and are cryptographically separated by per-channel MIC keys — a colliding device cannot forge another's traffic without that channel's master.

#### **2.2 Key Components**

| **Component**          | **Role**                                                                 |
|------------------------|--------------------------------------------------------------------------|
| **Address Generator**  | `truncate(HMAC-SHA256(secret_local, epoch_be8), 4)` — one-way, keyed.     |
| **`secret_local`**     | 32-byte device-local secret (never provisioned, never transmitted).      |
| **Local Clock**        | 15-min period counter + per-device jitter for the address boundary.      |

---

### **3. Dynamic Address Generation**

#### **3.1 Selected Method: HMAC-SHA256 over `secret_local` (one-way)**

> **Normative rule**: `addr_epoch = floor((t + jitter_device) / 900)` and `Address = HMAC-SHA256(secret_local, addr_epoch_be8)[0..3]` (first 4 bytes, big-endian).

Properties (tested by `test_crypto_layer.TestAddressHMAC`):

- **Deterministic for its owner**: the device recomputes its current address from its secret and its own clock — no storage of past addresses, no synchronization.
- **One-way / forward-unpredictable**: HMAC is a PRF — observing addresses of periods `E, E+1, …` gives no way to compute `E+n` (or any other epoch) without `secret_local`, for other channel members included. There is no state to roll forward (the LFSR was reversible from the UUID tail + clock — the exact defect this replaced).
- **No cycle**: the epoch is used **in full** (8 bytes, no `% 256` truncation): an address never repeats by wrap-around (`test_epoch_not_truncated_256`).
- `Chain` resets to 0 whenever the address changes (unchanged rule).

#### **3.2 `secret_local` Lifecycle (normative)**

| Stage | Rule |
| ----- | ---- |
| **Generation** | At **first boot only**: seed a DRBG from the nRF52 hardware TRNG (do not drain 32 raw bytes from the slow TRNG), mixed with boot-time entropy (startup timing jitter, accumulated RSSI, flash unique ID). **Never hardcode a secret in production.** |
| **Storage** | One dedicated flash page, **APPROTECT + readback protection enabled** (SWD pins locked). Marked keep-on-erase: if erased, the device simply regenerates a new secret and changes identity — acceptable, no recovery needed. |
| **Transmission** | **Forbidden**: `secret_local` never leaves the device — not in advertising, not in GATT, not in any packet field, not in any key derivation (channel keys derive from channel masters only, see `CONFIDENTIALITY.md` §2). |
| **Sync** | **None needed**: unlike channel masters, no other device must know this secret — the derived address is observable by all, recomputable by none. |

**Honest limit (also in SECURITY.md §1.6)**: this is *not* a secure element. An attacker with physical access and a J-Link can extract the secret from a *disarmed* device. The threat stopped is **remote extraction and opportunistic cloning**, not the compromise of a captured unit.

#### **3.3 Address Period + Per-Device Jitter (normative)**

1. Compute the **key epoch** (deterministic, shared by all): `E = floor(t / 900)` (integer division, **never truncated**) — counter used by the HKDF key hierarchy (`CONFIDENTIALITY.md` §2, `key_epoch()` in `tests/crypto_model.py`).
2. The **address period** uses the same 900 s base plus a **per-device jitter**: `addr_epoch = floor((t + jitter_device) / 900)` where `jitter_device ∈ [0, 120] s` is drawn **once** at first boot and fixed for the life of the device (`addr_epoch()` in the model, `test_jitter_misaligns_rotation_boundaries`).
3. Derive the address: `Address = HMAC-SHA256(secret_local, addr_epoch_be8)[0..3]`.
4. The `Chain` value resets to 0 whenever the address changes.

> **Normative warning**: the jitter applies to the **address boundary only** — never to `key_epoch`. Keys must be derived from the same deterministic index by every peer, whatever their personal jitter; otherwise devices could not agree on `chanKey(E)`. The jitter's purpose is to **break correlation by period boundary**: with N devices, rotation events no longer cluster on the same wall-clock instant (the fix LE privacy adopted for RPA rotation).

> **Normative warning**: the `% 256` truncation of the former LFSR is **gone** (the address now uses the full epoch). Deriving **encryption keys** from any truncated counter would reuse keys periodically and let an attacker replay recorded traffic as current — keys always use the full `E` (regression test: `test_crypto_layer.test_epoch_not_truncated_256`).

---

### **4. Time Synchronization**

- All devices use the same reference epoch (`January 1, 1970, 00:00:00 UTC`).
- **No central synchronization**: Each device uses its local clock to compute the elapsed time since the reference epoch. A non-provisioned MCU has no absolute UNIX time at first boot; the initial time is injected by the companion mobile app during the first GATT attachment (or by any trusted peer beacon). Until a reliable time is available, the device sets `time_unreliable = true` and **must not initiate new chains** (it may only relay/forward).
- **Recalibration**: the local RTC drifts over time. The device recalibrates its clock against beacons heard from serving Primaries (which carry the current epoch). If `|local_clock − peer_epoch|` exceeds a few minutes, the clock is progressively slewed back into agreement.
- The **3-epoch key acceptance window** (`accepted_epochs = (E−1, E, E+1)`, `CONFIDENTIALITY.md` §2) absorbs residual clock skew (45 minutes total). If the local clock drifts beyond this window, the device cannot derive valid channel keys and is effectively isolated until the next successful recalibration.
- The address itself needs no cross-device agreement — it is self-identifying in the beacon.
