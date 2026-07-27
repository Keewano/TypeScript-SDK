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
 * Read the persisted consent state from disk, or `null` when the
 * file is missing, not exactly `CONSENT_FILE_SIZE` bytes long, or
 * carries a value outside the known `ConsentState` enum range. The
 * exact-size check matches the regulatory fail-closed policy: a
 * file of any other length is treated as corruption or as a future
 * schema, not as a partial read.
 */
async function readPersistedConsentState(storage: StorageAdapter): Promise<ConsentState | null> {
  const bytes = await storage.readFile({ path: CONSENT_FILENAME });
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
      const persisted = await readPersistedConsentState(storage);
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
 * The persist write is best-effort: if it throws (disk full / I/O)
 * the transition is still returned so the caller applies it in memory
 * this session. A Deny must take effect - stop sending and purge -
 * even when it cannot be written, rather than fail open by staying
 * Pending. The choice is then not durable: the next launch re-reads
 * the still-Pending file and re-prompts, the conservative default.
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
      const persisted = await readPersistedConsentState(storage);
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

export { loadOrInitConsentState, setConsent };
