/**
 * Click tracker: BUTTON_CLICK from one delegated capture-phase `click`
 * listener on `document` - no per-element listeners, so buttons added
 * after init are covered automatically.
 *
 * A click qualifies when the event target (or an ancestor, via
 * `closest`) is an interactive control: `<button>`, `[role="button"]`,
 * `<a>`, or a button/submit `<input>`. Disabled controls do not
 * report; a duplicate event for the same control with the same
 * `timeStamp` (a browser-forwarded synthetic click, e.g. `<label>`
 * activation) reports once.
 *
 * The label resolution order gives hosts an explicit escape hatch
 * first: `data-keewano-name` > `aria-label` > trimmed `textContent` >
 * `id` > lowercased tag name. Truncation to the shared 256-char limit
 * happens in the core reporter.
 *
 * Shadow DOM: `event.target` at the document listener is retargeted
 * to the shadow host, so the real control is read from
 * `composedPath()[0]` when available - this covers OPEN shadow roots
 * (Shoelace, Ionic, Lit); closed roots stay opaque by design.
 *
 * Known blind spots, by design: clicks inside a `<canvas>` game never
 * reach a qualifying DOM element - canvas hosts report through the
 * manual API or their own plugin tracker. Browsers that quantize
 * `event.timeStamp` (fingerprinting protection) may fold very rapid
 * same-control taps into one report via the duplicate guard.
 */
import type { KeewanoTracker } from '../types/config';
import type {
  ClickDocumentLike,
  ClickElementLike,
  ClickEventLike,
  ClickTrackerArgs,
} from './types/clicks';

import { reportButtonClick } from '@keewano/core';

import { probeGlobal } from '../probeGlobal';
import { noopDetach } from './noopDetach';

const QUALIFYING_SELECTOR =
  'button, [role="button"], a, input[type="button"], input[type="submit"]';

/** Label chain: explicit name > accessible name > visible text > id > tag. */
function resolveLabel(element: ClickElementLike): string {
  const explicit = element.getAttribute('data-keewano-name');
  if (explicit !== null && explicit.trim().length > 0) return explicit.trim();
  const aria = element.getAttribute('aria-label');
  if (aria !== null && aria.trim().length > 0) return aria.trim();
  const text = element.textContent;
  if (text !== null && text.trim().length > 0) return text.trim();
  if (element.id.length > 0) return element.id;
  return element.tagName.toLowerCase();
}

class ClickTracker implements KeewanoTracker {
  readonly name = 'ClickTracker';

  private readonly args: ClickTrackerArgs;

  constructor(args: ClickTrackerArgs = {}) {
    this.args = args;
  }

  attach(): () => void {
    const doc =
      this.args.doc ??
      probeGlobal<ClickDocumentLike>({ path: ['document'], methods: ['addEventListener'] });
    if (doc === null) return noopDetach;
    const report = this.args.report ?? reportButtonClick;

    let lastElement: ClickElementLike | null = null;
    let lastTimeStamp = -1;

    const handler = (event: ClickEventLike): void => {
      try {
        /** Shadow-DOM-aware target: composedPath()[0] is the real control inside an open root. */
        const rawTarget =
          typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target;
        const target = rawTarget as ClickElementLike | null;
        if (target === null || typeof target?.closest !== 'function') return;
        const element = target.closest(QUALIFYING_SELECTOR);
        if (element === null) return;
        if (element.disabled === true) return;
        if (element.getAttribute('aria-disabled') === 'true') return;
        /**
         * A browser-forwarded synthetic click (label activation,
         * some a11y tools) arrives as a SECOND event for the same
         * interaction: same `timeStamp`, same resolved control.
         * Report the interaction once.
         */
        if (element === lastElement && event.timeStamp === lastTimeStamp) return;
        lastElement = element;
        lastTimeStamp = event.timeStamp;
        report(resolveLabel(element));
      } catch {
        /** A hostile DOM shape must not crash the page's click handling. */
      }
    };

    doc.addEventListener('click', handler, true);
    return () => {
      try {
        doc.removeEventListener('click', handler, true);
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }
}

export type { ClickTrackerArgs } from './types/clicks';
export { ClickTracker };
