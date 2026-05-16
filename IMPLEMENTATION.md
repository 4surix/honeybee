# Implementation Guide

This document provides code examples for implementing the protocol in Python and **Kotlin**.

---

## **1. Python Implementation**

### **1.1 Dependencies**

Install the `cryptography` library for AES-CCM:

```bash
pip install cryptography
```

### **1.2 Sender Example**

```python
import os
import hashlib

from cryptography.hazmat.primitives.ciphers.aead import AESCCM

# Constants
PROTOCOL_ID = 0xAA
PAYLOAD_SIZE = 12
NEXT_SIZE = 3
GROUP_KEY = os.urandom(16)  # 16-byte key for the group
GROUP_ID = 0x12  # Example group ID

def generate_next(next_payload: bytes) -> bytes:
    """Generate the 3-byte 'Next' field from the next payload."""
    hash_output = hashlib.sha256(next_payload).digest()
    return hash_output[:NEXT_SIZE]

def encrypt_payload(key: bytes, iv: bytes, next_field: bytes, payload: bytes) -> tuple[bytes, bytes]:
    """Encrypt the payload and next field using AES-CCM."""
    aesccm = AESCCM(key)
    nonce = iv
    plaintext = next_field + payload
    ciphertext = aesccm.encrypt(nonce, plaintext, None)
    tag = ciphertext[-4:]  # Last 4 bytes are the tag
    encrypted_data = ciphertext[:-4]  # Rest is encrypted data
    return encrypted_data, tag

def create_packet(
    ttl: int,
    flags: int,
    group: int,
    iv: bytes,
    next_field: bytes,
    payload: bytes,
    key: bytes
) -> bytes:
    """Create a full packet."""
    encrypted_data, tag = encrypt_payload(key, iv, next_field, payload)
    packet = bytearray()
    packet.append(PROTOCOL_ID)  # 1 byte
    packet.append(ttl)          # 1 byte
    packet.append(flags)        # 1 byte
    packet.append(group)        # 1 byte
    packet.extend(iv)           # 8 bytes
    packet.extend(tag)          # 4 bytes
    packet.extend(encrypted_data)  # 15 bytes (3 + 12)
    return bytes(packet)

# Example usage
if __name__ == "__main__":
    message = b"Temp:25C,Hum:60%,Press:1013hPa"
    fragments = [message[i:i+PAYLOAD_SIZE] for i in range(0, len(message), PAYLOAD_SIZE)]

    packets = []
    for i, fragment in enumerate(fragments):
        next_field = b'\x00\x00\x00' if i == len(fragments) - 1 else generate_next(fragments[i+1])
        iv = os.urandom(2) + i.to_bytes(6, byteorder='big')  # Random (2) + Counter (6)
        packet = create_packet(
            ttl=5,
            flags=0x00,
            group=GROUP_ID,
            iv=iv,
            next_field=next_field,
            payload=fragment,
            key=GROUP_KEY
        )
        packets.append(packet)
        print(f"Packet {i+1}: {packet.hex()}")
```

### **1.3 Receiver Example**

```python
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESCCM

GROUP_KEY = b'\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10'  # Example key
GROUP_ID = 0x12

def decrypt_payload(key: bytes, iv: bytes, encrypted_data: bytes, tag: bytes) -> bytes:
    """Decrypt the payload and next field using AES-CCM."""
    aesccm = AESCCM(key)
    ciphertext = encrypted_data + tag
    plaintext = aesccm.decrypt(iv, ciphertext, None)
    return plaintext

def verify_next(prev_next: bytes, current_payload: bytes) -> bool:
    """Verify that the 'Next' field of the previous packet matches the current payload."""
    expected_next = generate_next(current_payload)
    return prev_next == expected_next

def reconstruct_message(packets: list[bytes]) -> bytes:
    """Reconstruct the original message from packets."""
    # Sort packets by their 'Next' field (simplified for example)
    # In practice, you'd need to match 'Next' fields to chain packets.
    reconstructed = b''
    for packet in packets:
        # Parse packet (simplified)
        iv = packet[4:12]
        tag = packet[12:16]
        encrypted_data = packet[16:31]
        plaintext = decrypt_payload(GROUP_KEY, iv, encrypted_data, tag)
        next_field = plaintext[:3]
        payload = plaintext[3:]
        reconstructed += payload
    return reconstructed

# Example usage
if __name__ == "__main__":
    # Simulate received packets (in practice, these would come from BLE)
    packets = [...]
    message = reconstruct_message(packets)
    print(f"Reconstructed message: {message.decode()}")
```

---


## **2. Kotlin Implementation**

### **2.1 Dependencies**

