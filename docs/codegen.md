[Back to overview](README.md)

# Codegen Reference

`@keewano/codegen` is the build-time CLI that turns your custom-event definitions into a
typed module. This is the reference for the TypeScript targets; for the quick workflow see
[Custom Events](custom-events.md).

One tool serves every Keewano SDK - the same definitions also generate Kotlin, Swift and
Python. Those targets are documented with the tool itself; everything below applies to the
four TypeScript targets.

## Install

It is a build-time tool - install it as a dev dependency:

```bash
npm install --save-dev @keewano/codegen
```

It also ships as a standalone executable for Linux, macOS and Windows, which carries its
own runtime and needs no Node at all. Use that in a project that has no npm toolchain.

## Workflow

1. Create a `keewano-custom-events/` directory next to your source.
2. Declare each event with `npx keewano-codegen add <Name> --type <type>`.
3. Run `npx keewano-codegen --target <sdk>`.
4. Import the generated module and pass `customEventSet` to `Keewano.init`.

```typescript
import { Keewano } from '@keewano/react-native-sdk';
import { customEventSet, reportBestScore } from './keewano-custom-events/keewano-events.generated';

await Keewano.init({ apiKey: 'YOUR_API_KEY', customEventSet });

reportBestScore(12345); // typed wrapper; the name and payload shape come from the JSON
```

## Commands

The definition files are plain JSON and you may edit them by hand, but three commands do
the bookkeeping instead - allocating the id, keeping the filename and the `n` field in
step, and refusing a name that will not work:

```bash
npx keewano-codegen add BestScore --type uint
npx keewano-codegen edit BestScore --rename HighScore
npx keewano-codegen remove HighScore
```

