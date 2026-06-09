## Network Mechanism

### **1. Overview**

- Primary Node (Router/Relay) relays packets (at 1 Mbps and 125 kbps) and maintains the network.
- Secondary Node (Client) listens to the network and transmits its data (at 1 Mbps and 125 kbps), but does not relay.
- BLE 5.0 nodes (125 kbps) are prioritized to become Primary nodes because they cover a wider area, thereby reducing the total number of Primary nodes needed.
- BLE 5.0 nodes use dual transmission/reception (1 Mbps and 125 kbps) to ensure compatibility and maximum coverage.
- BLE 4.0 nodes are restricted to transmitting and listening at 1 Mbps only.

---

### 2. Fitness Score Calculation ($S_{base}$)

A node's role is determined by its Score, updated in real time. The score consists of 5 metrics, calculated independently and then weighted.

#### A. Battery Score ($S_{bat}$)

Smoothed sigmoid function to avoid discontinuities :

$$S_{bat} = \frac{100}{1 + e^{-0.2 (B - 40)}}$$

- $B$ : Remaining battery percentage (0 to 100).
- **Examples**:
    - $B = 40$ → $S_{bat} = 50$.
    - $B = 80$ → $S_{bat} \approx 99.9$.
    - $B = 33$ → $S_{bat} \approx 20.0$.
    - $B = 20$ → $S_{bat} \approx 1.8$.

#### B. Mobility Score ($S_{mob}$)

The mobility score evaluates the stability of a node without relying on energy-consuming positioning sensors. It measures the relative volatility ($V_{rel}$) of the radio environment via RSSI data collected in `Neighbor` packets.

##### 1. Breakdown of the $V_{rel}$ Calculation

The volatility ratio $V_{rel}$ is the sum of two factors of change, normalized by the total number of neighbors in the previous cycle to remain a relative value.

###### A. Topological Volatility ($V_{topo}$)

Measures the turnover of identifiers (IDs) in the neighborhood.

$$V_{topo} = N_{new} + N_{lost}$$

###### B. Signal Volatility ($V_{sig}$)

Measures the intensity of movement within existing links. For neighbors present during the current cycle ($T$) and the previous cycle ($T-1$), significant power variations are added together:

$$\overline{RSSI}_{i} = \frac{\sum_{j}^{n = 5} \text{RSSI}_{T_i - j}}{5}$$

$$V_{sig} = 0.5 \times \sum_{i \in \text{common}} \left( \frac{|\overline{RSSI}_{i}  - \overline{RSSI}_{i - 1} |}{Threshold} \right) \text{ for all } |\Delta \overline{RSSI}| > Threshold$$

* **Threshold**: Set to **6 dB** to filter out natural Bluetooth noise. RSSI variations less than or equal to 6 dB are ignored (considered as noise).
* **Logic**: A 6 dB variation counts as "1 movement unit". A sharper variation (e.g., 18 dB) counts for 3 units, penalizing fast movements more heavily.

##### 2. Global Formula and Score

$V_{rel}$ is a unitless ratio representing the average volatility per neighbor from the previous cycle, normalized to allow relative comparison between nodes. The relative volatility is fed into an exponential function to calculate the final score.

$$V_{rel} = \dfrac{V_{topo} + V_{sig}}{\max(1, N_{\text{total_previous}})}$$

$N_{\text{total_previous}}$: Total number of neighbors in the previous cycle (T-1), including those lost in T.

Adaptive penalization with a minimum Threshold of 10 points to guarantee that even a highly mobile node retains a minimal chance of relaying if no other node is available.

For the first calculation, $k_{\text{new}} = k_{\text{last}} = 1.15$ and $\Delta t_{\text{new}} = \Delta t_{\text{last}} = 1$.

$$k_{\text{new}} = k_{\text{last}} \times \frac{\Delta t_{\text{last}}}{\Delta t_{\text{new}}}$$

$$S_{\text{mob}} = \max(10, 100 \times e^{-k_{\text{new}} \cdot V_{rel}})$$

- $k_{\text{new}}$ : The k used in the actual cycle (T).
- $k_{\text{last}}$ : The k used in the previous cycle (T-1).
- $\Delta t_{\text{new}}$ : The time beetween the previous cycle and the actual cicle.
- $\Delta t_{\text{last}}$ : The time used in the previous cycle (T-1).

##### 3. Calculation Examples ($k=1.15$)

- **$V_{rel} = 0$ (Static)**: No ID changes, RSSI variations < 6 dB. $S_{mob} = 100$.
- **$V_{rel} = 0.6$ (Slight movement)**. $S_{mob} \approx 50$.
    *Example: A node loses 1 neighbor ($N_{\text{lost}}=1$) and has 1 common neighbor with an RSSI variation of 24 dB ($V_{sig} = 0.5 \cdot \frac{24}{6} = 2$). If $N_{\text{total_previous}} = 5$, then $V_{rel} = \frac{1 + 2}{5} = 0.6$.*
