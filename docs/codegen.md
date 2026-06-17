[Back to overview](README.md)

# Codegen Reference

`@keewano/codegen` is the build-time CLI that turns your custom-event definitions into a
typed module. This is the full reference; for the quick workflow see
[Custom Events](custom-events.md).

## Install

It is a build-time tool - install it as a dev dependency:

```bash
npm install --save-dev @keewano/codegen
```

## Workflow

1. Create a `keewano-custom-events/` directory next to your source.
2. Add one JSON file per event (`<EventName>.json`).
3. Run `npx keewano-codegen --input keewano-custom-events`.
4. Import the generated module and pass `customEventSet` to `Keewano.init`.

```typescript
import { Keewano } from '@keewano/react-native-sdk';
import { customEventSet, reportBestScore } from './keewano-custom-events/keewano-events.generated';

await Keewano.init({ apiKey: 'YOUR_API_KEY', customEventSet });

reportBestScore(12345); // typed wrapper; the name and payload shape come from the JSON
```

## Event JSON format

Each event lives in its own file. The filename basename must match the `n` field exactly.

```json
{
  "n": "BestScore",
  "t": 2
}
```

| Field | Type | Meaning |
|---|---|---|
| `n` | string | PascalCase event name. Regex `^[A-Z][A-Za-z0-9_]*$`. Max 128 characters. |
| `t` | integer | Payload type (see below). |

### Payload types

| `t` | Name | Generated wrapper |
|---|---|---|
| 0 | None | `report<Name>(): void` |
| 1 | String | `report<Name>(value: string): void` |
| 2 | UnsignedInt | `report<Name>(value: number): void` |
| 3 | Bool | `report<Name>(value: boolean): void` |
| 4 | Timestamp | `report<Name>(value: Date): void` |
| 5 | UnsignedShortVec2 | `report<Name>(value: { x: number; y: number }): void` |
| 6 | PriceInUSDCents | `report<Name>(value: number): void` |

## CLI flags

```
keewano-codegen --input <dir> [--output <file>] [--watch] [--help] [--version]
```

| Flag | Default | Meaning |
|---|---|---|
| `--input <dir>` | `./keewano-custom-events` | Directory holding the per-event JSON files. |
| `--output <file>` | `<input>/keewano-events.generated.ts` | Path to the generated TypeScript module. |
| `--watch` | off | Re-run on every change under `--input` (loads `chokidar` lazily). |
| `--help` | | Print usage and exit. |
| `--version` | | Print the codegen version and exit. |

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
  version: 0xabcd1234,
  eventCount: 1,
  gzipData: new Uint8Array([0x1f, 0x8b /* ... */]),
  events: [{ name: 'BestScore', type: 2 }],
};
```

By default the wrappers import from `@keewano/react-native-sdk`. Target the Expo package
(or a custom re-export) through the programmatic `emitGeneratedSource` API.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Emit succeeded, or the output was already up to date. |
| 1 | Validation error (malformed JSON, schema violation, duplicate name, basename mismatch, too many events). |
| 2 | I/O error (input directory missing / unreadable, or a write failed). |
| 3 | Internal error. |

---

Related: [Custom Events](custom-events.md) | [Event Types](event-types.md)
