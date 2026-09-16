# Keewano TypeScript SDK

Lightweight behavioural analytics for Keewano AI Analyst. These guides cover the React
Native, Expo, Node.js, and browser SDKs, all built on one platform-agnostic core.

## Overview

The SDK collects behavioural telemetry - taps, screens, in-app purchases, ad
revenue, errors - and ships it to the Keewano backend. Most of it is tracked
automatically after a single `init` call; anything game-specific you report
through a small manual API or your own typed custom events. One backend ingests
data from all of them: the device and Node.js SDKs ship the compact binary
format, the browser SDK the equivalent JSON envelope over the same ingress.

## Key features

- **Effortless integration** - install one package and call `Keewano.init({ apiKey })`. Automatic tracking starts immediately.
- **Automatic event tracking** - app lifecycle, button taps, deep links, and errors are captured with no extra code; screen tracking is one opt-in hook away. Manual and custom events are opt-in on top.
- **Minimalistic** - no schemas to maintain; the common events fire automatically and custom events are an opt-in extra, not a requirement.
- **Compact binary format** - events are encoded as compact binary (variable-length integers, packed records), not JSON, so there is no serialization overhead on the wire; the browser SDK sends the equivalent JSON envelope.
- **Non-blocking by design** - events accumulate in memory and are flushed by a background async loop off the render path, double-buffered so collection and delivery never block each other.
- **Persistence-first** - every batch is written to local storage before any network attempt, so a crash or a dropped connection does not lose what has already been persisted.
- **Lean footprint** - pure TypeScript, no native code, and no heavy third-party dependencies; it relies only on the platform's own storage.

## Contents

**Start here**

- [Getting Started](getting-started.md) - install, initialise, and report your first events
- [Configuration](configuration.md) - every `init` option
- [Automatic Tracking](automatic-tracking.md) - what is captured with no extra code
- [Event Types](event-types.md) - the full map of events

**Browser**

- [Browser (Web SDK)](web.md) - install, initialise, and run the SDK on a website

**Server**

- [Node.js (Server Relay)](nodejs.md) - report analytics from a backend on behalf of many users

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

- [Data Privacy](privacy.md) - what is collected, the consent gate, and what is stored locally
- [Offline Analytics](offline.md) - offline queuing, retry, and browser delivery
- [Data Format](data-format.md) - the wire format

**Integration**

- [Example Integration](example-integration.md) - a step-by-step walkthrough
- [Integration Testing](integration-testing.md) - verify it works
- [Existing App Integration](existing-app-integration.md) - add it to a shipped game
  (React Native and Expo)

**Contributing**

- [Development](development.md) - build and test the SDK locally

## Packages

The repo is a monorepo. You install one runtime package; the rest come transitively.

| Package                          | Purpose                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@keewano/react-native-sdk`      | Bare React Native SDK.                                                                           |
| `@keewano/react-native-expo-sdk` | Expo SDK - re-exports the bare RN API plus Expo adapters.                                        |
| `@keewano/node-sdk`              | Node.js server relay SDK. Reports for many end users from one process. See [Node.js](nodejs.md). |
| `@keewano/core`                  | Platform-agnostic core. Installed transitively; you never add it directly.                       |
| `@keewano/codegen`               | Optional build-time CLI for [custom events](codegen.md). Ships from its own repository, because one tool serves every Keewano SDK. |
| `@keewano/web-sdk`               | Browser SDK - npm package or CDN snippet. See [Browser (Web SDK)](web.md).                        |

```bash
# Expo
npm install @keewano/react-native-expo-sdk

# Bare React Native
npm install @keewano/react-native-sdk react-native-fs

# Node.js (server)
npm install @keewano/node-sdk

# Browser
npm install @keewano/web-sdk
```

For typed custom events, also add the codegen tool: `npm install --save-dev @keewano/codegen`. See [Getting Started](getting-started.md) for the full setup.
