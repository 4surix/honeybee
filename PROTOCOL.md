# Protocol Specification

1. [Introduction](#intro)
2. [Protocol Overview](#overview)
3. [Mechanisms](#mechanisms)

---

## **1. Introduction** {#intro}

### **1.1 Purpose**

This document describes a **Bluetooth Low Energy (BLE)** protocol for:

- **Relay-based communication** between devices (ex: phone-to-phone).
- **Fragmented data transmission** (14-byte payloads linked via `List` fields).
- **Secure and anonymous** messaging (AES-CCM encryption, channel keys, integrity checks).

### **1.2 Prerequisites**

- Basic understanding of BLE and AES-CCM encryption.
- Familiarity with fragmentation and cryptographic hashing.

---

## **2. Protocol Overview** {#overview}

### **2.1 Resume**

| Concept           | Description                                                                             |
| ----------------- | --------------------------------------------------------------------------------------- |
| **Relay**         | Devices can relay packets to others, up to a **TTL (Time To Live)** limit.              |
| **Fragmentation** | Long messages are split into **14-byte payloads**, linked via a `List` field (2 bytes). |
| **Channel**        | Packets belong to a channel _(2 bytes)_, each with a unique encryption key.              |
| **Security**      | `AES-CCM-128` encryption, unique `IV`, and `MIC` for integrity.      |


### **2.2 Comparison with Existing Standards**

|                  | **HoneyBee**        | **Bluetooth Mesh**   | **Thread**         | **Zigbee**        | **LoRaWAN**        |
| ---------------- | ------------------- | -------------------- | ------------------ | ----------------- | ------------------ |
| **Provisioning** | Pre-shared key      | Dedicated            | Certificate / PSK  | Trust Center      | OTAA/ABP           |
| **Size Payload** | Max 14 bytes        | Max 16 bytes         | Max 63 bytes       | Max 68 bytes      | Max 51-222 bytes   |
| **Security**     | AES-CCM-128 </br> Channels  | AES-CCM-128          | AES-128 </br> DTLS      | AES-128 </br> Trust Center | AES-128 </br> E2E optionnal |
| **Range**        | ~30-50m _(BLE)_ </br> ~250m _(BLE LongRange)_ | ~30-50m              | ~30-50m                 | ~10-100m               | ~1-40 km                 |
| **Latency**      | Low                 | Medium               | Low                | Medium            | High               |

### **2.3 Communication Flow**

```mermaid
sequenceDiagram
    participant A as Device A
    participant B as Device B
    participant C as Device C

    A->>B: Packet 1 (TTL=5)
    B->>C: Packet 1 (TTL=4)
    A->>B: Packet 2 (TTL=5)
    B->>C: Packet 2 (TTL=4)
    C->>C: Reconstructs message
```

---

## 3. Mechanisms {#mechanisms}

- [Acknowledgement Mechanism](mechanisms/ACKNOWLEDGEMENT.md)
- [Channels Mechanism](mechanisms/CHANNELS.md)
- [Identification Mechanism](mechanisms/IDENTIFICATION.md)
- [Network Mechanism](mechanisms/NETWORK.md)
- [Packet Mechanism](mechanisms/PACKET.md)
- [Relay Mechanism](mechanisms/RELAY.md)
- [Confidentiality Mechanism](mechanisms/CONFIDENTIALITY.md)
- [Send Mechanism](mechanisms/SEND.md)
- [Receive Mechanism](mechanisms/RECEIVE.md)
