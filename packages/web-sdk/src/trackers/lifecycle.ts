/**
 * Visibility tracker: the tab's `visibilitychange` is the web's
 * pause / resume signal.
 *
 *   hidden  -> APP_PAUSE, and nothing else. Waking the send loop here
 *              is what this tracker used to do, and it defeats the
 *              exit flush that now owns this moment: the wake
 *              resolves the loop's parked promise, the loop swaps the
 *              accumulated batch away in the microtask between
 *              listener callbacks, and the exit flush - a later
 *              listener on the same event - then finds an empty
 *              buffer and sends nothing. The exit flush still wakes
 *              the loop for the on-disk queue, but only after it has
 *              taken what it came for.
 *   visible -> APP_RESUME.
 *
 * Repeated transitions into the same logical phase are coalesced so
 * browser quirks (double `hidden` on some mobile navigations) emit
 * one event per real transition, mirroring the device SDKs.
 */
import type { KeewanoTracker } from '../types/config';
import type { VisibilityDocumentLike, VisibilityTrackerArgs } from './types/lifecycle';

import { KEvents } from '@keewano/core';

import { probeGlobal } from '../probeGlobal';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

type Phase = 'unknown' | 'visible' | 'hidden';

class VisibilityTracker implements KeewanoTracker {
  readonly name = 'VisibilityTracker';

  private readonly args: VisibilityTrackerArgs;

  constructor(args: VisibilityTrackerArgs) {
    this.args = args;
  }

  attach(): () => void {
    const doc =
      this.args.doc ??
      probeGlobal<VisibilityDocumentLike>({ path: ['document'], methods: ['addEventListener'] });
    if (doc === null) return noopDetach;
    const now = this.args.now ?? ((): Date => new Date());

    /** Start from the ACTUAL current state so the first change is a real transition. */
    let lastPhase: Phase = doc.visibilityState === 'hidden' ? 'hidden' : 'visible';

    const handler = (): void => {
      const nextPhase: Phase = doc.visibilityState === 'hidden' ? 'hidden' : 'visible';
      if (nextPhase === lastPhase) return;
      try {
        stampNowOnDispatcher(this.args.dispatcher);
        if (nextPhase === 'hidden') {
          this.args.dispatcher.addEventDateTime({ eventId: KEvents.APP_PAUSE, date: now() });
          lastPhase = nextPhase;
        } else {
          this.args.dispatcher.addEventDateTime({ eventId: KEvents.APP_RESUME, date: now() });
          lastPhase = nextPhase;
        }
      } catch {
        /** A throw from the dispatcher must not crash the visibility callback. */
      }
    };

    doc.addEventListener('visibilitychange', handler);
    return () => {
      try {
        doc.removeEventListener('visibilitychange', handler);
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }
}

export type { VisibilityTrackerArgs } from './types/lifecycle';
export { VisibilityTracker };
