<h1>HoneyBee 🐝</h1>

<img align="right" width="80" height="80" src="logo_honeybee.png">

**A lightweight, (secure?), and relay-based Bluetooth Low Energy (BLE) protocol for fragmented, anonymous, and encrypted communication between devices.**

> It is an experimental protocol and not an official standard. No security checks by a specialized audit.

---

## **Overview**

It is designed for:
- **Device-to-device relaying** (ex: phone-to-phone).
- **Secure data transmission** (AES-CCM encryption, group-based keys).
- **Fragmentation** of long messages into 12-byte payloads, linked via cryptographic `next` fields.

Key Features:
- **No provisioning required** (unlike Bluetooth Mesh).
- **Low complexity** (suitable for embedded and mobile devices).
- **Anti-replay and integrity checks** (TTL, cryptographic `next`, AES-CCM tags).

---

## **Documentation**

| Document                                 | Description                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| [PROTOCOL.md](PROTOCOL.md)               | Technical specification of the protocol (packet structure, encryption, relaying). |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Code examples (Python, Kotlin) and integration guidelines.                        |
| [USAGE.md](USAGE.md)                   | Step-by-step guide for sending/receiving messages.                                |
| [SECURITY.md](SECURITY.md)                   | Know security issues.                                |

---

## **Quick Start**

### Prerequisites

- Basic knowledge of **BLE (Bluetooth Low Energy)**.
- Familiarity with **AES-CCM encryption** and **fragmentation**.

### Installation

1. Clone this repository (link or ssh):
  ```bash
   git clone https://github.com/4surix/honeybee.git
  ```
2. Install dependencies (Python example):
  ```bash
   pip install cryptography
  ```

---

## **Project Structure**

```
bluetooth-relay-protocol/
│─ README.md               # This file
│─ PROTOCOL.md             # Protocol specification
│─ IMPLEMENTATION.md       # Code examples
│─ USAGE.md                # Usage guide
|─ SECURITY.md             # Security issues
|─ logo_honeybee.png       # Logo of the protocol
│─ LICENSE                 # SOON
```
