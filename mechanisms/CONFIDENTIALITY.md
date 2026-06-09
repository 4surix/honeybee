
## Confidentiality Mechanisms

### **1. Encryption and Authentication**

- **Algorithm**: AES-CCM-128 (16-bytes key).
- **IV**: 11 bytes (`Sender (3) + Channel (3) + Random (5)`) for uniqueness.
- **MIC**: 5 bytes for authentication (tamper detection).

#### Initialization Vector (IV)

The IV (Initialization Vector) is a pseudo-random value used to ensure that the same plaintext encrypted twice with the same key produces two different ciphertexts. This prevents replication attacks.

#### Message integrity check (MIC)

The MIC is used in authenticated encryption modes such as AES-CCM to verify the integrity and authenticity of the encrypted message. It allows detection of whether the message has been modified during transmission.

### 2. Channel Management

Each channel has a unique encryption key (stored by sender/receiver).

#### Database
  
**Structure**  
Each field packet is stored in binary form in a file, with the following structure:
| Field             | Bytes           | Description                         |
|-------------------|-----------------|-------------------------------------|
| Channel           | 3               | Identifiant of channel.             |
| Key Encryption    | 16              | Key of the channel for encryption.  |
| Key Signature     | 32              | Key of the channel for signature.   |
  
**Size**  
51 bytes for each channel.  
  
**Format**  
- The file is a concatenation.
- Each channel is written sequentially, with a new line.

### 3. Keys

#### 3.1. Read-Only Channel Keys

Keys shared with all listeners:
- $\text{Key}_\text{Channel}$: Symmetric key (AES-128) for encryption.
- $\text{Key}_\text{Signature}$: Ed25519 public key for the signature.

The sender keep **secretly** the Ed25519 private key (for signing).

Exemple to share:  
`Channel::KeyEncryption::KeySignature`  
`0x0130A1::7d2e9a4c1b8f3e5d0a6c9b2f4e7d1a0c::9d61b19deffd5a60ba844af492ec2cc44449c5697b32695c728c7c3cb9ae2`  
  
Process:
- Signing: Signs the compressed data with private $\text{Key}_\text{Signature}$ (Ed25519), truncates to 10 bytes.
- Concatenation: `Signature (10)` + `Compressed data (...)`.
- Encryption: Encrypts concatenation with AES-CCM (IV=11, MIC=5) and $\text{Key}_\text{Channel}$.

#### 3.2. Channel keys for reading and writing.

Keys shared with all listeners:
- $\text{Key}_\text{Channel}$: Symmetric key (AES-128) for encryption.
- $\text{Key}_\text{Signature}$: Symmetric key (HMAC) for the signature.
  
Exemple to share:  
`Channel::KeyEncryption::KeySignature`  
`0x010001::e9c1d2b3a4f506172839405162738495::5e6b3d9f2c7a1b8e4d0c9a6b3f7e2d8c5a1b0e4f9d6c7b8a3f2e1d0c9a`  
  
Process:
- Signing: Signs the compressed data with $\text{Key}_\text{Signature}$ (HMAC-SHA256), truncated to 10 bytes.
- Concatenation: `Signature (10)` + `Compressed data (...)`.
- Encryption: Encrypts concatenation with AES-CCM (IV=11, MIC=5) and $\text{Key}_\text{Channel}$.
  
### 4. Fragmentation with `Next`

The `Next` field is used for fragmentation by indicating which packet comes after the other in a packet chain, but it also constitutes a cryptographic proof preventing an attacker from reordering or modifying the fragments.
  
**Principle**  
- Each packet contains a 2-byte `Next` field.
- `Next = hash(Channel + Next (next packet) + Payload (next packet))`.
- Last packet has `Next = 0x0000`.  
  
**Reconstruction**  
- Receiver verifies that `Next` of the previous packet matches the hash of the current payload.
- If a packet is missing or modified, the chain is invalid.
  
### **5. Anti-Replay and Integrity**
  
- **TTL**: Limits relay count (prevents infinite loops).
- **Cryptographic `Next`**: Prevents packet modification/reordering.
- **MIC**: Detects tampering.
  
### 6. Risk of collision MIC

The probability of collision for a space of N possible value (here, $2^{40}$ for 40 bytes MIC) with `k` packets (here, $10^{9}$ for example) is approximated by :  
  
$P(\text{collision}) \approx 1 - e^{-k^2 / (2N)}$  
- $N = 2^{40}$ (number of possible MIC).  
- $k = 10^{9}$ (number of packet exchanged). 
  
$P(\text{collision}) \approx 1 - e^{-(10^9)^2 / (2 \times 2^{40})} \approx 1 - e^{-10^{18} / 2^{41}} \approx 1 - e^{-0.00045} \approx 0.00045$  

The probability of collision for a 40-bit MIC ($N = 2^{40}$) with 1 billion packets ($k = 10^9$) is approximately 0.045% (1 collision every ~220,000 packets).