`add` writes `<Name>.json` with the next id past the highest one in use, so a gap in the
middle of the range stays a gap. `--type` takes a wire name from the
[payload types](#payload-types) table.

`edit` renames the event and carries its id and payload type across: the id is what
recorded data was written under, and the payload type is what that data holds, so an event
that needs a different type is a different event.

All three refuse a name that is already taken, that would shadow a built-in `report*`
method, or that only collides once a target transforms it - `LevelUp` and `Level_Up` are
two names but one `report_level_up` in Python.

### Removing an event

`remove` is for an event that has **not shipped** - one added under the wrong name or the
wrong payload type and caught before a release.

Do not remove an event that reached users. Builds already installed keep reporting it for
as long as people run them, and the data you have collected is described by the very
definition you would be deleting. To retire one of those, stop calling it in your app code
and leave its definition in place: it costs one id out of 63036 and one generated wrapper
nobody calls.

The id of a removed event is not reserved anywhere. Removing an event from the middle of
the range leaves its id skipped, because `add` goes past the highest id still present.
Removing the **highest** event lowers that mark, so the next `add` takes its number again -
which is why `remove` prints the number it freed. To place an event on a chosen id
deliberately, `add <Name> --type <type> --id <n>`; only do that if nothing was ever
recorded under it.

## Event JSON format

Each event lives in its own file. The filename basename must match the `n` field exactly.

```json
{
  "id": 2500,
  "n": "BestScore",
  "t": 2
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | Wire event id, `2500`..`65535`. Written once and never moved. |
| `n` | string | PascalCase event name. Regex `^[A-Z][A-Za-z0-9_]*$`. Max 128 characters. |
| `t` | integer | Payload type (see below). |

The id is what identifies the event in a log and on the backend, so an event keeps it
whatever is added or removed around it, and the set may skip numbers. `add` picks it for
you; you only write it by hand when you mean to.

### Payload types

`add --type` takes the wire name; a definition file's `t` field takes the number.

| `t` | Wire name | Name | Generated wrapper |
|---|---|---|---|
| 0 | `none` | None | `report<Name>(): void` |
| 1 | `string` | String | `report<Name>(value: string): void` |
| 2 | `uint` | UnsignedInt | `report<Name>(value: number): void` |
| 3 | `bool` | Bool | `report<Name>(value: boolean): void` |
| 4 | `timestamp` | Timestamp | `report<Name>(value: Date): void` |
| 5 | `ushortvec2` | UnsignedShortVec2 | `report<Name>(value: { x: number; y: number }): void` |
| 6 | `price_usd_cent` | PriceInUSDCents | `report<Name>(value: number): void` |

> [!IMPORTANT]
> Numeric payloads are range-checked at report time, not clamped: `UnsignedInt` and
> `PriceInUSDCents` accept whole numbers in `[0, 4294967295]`, and each component of
> `UnsignedShortVec2` must be a whole number in `[0, 65535]`. Anything else is refused:
> the SDK logs the event name and the reason and drops that one event, on every target.
> The rest of the batch is unaffected, and the call does not throw into your code -
> an analytics call is not worth taking a screen down. Round and bound the value before
> you report it, and watch the console during development.

## CLI flags

```
keewano-codegen [--input <dir>] [--output <file>] [--target <sdk>] [--watch]
                [--json | --no-json] [--config <file>] [--help] [--version]
```

| Flag | Default | Meaning |
|---|---|---|
| `--input <dir>` | `./keewano-custom-events` | Directory holding the per-event JSON files. |
| `--output <file>` | `<input>/keewano-events.generated.ts` | Path to the generated TypeScript module. |
| `--target <sdk>` | `react-native` | SDK the module imports from and matches: `react-native`, `expo`, `node`, or `web`. |
| `--watch` | off | Re-run on every change under `--input`. |
| `--json` | off | Also write `keewano-events.json` next to the output: ids, names, types and the base64 map, for tooling that wants the set in readable form. |
| `--no-json` | | Do not write it, even if the settings file says so. |
| `--config <file>` | `./keewano.codegen.json` | Settings file, may be absent; flags override it. |
| `--help` | | Print usage and exit. |
| `--version` | | Print the codegen version and exit. |

`add`, `edit` and `remove` take `--input` and `--config` too, and read the same settings
file, so a project configured once is configured for every command.

> [!NOTE]
> The generator is idempotent: if the parsed input would produce the same source the
> output already has, the run exits without rewriting the file.

## Generated output

The output is a single `.generated.ts` module that exports one typed `report<Name>`
wrapper per event plus a `customEventSet` literal - the gzipped schema bytes, its
FNV-1a 32-bit `version` stamp, and the event list the runtime resolves names against.

```typescript
import type { CustomEventSet } from '@keewano/react-native-sdk';
import { Keewano } from '@keewano/react-native-sdk';

export function reportBestScore(value: number): void {
  Keewano.reportCustomEvent({ name: 'BestScore', value });
}

export const customEventSet: CustomEventSet = {
  version: 0xABCD1234,
  eventCount: 1,
  gzipData: new Uint8Array([0x1F, 0x8B /* ... */]),
  events: [{ id: 2500, name: 'BestScore', type: 2 }],
};
```

Each entry carries its own id rather than leaving the runtime to count positions, so a set
that skips a number still reports and registers every event under the id it was declared
with. A module generated before ids were emitted has none, and the runtime falls back to
`2500 + position` for it - which is how those modules were numbered.

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
Every payload type in the table above registers over that API. Registration gates all
delivery, so a rejected schema stops the whole session - see
[Custom Events](custom-events.md).

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
import { customEventSet, reportBestScore } from './keewano-custom-events/keewano-events.generated';

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

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Emit succeeded, or the output was already up to date. |
| 1 | Validation error (malformed JSON, schema violation, duplicate name or id, basename mismatch, too many events). |
| 2 | I/O error (input directory missing / unreadable, or a write failed). |
| 3 | Internal error. |

---

Related: [Custom Events](custom-events.md) | [Event Types](event-types.md)
