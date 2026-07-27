# @keewano/node-sdk

Keewano analytics SDK for Node.js services and processes. Built on `@keewano/core`; it reuses the same wire-compatible engine as the React Native SDK, with no React or React Native dependencies.

## Documentation

See the [Node.js guide](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/nodejs.md) and the [documentation index](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/README.md).

## Installation

```bash
npm install @keewano/node-sdk
```

Requires Node.js >= 20 (built-in global `fetch`).

## Relay model

The Node SDK runs as a relay: one server process reports analytics on behalf of many end users. It keeps no identity of its own.

- User id: required. Every batch is attributed to a specific end user through `reportUserBatch({ userId, build })`, where `userId` is a UUID string or a numeric (up to 64-bit) `bigint`. Events with no user have nowhere to land, so a missing or all-zero user id is rejected.
- Install id: the project id. A device SDK uses a per-device install id to track an anonymous user until the real user id is known, which never happens on a server where the user id is always supplied. A relay has no per-device id, so it sends the project id from the API key (a stable, backend-known value) as the install id; override it with `installId` if you need to.
- Data session id: one per `Keewano.init(...)`, shared by every batch the process ships.
- No consent gate, no environment burst, no crash hook: a relay reports only what the host emits per user, not the process's own telemetry.

## Usage

```ts
import { Keewano } from '@keewano/node-sdk';

await Keewano.init({ apiKey: 'YOUR_API_KEY' });

await Keewano.reportUserBatch({
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  build: (user) => {
    user.reportInstallCampaign('summer_promo');
    user.reportInAppPurchase({ productName: 'gold_pack', price: { priceUsdCents: 499 } });
  },
});

await Keewano.shutdown();
```

The `build` callback runs synchronously and receives a reporter scoped to that one user's batch. Using the reporter after `build` returns, or from an `async` build, throws instead of attributing events to the wrong user.

The surface is `init`, `shutdown`, `isReady`, and `reportUserBatch`. Versus the React Native SDK: relay-only (not single-user), no UI tracking, a project-level (not per-device) install id, Node 20+, file-system storage.

## License

MIT
