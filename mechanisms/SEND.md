## Send Mechanism

### 1. Construction

#### 1.1 Type 3 : Message

1. Check if `TTL > 0`. 
2. A signature is generated with the data.
3. The signature is concatenated with the data: `Signature (8)` + `Data (...)`.
4. The data is compressed using `SMAZ` or `ZSTD`.
5. A byte is added at the very beginning to indicate the compression type: `Type (1)` + `Concatenation (...)`.
6. The compression is divided into 14-byte segments. Starting from the end, we work backward to the first segment. For each segment, a packet is created:
    1. A random number between 0 and 2^32 is generated.
    2. The IV is constructed using: the list info, the sender identifier, the channel identifier, and the random number.
    3. The 14-byte portion is encrypted using `AES-CCM (IV=10, MIC=5)`, resulting in a 5-byte MIC.

### 2. Delay

To avoid overloading the network, the limit is one packet sent per second.
