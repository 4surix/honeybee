# HoneyBee 🐝

[![Bluetooth](https://img.shields.io/badge/-Bluetooth-0082FC?style=flat&logo=bluetooth&logoColor=white)](https://www.bluetooth.com/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/4surix/honeybee/blob/main/LICENSE) [![Issues open](https://img.shields.io/github/issues/4surix/honeybee)](https://github.com/4surix/honeybee/issues) 

<img align="right" width="90" height="90" src="img-logo-honeybee.png">

**A lightweight, (secure?), and relay-based Bluetooth Low Energy (BLE) protocol for fragmented, anonymous, and encrypted communication between devices.**

> It is an experimental protocol and not an official standard. No security checks by a specialized audit.

---

## **Overview**

It is designed for:
- **Device-to-device relaying** (ex: phone-to-phone).
- **Secure data transmission** (AES-CCM encryption, group-based keys).
- **Fragmentation** of long messages into 12-byte payloads, linked via cryptographic `next` fields.
- **Secure P2P messaging** with fragmentation and relay (ex: offline chat).

Key Features:
- **Easy and low provisioning**.
- **Low complexity** (suitable for embedded and mobile devices).
- **Anti-replay and integrity checks** (TTL, cryptographic `next`, AES-CCM tags).

Not Ideal for:
- Long-range IoT.
- High-throughput applications.
- Standardized, interoperable solutions.
- Large-scale deployments with dynamic group joining.

<img src="img-frame.png">

---

## **Documentation**

1. [PROTOCOL.md](PROTOCOL.md) : Technical specification of the protocol.
2. [SECURITY.md](SECURITY.md) : Know security issues.
