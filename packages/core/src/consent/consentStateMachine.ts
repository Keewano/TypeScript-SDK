/**
 * Persistent state machine wrapping the read-only `consentGate`
 * decision function. Owns the on-disk file (`Keewano_UserConsent`,
 * 4 bytes uint32 LE) and the single transition rule:
 *
 *   Pending -> Granted   via setConsent({ granted: true })
 *   Pending -> Denied    via setConsent({ granted: false })
 *   any other state      no-op (terminal)
 *
 * State and transitions are deliberately separate from the gate
 * (`consentGate(state)`): the gate is pure and side-effect-free,
 * this module is the side-effect surface.
 */

import type { StorageAdapter } from '../storage';

import type { LoadOrInitConsentStateArgs, SetConsentArgs } from './types/consentStateMachine';

import { ConsentState } from './consentState';
import { CONSENT_FILE_SIZE, CONSENT_FILENAME } from './helpers/constants';

/**
 * Set of integer values that decode to a valid `ConsentState`
 * member. Used to discard a malformed on-disk byte that lies
 * outside the enum range.
 */
const VALID_STATE_VALUES: ReadonlySet<number> = new Set([
  ConsentState.NotRequired,
  ConsentState.Pending,
  ConsentState.Granted,
  ConsentState.Denied,
]);

/**
 * Args bag for the private `persistConsentState` helper.
 *
 * storage - Storage adapter backing the consent file.
 * state - Consent state to encode and persist.
 */
interface PersistConsentStateArgs {
  storage: StorageAdapter;
  state: ConsentState;
}

/**
 * Serialize a single `ConsentState` as 4 bytes little-endian and
 * persist it via the storage adapter.
 */
async function persistConsentState(args: PersistConsentStateArgs): Promise<void> {
  const { storage, state } = args;
  const bytes = new Uint8Array(CONSENT_FILE_SIZE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, state, true);
  await storage.writeFile({ path: CONSENT_FILENAME, bytes });
}

/**
 * Read the recorded consent state from disk without creating one, or
 * `null` when the file is missing, not exactly `CONSENT_FILE_SIZE`
 * bytes long, or carries a value outside the known `ConsentState`
 * enum range. The exact-size check matches the regulatory fail-closed
 * policy: a file of any other length is treated as corruption or as a
 * future schema, not as a partial read.
 *
 * {@link loadOrInitConsentState} is the boot path, and it writes an
 * initial record when none exists. An observer must not: a caller
 * that reacts to someone else's decision (another tab of the same
 * origin) has to be able to tell "no record" from a real value, or a
 * cleared store would look like a fresh install and silently undo a
 * withdrawal.
 *
 * Unqueued on purpose: a read that overlaps a transition returns
 * either the old or the new recorded value, and both are states the
 * caller may legitimately act on.
 */
async function readConsentState(storage: StorageAdapter): Promise<ConsentState | null> {
  return decodeConsentState(await storage.readFile({ path: CONSENT_FILENAME }));
}

/**
 * Decode the bytes of a consent file, applying the same fail-closed
 * rules {@link readConsentState} applies to a stored record.
 *
 * Separate from the read so a host whose storage can answer without
 * awaiting - a browser ladder backed by `localStorage` and cookies -
 * can consult the record from a context that cannot await one, such
 * as a page being torn down. The encoding then stays defined here
 * alone rather than being restated by every such caller.
 */
function decodeConsentState(bytes: Uint8Array | null): ConsentState | null {
  if (bytes?.length !== CONSENT_FILE_SIZE) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = view.getUint32(0, true);
  return VALID_STATE_VALUES.has(value) ? value : null;
}

/**
 * Per-storage chain of in-flight consent file operations. Both
 * `loadOrInitConsentState` and `setConsent` queue through the
 * same chain so a first-launch load cannot race with a transition
 * (and two concurrent loads cannot race with each other). The
 * `WeakMap` lets the entry GC alongside the storage adapter.
 */
const consentInFlight = new WeakMap<StorageAdapter, Promise<ConsentState>>();

/**
 * Args bag for `enqueueConsentOp`.
 *
 * storage - Storage adapter that owns the consent file. Identifies
 *   the queue.
 * fallback - State to substitute if the previous queued op threw.
 *   Lets a rejected predecessor not poison the chain.
 * op - The operation to run once the predecessor settles.
 */
interface EnqueueConsentOpArgs {
  storage: StorageAdapter;
  fallback: ConsentState;
  op: () => Promise<ConsentState>;
}

/**
 * Append `op` to the per-storage consent queue and return its
 * eventual result. The chain `previous.catch(() => fallback).then(op)`
 * guarantees `op` runs after any in-flight predecessor regardless of
 * whether the predecessor resolved or threw. The trailing `finally`
 * trims the WeakMap entry when this op is the most recent one, so
 * the next quiescent caller starts a fresh chain.
 */
