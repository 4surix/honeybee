
## **Identification Mechanism**

### **1. Introduction**

Generate a unique 2-byte (16-bit) identifiant that changes every 15-minute interval, without requiring local storage, central synchronization. With each change, the value of `Group` is reset to zero.

---

### **2. General Architecture**

#### **2.1 Basic Principles**

- **Full Decentralization**: No dependency on a central server, synchronized clock, or global counter.
- **Dynamic Addresses**: Each device generates a new address every 15 minutes using only its permanent identifier and local time.
- **Uniqueness**: Addresses are unique per device at any given time, thanks to a unique seed (based on the UUID).

#### **2.2 Key Components**

| **Component**          | **Role**                                                |
|------------------------|---------------------------------------------------------|
| **Address Generator**  | Uses a 16-bit LFSR to generate pseudo-random addresses. |
| **Unique Seed**        | Derived from part of the UUID to ensure uniqueness.     |
| **Local Clock**        | Used to determine the current 15-minute period.         |

---

### **3. Dynamic Address Generation**

#### **3.1 Selected Method: 16-bit LFSR + Local Time**

The solution uses a 16-bit Linear Feedback Shift Register (LFSR) with a feedback polynomial:
`x¹⁶ + x¹⁴ + x¹³ + x¹¹ + 1` (represented by the hexadecimal value `0x402B`).
This polynomial ensures a maximum period of 65,535 unique values before repetition.

- **Maximum Period**: 65,535 unique values.
- **Deterministic**: The same seed and period always produce the same address.

#### **3.2 LFSR Initialization**

Each device initializes its LFSR with a unique seed derived from the last 2 bytes of its UUID (ex: `0xBBCC`).

#### **3.3 Address Generation**

1. Each device calculates the current period by dividing the elapsed time since a reference epoch (January 1, 1970) by 15 minutes (900 seconds).
   Example: If `elapsed_time = 3600 seconds` (1 hour), then `current_period = (elapsed_time / 900) % 255`.
2. The LFSR generates 2 bytes (16 bits) using the device's unique seed and the current period as input.
3. The current period (1 byte) is XORed with each byte to introduce temporal variability. The address is computed as follows:
   ```
   Address = [
       LFSR_byte_1 XOR current_period,
       LFSR_byte_2 XOR current_period
   ]
   ```

---

### **4. Time Synchronization**

- All devices use the same reference epoch (`January 1, 1970, 00:00:00 UTC`).
- **No central synchronization**: Each device uses its local clock to compute the elapsed time since the reference epoch.
