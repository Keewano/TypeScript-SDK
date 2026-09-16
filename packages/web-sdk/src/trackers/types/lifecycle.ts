/**
 * Types for the visibility (lifecycle) tracker.
 *
 * VisibilityDocumentLike - the document seam: the listener target and
 *   the `visibilityState` read.
 *
 * VisibilityTrackerArgs - dispatcher the events land in, plus the
 *   optional document and clock seams (defaults wire the live ones).
 */
import type { KEventDispatcher } from '@keewano/core';

interface VisibilityDocumentLike {
  visibilityState?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface VisibilityTrackerArgs {
  dispatcher: KEventDispatcher;
  doc?: VisibilityDocumentLike;
  now?: () => Date;
}

export type { VisibilityDocumentLike, VisibilityTrackerArgs };
