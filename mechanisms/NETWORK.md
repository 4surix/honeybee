
## Network Mechanism

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
- **Secondary Node**
    - Send packets *(at 1 Mbps and 125 kbps)*
    - Receive packets *(at 1 Mbps and 125 kbps)*  
  
BLE 5.0 nodes use dual transmission/reception (1 Mbps and 125 kbps) to ensure compatibility and maximum coverage. BLE 4.0 nodes are restricted to transmitting and listening at 1 Mbps only.

---

<a name="fitness-score"></a>

### 2. Fitness Score Calculation ($S_{base}$)

A node's role is determined by its Score, updated in real time. The score consists of 5 metrics, calculated independently and then weighted.

#### A. Battery Score ($S_{bat}$)

Smoothed sigmoid function to avoid discontinuities :

$$S_{\mathrm{bat}} = \frac{100}{1 + e^{-0.2 (B - 40)}}$$

$B$ : Remaining battery percentage (0 to 100).
**Examples**:
- $B = 80$ → $S_{\mathrm{bat}} \approx 99.9$.
- $B = 40$ → $S_{\mathrm{bat}} = 50$.
- $B = 33$ → $S_{\mathrm{bat}} \approx 20.0$.
- $B = 20$ → $S_{\mathrm{bat}} \approx 1.8$.

#### B. Mobility Score ($S_{mob}$)

The mobility score evaluates the stability of a node without relying on energy-consuming positioning sensors. It measures the relative volatility ($V_{rel}$) of the radio environment via RSSI data collected in `Neighbor` packets.

##### 1. Breakdown of the $V_{rel}$ Calculation

The volatility ratio $V_{rel}$ is the sum of two factors of change, normalized by the total number of neighbors in the previous cycle to remain a relative value.

###### A. Topological Volatility ($V_{topo}$)

Measures the turnover of identifiers (IDs) in the neighborhood.

$$V_{topo} = N_{new} + N_{lost}$$

###### B. Signal Volatility ($V_{sig}$)

Measures the intensity of movement within existing links using an Exponential Moving Average (EMA) filter to smooth out fast channel fading and temporary physical obstructions.

Each of our neighbors sends an Informations packet every 10 seconds. If we have 100 neighbors, we therefore receive 100 packets every 10 seconds, or 10 packets per second.

$$\mathrm{RSSI}_{EMA, t} = (\alpha \times \mathrm{RSSI}_{measured}) + ((1 - \alpha) \times \mathrm{RSSI}_{EMA, t-1})$$

$\alpha$ : Smoothing factor set to **0.2** to give significant historical weight and damp sudden radio anomalies.

$$V_{sig} = \mathrm{round}\left(0.5 \times \sum_{i \in \mathrm{common}} \left( \frac{|\mathrm{RSSI}_{EMA, i} - \mathrm{RSSI}_{EMA, i - 1} |}{Threshold} \right)\right)$$

**Threshold**: Set to **6 dB** variation counts as "1 movement unit". A sharper variation (ex: 18 dB) counts for 3 units, penalizing fast movements more heavily.

##### 2. Global Formula and Score

$V_{rel}$ is a unitless ratio representing the average volatility per neighbor from the previous cycle, normalized to allow relative comparison between nodes. The relative volatility is fed into an exponential function to calculate the final score.

$$V_{rel} = \dfrac{V_{topo} + V_{sig}}{\max(1, N_{\mathrm{total_previous}})}$$

$N_{\mathrm{total_previous}}$: Total number of neighbors in the previous cycle (T-1), including those lost in T.

Adaptive penalization with a minimum Threshold of 10 points to guarantee that even a highly mobile node retains a minimal chance of relaying if no other node is available.

For the first calculation, $k_{\mathrm{new}} = k_{\mathrm{last}} = 1.15$ and $\Delta t_{\mathrm{new}} = \Delta t_{\mathrm{last}} = 1$.

$$k_{\mathrm{new}} = k_{\mathrm{last}} \times \frac{\Delta t_{\mathrm{last}}}{\Delta t_{\mathrm{new}}}$$

$$S_{\mathrm{mob}} = \max(10, 100 \times e^{-k_{\mathrm{new}} \cdot V_{rel}})$$

