/**
 * Pure decision function that maps a `ConsentState` to the action
 * the send loop should take for one batch.
 *
 * The mapping for each state:
 *   NotRequired | Granted  -> `'send'`   (attempt HTTP send)
 *   Denied                 -> `'delete'` (silently drop, no HTTP)
 *   Pending                -> `'keep'`   (stay on disk, retry later)
 *   anything else          -> `'delete'` (defensive: a corrupted
 *                                         on-disk consent value
 *                                         must not wedge the loop)
 *
 * Kept as a free function (not a class method) and stateless so the
 * send loop, retry helpers, and tests can call it without any
 * setup. State persistence and transitions live in
 * `consentStateMachine.ts`.
 *
 * @example
 * ```ts
 * switch (consentGate(state)) {
 *   case 'send':   await sendBatch({ ... }); break;
 *   case 'delete': await deleteBatch({ ... }); break;
 *   case 'keep':   // leave the file untouched
 * }
 * ```
 */

import type { ConsentGateDecision } from './types/consentGate';

import { ConsentState } from './consentState';

function consentGate(state: ConsentState): ConsentGateDecision {
  switch (state) {
    case ConsentState.NotRequired:
    case ConsentState.Granted:
      return 'send';
    case ConsentState.Pending:
      return 'keep';
    case ConsentState.Denied:
      return 'delete';
    default:
      /**
       * Unknown / corrupted enum value (e.g. a future SDK wrote a new
       * state that this build does not understand, or the on-disk
       * file got truncated to a stray byte). `'delete'` is the safe
       * fallback: drop the batch locally so the send loop cannot get
       * pinned on an unrecognized state forever.
       */
      return 'delete';
  }
}

export { consentGate };
