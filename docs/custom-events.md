[Back to overview](README.md)

# Custom Events

When the built-in events are not enough, declare your own. Custom events are
type-safe: you describe them once, generate typed helpers, and the compiler keeps your
calls honest.

## The workflow

1. Declare your events in a `keewano-custom-events/` folder (one definition per event:
   a name and a value type).
2. Run the generator from `@keewano/codegen`. It produces a module that exports a
   `customEventSet` plus a typed helper per event.
3. Pass `customEventSet` to `init`, and call the generated helpers.

```bash
npx keewano-codegen --input keewano-custom-events --target expo
```

Set `--target` to match your SDK: `react-native` (default), `expo`, or `node`. See the
[Codegen Reference](codegen.md) for the event JSON format, payload types, CLI flags, and generated output.

```typescript
import { Keewano } from '@keewano/react-native-expo-sdk';
import { customEventSet, reportGameScore, reportGameOver } from '../keewano-custom-events/keewano-events.generated';

Keewano.init({ apiKey: '...', customEventSet });

// later, fully typed:
reportGameScore(13050);
reportGameOver();
```

> [!IMPORTANT]
> The `customEventSet` you pass to `init` and the helpers you call must come from the
> same generated module. The SDK registers your schema with the backend once per
> session, so the server can decode the custom-event ids your app sends.

## Value types

Each custom event carries one typed value. The available types:

| Type | Use for |
|---|---|
| None | a bare marker with no payload (e.g. `GameOver`) |
| String | text (e.g. a level name) |
| UnsignedInt | a non-negative whole number (e.g. a score) |
| Bool | a true / false flag |
| Timestamp | a point in time |
| UnsignedShortVec2 | a pair of small numbers (e.g. an `x, y` grid cell) |
| PriceInUSDCents | a price expressed in USD cents |

## Reporting without the generated helpers

The generated helpers are the recommended path. If you need to emit by name (for
example from dynamic code), use `reportCustomEvent` - it resolves the name against the
`customEventSet` you passed to `init`.

```typescript
Keewano.reportCustomEvent({ name: 'GameScore', value: 13050 });
```

> [!NOTE]
> `reportCustomEvent` no-ops with a logged reason if `init` got no `customEventSet`, or
> if the name is not in it. The typed helpers prevent both at compile time, which is
> why they are preferred.

---

Related: [Codegen Reference](codegen.md) | [Event Types](event-types.md) | [Configuration](configuration.md)