- **$V_{rel} = 2.0$ (Fast movement)**. $S_{mob} \approx 10$.
    *Example: A node loses 4 neighbors ($N_{\text{lost}}=4$) and gains 4 new ones ($N_{new}=4$), with $N_{\text{total_previous}} = 4$. If $V_{sig} = 0$, then $V_{rel} = \frac{4 + 4}{4} = 2.0$.*

#### C. Neighborhood Score ($S_{vois}$)

Non-linear weighting to favor well-connected nodes, without a cap (to prioritize BLE 5.0 nodes which detect more neighbors) :

$$S_{vois} = 100 \times \left(1 - e^{-0.1 \times N}\right)$$

* **$N$**: Total number of detected neighbors *(in 1 Mbps AND 125 kbps)*.
* **Examples**:
    * $N = 0$ → $S_{vois} = 0$.
    * $N = 5$ → $S_{vois} \approx 40$.
    * $N = 10$ → $S_{vois} \approx 60$.
    * $N = 20$ → $S_{vois} \approx 86$.

#### D. Link Quality Score ($S_{RSSI}$)

RSSI Normalization to compensate for differences between 1 Mbps and 125 kbps:

* For **1 Mbps** packets: $RSSI_{normalized} = RSSI_{measured}$.
* For **125 kbps** packets: $RSSI_{normalized} = RSSI_{measured} + 10$ (since 125 kbps has ~10 dB better sensitivity, BLE 5.0 nodes are therefore not penalized by a lower RSSI at 125 kbps).
* **Final formula**:
$$S_{RSSI} = \max(0, \min(100, 2.5 \times (RSSI_{normalized} + 100)))$$

* **Examples**:
    * $RSSI = -70$ dBm (1 Mbps) -> $S_{RSSI} = 2.5 \times 30 = 75$.
    * $RSSI = -70$ dBm (125 kbps) -> $RSSI_{normalized} = -60$ -> $S_{RSSI} = 100$.

#### E. Reliability History Score ($S_{fiab}$)

Based on the transmission success rate _(successfully relayed packets (= ACK Succeeded received) / total relayed packets)_ over the last 100 transmissions:

$$S_{fiab} = \text{success_rate} \times 100$$

**Initialization**: $S_{fiab} = 100$ for new nodes.

#### F. Total Score Formula ($S_{base}$)

$$S_{base} = ((S_{vois} \times 0.30) + (S_{mob} \times 0.20) + (S_{RSSI} \times 0.15) + (S_{fiab} \times 0.15)) \times (S_{bat} / 100)$$

$$S_{base} = \max(0, \min(100, S_{base}))$$

**Explanations**:

- **$S_{vois}$ has the highest weight (30%)**: Prioritizes nodes covering the most neighbors (BLE 5.0).
- **$S_{mob}$**: 20% each (mobility).
- **$S_{RSSI}$ and $S_{fiab}$**: 15% each (link quality and reliability).
- **Mandatory range**: $S_{base} \in [0, 100]$.

---

### **3. Score Modifiers (Bonus)**

#### **A. Seniority Bonus (Primary Nodes only)**

Decay to prevent obsolete Primary nodes :

$$Bonus_{\text{seniority}} = \min\left(10, \frac{t}{4}\right) \times \frac{S_{base}}{100}$$

- **$t$**: Uptime in seconds in the Primary role.
- **Examples**:
    - If $S_{base} = 100$ and $t = 40$s -> $Bonus = 10$.
    - If $S_{base} = 100$ and $t = 20$s -> $Bonus = 5$.
    - If $S_{base} = 100$ and $t = 10$s -> $Bonus = 2.5$.
    - If $S_{base} = 50$ and $t = 40$s -> $Bonus = 5$.
    - If $S_{base} = 50$ and $t = 20$s -> $Bonus = 2.5$.
    - If $S_{base} = 50$ and $t = 10$s -> $Bonus = 1.25$.

### **B. Critical Bridge Bonus**

Dynamic and proportional to the node's importance :

$$Bonus_{\text{bridge}} = 20 \times \text{number_dependent_Primary_pairs}$$

* **Cap**: $Bonus_{\text{bridge}} \le 100$.
* **Condition**: A node is a Critical Bridge if it is the only physical link between two Primary nodes that cannot hear each other directly *(at 1 Mbps OR 125 kbps)*. 

---

### **4. State Machine**

#### **Global Constants**

| Constant | Value | Description |
| --- | --- | --- |
| **Hysteresis** | 15 | Score difference required to dethrone a current Primary node. |
| **Redundancy Threshold** | 0.75 | Overlap threshold to trigger demotion. |
| **Minimum RSSI Threshold** | -80 dBm | Minimum RSSI to consider a neighbor as "reliable". |

#### **Rule 0: Temperature Lock (Cooldown)**

