/**
 * Types for the click tracker.
 *
 * ClickElementLike - the element surface label resolution reads:
 *   `closest` for the qualifying-ancestor walk, attribute/text/id/tag
 *   accessors for the label chain, `disabled` for the skip rule.
 *
 * ClickEventLike - the event fields the delegated handler uses.
 *
 * ClickDocumentLike - the document seam the capture listener attaches
 *   to.
 *
 * ClickTrackerArgs - optional document seam and report function;
 *   defaults to the live `document` and the core BUTTON_CLICK
 *   reporter.
 */

interface ClickElementLike {
  closest(selector: string): ClickElementLike | null;
  getAttribute(name: string): string | null;
  textContent: string | null;
  id: string;
  tagName: string;
  disabled?: boolean;
}

interface ClickEventLike {
  target: unknown;
  timeStamp: number;
  composedPath?: () => unknown[];
}

interface ClickDocumentLike {
  addEventListener(type: string, listener: (event: ClickEventLike) => void, capture: boolean): void;
  removeEventListener(
    type: string,
    listener: (event: ClickEventLike) => void,
    capture: boolean,
  ): void;
}

interface ClickTrackerArgs {
  doc?: ClickDocumentLike;
  report?: (name: string) => void;
}

export type { ClickDocumentLike, ClickElementLike, ClickEventLike, ClickTrackerArgs };
