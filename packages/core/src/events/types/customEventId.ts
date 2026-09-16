/**
 * Arguments of `customEventIdAt`.
 *
 * declaredId - the id the generated set carries for this entry, when it
 *   carries one. A file emitted before the field existed does not.
 * index - the entry's position in the set, used only as the fallback.
 */
interface CustomEventIdArgs {
  declaredId?: number | undefined;
  index: number;
}

/**
 * One entry of a set, as resolving its id needs to see it.
 *
 * id - the id this entry carries, when it carries one.
 * name - the event's name, used only to say which entries collided.
 */
interface CustomEventIdEntry {
  id?: number | undefined;
  name: string;
}

/**
 * Two entries of one set that resolve to the same id.
 *
 * id - the id they share.
 * names - the two entries that reached it, in set order.
 */
interface CustomEventIdCollision {
  id: number;
  names: readonly [string, string];
}

export type { CustomEventIdArgs, CustomEventIdCollision, CustomEventIdEntry };
