/**
 * Payload value for a custom event. The concrete shape required
 * depends on the event's declared `CustomEventType`:
 *   String -> string; UnsignedInt / PriceInUSDCents -> number;
 *   Timestamp -> Date or Unix-seconds number; Bool -> boolean;
 *   UnsignedShortVec2 -> { x, y }; None -> omit the value.
 */
type CustomEventValue = string | number | boolean | Date | { x: number; y: number };

/**
 * Args for `reportCustomEvent`.
 *
 * name - The custom event name as declared in the `customEventSet`
 *   passed to `Keewano.init`.
 * value - Payload matching the event's declared type; omit for a
 *   `None`-typed event.
 */
interface ReportCustomEventArgs {
  name: string;
  value?: CustomEventValue;
}

export type { CustomEventValue, ReportCustomEventArgs };