Add the following to your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.google.crypto.tink:tink-android:1.10.0")  // For AES-CCM
}
```


### **2.2 Sender Example**

```kotlin
import java.security.SecureRandom
import java.util.Arrays
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class BluetoothProtocol {
    companion object {
        private const val PROTOCOL_ID = 0xAA.toByte()
        private const val PAYLOAD_SIZE = 12
        private const val NEXT_SIZE = 3
        private const val KEY_SIZE = 16  // AES-128
        private const val IV_SIZE = 8
        private const val TAG_SIZE = 4
        private const val GROUP_ID = 0x12.toByte()

        private val GROUP_KEY = ByteArray(KEY_SIZE).apply {
            SecureRandom().nextBytes(this)
        }

        fun generateNext(nextPayload: ByteArray): ByteArray {
            val md = java.security.MessageDigest.getInstance("SHA-256")
            val hash = md.digest(nextPayload)
            return hash.copyOfRange(0, NEXT_SIZE)
        }

        fun encryptPayload(
            key: ByteArray,
            iv: ByteArray,
            nextField: ByteArray,
            payload: ByteArray
        ): Pair<ByteArray, ByteArray> {
            val cipher = Cipher.getInstance("AES/CCM/NoPadding")
            val secretKey = SecretKeySpec(key, "AES")
            val ivSpec = IvParameterSpec(iv)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec)
            val plaintext = nextField + payload
            val ciphertext = cipher.doFinal(plaintext)
            val tag = ciphertext.copyOfRange(ciphertext.size - TAG_SIZE, ciphertext.size)
            val encryptedData = ciphertext.copyOfRange(0, ciphertext.size - TAG_SIZE)
            return Pair(encryptedData, tag)
        }

        fun createPacket(
            ttl: Int,
            flags: Int,
            group: Byte,
            iv: ByteArray,
            nextField: ByteArray,
            payload: ByteArray,
            key: ByteArray
        ): ByteArray {
            val (encryptedData, tag) = encryptPayload(key, iv, nextField, payload)
            val packet = ByteArray(31)
            packet[0] = PROTOCOL_ID
            packet[1] = ttl.toByte()
            packet[2] = flags.toByte()
            packet[3] = group
            System.arraycopy(iv, 0, packet, 4, IV_SIZE)
            System.arraycopy(tag, 0, packet, 12, TAG_SIZE)
            System.arraycopy(encryptedData, 0, packet, 16, encryptedData.size)
            return packet
        }
    }
}

fun main() {
    val message = "Temp:25C,Hum:60%,Press:1013hPa".toByteArray()
    val fragments = message.chunked(PAYLOAD_SIZE)

    for ((i, fragment) in fragments.withIndex()) {
        val nextField = if (i == fragments.size - 1) {
            ByteArray(NEXT_SIZE)
        } else {
            BluetoothProtocol.generateNext(fragments[i + 1].toByteArray())
        }
        val iv = ByteArray(IV_SIZE).apply {
            SecureRandom().nextBytes(this)
        }
        val packet = BluetoothProtocol.createPacket(
            ttl = 5,
            flags = 0x00,
            group = BluetoothProtocol.GROUP_ID,
            iv = iv,
            nextField = nextField,
            payload = fragment.toByteArray(),
            key = BluetoothProtocol.GROUP_KEY
        )
        println("Packet ${i + 1}: ${packet.joinToString("") { "%02x".format(it) }}")
    }
}
```

### **2.3 Receiver Example**

```kotlin
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class BluetoothProtocolReceiver {
    companion object {
        private val GROUP_KEY = byteArrayOf(
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10
        )

        fun decryptPayload(
            key: ByteArray,
            iv: ByteArray,
            encryptedData: ByteArray,
            tag: ByteArray
        ): ByteArray {
            val cipher = Cipher.getInstance("AES/CCM/NoPadding")
            val secretKey = SecretKeySpec(key, "AES")
            val ivSpec = IvParameterSpec(iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec)
            val ciphertext = encryptedData + tag
            return cipher.doFinal(ciphertext)
        }

        fun reconstructMessage(packets: List<ByteArray>): ByteArray {
            val reconstructed = mutableListOf<Byte>()
            for (packet in packets) {
                val iv = packet.copyOfRange(4, 12)
                val tag = packet.copyOfRange(12, 16)
                val encryptedData = packet.copyOfRange(16, 31)
                val plaintext = decryptPayload(GROUP_KEY, iv, encryptedData, tag)
                val payload = plaintext.copyOfRange(3, plaintext.size)  // Skip 'Next' field
                reconstructed.addAll(payload.toList())
            }
            return reconstructed.toByteArray()
        }
    }
}

fun main() {
    // Simulate received packets (hex strings)
    val packets = listOf(...)
    val message = BluetoothProtocolReceiver.reconstructMessage(packets)
    println("Reconstructed message: ${String(message)}")
}
```
