/**
 * Contracts for the web identity value store: a synchronous string
 * key-value surface over the durability ladder (localStorage, then
 * first-party cookie, then in-memory). Identity deliberately does NOT
 * go through the `StorageAdapter` queue storage: IndexedDB can be
 * denied or evicted wholesale, and the install identity must degrade
 * independently of the event queue.
 */

/**
 * key - Store key to write.
 * value - String value to persist.
 * isValid - Optional read-back discriminator: a rung whose read-back
 *   differs from `value` is a concurrent writer's record (adopt it)
 *   only when it passes this predicate; a failing read-back is a
 *   stale value from an engine that silently dropped the write, so
 *   the rung is treated as failed. Absent -> any non-null read-back
 *   is adopted.
 */
interface SetValueArgs {
  key: string;
  value: string;
  isValid?: (value: string) => boolean;
}

/**
 * Synchronous key-value surface the identity layer persists through.
 *
 * get - Stored string, or `null` when absent on every rung. A hit
 *   below the top rung is promoted (written back) upward.
 * set - Persist best-effort on the highest rung whose write survives
 *   a read-back; never throws. Returns the value the ladder now
 *   holds: a concurrent writer that raced the read-back is adopted
 *   (last write wins) instead of clobbered; a stale read-back that
 *   fails `isValid` fails the rung instead (see {@link SetValueArgs}).
 * delete - Remove the key from EVERY rung so a wipe cannot resurrect
 *   from a lower rung. Best-effort; never throws.
 */
interface WebValueStore {
  get(key: string): string | null;
  set(args: SetValueArgs): string;
  delete(key: string): void;
}

/**
 * One rung of the durability ladder, ordered most-durable-first.
 * No method throws.
 *
 * durable - `false` only for the in-memory last resort; a set landing
 *   there warns once per store (the value will not survive the page).
 * get - Stored string, or `null` when absent or the read failed.
 * set - Write and return the raw read-back. `null` means the rung did
 *   not persist (threw, dropped an empty slot, or refused); the
 *   ladder layer compares a non-null read-back against the written
 *   value to tell verified / adopted / stale apart.
 * delete - Remove the key; missing keys and denied removals are
 *   silent.
 */
interface LadderRung {
  durable: boolean;
  get(key: string): string | null;
  set(args: SetValueArgs): string | null;
  delete(key: string): void;
}

/**
 * key - Store key to write.
 * value - String value to persist.
 * isValid - Read-back discriminator forwarded from the `set` caller;
 *   see {@link SetValueArgs}.
 * limit - Exclusive upper rung index: only rungs in `[0, limit)` are
 *   attempted. `rungs.length` for a full-ladder set; a hit's own
 *   index for a promotion write.
 */
interface SetThroughLadderArgs {
  key: string;
  value: string;
  isValid?: (value: string) => boolean;
  limit: number;
}

/**
 * Where a ladder write landed.
 *
 * stored - The rung's read-back value (the adoption point).
 * rung - The rung that accepted the write.
 */
interface LadderWriteResult {
  stored: string;
  rung: LadderRung;
}

/**
 * Minimal `window.localStorage` surface, injectable in tests.
 *
 * getItem - Return the stored string, or `null` when absent.
 * setItem - Persist the string; throws when storage is denied/full.
 * removeItem - Remove the key; missing keys are a no-op.
 */
interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Minimal `document.cookie` accessor pair, injectable in tests.
 *
 * read - Return the current cookie string (`document.cookie` form).
 * write - Append/overwrite one cookie via an assignment string.
 */
interface CookieJarLike {
  read(): string;
  write(cookie: string): void;
}

/**
 * secure - Whether to append the `Secure` cookie attribute.
 * maxAgeSeconds - `Max-Age` lifetime for the cookie.
 */
interface CookieAttributesArgs {
  secure: boolean;
  maxAgeSeconds: number;
}

/**
 * jar - Cookie accessor to write through.
 * secure - Whether the page is served over `https:` (adds `Secure`).
 */
interface CookieRungArgs {
  jar: CookieJarLike;
  secure: boolean;
}

/**
 * jar - Cookie accessor to read from.
 * name - Encoded cookie name, exactly as it appears in the jar.
 */
interface ReadCookieValueArgs {
  jar: CookieJarLike;
  name: string;
}

/**
 * key - Ladder key (unencoded).
 * secure - Whether the page is served over `https:`, which decides
 *   whether the hardened `__Host-` prefix can be used at all.
 */
interface CookieNameArgs {
  key: string;
  secure: boolean;
}

/**
 * Args bag for `createWebValueStore`.
 *
 * localStorage - `localStorage` surface override. Defaults to
 *   `globalThis.localStorage`; pass `null` to model a missing API.
 * cookieJar - Cookie accessor override. Defaults to a
 *   `document.cookie` wrapper; pass `null` for a cookie-less
 *   environment.
 * secure - Whether cookies get the `Secure` attribute. Defaults to
 *   `location.protocol === 'https:'` - NOT `isSecureContext`, which
 *   is also true on plain-http localhost where some browsers refuse
 *   `Secure` cookies.
 */
interface CreateWebValueStoreArgs {
  localStorage?: WebStorageLike | null;
  cookieJar?: CookieJarLike | null;
  secure?: boolean;
}

export type {
  CookieAttributesArgs,
  CookieJarLike,
  CookieNameArgs,
  CookieRungArgs,
  CreateWebValueStoreArgs,
  LadderRung,
  LadderWriteResult,
  ReadCookieValueArgs,
  SetThroughLadderArgs,
  SetValueArgs,
  WebStorageLike,
  WebValueStore,
};
