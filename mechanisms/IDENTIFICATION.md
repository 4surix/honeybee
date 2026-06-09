
## **Identification Mechanism**

### **1. Introduction**

Generate a unique 3-byte (24-bit) address that changes every 5-minute interval, without requiring local storage, central synchronization, or complex management.

---

### **2. General Architecture**

#### **2.1 Basic Principles**

- **Full Decentralization**: No dependency on a central server, synchronized clock, or global counter.
- **Dynamic Addresses**: Each device generates a new address every 15 minutes using only its permanent identifier and local time.
- **Uniqueness**: Addresses are unique per device at any given time, thanks to a unique seed (based on the UUID).

#### **2.2 Key Components**

| **Component**          | **Role**                                                     |
|------------------------|-------------------------------------------------------------|
| **Address Generator**  | Uses a 24-bit LFSR to generate pseudo-random addresses. |
| **Unique Seed**        | Derived from part of the UUID to ensure uniqueness.     |
| **Local Clock**        | Used to determine the current 15-minute period.         |

---

### **3. Dynamic Address Generation**

#### **3.1 Selected Method: 24-bit LFSR + Local Time**

The solution uses a 24-bit Linear Feedback Shift Register (LFSR) with a feedback polynomial:
`x²⁴ + x²³ + x²² + x¹⁷ + 1` (represented by the hexadecimal value `0x2D2C01`).

- **Maximum Period**: 16,777,215 unique values before repetition.
- **Deterministic**: The same seed and period always produce the same address.

#### **3.2 LFSR Initialization**

Each device initializes its LFSR with a unique seed derived from the last 3 bytes of its UUID (ex: `0xAABBCC`).

#### **3.3 Address Generation**

1. Each device calculates the current period by dividing the elapsed time since a reference epoch (January 1, 1970) by 15 minutes (900 seconds).
   Example: If `elapsed_time = 3600 seconds` (1 hour), then `current_period = 3600 / 900 = 4 % 255`.
2. The LFSR generates 3 bytes (24 bits) using the device's unique seed and the current period as input.
3. The address is computed as follows:
   ```
   Address = [
       LFSR_byte_1 XOR current_period,
       LFSR_byte_2 XOR current_period,
       LFSR_byte_3 XOR current_period
   ]
   ```
   The current period (1 byte) is XORed with each byte to introduce temporal variability.

---
### **4. Time Synchronization**

- All devices use the same reference epoch (`January 1, 1970, 00:00:00 UTC`).
- **No central synchronization**, each device uses its local clock to compute the elapsed time since the reference epoch.