[Back to overview](README.md)

# Custom Events

When the built-in events are not enough, declare your own. Custom events are
type-safe: you describe them once, generate typed helpers, and the compiler keeps your
calls honest.

## The workflow

1. Declare each event with `@keewano/codegen`. `add` appends an entry to
   `keewano.events.json` in the directory you run it from, creating the file on first
   use; an event's id is 2500 plus its position in that file, so new events go at the end
   and existing ones are never reordered.
2. Run the generator with `--code` naming the directory the module goes in. It writes
   `keewano-events.generated.ts` there, exporting a `customEventSet` plus a typed helper
   per event.
3. Pass `customEventSet` to `init`, and call the generated helpers.

```bash
npx @keewano/codegen add GameScore --type uint
npx @keewano/codegen add GameOver --type none
npx @keewano/codegen --target expo --code src/analytics
```

Set `--target` to match your SDK: `react-native` (default), `expo`, `node`, or `web`. The
same tool generates Kotlin, Swift and Python from the same definitions. See the
[Codegen Reference](codegen.md) for the targets and the generated output, and for links
to the tool's own reference (definitions file, commands, options).

```typescript
import { Keewano } from '@keewano/react-native-expo-sdk';
import { customEventSet, reportGameScore, reportGameOver } from './src/analytics/keewano-events.generated';

Keewano.init({ apiKey: '...', customEventSet });

// later, fully typed:
reportGameScore(13050);
reportGameOver();
```

> [!IMPORTANT]
> The `customEventSet` you pass to `init` and the helpers you call must come from the
> same generated module. The SDK registers your schema with the backend once per
> session, so the server can decode the custom-event ids your app sends.
>
> Until that registration succeeds, **nothing is sent at all** - not even built-in
> events. Batches keep accumulating locally and ship once registration goes through, so
> a temporary failure costs no data; a permanently rejected schema stalls delivery for
> the whole session. If events stop arriving right after you add a `customEventSet`,
> check the console for a registration error.

## Value types

Each custom event carries one typed value. The first column is what `add --type` takes:

| `--type` | Type | Use for |
|---|---|---|
| `none` | None | a bare marker with no payload (e.g. `GameOver`) |
| `string` | String | text (e.g. a level name) |
| `uint` | UnsignedInt | a non-negative whole number (e.g. a score) |
| `bool` | Bool | a true / false flag |
| `timestamp` | Timestamp | a point in time |
| `ushortvec2` | UnsignedShortVec2 | a pair of small numbers (e.g. an `x, y` grid cell) |
| `price_usd_cent` | PriceInUSDCents | a price expressed in USD cents |

> [!IMPORTANT]
> Numeric custom-event payloads are range-checked, not clamped. A negative, fractional,
> or out-of-range value is refused (`0` to `4,294,967,295` for `UnsignedInt` and
> `PriceInUSDCents`, `0` to `65,535` for each component of `UnsignedShortVec2`). This is
> the opposite of the built-in reports, whose numbers are clamped into range. A refused
> value is logged with the event name and that one event is dropped, on every target; the
> call itself does not throw and the rest of the batch still ships. Round and bound the
> value before you report it.

## Reporting without the generated helpers

The generated helpers are the recommended path. If you need to emit by name (for
example from dynamic code), use `reportCustomEvent` - it resolves the name against the
`customEventSet` you passed to `init`.

```typescript
Keewano.reportCustomEvent({ name: 'GameScore', value: 13050 });
```

The same call accepts the event's wire id instead of the name: `{ id: 2500, value: 13050 }`.

> [!NOTE]
> `reportCustomEvent` no-ops with a logged reason if `init` got no `customEventSet`, or
> if the name or id is not in it. The typed helpers prevent both at compile time, which is
> why they are preferred.

---

Related: [Codegen Reference](codegen.md) | [Event Types](event-types.md) | [Configuration](configuration.md)
