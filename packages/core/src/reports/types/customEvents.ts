/**
 * Payload value for a custom event. The concrete shape required
 * depends on the event's declared `CustomEventType`:
 *   String -> string; UnsignedInt / PriceInUSDCents -> number;
 *   Timestamp -> Date or Unix-seconds number; Bool -> boolean;
 *   UnsignedShortVec2 -> { x, y }; None -> omit the value.
 */
type CustomEventValue = string | number | boolean | Date | { x: number; y: number };

/**
 * Args for `reportCustomEvent` naming the event.
 *
 * name - The custom event name as declared in the `customEventSet`
 *   passed to `Keewano.init`.
 * id - never; use `ReportCustomEventById` to report by wire id.
 * value - Payload matching the event's declared type; omit for a
 *   `None`-typed event.
 */
interface ReportCustomEventByName {
  name: string;
  id?: never;
  value?: CustomEventValue;
}

/**
 * Args for `reportCustomEvent` carrying the event's wire id.
 *
 * id - The wire id the generated module carries for the event.
 * name - never; use `ReportCustomEventByName` to report by name.
 * value - Payload matching the event's declared type; omit for a
 *   `None`-typed event.
 */
interface ReportCustomEventById {
  id: number;
  name?: never;
  value?: CustomEventValue;
}

/**
 * Args for `reportCustomEvent`: the event's name or its wire id, plus
 * the payload.
 */
type ReportCustomEventArgs = ReportCustomEventByName | ReportCustomEventById;

export type {
  CustomEventValue,
  ReportCustomEventArgs,
  ReportCustomEventById,
  ReportCustomEventByName,
};
