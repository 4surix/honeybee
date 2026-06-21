
## Confidentiality Mechanisms

### **1. Encryption and Authentication**

- **Algorithm**: AES-CCM-128 (16-bytes key).
- **IV**: 10 bytes (`List (2) + Sender (2) + Channel (2) + Random (4)`) for uniqueness.
- **MIC**: 6 bytes for authentication (tamper detection).

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
| Channel           | 2               | Identifiant of channel.             |
| Key Encryption    | 16              | Key of the channel for encryption.  |
| Key Signature     | 32              | Key of the channel for signature.   |
  
**Size**  
50 bytes for each channel.  
  
**Format**  
- The file is a concatenation.
- Each channel is written sequentially, with a new line.

### 3. Keys

#### 3.1. Read-Only Channel Keys

Keys shared with all listeners:
- $\mathrm{Key}_\mathrm{Channel}$: Symmetric key (AES-128) for encryption.
- $\mathrm{Key}_\mathrm{Signature}$: Ed25519 public key for the signature.
  
The sender keep **secretly** the Ed25519 private key (for signing).
  
Exemple to share:  
`Channel::KeyEncryption::KeySignature`  
`0x0130::7d2e9a4c1b8f3e5d0a6c9b2f4e7d1a0c::9d61b19deffd5a60ba844af492ec2cc44449c5697b32695c728c7c3cb9ae2`  
  
Process:
- Signing: Signs the compressed data with private $\mathrm{Key}_\mathrm{Signature}$ (Ed25519), truncates to 8 bytes.
- Concatenation: `Signature (8)` + `Compressed data (...)`.
- Encryption: Encrypts concatenation with AES-CCM (IV=10, MIC=6) and $\mathrm{Key}_\mathrm{Channel}$.

#### 3.2. Read-Write Channel Keys.

Keys shared with all listeners:
- $\mathrm{Key}_\mathrm{Channel}$: Symmetric key (AES-128) for encryption.
- $\mathrm{Key}_\mathrm{Signature}$: Symmetric key (HMAC) for the signature.
  
Exemple to share:  
`Channel::KeyEncryption::KeySignature`  
`0x0101::e9c1d2b3a4f506172839405162738495::5e6b3d9f2c7a1b8e4d0c9a6b3f7e2d8c5a1b0e4f9d6c7b8a3f2e1d0c9a`  
  
Process:
- Signing: Signs the compressed data with $\mathrm{Key}_\mathrm{Signature}$ (HMAC-SHA256), truncated to 8 bytes.
- Concatenation: `Signature (8)` + `Compressed data (...)`.
- Encryption: Encrypts concatenation with AES-CCM (IV=10, MIC=6) and $\mathrm{Key}_\mathrm{Channel}$.
  
### 4. Anti-Replay and Integrity
  
- **TTL**: Limits relay count (prevents infinite loops).
- **MIC**: Detects tampering.
  
### 5. Risk of collision

#### MIC

The length of the MIC is 6 bytes (48 bits). The probability of a collision for a space of $N$ possible values (here, $2^{48}$ for a 48-bit MIC) with $k$ packets (here, $10^6$ for example) is approximated by:  
  
$$P(\mathrm{collision}) \approx 1 - e^{-k^2 / (2N)}$$
- $N = 2^{48}$ (number of possible MIC values).
- $k = 10^6$ (number of packets exchanged).

$$P(\mathrm{collision}) \approx 1 - e^{-(10^6)^2 / (2 \times 2^{48})} \approx 1 - e^{-10^{12} / 2^{49}} \approx 1 - e^{-0.001776} \approx 0.001775$$

The probability of a collision for a 48-bit MIC ($N = 2^{48}$) with 1 million packets ($k = 10^6$) is approximately **0.2%**.  
