
# Network Mechanism

1. [Overview](#overview)
2. [Fitness Score Calculation](#fitness-score)
3. [Score Modifiers (Bonus & Malus)](#score-modifiers)
4. [State Machine](#state-machine)
5. [BLE 4.0 and 5.0 Device Management](#device-management)

---

<a name="overview"></a>

### **1. Overview**

**Two modes :**  

- **Primary Node** 
    - Send packets *(at 1 Mbps and 125 kbps)*
    - Receive packets *(at 1 Mbps and 125 kbps)*
    - Relays packets *(at 1 Mbps and 125 kbps)*
    - Maintains the network
    - Detects Secondary `Pend.=1` beacons and Only role that relays 03 (mesh M=3 with peer Primaries, Relay 5 + fan-out download to each attached Secondary, Relay 6.3); lists attached Secondaries in its 02 snapshot; reads `Primary?` to gate rendezvous (Central) ONLY toward Secondaries attached to self (or unattached/electing-winner), one at a time, cancel if already served (mutex, Relay 6.5)
- **Secondary Node**
    - Send packets *(at 1 Mbps and 125 kbps)*
    - Receive packets *(at 1 Mbps and 125 kbps)*
    - Never relay; attach to exactly ONE serving Primary elected by (Score, RSSI, Sender ID) with hysteresis (see Relay 6.1b); queue own GATT packets in a FIFO outbox while disconnected; signal `Pend.=1` (binary non-empty flag) + `Primary?` = serving Primary ID in its 17-byte beacon (4-byte Sender); upload ONLY to its server on its initiated rendezvous, accept no other Primary (mutex + handover, Relay 6.5)
  
BLE 5.0 nodes use dual transmission/reception (1 Mbps and 125 kbps) to ensure compatibility and maximum coverage. BLE 4.0 nodes are restricted to transmitting and listening at 1 Mbps only.

---

<a name="fitness-score"></a>

### 2. Fitness Score Calculation (S-base)

A node's role is determined by its Score, updated in real time. The score consists of 5 metrics, calculated independently and then weighted.

#### A. Battery Score (S-bat)

Smoothed sigmoid function to avoid discontinuities :

$$S_{\mathrm{bat}} = \frac{100}{1 + e^{-0.2 (B - 40)}}$$

$B$ : Remaining battery percentage (0 to 100).  

**Examples**:

- $B = 80$ → $S_{\mathrm{bat}} \approx 99.9$.
- $B = 40$ → $S_{\mathrm{bat}} = 50$.
- $B = 33$ → $S_{\mathrm{bat}} \approx 20.0$.
- $B = 20$ → $S_{\mathrm{bat}} \approx 1.8$.

#### B. Mobility Score (S-mob)

The mobility score evaluates the stability of a node without relying on energy-consuming positioning sensors. It measures the relative volatility ($V_{rel}$) of the radio environment via RSSI data collected in `Neighbor` packets.

##### 1. Breakdown of the V-rel Calculation

The volatility ratio $V_{rel}$ is the sum of two factors of change, normalized by the total number of neighbors in the previous cycle to remain a relative value.

###### A. Topological Volatility (V-topo)

Measures the turnover of identifiers (IDs) in the neighborhood.

$$V_{topo} = N_{new} + N_{lost}$$

###### B. Signal Volatility (V-sig)

Measures the intensity of movement within existing links using an Exponential Moving Average (EMA) filter to smooth out fast channel fading and temporary physical obstructions.

Each of our neighbors sends an Informations packet nominally every 10 seconds (jittered 8–12 s per emission, §5.A). If we have 100 neighbors, we therefore receive 100 packets every 10 seconds on average, or 10 packets per second.

$$\mathrm{RSSI}_{EMA, t} = (\alpha \times \mathrm{RSSI}_{measured}) + ((1 - \alpha) \times \mathrm{RSSI}_{EMA, t-1})$$

$\alpha$ : Smoothing factor set to **0.2** to give significant historical weight and damp sudden radio anomalies.

$$V_{sig} = \mathrm{round}\left(0.5 \times \sum_{i \in \mathrm{common}} \left( \frac{|\mathrm{RSSI}_{EMA, i} - \mathrm{RSSI}_{EMA, i - 1} |}{Threshold} \right)\right)$$

**Threshold**: Set to **6 dB** variation counts as "1 movement unit". A sharper variation (ex: 18 dB) counts for 3 units, penalizing fast movements more heavily.

##### 2. Global Formula and Score

$V_{rel}$ is a unitless ratio representing the average volatility per neighbor from the previous cycle, normalized to allow relative comparison between nodes. The relative volatility is fed into an exponential function to calculate the final score.  
  
$$V_{rel} = \dfrac{V_{topo} + V_{sig}}{\max(1, N_{\mathrm{total\\_previous}})}$$  
  
$N_{\mathrm{total_previous}}$: Total number of neighbors in the previous cycle (T-1), including those lost in T.  
  
Adaptive penalization with a minimum Threshold of 10 points to guarantee that even a highly mobile node retains a minimal chance of relaying if no other node is available.  
  
**Units (normative)**: $\\Delta t$ is measured in **nominal cycle periods** — one cycle = one $S_{\\mathrm{mob}}$ evaluation, nominally the 10 s beacon period. The recurrence below is scale-invariant (only the ratio $\\Delta t_{\\mathrm{last}} / \\Delta t_{\\mathrm{new}}$ matters), but the initialization uses this unit.

For the first calculation, $k_{\\mathrm{new}} = k_{\\mathrm{last}} = 1.15$ and $\\Delta t_{\\mathrm{new}} = \\Delta t_{\\mathrm{last}} = 1$ (one nominal cycle — the §3 examples assume nominal cycles).  

$$k_{\\mathrm{new}} = \\mathrm{clamp}\\left(k_{\\mathrm{last}} \\times \\frac{\\Delta t_{\\mathrm{last}}}{\\Delta t_{\\mathrm{new}}},\ 0.5,\ 3\\right)$$

$$S_{\\mathrm{mob}} = \\max(10, 100 \\times e^{-k_{\\mathrm{new}} \\cdot V_{rel}})$$

- $k_{\\mathrm{new}}$ : The k used in the actual cycle (T).
- $k_{\\mathrm{last}}$ : The k used in the previous cycle (T-1).
- $\\Delta t_{\\mathrm{new}}$ : The time between the previous cycle and the actual cycle, in nominal cycle periods.
- $\\Delta t_{\\mathrm{last}}$ : The time used in the previous cycle (T-1), same unit.
- **Clamp (normative)**: $k \\in [0.5, 3]$. The product telescopes ($k_n = 1.15 \\times \\Delta t_{init} / \\Delta t_n$ — intermediate ratios cancel, so $k$ tracks only the *current* cycle length, there is no compounding drift); the clamp nevertheless bounds the single-cycle swings that irregular sampling causes (beacon jitter 8–12 s, missed or delayed cycles), giving the exponential a hard floor and ceiling.

##### 3. Calculation Examples (k = 1.15)

- **$V_{rel} = 0$ (Static)**: No ID changes, very low RSSI variations. $S_{mob} = 100$.  
- **$V_{rel} = 0.6$ (Slight movement)**. $S_{mob} \approx 50$.  
    Example: A node loses 1 neighbor ($N_{\mathrm{lost}}=1$) and has 1 common neighbor with an RSSI variation of 24 dB ($V_{sig} = 0.5 \cdot \frac{24}{6} = 2$). If $N_{\mathrm{total_previous}} = 5$, then $V_{rel} = \frac{1 + 2}{5} = 0.6$.  
- **$V_{rel} = 2.0$ (Fast movement)**. $S_{mob} \approx 10$.  
    Example: A node loses 4 neighbors ($N_{\mathrm{lost}}=4$) and gains 4 new ones ($N_{new}=4$), with $N_{\mathrm{total_previous}} = 4$. If $V_{sig} = 0$, then $V_{rel} = \frac{4 + 4}{4} = 2.0$.

#### C. Neighborhood Score (S-neighborhood)

Non-linear weighting to favor well-connected nodes, without a cap (to prioritize BLE 5.0 nodes which detect more neighbors) :

$$S_{\mathrm{Neighborhood}} = 100 \times \left(1 - e^{-0.1 \times N}\right)$$

**$N$**: Total number of **unique** detected neighbors, deduplicated by Sender ID across both PHYs *(in 1 Mbps AND 125 kbps)*. A BLE 5.0 node heard once on 1 Mbps and once on 125 kbps counts as **one** neighbor, not two.  

**Examples**:

- $N = 0$ → $S_{\mathrm{Neighborhood}} = 0$.
- $N = 5$ → $S_{\mathrm{Neighborhood}} \approx 40$.
- $N = 10$ → $S_{\mathrm{Neighborhood}} \approx 60$.
- $N = 20$ → $S_{\mathrm{Neighborhood}} \approx 86$.

#### D. Link Quality Score (S-RSSI)

RSSI Normalization to compensate for differences between 1 Mbps and 125 kbps: 

- For **1 Mbps** packets: $RSSI_{normalized} = RSSI_{measured}$.
- For **125 kbps** packets: $RSSI_{normalized} = RSSI_{measured} + 10$ _(since 125 kbps has ~10 dB better sensitivity, BLE 5.0 nodes are therefore not penalized by a lower RSSI at 125 kbps)_.

**Final formula**

$$S_{RSSI} = \max(0, \min(100, 2.5 \times (RSSI_{normalized} + 100)))$$

**Examples**:

- $RSSI = -70$ dBm (1 Mbps) -> $S_{RSSI} = 2.5 \times 30 = 75$.
- $RSSI = -70$ dBm (125 kbps) -> $RSSI_{normalized} = -60$ -> $S_{RSSI} = 100$.


**RSSI global (multi-neighbor aggregation).** A node typically hears multiple neighbors. For each reliable neighbor (RSSI ≥ -90 dBm), the node maintains an **individual EMA** of its normalized RSSI, updated on every received `Informations` (0x01) beacon from that neighbor:

$$RSSI_{EMA, i, t} = (0.2 \times RSSI_{normalized, i, measured}) + (0.8 \times RSSI_{EMA, i, t-1})$$

At the end of each cycle, the node's global RSSI is the **simple arithmetic mean** of all its neighbors' individual EMAs:

$$RSSI_{normalized} = \frac{1}{N_{\mathrm{reliable}}} \sum_{i=1}^{N_{\mathrm{reliable}}} RSSI_{EMA, i, t}$$

If no reliable neighbor is heard, $S_{RSSI} = 0$. This prevents the score from oscillating at the rate of the last received packet and from being biased toward the node that emits most frequently.
#### E. Reliability History Score (S-fiab)

Operational definition (normative) — the measurement is **per hop**, closing on the per-hop delivery confirmation of the Acknowledgement mechanism (ACKNOWLEDGEMENT "Per-hop delivery confirmation"):

- **Transmission** = one chain-hop emission by this node: an own-originated chain sent to a direct GATT peer, a relay re-emission to a mesh peer, or a Phase B download to an attached Secondary. A fan-out to M peers counts as M transmissions (each peer confirms independently).
- **Success** = the direct peer answered `ACK Succeeded (0x1F)` **or** `ACK Duplicated (0x0F)` for that chain (both mean "the peer holds the chain") within the emission's ECDRI lifetime (at most 3 × 1 s DELAY cycles + transmission time).
- **Failure** = nothing, `ACK Unabled (0x03)` or `ACK Denied (0x07)` within that window.

$$S_{fiab} = \mathrm{success\\_rate} \times 100$$

computed over a sliding window of the **last 100 transmissions**.

**Initialization**: $S_{fiab} = 100$ for new nodes.

> **Why per-hop, not end-to-end**: `Succeeded` is 1-hop and terminal (RELAY §4) — it never travels back past the receiving hop, so "did the *final* recipient get it" is unmeasurable from an intermediate node. "Did my direct peer take the chain" is exactly what this node controls, and since the completion ACK is key-independent (RECEIVE §1), every hop — member relay, non-member relay, terminal delivery — is answered and therefore measurable. A relay's $S_{fiab}$ converges to its true per-hop delivery rate; transit no longer drains it.

#### F. Base Score Formula (S-base)

$$S_{base} = ((S_{\mathrm{Neighborhood}} \times 0.35) + (S_{mob} \times 0.25) + (S_{RSSI} \times 0.20) + (S_{fiab} \times 0.20)) \times (\frac{S_{bat}}{100})$$

$$S_{base} = \max(0, \min(100, S_{base}))$$

---

<a name="score-modifiers"></a>

### **3. Score Modifiers (Bonus & Malus)**

#### **A. Seniority Bonus (Primary Nodes only)**

Provides long-term role stability for proven operational Primary nodes to prevent unnecessary structural re-elections:

$$Bonus_{\mathrm{seniority}} = \min\left(20, \frac{t}{15}\right) \times \frac{S_{base}}{100}$$

**$t$**: Uptime in seconds in the Primary role.

**Reset (normative)**: $t$ resets to 0 on every demotion (Primary → Secondary). A re-promoted node starts its seniority from scratch — the Demotion Malus (§3.C) and the seniority loss compound by design (anti-flapping: role stability must be re-earned).

**Examples**

- If $S_{\mathrm{base}} = 100$ and $t = 300\mathrm{s}$ -> $Bonus = 20$.
- If $S_{\mathrm{base}} = 100$ and $t = 60\mathrm{s}$ -> $Bonus = 4$.
- If $S_{\mathrm{base}} = 50$ and $t = 300\mathrm{s}$ -> $Bonus = 10$.

#### **B. Critical Bridge Bonus**

A node is a Critical Bridge if it is the only link _(at 1 Mbps OR 125 kbps)_ between two Primary nodes that cannot hear each other directly. _Example: A BLE 5.0 node can be a Critical Bridge between a BLE 4.0 (1 Mbps) and a BLE 5.0 (125 kbps) node, because it transmits in both modes._ Dynamic and proportional to the node's importance :

$$Bonus_{\mathrm{bridge}} = 20 \times \mathrm{number\\_dependent\\_Primary\\_pairs}$$

* **Cap**: $Bonus_{\mathrm{bridge}} \le 100$.
* **Condition**: A node is a Critical Bridge if it is the only physical link between two Primary nodes that cannot hear each other directly *(at 1 Mbps OR 125 kbps)*.

#### **C. Demotion Malus (Anti Yo-Yo / Secondary Nodes only)**

Prevents immediate re-promotion loops (flapping) caused by minor, localized score recoveries immediately after a node voluntarily relinquishes its Primary role:

$$Malus_{\mathrm{demotion}} = 20 \times e^{-\frac{t}{10}}$$

**$t$**: Time elapsed in seconds since the node transitioned back to the Secondary role.

**Behavior**
At $t = 0$ seconds, a 20-point penalty is subtracted. The penalty exponentially decays and effectively disappears after approximately 30 seconds, letting the new Primary stabilize its connections.

#### **D. Global Adjusted Score Formula (S-global)**

The absolute score used by the state machine to determine all routing and role transitions:

$$S_{global} = S_{base} + Bonus_{\mathrm{seniority}} + Bonus_{\mathrm{bridge}} - Malus_{\mathrm{demotion}} - Malus_{\mathrm{charge}}$$

$$S_{global} = \max(0, \min(100, S_{global}))$$

> **Cap à 100 intentionnel.** Le plafond supérieur de $S_{global}$ est **normatif et intentionnel** : $S_{global}$ est un score borné utilisé pour la comparaison de base, la Dynamic Hysteresis et l'élection. Le $Bonus_{\mathrm{bridge}}$ ne sert **pas** à faire gagner une élection (il ne doit pas permettre à un nœud de dépasser 100 pour l'emporter sur Absolute Competition). Il sert uniquement à : (a) protéger un nœud structurellement indispensable contre une rétrogradation intempestive par la Règle 1 (Purger), et (b) justifier sa promotion en tant que Critical Bridge par la Règle 3.

> **Interactions.** (a) Le $Malus_{\mathrm{charge}}$ (§3.E) s'applique **avant** le cap $[0, 100]$. (b) Ancrage seniority vs charge : le $Bonus_{\mathrm{seniority}}$ est plafonné à 20, donc un Primaire **junior** à 15 attachés perd net 21 points (malus 21 > 0) tandis qu'un Primaire **senior** (bonus 20) reste quasi au neutre — les nouveaux Primaires cèdent la charge avant les anciens, exactement l'effet « flotte 10–15 tolérée, mur vers 20 » recherché. (c) Rétrogradation : un Primaire surchargé (ex. N=20, malus 74) chute dans le classement et se rétrograde par la **Règle 1 (Absolute Competition) uniquement si un voisin le dépasse** de plus que la Dynamic Hysteresis — si aucun voisin n'existe, il reste en place (pas de trou topologique), simplement dégradé.

#### **E. Load Malus (Primary Nodes only)**

Steeply penalizes an overloaded serving Primary so new Secondaries elect a less-loaded peer instead, and the node itself demotes around N=20 where GATT service (one rendezvous at a time, task queue cap 8, 5 s inactivity close) becomes untenable:

$$Malus_{\mathrm{charge}} = \mathrm{round}_{\mathrm{half\mbox{-}up}}\left(0.5 \times e^{0.25 \times N_{\mathrm{attached}}}\right), \quad N_{\mathrm{attached}} = 0 \Rightarrow Malus_{\mathrm{charge}} = 0$$

**$N_{attached}$**: Number of Secondaries currently attached to the Primary — the entry count of its own **kind `Typ. N.` = `0x03`** Neighbors packet (attached-Secondaries list, PACKET §2; Relay §6.5). Only the Primary itself computes the malus (it is the only node that reliably knows its attachment set — kind `0x03` lists travel only on 1-hop mesh links, never relayed); the result is carried by its broadcast `Score` field ($S_{global}$, PACKET §1).

**Rounding (normative)**: half-up, $\mathrm{floor}(x + 0.5)$ — *not* banker's rounding.

**Recalculation triggers**: on every attachment change (attach, detach, handover) and before each beacon emission.

**Behavior**

| $N_{attached}$ | $Malus_{\mathrm{charge}}$ | Effect |
| -------------- | ------------------------- | ------ |
| 0              | 0                         | Neutral. |
| 5              | 2                         | Indolore. |
| 10             | 6                         | Léger avertissement : le Primaire reste très compétitif. |
| 15             | 21                         | La pression monte (dépasse le bonus seniority max de 20) : les nouveaux Secondaires commencent à préférer un autre Primaire s'il y en a un bon à proximité. |
| 20             | 74                         | Rejet presque total : le Primaire s'effondre dans le classement, forçant l'élection d'un nouveau Primaire dans la zone (Règle 1, cf. interactions en §3.D). |

<a name="state-machine"></a>

### **4. State Machine**

#### **Global Constants & Variables**

| Constant / Variable        | Value / Formula                  | Description |
| -------------------------- | -------------------------------- | ----------- |
| **Dynamic Hysteresis**     | $15 + \mathrm{round}(10 \times V_{rel})$ | Adaptive score difference required to dethrone a current Primary node, significantly tightening restrictions in high-mobility environments. |
| **Redundancy Threshold**   | 0.75                             | Overlap threshold to trigger demotion. |
| **Minimum RSSI Threshold** | -90 dBm                          | Minimum RSSI to consider a neighbor as "reliable". |

#### **Rule 0: Temperature Lock (Cooldown)**

Adaptive lock based on the average velocity of neighbors (to prevent "flapping"):

- **Promotion (Secondary -> Primary)**: $\mathrm{Lock} = 5 + 5 \times V_{rel}$ ($5 < \mathrm{Lock} < 15$).
- **Demotion (Primary -> Secondary)**: $\mathrm{Lock} = 2 + 4 \times V_{rel}$ ($2 < \mathrm{Lock} < 10$).

#### **Rule 1: The Purger (Primary Nodes only)**

A Primary node demotes itself to Secondary if any one of these conditions is met :

**Absolute Competition**
Another neighboring Primary has an $S_{global}$ higher by more than the computed Dynamic Hysteresis value.

**Topological Redundancy**
The overlap with a neighboring Primary is **> 75%**. **AND** this neighbor has a better score (Neighbor > Self + 5).

**Overlap Calculation**
Only neighbors with an RSSI ≥ -90 dBm are considered.
> **Dénominateur.** `total_number_neighbors` est strictement le nombre de voisins du **nœud qui s'auto-évalue** (le candidat à la rétrogradation), filtrés par RSSI ≥ -90 dBm. Ce n'est ni l'union des deux voisinages (indice de Jaccard) ni le voisinage du pair comparé.
$\mathrm{overlap\\_ratio} = \frac{\mathrm{number\\_common\\_neighbors}}{\mathrm{total\\_number\\_neighbors}}$

#### **Rule 2: Survival (Secondary Nodes only)**

If a Secondary detects zero Primary nodes *(at 1 Mbps OR 125 kbps)*:

1. It initiates a **random timer** with $\mathrm{Delay} = \mathrm{random}(1000, 3000) + 10000 \times \left(1 - \frac{S_{global}}{100}\right)$:
    - A node with $S_{global} = 100$ will wait between 1s and 3s.
    - A node with $S_{global} = 0$ will wait between 11s and 13s.
    - Delays are expressed in **milliseconds**.
2. If a Primary is detected during this delay, the timer is canceled.
3. If the delay expires, the node promotes itself to Primary.

#### **Rule 3: Bridging and Replacement (Secondary Nodes only)**

A Secondary promotes itself to Primary if:

- It has "Critical Bridge" status ($Bonus_{\mathrm{bridge}} > 0$). A Secondary determines this status from **two information sources it can actually obtain** — note the bearer constraint: `Neighbor (0x02)` is **GATT-only, 1-hop** (PACKET §0.3), so a Secondary **cannot** overhear a third party's `Type 02`; it receives exactly **one** Primary's `Type 02` — its serving Primary's, in-session (Phase B Control, RELAY §6.3c/§6.4):  
    (a) via **Advertising scan** (universal, passive), it hears Primary B's `Type 01` beacon (fresh ≤ 20 s)  
    (b) via its **GATT session**, it holds serving Primary A's Primary-kind list (`Typ. N.` = `0x01`)  
    (c) if **B is heard but absent from A's list**, then A cannot hear B: the Secondary is the only link for the pair (A, B) and qualifies as a Critical Bridge ($Bonus_{\mathrm{bridge}} += 20$ per dependent pair, cap 100).  
    _**Documented limits**: only pairs (A = serving Primary, B heard) are detectable — the Secondary never holds B's list; A's list is refreshed per rendezvous session (sessions are Pending-driven, so detection is opportunistic and a stale list may yield false positives); an asymmetric link (B hears A, A does not hear B) is undetectable from the Secondary's vantage and is a bounded false positive — cleaned up by Rule 1 (Topological Redundancy) if it causes a spurious promotion._
- **OR** its $S_{global}$ exceeds the score of the best Primary in its vicinity by more than the computed Dynamic Hysteresis value.
- **OR** there are no Primary nodes with an $S_{RSSI} \ge 50$ in its vicinity (to guarantee good link quality).

**CSMA/CA Mechanism**
If the promotion intent is validated, the node initiates a timer with $\mathrm{Delay} = \mathrm{random}(1000, 3000) + 10000 \times \left(1 - \frac{S_{global}}{100}\right)$:

- A node with $S_{global} = 100$ will wait between 1s and 3s.
- A node with $S_{global} = 0$ will wait between 11s and 13s.
- Delays are expressed in **milliseconds**. The millisecond granularity (2000 possible jitter values instead of 3) prevents multiple similarly-scored nodes from promoting simultaneously.

**Cancellation**
The intent is canceled only if another node with a higher $S_{global}$ promotes itself before the timer ends. Nodes with a high $S_{global}$ promote themselves faster.

---

<a name="device-management"></a>

### **5. BLE 4.0 and 5.0 Device Management**

#### **A. Packet Transmission**

Bluetooth 5.0+ nodes transmit at 1 Mbps AND 125 kbps to :

- **Ensure compatibility** with BLE 4.0 devices.
- **Maximize coverage** using 125 kbps (BLE 5.0).

Transmission Frequency (normative, SECURITY §3.1 uniformity):

- **Control packets** (election, core protocol): nominally every 10 seconds, with a **per-emission jitter of ±2 s (window 8–12 s)** — a fixed 10 s period is a beaconing fingerprint and synchronizes every device's rotation/duty events on the grid (use CSPRNG per emission, not a counter).
- **Application packets**: According to application needs, still emitted inside the jittered slot grid (never burst-aligned on a global tick).
- **Advertising interval**: jittered per emission as above (`Informations 01`), never a metronome.

**Constant TX power (normative, SECURITY §3.1)**: a device MUST emit at a **fixed power level** configured for the deployment — no distance/power adaptation, no low-power "close range" mode that would let an observer infer proximity or track a device by its power steps (each power change is a re-linking vector). (Battery-driven duty cycling changes *whether* it emits — see presence obfuscation in SECURITY.md §3 — but never the power level while emitting.)

#### **B. Exclusive attachment + Primary-initiated rendezvous (Secondary Pending flush)**

A Secondary attaches to exactly ONE serving Primary elected by (Score, RSSI_EMA, Sender ID) + hysteresis (Relay 6.1b) and accepts rendezvous only from it; other Primaries cancel (mutex, Relay 6.5). When the serving Primary detects `Pend.=1` + `Primary?` naming it (or unattached + winner) in the 16-byte beacon (4-byte Sender), it schedules one jittered GATT connection (0.5-2.0 s, 1 rendezvous at a time, task queue cap 8) as Central; the Secondary stays connectable as Peripheral. Upload (Secondary -> Primary, own 03) runs first, then download (Primary -> Secondary, relayed 03 + own Control) in the same session; close on empty or 5 s inactivity. Retries: max 3 with 2/4/8 s backoff. Handover is Secondary-initiated only. See Relay 6 for full normative flow.

#### **C. Neighbor Detection**
  
Bluetooth LE 4.0+ nodes detect only 1 Mbps neighbors.  
  
Bluetooth LE 5.0+ nodes scan at 1 Mbps AND 125 kbps to detect:

- BLE 4.0 neighbors (1 Mbps).
- BLE 5.0 neighbors (1 Mbps + 125 kbps).
