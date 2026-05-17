# Security Analysis

### **1 Known Vulnerabilities and Risks**

#### **1.1 Encryption and Authentication**

| Risk                         | Description                                                                                                                                                    | Impact   | Mitigation?                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| **Weak Key Management**      | Group keys are statically shared and may be reused across sessions. If a key is compromised, all past and future communications in that group are at risk. | High     | Use ephemeral session keys derived from a master key (ex: via HKDF). Rotate keys periodically.          |
| **Short Tag Size**           | AES-CCM tag is 4 bytes (32 bits). While this provides integrity, it may not be sufficient for high-security applications.      | Medium   | Consider increasing tag size to 8 or 16 bytes for stronger authentication. _(but there isn't enough bytes, sorry)_                                |
| **No Forward Secrecy**       | If a long-term group key is compromised, all past communications can be decrypted.                                                                         | Critical     | Maybe use Diffie-Hellman (ECDH), or other, to establish session keys for forward secrecy.                                  |
| **No Key Exchange Protocol** | The protocol assumes pre-shared keys for groups. This is impractical for large-scale or dynamic groups.                                                   | Medium     | Implement a secure key exchange protocol. |


#### **1.2 Packet Integrity**

| Risk                         | Description                                                                                                  | Impact   | Mitigation?                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| **No Source Authentication** | The protocol does not authenticate the sender of a packet. An attacker can impersonate a device.         | Is really important to authentificate the sender ? | Add a sender ID or signature (ex: HMAC, or include sender's public key hash).                            |

#### **1.3 Relay and Network Attacks**

| Risk                         | Description                                                                              | Impact   | Mitigation?                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| **TTL Manipulation**         | An attacker can set TTL to a high value to flood the network with packets.           | Medium   | Enforce a maximum TTL (ex: 15) and validate it on reception.                                        |
| **Relay Loops**              | Packets can loop indefinitely if devices relay them back to the sender.              | Medium   | Track visited device IDs in packets to prevent loops.                                                 |
| **Denial-of-Service (DoS)**  | An attacker can flood the network with invalid packets, exhausting device resources. | High     | Implement rate limiting and packet validation (ex: drop packets with invalid `Group` or `TTL`). |


#### **1.4 Bluetooth-Specific Risks**

| Risk                               | Description                                                                    | Impact | Mitigation?                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| **BLE Long Range Vulnerabilities** | BLE Long Range (125 kbps) is more susceptible to interference and jamming. | Medium | Use adaptive hopping or fallback to standard BLE if jamming is detected.                  |


#### **1.5 Group Management Risks**

| Risk                          | Description                                                                                   | Impact   | Mitigation?                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| **Group Key Leakage**         | If a group key is leaked or stolen, all communications in that group are compromised.     | Critical | Use hierarchical keys (ex: master key + session keys) and revocation mechanisms. |


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
| **Authentication**  | Devices can verify the sender's identity. (maybe)    |
| **Forward Secrecy** | Compromised keys cannot decrypt past communications. |
| **Availability**    | The network remains operational despite attacks.     |
| **Non-Repudiation** | Senders cannot deny sending a message (maybe).       |
