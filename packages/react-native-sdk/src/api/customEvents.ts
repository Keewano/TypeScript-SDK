/**
 * Runtime emission for host-declared custom events. The codegen tool
 * (`@keewano/codegen`) turns a `keewano-custom-events/` folder into a
 * `customEventSet` (passed to init) plus typed wrappers; those wrappers
 * call `reportCustomEvent` here, which resolves the event name to its
 * wire id and payload type and emits through the matching dispatcher
 * overload.
 */

import type { CustomEventTypeValue, KEventDispatcher } from '@keewano/core';
import type { ReportCustomEventArgs } from './types/customEvents';

import { CustomEventType } from '@keewano/core';

import { runWhenReady, truncateString } from './reportHelpers';

/** First wire id assigned to custom events; the Nth declared event is 2500 + N. */
const CUSTOM_EVENT_BASE = 2500;

/**
 * Emit one custom event onto the dispatcher using the overload that
 * matches its declared payload type. A value whose runtime type does
 * not match the declaration surfaces as the dispatcher's own
 * TypeError / RangeError - the typed codegen wrappers prevent that at
 * compile time, so a mismatch only reaches here from an untyped (raw)
 * call, which is the host's risk to take.
 */
function emitByType(
  dispatcher: KEventDispatcher,
  eventId: number,
  type: CustomEventTypeValue,
  value: unknown,
): void {
  switch (type) {
    case CustomEventType.None:
      dispatcher.addEvent(eventId);
      return;
    case CustomEventType.String:
      dispatcher.addEventString({
        eventId,
        str: typeof value === 'string' ? truncateString(value) : (value as string),
      });
      return;
    case CustomEventType.UnsignedInt:
      dispatcher.addEventUint32({ eventId, value: value as number });
      return;
    case CustomEventType.Bool:
      dispatcher.addEventBool({ eventId, flag: value as boolean });
      return;
    case CustomEventType.Timestamp:
      dispatcher.addEventDateTime({
        eventId,
        date: value instanceof Date ? Math.floor(value.getTime() / 1000) : (value as number),
      });
      return;
    case CustomEventType.UnsignedShortVec2: {
      const vec = value as { x: number; y: number };
      dispatcher.addEventUint16x2({ eventId, x: vec.x, y: vec.y });
      return;
    }
    case CustomEventType.PriceInUSDCents:
      dispatcher.addEventInt32({ eventId, value: value as number });
      return;
  }
}

/**
 * Emit a host-declared custom event. Resolves the name to its wire id
 * (`2500 + declaration index`) and payload type from the
 * `customEventSet` passed to `Keewano.init`, then emits via the
 * matching dispatcher overload. No-ops with a logged reason when init
 * received no `customEventSet` carrying `events`, or the name is not in
 * it. Usually called through the typed wrappers `@keewano/codegen`
 * generates rather than by hand.
 */
function reportCustomEvent({ name, value }: ReportCustomEventArgs): void {
  runWhenReady((runtime) => {
    const events = runtime.customEventSet?.events;
    if (events === undefined) {
      console.error('reportCustomEvent: init received no customEventSet events');
      return;
    }
    const index = events.findIndex((event) => event.name === name);
    if (index < 0) {
      console.error(`reportCustomEvent: unknown event "${name}"`);
      return;
    }
    const def = events[index];
    if (def === undefined) return;
    emitByType(runtime.dispatcher, CUSTOM_EVENT_BASE + index, def.type, value);
  });
}

export type { CustomEventValue, ReportCustomEventArgs } from './types/customEvents';
export { reportCustomEvent };
