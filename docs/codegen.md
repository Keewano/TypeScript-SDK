[Back to overview](README.md)

# Codegen Reference

`@keewano/codegen` is the build-time CLI that turns your custom-event definitions into a
typed module. This page covers what is specific to the TypeScript SDKs: how the generated
module plugs into `init` and how the four TypeScript targets differ. The tool itself - its
definitions file, commands, options and exit codes - is documented in its own
[README](https://github.com/Keewano/keewano-codegen#readme), linked from the
[Reference](#reference) section below. For the quick workflow see
[Custom Events](custom-events.md).

One tool serves every Keewano SDK - the same definitions also generate Kotlin, Swift and
Python. Those targets are documented with the tool; everything below applies to the four
TypeScript targets.

## Install

It is a build-time tool - install it as a dev dependency:

```bash
npm install --save-dev @keewano/codegen
```

## Workflow

1. Declare each event with `npx @keewano/codegen add <Name> --type <type>`. The first `add`
   creates `keewano.events.json` in the directory you run it from (`--input` places it
   elsewhere); later ones append to it.
2. Run `npx @keewano/codegen --target <sdk> --code <dir>`. `--code` is required: it names
   the directory the generated module is written into, and the file is always
   `keewano-events.generated.ts`.
3. Import the generated module and pass its `customEventSet` to `Keewano.init`.

```bash
npx @keewano/codegen add BestScore --type uint
npx @keewano/codegen --target react-native --code src/analytics
```

```typescript
import { Keewano } from '@keewano/react-native-sdk';
import { customEventSet, reportBestScore } from './src/analytics/keewano-events.generated';

await Keewano.init({ apiKey: 'YOUR_API_KEY', customEventSet });

reportBestScore(12345); // typed wrapper; the name and payload shape come from the definitions file
```

## Targets

`--target` selects which SDK the generated module imports from and matches its report API.
The `customEventSet` data is identical across targets; only the imports and wrapper
signatures differ.

| `--target` | Imports from | Wrapper shape |
|---|---|---|
| `react-native` (default) | `@keewano/react-native-sdk` | `report<Name>(value)` calls `Keewano.reportCustomEvent(...)` |
| `expo` | `@keewano/react-native-expo-sdk` | same top-level `Keewano` call |
| `node` | `@keewano/node-sdk` | `report<Name>(reporter, value)` calls `reporter.reportCustomEvent(...)` |
| `web` | `@keewano/web-sdk` | same top-level `Keewano` call |

On `web` the schema is registered over the JSON ingestion API using the readable
`events` list rather than the gzip blob, so the registration wire shape differs from
the device and Node.js SDKs even though the generated `customEventSet` is identical.
Every payload type registers over that API. Registration gates all delivery, so a
rejected schema stops the whole session - see [Custom Events](custom-events.md).

On the Node relay, events are emitted through the per-batch reporter, so each wrapper takes
a `UserReporter` as its first argument:

```typescript
import type { CustomEventSet, UserReporter } from '@keewano/node-sdk';

export function reportBestScore(reporter: UserReporter, value: number): void {
  reporter.reportCustomEvent({ name: 'BestScore', value });
}
```

Use it inside a `reportUserBatch` build callback:

```typescript
import { Keewano } from '@keewano/node-sdk';
import { customEventSet, reportBestScore } from './src/analytics/keewano-events.generated';

await Keewano.init({ apiKey: 'YOUR_API_KEY', dataDir: '/var/lib/my-service/keewano', customEventSet });
await Keewano.reportUserBatch({
  userId,
  build: (user) => reportBestScore(user, 12345),
});
```

On web, typed custom events require the npm integration: the generated module is produced
by a build-time CLI, so a site integrated through the script snippet alone (no build step)
has no way to ship a `customEventSet`. Without a set configured in `init`,
`reportCustomEvent` calls log a reason and are dropped.

## Generated output

The output is a single `keewano-events.generated.ts` module that exports one typed
`report<Name>` wrapper per event plus a `customEventSet` literal - the gzipped schema
bytes, its FNV-1a 32-bit `version` stamp, and the event list the runtime resolves names
against. The wrapper's parameter follows the payload type: `string`, `number`, `boolean`,
`Date`, `{ x: number; y: number }`, or no parameter at all for a payload-less event.

```typescript
import type { CustomEventSet } from '@keewano/react-native-sdk';

import { Keewano } from '@keewano/react-native-sdk';

export function reportBestScore(value: number): void {
  Keewano.reportCustomEvent({ name: 'BestScore', value });
}

export function reportGameOver(): void {
  Keewano.reportCustomEvent({ name: 'GameOver' });
}

export const customEventSet: CustomEventSet = {
  version: 0xABCD1234,
  eventCount: 2,
  gzipData: new Uint8Array([0x1F, 0x8B /* ... */]),
  events: [
    { id: 2500, name: 'BestScore', type: 2 },
    { id: 2501, name: 'GameOver', type: 0 },
  ],
};
```

An event's id is 2500 plus its position in the definitions file, so the ids are
contiguous - which is why new events go at the end and existing ones are never reordered.
Each entry still carries its `id` explicitly. A module generated before that field existed
has none, and the runtime falls back to `2500 + position` for it, which yields the same
numbers.

> [!IMPORTANT]
> Numeric payloads are range-checked at report time, not clamped: `UnsignedInt` and
> `PriceInUSDCents` accept whole numbers in `[0, 4294967295]`, and each component of
> `UnsignedShortVec2` must be a whole number in `[0, 65535]`. Anything else is refused:
> the SDK logs the event name and the reason and drops that one event, on every target.
> The rest of the batch is unaffected, and the call does not throw into your code -
> an analytics call is not worth taking a screen down. Round and bound the value before
> you report it, and watch the console during development.

## Reference

The CLI is documented with the tool, in the
[`@keewano/codegen` README](https://github.com/Keewano/keewano-codegen#readme):

- [Definitions file and payload types](https://github.com/Keewano/keewano-codegen#quick-start) -
  the `keewano.events.json` format and the wire names `--type` accepts.
- [Commands](https://github.com/Keewano/keewano-codegen#commands) - `add`, `edit`, `remove`.
- [Options](https://github.com/Keewano/keewano-codegen#options) - every flag, the
  `keewano.codegen.json` settings file, and the exit codes.
- [The readable manifest (`--json`)](https://github.com/Keewano/keewano-codegen#the-readable-manifest---json) -
  the human-readable copy of the set, for tooling.
- [The frozen contract](https://github.com/Keewano/keewano-codegen#the-frozen-contract) -
  how the set's `version` stamp is computed, identically on every platform.

---

Related: [Custom Events](custom-events.md) | [Event Types](event-types.md)
