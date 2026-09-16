/**
 * Cross-tab consent propagation.
 *
 * Consent is recorded per origin, but each tab holds its own copy in
 * memory. Without this listener a tab that was open when the visitor
 * withdrew consent elsewhere keeps believing it may send, and the exit
 * path - which delivers directly, off-device, as the tab closes -
 * would act on that stale belief.
 *
 * Two triggers, because the record does not always live where an event
 * can announce it:
 *
 *   - the `storage` event, which fires in exactly the other tabs of
 *     the origin within milliseconds of a `localStorage` write;
 *   - a re-read on every visibility change, which is the only way a
 *     record that landed on the cookie rung (localStorage denied,
 *     full, or wiped for this key) ever reaches a sibling tab while it
 *     goes on running. A timer would have to run in every tab of the
 *     origin for the whole session to buy the same thing.
 *
 * Neither trigger guards the exit send, and neither could: this
 * listener resolves a promise, while teardown runs to completion in
 * one task. The exit path re-reads the record synchronously for
 * itself. What this buys is the tab that keeps living - it stops
 * reporting into a queue it may no longer send, or resumes sending
 * after a grant, without waiting out an idle window.
 *
 * A record stranded on the in-memory rung is out of reach by
 * construction: no other tab can observe it, and no polling changes
 * that.
 *
 * An applied change also wakes the send loop. That matters because
 * only ONE tab of the origin runs a loop: a grant made in any other
 * tab wakes its own (parked) loop for nothing, and the tab that can
 * actually ship would otherwise sleep out its idle window - throttled
 * in the background - with the whole held queue on disk. A withdrawal
 * gets the same nudge so the purge happens now, not eventually.
 *
 * It reads, and never records. Recording here would invert the whole
 * point: clearing site data removes the consent record, and a boot-
 * style "no record means fresh install" would turn a withdrawal into
 * a fresh Pending (or, where the host disabled the gate, straight
 * back into sending) in every other tab of the origin.
 */
import type { AttachConsentSyncArgs, ConsentSyncWindowLike } from './types/consentSync';
import type { WebSdkRuntime } from '../types/runtime';

import { readConsentState } from '@keewano/core';

import { LADDER_KEYS } from '../identity';
import { EVENT_TARGET_METHODS, probeGlobal } from '../probeGlobal';
import { noopDetach } from '../trackers/noopDetach';

/**
 * Adopt the recorded consent decision without awaiting anything.
 *
 * The synchronous counterpart to the listener below, and the only one
 * the exit path can use: it starts in a teardown event whose
 * continuations are not guaranteed to run, and it then keeps
 * delivering across awaits, where neither trigger below reaches it -
 * the `storage` event does not fire at all for a record on the cookie
 * rung, and a tab that is already hidden gets no further visibility
 * change. No record left is not a decision to adopt, for the reason
 * the module header gives.
 */
function adoptRecordedConsentSync(runtime: WebSdkRuntime): void {
  const recorded = runtime.storage.readRecordedConsentSync();
  if (recorded !== null) {
    runtime.consentState = recorded;
  }
}

/**
 * Listen for consent changes made by other tabs of this origin.
 *
 * @returns A detach function; safe to call more than once.
 */
function attachConsentSync(args: AttachConsentSyncArgs): () => void {
  const { runtime } = args;
  const win = args.win ?? probeGlobal<ConsentSyncWindowLike>({ methods: EVENT_TARGET_METHODS });
  if (win === null) return noopDetach;

  /**
   * Reads resolve asynchronously, so only the newest one may apply:
   * with today's one-shot consent two in-flight reads always carry
   * the same recorded value, but the moment consent becomes
   * changeable, an older read resolving last would overwrite the
   * newer decision. Detach bumps the token so a read still in flight
   * cannot write into a runtime being torn down.
   */
  let readToken = 0;

  const adoptRecordedConsent = (): void => {
    readToken += 1;
    const token = readToken;
    /**
     * `runtime.storage` is the ladder that holds identity and consent,
     * NOT the event queue - that one is `runtime.queueStorage`. Boot
     * and `setUserConsent` read and write consent through this same
     * adapter, which is what makes what they record readable here.
     */
    readConsentState(runtime.storage)
      .then((state) => {
        /** No record left (site data cleared) is not a decision to adopt. */
        if (token !== readToken || state === null) return;
        const changed = runtime.consentState !== state;
        runtime.consentState = state;
        if (changed) runtime.dispatcher.signalSend();
      })
      .catch(() => undefined);
  };

  const onStorage = (event: { key?: string | null }): void => {
    /** A null key means the whole store was cleared, which includes consent. */
    const key = event.key ?? null;
    if (key !== null && key !== LADDER_KEYS.CONSENT) return;
    adoptRecordedConsent();
  };
  const onVisibilityChange = (): void => {
    adoptRecordedConsent();
  };

  win.addEventListener('storage', onStorage);
  win.document?.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    readToken += 1;
    try {
      win.removeEventListener('storage', onStorage);
      win.document?.removeEventListener('visibilitychange', onVisibilityChange);
    } catch {
      /** Best-effort cleanup. */
    }
  };
}

export { adoptRecordedConsentSync, attachConsentSync };
