import type { CustomEventTypeValue } from '../customEventType';

/**
 * One entry of a set with its wire id resolved.
 *
 * id - the wire id the entry reports under, declared or by position.
 * name - the event's name exactly as declared.
 * type - payload shape; picks the dispatcher overload.
 */
interface ResolvedCustomEvent {
  id: number;
  name: string;
  type: CustomEventTypeValue;
}

/**
 * Both lookups of one set.
 *
 * byName - every entry keyed by its declared name.
 * byId - every entry keyed by its resolved wire id.
 */
interface CustomEventIndex {
  byName: ReadonlyMap<string, ResolvedCustomEvent>;
  byId: ReadonlyMap<number, ResolvedCustomEvent>;
}

export type { CustomEventIndex, ResolvedCustomEvent };
