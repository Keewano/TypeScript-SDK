# @keewano/codegen

Custom-events code generator for the Keewano SDK. Turns per-event JSON
definitions into a type-safe TypeScript module that plugs straight into
`Keewano.init({ customEventSet })`.

> Alpha. The generate-then-register-then-emit pipeline works end-to-end;
> APIs may still change before 1.0.

## Install

This package is a build-time tool, install it as a devDependency:

```bash
npm install --save-dev @keewano/codegen
```

You also need one of the platform packages to consume the generated
output at runtime:

- Bare React Native: `@keewano/react-native-sdk`
- Expo: `@keewano/react-native-expo-sdk`

## Workflow

1. Create a `keewano-custom-events/` directory next to your source.
2. Add one JSON file per event (`<EventName>.json`).
3. Run `npx keewano-codegen --input keewano-custom-events`.
4. Import the generated module and pass `customEventSet` to
   `Keewano.init`.

```ts
import { Keewano } from '@keewano/react-native-sdk';
import { customEventSet, reportBestScore } from './keewano-custom-events/keewano-events.generated';

await Keewano.init({ apiKey: 'YOUR_API_KEY', customEventSet });

// Typed wrapper; the name and payload shape come from the JSON:
reportBestScore(12345);
```

## Event JSON format

Each event lives in its own file. The filename basename must match the
declared `n` field exactly.

```json
{
  "n": "BestScore",
  "t": 2
}
```

| Field | Type    | Meaning                                                                   |
| ----- | ------- | ------------------------------------------------------------------------- |
| `n`   | string  | PascalCase event name. Regex: `^[A-Z][A-Za-z0-9_]*$`. Max 128 characters. |
| `t`   | integer | Payload type. See table below.                                            |

### Payload types

| `t` | Name              | Generated wrapper signature                           |
| --- | ----------------- | ----------------------------------------------------- |
| 0   | None              | `report<Name>(): void`                                |
| 1   | String            | `report<Name>(value: string): void`                   |
| 2   | UnsignedInt       | `report<Name>(value: number): void`                   |
| 3   | Bool              | `report<Name>(value: boolean): void`                  |
| 4   | Timestamp         | `report<Name>(value: Date): void`                     |
| 5   | UnsignedShortVec2 | `report<Name>(value: { x: number; y: number }): void` |
| 6   | PriceInUSDCents   | `report<Name>(value: number): void`                   |

## CLI flags

```
keewano-codegen --input <dir> [--output <file>] [--watch] [--help] [--version]
```

| Flag              | Default                               | Meaning                                                                                                                            |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--input <dir>`   | `./keewano-custom-events`             | Directory holding the per-event JSON files.                                                                                        |
| `--output <file>` | `<input>/keewano-events.generated.ts` | Path to the generated TypeScript module.                                                                                           |
| `--watch`         | off                                   | Re-run the parse-then-emit pipeline on every change under `--input`. Loads `chokidar` lazily; only required when `--watch` is set. |
| `--help`          |                                       | Print usage and exit 0.                                                                                                            |
| `--version`       |                                       | Print the codegen version and exit 0.                                                                                              |

The generator is idempotent: when the parsed input would produce the
same source the existing output already has, the run exits 0 without
rewriting the file.

## Generated output

The output file is a single `.generated.ts` module that

- imports `CustomEventSet` and `Keewano` from the SDK,
- exports one typed `report<Name>` wrapper per event that forwards to
  `Keewano.reportCustomEvent`,
- exports a `customEventSet` literal: the gzipped schema bytes plus the
  FNV-1a 32-bit `version` stamp the SDK registers with the server, and
  the `events` list the runtime resolves event names against.

```ts
import type { CustomEventSet } from '@keewano/react-native-sdk';

import { Keewano } from '@keewano/react-native-sdk';

export function reportBestScore(value: number): void {
  Keewano.reportCustomEvent({ name: 'BestScore', value });
}

export function reportGameStart(): void {
  Keewano.reportCustomEvent({ name: 'GameStart' });
}

export const customEventSet: CustomEventSet = {
  version: 0xabcd1234,
  eventCount: 2,
  gzipData: new Uint8Array([0x1f, 0x8b /* ... */]),
  events: [
    { name: 'BestScore', type: 2 },
    { name: 'GameStart', type: 0 },
  ],
};
```

By default the wrappers import from `@keewano/react-native-sdk`. Pass a
different module name through the programmatic `emitGeneratedSource` API
when you target the Expo package or a custom re-export.

## Exit codes

| Code | Meaning                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 0    | Emit succeeded, or the existing output was already up to date.                                           |
| 1    | Validation error (malformed JSON, schema violation, duplicate name, basename mismatch, too many events). |
| 2    | I/O error (input directory missing, unreadable, or a write failed).                                      |
| 3    | Internal error (unexpected throw out of the pipeline).                                                   |

## License

MIT
