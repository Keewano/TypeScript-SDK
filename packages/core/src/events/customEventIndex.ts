/**
 * Name and id lookups of a set, built once per set object.
 *
 * The memo is keyed by the set object: a runtime installed per batch
 * around the same set (the Node relay does this) finds the index
 * already built instead of scanning the set again.
 */

import type { CustomEventSet } from '../network/types/customEventSet';
import type { CustomEventIndex, ResolvedCustomEvent } from './types/customEventIndex';

import { customEventIdAt } from './customEventId';

const indexes = new WeakMap<CustomEventSet, CustomEventIndex>();

function buildCustomEventIndex(set: CustomEventSet): CustomEventIndex {
  const byName = new Map<string, ResolvedCustomEvent>();
  const byId = new Map<number, ResolvedCustomEvent>();
  for (const [index, def] of (set.events ?? []).entries()) {
    const resolved: ResolvedCustomEvent = {
      id: customEventIdAt({ declaredId: def.id, index }),
      name: def.name,
      type: def.type,
    };
    if (!byName.has(resolved.name)) byName.set(resolved.name, resolved);
    if (!byId.has(resolved.id)) byId.set(resolved.id, resolved);
  }
  return { byName, byId };
}

function customEventIndexFor(set: CustomEventSet): CustomEventIndex {
  const cached = indexes.get(set);
  if (cached !== undefined) return cached;
  const built = buildCustomEventIndex(set);
  indexes.set(set, built);
  return built;
}

export { customEventIndexFor };
