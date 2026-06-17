# Keewano TypeScript SDK

Lightweight behavioural analytics for Keewano AI Analyst. These guides cover the React
Native and Expo SDKs; the SDK is built on a platform-agnostic core, ready for future
platforms such as Node.js or Web.

## Overview

The SDK collects behavioural telemetry - taps, screens, in-app purchases, ad
revenue, errors - and ships it to the Keewano backend in a compact binary format.
Most of it is tracked automatically after a single `init` call; anything
game-specific you report through a small manual API or your own typed custom
events. The wire format is identical to the Keewano Unity SDK, so the same
backend ingests data from both.

## Key features

- **Effortless integration** - install one package and call `Keewano.init({ apiKey })`. Automatic tracking starts immediately.
- **Automatic event tracking** - app lifecycle, button taps, screens, deep links, and errors are captured with no extra code. Manual and custom events are opt-in on top.
- **Compact binary format** - events are encoded as compact binary, not JSON, so there is no serialization overhead on the wire.
- **Non-blocking by design** - events accumulate in memory and are flushed by a background async loop, off the render path, so the UI thread is never blocked.
- **Lean footprint** - pure TypeScript, no native code, and no heavy third-party dependencies; it relies only on the platform's own file system.

## Performance-first

The SDK is built so that analytics never costs you frame time:

- **Minimalistic** - no schemas to maintain. The common events fire automatically; custom events are an opt-in extra, not a requirement.
- **Binary wire format** - a compact byte encoding (variable-length integers, packed records) instead of JSON, which keeps payloads small and avoids serialization cost.
- **Double-buffered batching** - events are written into one buffer while a second is being shipped, so collection and delivery never block each other.
- **Persistence-first** - every batch is written to disk before any network attempt, so a crash or a dropped connection never loses data.
- **Single-threaded and predictable** - delivery runs on an async send loop scheduled off the render path (JavaScript is single-threaded - there are no background threads to reason about), with bounded batch sizes and a disk cap.

## Contents

**Start here**

- [Getting Started](getting-started.md) - install, initialise, and report your first events
- [Configuration](configuration.md) - every `init` option
- [Automatic Tracking](automatic-tracking.md) - what is captured with no extra code
- [Event Types](event-types.md) - the full map of events

**Reporting events**

- [Windows and Buttons](windows.md) - button clicks, windows, and popups
- [In-App Purchases](in-app-purchases.md) - purchases and granted items
- [Ad Revenue](ad-revenue.md) - ad offers, revenue, and rewarded items
- [Subscription Revenue](subscription-revenue.md) - recurring revenue and perks
- [Item Economy](item-economy.md) - exchanges and inventory resets
- [Tutorial Tracking](onboarding.md) - onboarding milestones
- [A/B Tests](ab-testing.md) - experiment group assignment
- [Marketing Campaign](install-campaign.md) - install attribution and game language
- [Custom Events](custom-events.md) - your own typed events
- [Codegen Reference](codegen.md) - the custom-events CLI

**Data and operations**

- [Data Privacy](privacy.md) - the consent gate and what is stored on device
- [Offline Analytics](offline.md) - no-loss offline behaviour
- [Data Format](data-format.md) - the binary wire format

**Integration**

- [Example Integration](example-integration.md) - a step-by-step walkthrough
- [Integration Testing](integration-testing.md) - verify it works
- [Existing App Integration](existing-app-integration.md) - add it to a shipped game

**Contributing**

- [Development](development.md) - build and test the SDK locally

## Packages

The repo is a monorepo. You install one runtime package; the rest come transitively.

| Package | Purpose |
|---|---|
| `@keewano/react-native-sdk` | Bare React Native SDK. |
| `@keewano/react-native-expo-sdk` | Expo SDK - re-exports the bare RN API plus Expo adapters. |
| `@keewano/core` | Platform-agnostic core. Installed transitively; you never add it directly. |
| `@keewano/codegen` | Optional build-time CLI for [custom events](codegen.md). |

```bash
# Expo
npm install @keewano/react-native-expo-sdk

# Bare React Native
npm install @keewano/react-native-sdk react-native-fs
```

For typed custom events, also add the codegen tool: `npm install --save-dev @keewano/codegen`. See [Getting Started](getting-started.md) for the full setup.
