/**
 * Runtime emission for host-declared custom events. The codegen tool
 * (`@keewano/codegen`) turns the `keewano.events.json` definitions file
 * into a `customEventSet` (passed to init) plus typed wrappers; those
 * wrappers call `reportCustomEvent` here, which resolves the event, by
 * name or wire id, to its id and payload type and emits through the
 * matching dispatcher overload.
 */

import type { CustomEventTypeValue, ResolvedCustomEvent } from '../events';
import type { KEventDispatcher } from '../dispatcher';
import type { ReportCustomEventArgs } from './types/customEvents';

import { CustomEventType, customEventIndexFor, isCustomEventId } from '../events';
import { runWhenReady, truncateString } from './reportHelpers';

const NEEDS_NAME_OR_ID = 'reportCustomEvent: needs a name or a numeric id';

/**
 * Emit one custom event onto the dispatcher using the overload that
 * matches its declared payload type. A value that does not match the
 * declaration reaches the dispatcher, which refuses it; the caller
 * turns that refusal into a dropped event rather than a throw.
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
    // UnsignedInt and PriceInUSDCents share the same uint32 LE payload
    // encoding; only their wire type tag (in the custom-event map) differs.
    case CustomEventType.UnsignedInt:
    case CustomEventType.PriceInUSDCents:
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
  }
}

/**
 * Emit a host-declared custom event. Resolves the event, by name or by
 * wire id, to its entry in the `customEventSet` passed to `Keewano.init`
 * (wire id and payload type), then emits via the matching dispatcher
 * overload. No-ops with a logged reason when init received no
 * `customEventSet` carrying `events`, or the event is not in it. Usually
 * called through the typed wrappers `@keewano/codegen` generates rather
 * than by hand.
 */
function reportCustomEvent(args: ReportCustomEventArgs): void {
  runWhenReady((runtime) => {
    const set = runtime.customEventSet;
    if (set?.events === undefined) {
      console.error('reportCustomEvent: init received no customEventSet events');
      return;
    }
    // A plain-JS caller can pass something that is not an object at all.
    if (typeof args !== 'object' || args === null) {
      console.error(NEEDS_NAME_OR_ID);
      return;
    }
    const index = customEventIndexFor(set);
    let def: ResolvedCustomEvent | undefined;
    if (typeof args.id === 'number') {
      def = index.byId.get(args.id);
      if (def === undefined) {
        console.error(`reportCustomEvent: unknown event id ${String(args.id)}`);
      }
    } else if (typeof args.name === 'string') {
      def = index.byName.get(args.name);
      if (def === undefined) {
        console.error(`reportCustomEvent: unknown event "${args.name}"`);
      }
    } else {
      console.error(NEEDS_NAME_OR_ID);
    }
    if (def === undefined) return;
    const { id: eventId, name, type } = def;
    const { value } = args;
    /**
     * An id below the custom range is a built-in event's number, and
     * nothing downstream can tell the difference once the event is on
     * the wire - the payload would simply arrive as that built-in.
     */
    if (!isCustomEventId(eventId)) {
      console.error(
        `reportCustomEvent: "${name}" declares id ${String(eventId)}, which is not a custom event id; event dropped.`,
      );
      return;
    }
    /**
     * Which payload shape is correct depends on the declaration, which
     * is runtime data, so `value` is typed as the union of all of them
     * and a call that compiles can still be wrong. This runs
     * synchronously inside whatever called it - a purchase handler, a
     * render - and every dispatcher overload validates before it writes
     * anything, so catching the refusal drops the one event and leaves
     * the batch exactly as it was. An analytics call is not worth a
     * crash.
     */
    try {
      emitByType(runtime.dispatcher, eventId, type, value);
    } catch (error: unknown) {
      console.error(`reportCustomEvent: "${name}" payload refused; event dropped.`, error);
    }
  });
}

export type {
  CustomEventValue,
  ReportCustomEventArgs,
  ReportCustomEventById,
  ReportCustomEventByName,
} from './types/customEvents';
export { reportCustomEvent };