function enqueueConsentOp(args: EnqueueConsentOpArgs): Promise<ConsentState> {
  const { storage, fallback, op } = args;
  const previous = consentInFlight.get(storage) ?? Promise.resolve(fallback);
  const nextPromise = previous.catch(() => fallback).then(() => op());
  consentInFlight.set(storage, nextPromise);
  return nextPromise.finally(() => {
    if (consentInFlight.get(storage) === nextPromise) {
      consentInFlight.delete(storage);
    }
  });
}

/**
 * Load the consent state from disk, or initialize a fresh one when
 * the file is missing, not exactly `CONSENT_FILE_SIZE` bytes long,
 * or carries a value that is not a known `ConsentState`. Init choice
 * depends on `requirePlayerConsent`: `true` -> `Pending`, `false` ->
 * `NotRequired`. The initialized value is persisted before returning
 * so the next launch reads back the same state.
 *
 * Queued through the shared consent chain: concurrent first-launch
 * loads cannot both observe a missing file and persist different
 * initial states, and a load racing with `setConsent` cannot
 * overwrite a just-persisted terminal choice.
 */
async function loadOrInitConsentState(args: LoadOrInitConsentStateArgs): Promise<ConsentState> {
  const { storage, requirePlayerConsent } = args;
  const initial = requirePlayerConsent ? ConsentState.Pending : ConsentState.NotRequired;
  return enqueueConsentOp({
    storage,
    fallback: initial,
    op: async () => {
      const persisted = await readConsentState(storage);
      if (persisted !== null) {
        return persisted;
      }
      await persistConsentState({ storage, state: initial });
      return initial;
    },
  });
}

/**
 * Transition out of `Pending` to `Granted` (`granted = true`) or
 * `Denied` (`granted = false`), persisting the new value to disk.
 * Calls from a terminal state (`NotRequired`, `Granted`, `Denied`,
 * or any unknown value) are a no-op and return the persisted state
 * unchanged.
 *
 * Queued through the shared consent chain so two concurrent
 * `setConsent` calls cannot both observe `Pending` on disk and then
 * race to write conflicting terminal states. The disk re-read
 * inside the queued op is the source of truth for a regulatory-
 * sensitive flow: a persisted value wins over a stale `current`
 * supplied from caller memory, including the case where disk is
 * still `Pending` but the caller claims to be terminal (the
 * caller's `current` is wrong; the caller must re-prompt).
 *
 * Both disk steps are best-effort in the Deny direction, for one
 * reason: a Deny must take effect - stop sending and purge - even when
 * the disk will not cooperate, rather than fail open by staying
 * Pending. So a persist that throws still returns the transition, and
 * a read that throws still lets the Deny through. The choice is then
 * not durable: the next launch re-reads the still-Pending file and
 * re-prompts, the conservative default. A Grant over an unreadable
 * record is refused instead, since that record may hold a Denied.
 *
 * @returns The state after the call: the persisted value when one
 *   exists (terminal OR pending), `current` for a non-Pending no-op
 *   on a fresh-install disk, or the new `Granted`/`Denied` after the
 *   transition (returned even if the persist write failed).
 */
async function setConsent(args: SetConsentArgs): Promise<ConsentState> {
  const { storage, current, granted } = args;
  return enqueueConsentOp({
    storage,
    fallback: current,
    op: async () => {
      let persisted: ConsentState | null = null;
      try {
        persisted = await readConsentState(storage);
      } catch (err: unknown) {
        /**
         * The record is unreadable (I/O). Direction decides what that
         * means, the same way the failed persist below is decided by
         * it: a Deny still takes effect this session, because refusing
         * one over a disk error leaves on disk the very data the user
         * asked to be gone. A Grant does not - an unreadable file may
         * hold a Denied, and re-opening delivery over one is the unsafe
         * way to be wrong.
         */
        console.error('Keewano: consent read failed.', err);
        if (granted) throw err;
      }
      if (persisted !== null) {
        if (persisted !== ConsentState.Pending) {
          return persisted;
        }
        if (current !== ConsentState.Pending) {
          /*
           * Disk says Pending but the caller's `current` claims a
           * terminal value. Their in-memory state is stale; honour
           * disk so the caller realises consent is still pending
           * and re-prompts instead of acting on a phantom terminal.
           */
          return persisted;
        }
      }
      if (current !== ConsentState.Pending) {
        return current;
      }
      const next = granted ? ConsentState.Granted : ConsentState.Denied;
      try {
        await persistConsentState({ storage, state: next });
      } catch (err: unknown) {
        /**
         * Persisting the transition failed (disk full / I/O). Still
         * return `next` so the caller applies the decision in memory
         * this session: a Deny must stop sending and purge even when
         * it cannot be written, rather than fail open by staying
         * Pending. Not durable - the next launch re-reads the still-
         * Pending file and re-prompts - so surface the failure.
         */
        console.error('Keewano: consent persistence failed.', err);
      }
      return next;
    },
  });
}

export { decodeConsentState, loadOrInitConsentState, readConsentState, setConsent };