- $k_{\mathrm{new}}$ : The k used in the actual cycle (T).
- $k_{\mathrm{last}}$ : The k used in the previous cycle (T-1).
- $\Delta t_{\mathrm{new}}$ : The time beetween the previous cycle and the actual cicle.
- $\Delta t_{\mathrm{last}}$ : The time used in the previous cycle (T-1).

##### 3. Calculation Examples ($k=1.15$)

- **$V_{rel} = 0$ (Static)**: No ID changes, very low RSSI variations. $S_{mob} = 100$.  
- **$V_{rel} = 0.6$ (Slight movement)**. $S_{mob} \approx 50$.  
    Example: A node loses 1 neighbor ($N_{\mathrm{lost}}=1$) and has 1 common neighbor with an RSSI variation of 24 dB ($V_{sig} = 0.5 \cdot \frac{24}{6} = 2$). If $N_{\mathrm{total_previous}} = 5$, then $V_{rel} = \frac{1 + 2}{5} = 0.6$.  
- **$V_{rel} = 2.0$ (Fast movement)**. $S_{mob} \approx 10$.  
    Example: A node loses 4 neighbors ($N_{\mathrm{lost}}=4$) and gains 4 new ones ($N_{new}=4$), with $N_{\mathrm{total_previous}} = 4$. If $V_{sig} = 0$, then $V_{rel} = \frac{4 + 4}{4} = 2.0$.

#### C. Neighborhood Score ($S_{Neighborhood}$)

Non-linear weighting to favor well-connected nodes, without a cap (to prioritize BLE 5.0 nodes which detect more neighbors) :

$$S_{\mathrm{Neighborhood}} = 100 \times \left(1 - e^{-0.1 \times N}\right)$$

**$N$**: Total number of detected neighbors *(in 1 Mbps AND 125 kbps)*.
**Examples**:
- $N = 0$ → $S_{\mathrm{Neighborhood}} = 0$.
- $N = 5$ → $S_{\mathrm{Neighborhood}} \approx 40$.
- $N = 10$ → $S_{\mathrm{Neighborhood}} \approx 60$.
- $N = 20$ → $S_{\mathrm{Neighborhood}} \approx 86$.

#### D. Link Quality Score ($S_{RSSI}$)

RSSI Normalization to compensate for differences between 1 Mbps and 125 kbps:
- For **1 Mbps** packets: $RSSI_{normalized} = RSSI_{measured}$.
- For **125 kbps** packets: $RSSI_{normalized} = RSSI_{measured} + 10$ _(since 125 kbps has ~10 dB better sensitivity, BLE 5.0 nodes are therefore not penalized by a lower RSSI at 125 kbps)_.

**Final formula**
$$S_{RSSI} = \max(0, \min(100, 2.5 \times (RSSI_{normalized} + 100)))$$

**Examples**:
- $RSSI = -70$ dBm (1 Mbps) -> $S_{RSSI} = 2.5 \times 30 = 75$.
- $RSSI = -70$ dBm (125 kbps) -> $RSSI_{normalized} = -60$ -> $S_{RSSI} = 100$.

#### E. Reliability History Score ($S_{fiab}$)

Based on the transmission success rate _(successfully relayed packets (= ACK Succeeded received) / total relayed packets)_ over the last 100 transmissions :

$$S_{fiab} = \mathrm{success\_rate} \times 100$$

**Initialization**: $S_{fiab} = 100$ for new nodes.

#### F. Base Score Formula ($S_{base}$)

$$S_{base} = ((S_{\mathrm{Neighborhood}} \times 0.30) + (S_{mob} \times 0.20) + (S_{RSSI} \times 0.15) + (S_{fiab} \times 0.15)) \times (\frac{S_{bat}}{100})$$

$$S_{base} = \max(0, \min(100, S_{base}))$$

---

<a name="score-modifiers"></a>

### **3. Score Modifiers (Bonus & Malus)**

#### **A. Seniority Bonus (Primary Nodes only)**

Provides long-term role stability for proven operational Primary nodes to prevent unnecessary structural re-elections:

$$Bonus_{\mathrm{seniority}} = \min\left(20, \frac{t}{15}\right) \times \frac{S_{base}}{100}$$

**$t$**: Uptime in seconds in the Primary role.

**Examples**
- If $S_{base} = 100$ and $t = 300$s -> $Bonus = 20$.
- If $S_{base} = 100$ and $t = 60$s -> $Bonus = 4$.
- If $S_{base} = 50$ and $t = 300$s -> $Bonus = 10$.