Adaptive lock based on the average velocity of neighbors (to prevent "flapping"):
- **Promotion (Secondary -> Primary)**: $\text{Lock} = 5 + 5 \times V_{rel}$, $5 < \text{Lock} < 15$.
- **Demotion (Primary -> Secondary)**: $\text{Lock} = 2 + 4 \times V_{rel}$, $2 < \text{Lock} < 10$.

#### **Rule 1: The Purger (Primary Nodes only)**

A Primary node demotes itself to Secondary if any one of these conditions is met:

1. **Absolute Competition**:
- Another neighboring Primary has a score higher by more than 15 points (Hysteresis).
- **Exception**: If the current Primary has an $S_{bat} < 20\%$, $Score = 0$.

2. **Topological Redundancy**:
- The overlap with a neighboring Primary is **> 75%**.
- **AND** this neighbor has a better score (Neighbor > Self + 5).

**Overlap Calculation**:
- Only neighbors with an RSSI ≥ -80 dBm are considered.
- **Formula**: $\text{overlap_ratio} = \frac{\text{number_common_neighbors}}{\text{total_number_neighbors}}$

#### **Rule 2: Survival (Secondary Nodes only)**

If a Secondary detects zero Primary nodes *(at 1 Mbps OR 125 kbps)*:

1. It initiates a **random timer**:
    $$\text{Delay} = \text{random}(1, 3) + 10 \times \left(1 - \frac{S_{base}}{100}\right)$$
    - A node with $S_{base} = 100$ will wait between 1s and 3s.
    - A node with $S_{base} = 0$ will wait between 11s and 13s.
2. If a Primary is detected during this delay, the timer is canceled.
3. If the delay expires, the node promotes itself to Primary.

#### **Rule 3: Bridging and Replacement (Secondary Nodes only)**

A Secondary promotes itself to Primary if:
- It has "Critical Bridge" status ($Bonus_{\text{bridge}} > 0$).
- **OR** its score exceeds the score of the best Primary in its vicinity by more than 15 points (Hysteresis).
- **OR** there are no Primary nodes with an $S_{RSSI} \ge 50$ in its vicinity (to guarantee good link quality).
  
**CSMA/CA Mechanism**:
  
If the promotion intent is validated, the node initiates a timer:
$$\text{Delay} = \text{random}(1, 3) + 10 \times \left(1 - \frac{S_{base}}{100}\right)$$
- A node with $S_{base} = 100$ will wait between 1s and 3s.
- A node with $S_{base} = 0$ will wait between 11s and 13s.  
  
**Cancellation**: The intent is canceled only if another node with a higher $S_{base}$ promotes itself before the timer ends. Nodes with a high $S_{base}$ promote themselves faster.
  
---

### **5. BLE 4.0 and 5.0 Device Management**

#### **A. Packet Transmission**

Bluetooth 5.0+ nodes transmit at 1 Mbps AND 125 kbps to :
- **Ensure compatibility** with BLE 4.0 devices.
- **Maximize coverage** using 125 kbps (BLE 5.0).

Transmission Frequency :
- **Control packets** (election, core protocol): Every 5 seconds.
- **Application packets**: According to application needs.

#### **B. Neighbor Detection**

Bluetooth LE 4.0+ nodes detect only 1 Mbps neighbors.

Bluetooth LE 5.0+ nodes scan at 1 Mbps AND 125 kbps to detect:
- BLE 4.0 neighbors (1 Mbps).
- BLE 5.0 neighbors (1 Mbps + 125 kbps).

#### **C. Critical Bridges**
  
A node is a Critical Bridge if it is the only link *(at 1 Mbps OR 125 kbps)* between two Primary nodes that cannot hear each other directly.  
  
**Example**:  
A BLE 5.0 node can be a Critical Bridge between a BLE 4.0 (1 Mbps) and a BLE 5.0 (125 kbps) node, because it transmits in both modes.  
  
---

### **6. Robustness and Security**

#### **A. Load Balancing & Quality of Service (QoS)**
  
**Problem**  
Certain well-placed Primary nodes might become overloaded with traffic. Penalizing their score would cause them to demote, leading to network instability ("flapping") and further packet loss during topology reorganization.  
  
**Solution**  
The Primary node retains its status and score, but implements a Local Triage (Active Dropping) mechanism to protect core network operations. 
  
**Mechanism**
- **Traffic Classification**: All network traffic is divided into two priority tiers:
    - **High Priority (Control)**: Core routing protocol packets (e.g., `Neighbor` broadcasts, election intents, score updates).
    - **Low Priority (Data)**: Standard application payloads (e.g., routine sensor telemetry).
- **Active Dropping**: If a Primary node exceeds its safe processing threshold *(> 50 relayed packets per second, or, > 80% TX/RX buffer capacity)*, it enters a defensive state.
- **Execution**: In this state, the node silently drops any newly received Low Priority (Data) packets instead of adding them to the relay queue. High Priority (Control) packets are always processed normally. The node exits the defensive state once traffic drops back below the threshold.
