# HoneyBee Protocol

![Version](https://img.shields.io/badge/Version-0.0-blue.svg) [![Bluetooth](https://img.shields.io/badge/-Bluetooth-0082FC?style=flat&logo=bluetooth&logoColor=white)](https://www.bluetooth.com/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/4surix/honeybee/blob/main/LICENCE) [![Issues open](https://img.shields.io/github/issues/4surix/honeybee)](https://github.com/4surix/honeybee/issues)

![logo](images/img-logo-honeybee.png){ width="90" align="right" }

**Offline, anonymous, BLE-native mesh messaging — normative specification.**

> Experimental protocol, not an official standard. No specialized security audit.

HoneyBee is a lightweight, relay-based Bluetooth Low Energy (BLE) protocol for
fragmented, anonymous and encrypted device-to-device communication:

- **Relay-based communication** between devices (phone-to-phone).
- **Fragmented data transmission** (1..200-byte chunks linked via `List` fields).
- **Secure and anonymous messaging** (AES-CCM-128, channel keys, integrity checks).

![Frame overview](images/img-frame.png)

## Start here

- [Protocol Specification](PROTOCOL.md) — technical specification of the protocol.
- [Security Analysis](SECURITY.md) — known issues, threat model, privacy analysis.

## Mechanisms

| Mechanism | Description |
| --------- | ----------- |
| [Acknowledgement](mechanisms/ACKNOWLEDGEMENT.md) | Per-hop delivery confirmation, ECDRI, MISSING recovery |
| [Channels](mechanisms/CHANNELS.md) | 32-bit channel structure, types, priorities |
| [Identification](mechanisms/IDENTIFICATION.md) | Rotating one-way device addresses |
| [Network](mechanisms/NETWORK.md) | Fitness score, election, Primary / Secondary roles |
| [Packet](mechanisms/PACKET.md) | Frame formats, Packet ID, IV, MIC layout |
| [Relay](mechanisms/RELAY.md) | Dedup cache, PoW, budgets, GATT mesh, rendezvous |
| [Confidentiality](mechanisms/CONFIDENTIALITY.md) | AES-CCM, HKDF key hierarchy, anti-replay |
| [Send](mechanisms/SEND.md) | Construction, padding, token bucket, retransmission |
| [Receive](mechanisms/RECEIVE.md) | Reception order, reassembly, active dropping |

## Notation used in this specification

- [MIC]: Message Integrity Check (8-byte CCM tag, one per message)
- [PoW]: Proof of Work (chain difficulty, base d=12)
- [ECDRI]: Ensure the Connected Device Received It (1 s per-hop timer)
- [FCS]: Frame Check Sequence (CRC-16/CCITT-FALSE transport check)
- [IV]: Initialization Vector (18-byte logical value, 12-byte CCM nonce derived)
- [GATT]: Generic Attribute Profile (connected BLE bearer)
- [RSSI]: Received Signal Strength Indicator
- [EMA]: Exponential Moving Average
- [HKDF]: HMAC-based Key Derivation Function
- [AAD]: Additional Authenticated Data