#### **B. Critical Bridge Bonus**

A node is a Critical Bridge if it is the only link _(at 1 Mbps OR 125 kbps)_ between two Primary nodes that cannot hear each other directly. _Example: A BLE 5.0 node can be a Critical Bridge between a BLE 4.0 (1 Mbps) and a BLE 5.0 (125 kbps) node, because it transmits in both modes._ Dynamic and proportional to the node's importance :

$$Bonus_{\mathrm{bridge}} = 20 \times \mathrm{number\_dependent\_Primary\_pairs}$$

* **Cap**: $Bonus_{\mathrm{bridge}} \le 100$.
* **Condition**: A node is a Critical Bridge if it is the only physical link between two Primary nodes that cannot hear each other directly *(at 1 Mbps OR 125 kbps)*.

#### **C. Demotion Malus (Anti Yo-Yo / Secondary Nodes only)**

Prevents immediate re-promotion loops (flapping) caused by minor, localized score recoveries immediately after a node voluntarily relinquishes its Primary role:

$$Malus_{\mathrm{demotion}} = 20 \times e^{-\frac{t}{10}}$$

**$t$**: Time elapsed in seconds since the node transitioned back to the Secondary role.

**Behavior**
At $t = 0$ seconds, a 20-point penalty is subtracted. The penalty exponentially decays and effectively disappears after approximately 30 seconds, letting the new Primary stabilize its connections.

#### **D. Global Adjusted Score Formula ($S_{global}$)**

The absolute score used by the state machine to determine all routing and role transitions:

$$S_{global} = S_{base} + Bonus_{\mathrm{seniority}} + Bonus_{\mathrm{bridge}} - Malus_{\mathrm{demotion}}$$

$$S_{global} = \max(0, \min(100, S_{global}))$$

---

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
$\mathrm{overlap\_ratio} = \frac{\mathrm{number\_common\_neighbors}}{\mathrm{total\_number\_neighbors}}$

#### **Rule 2: Survival (Secondary Nodes only)**

If a Secondary detects zero Primary nodes *(at 1 Mbps OR 125 kbps)*:

1. It initiates a **random timer**:
    $$\mathrm{Delay} = \mathrm{random}(1, 3) + 10 \times \left(1 - \frac{S_{global}}{100}\right)$$
    - A node with $S_{global} = 100$ will wait between 1s and 3s.
    - A node with $S_{global} = 0$ will wait between 11s and 13s.
2. If a Primary is detected during this delay, the timer is canceled.
3. If the delay expires, the node promotes itself to Primary.

#### **Rule 3: Bridging and Replacement (Secondary Nodes only)**

A Secondary promotes itself to Primary if:
- It has "Critical Bridge" status ($Bonus_{\mathrm{bridge}} > 0$).
- **OR** its $S_{global}$ exceeds the score of the best Primary in its vicinity by more than the computed Dynamic Hysteresis value.
- **OR** there are no Primary nodes with an $S_{RSSI} \ge 50$ in its vicinity (to guarantee good link quality).

**CSMA/CA Mechanism**
If the promotion intent is validated, the node initiates a timer:
$$\mathrm{Delay} = \mathrm{random}(1, 3) + 10 \times \left(1 - \frac{S_{global}}{100}\right)$$
- A node with $S_{global} = 100$ will wait between 1s and 3s.
- A node with $S_{global} = 0$ will wait between 11s and 13s.

**Cancellation**
The intent is canceled only if another node with a higher $S_{global}$ promotes itself before the timer ends. Nodes with a high $S_{global}$ promote themselves faster.

---

<a name="device-management"></a>

### **5. BLE 4.0 and 5.0 Device Management**

#### **A. Packet Transmission**

Bluetooth 5.0+ nodes transmit at 1 Mbps AND 125 kbps to :
- **Ensure compatibility** with BLE 4.0 devices.
- **Maximize coverage** using 125 kbps (BLE 5.0).

Transmission Frequency :
- **Control packets** (election, core protocol): Every 10 seconds.
- **Application packets**: According to application needs.

#### **B. Neighbor Detection**
  
Bluetooth LE 4.0+ nodes detect only 1 Mbps neighbors.  
Bluetooth LE 5.0+ nodes scan at 1 Mbps AND 125 kbps to detect:
- BLE 4.0 neighbors (1 Mbps).
- BLE 5.0 neighbors (1 Mbps + 125 kbps).
