/**
 * The wire id of one entry in a generated set.
 *
 * The generator assigns each event's id from its position in the
 * definitions file - the first event gets the custom-event base - and
 * carries it per entry in the generated module; `remove` renumbers
 * every later event, so a generated set is contiguous.
 *
 * The position is still the answer for a set generated before the id
 * was carried in readable form. Those were emitted from a list whose
 * ids were the positions, so the fallback reproduces exactly what the
 * generator meant at the time.
 */

import type {
  CustomEventIdArgs,
  CustomEventIdCollision,
  CustomEventIdEntry,
} from './types/customEventId';

import { CUSTOM_EVENT_BASE } from './customEventType';

function customEventIdAt({ declaredId, index }: CustomEventIdArgs): number {
  return declaredId ?? CUSTOM_EVENT_BASE + index;
}

/**
 * Two entries of a set that would report under one id, if any do.
 *
 * The id is optional per ENTRY, not per set, so a set may declare some
 * and leave the rest to their position - and a position can land on a
 * number another entry declares. Both then resolve to it: the map the
 * backend is given keeps whichever came last, and every event of the
 * other arrives named as that one. Nothing later can notice, because
 * the report path resolves through the same rule, so the SDK and the
 * server agree exactly on the wrong mapping.
 *
 * @returns The first shared id and the two names that reached it, or
 *   null when every entry resolves to an id of its own.
 */
function findCustomEventIdCollision(
  events: ReadonlyArray<CustomEventIdEntry>,
): CustomEventIdCollision | null {
  const owner = new Map<number, string>();
  for (const [index, def] of events.entries()) {
    const id = customEventIdAt({ declaredId: def.id, index });
    const first = owner.get(id);
    if (first !== undefined) return { id, names: [first, def.name] };
    owner.set(id, def.name);
  }
  return null;
}

export { customEventIdAt, findCustomEventIdCollision };
