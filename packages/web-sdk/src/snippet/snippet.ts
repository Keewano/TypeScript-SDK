/**
 * The customer-facing integration snippet, versioned here so the
 * exact text that ships in documentation is the text the snippet test
 * executes against the built bundle. The stub half lives in customer
 * HTML forever and can never be hotfixed.
 *
 * The global name `keewano` (lowercase) is final: it cannot change
 * after the snippet ships into customer HTML.
 */

import type { BuildSnippetHtmlArgs } from './types/snippet';

/**
 * The inline stub script. Idempotent (`||`) so a double-pasted
 * snippet cannot wipe an already-queued `q` or an already-installed
 * facade. Every facade method gets a queueing shim, so pre-load page
 * code calls the same API the live bundle installs:
 *
 *   keewano.init({ apiKey: 'YOUR-API-KEY' });
 *   keewano.reportButtonClick('Play');
 *
 * Shims append `[method, ...args]` tuples to `q`; pushing a tuple
 * into `q` directly stays supported, so a stub pasted before a method
 * existed can still reach it. Calls may arrive in any order relative
 * to `init`: the bundle buffers pre-`init` calls (up to 1000) and
 * flushes them in arrival order once `init` lands. Shims return
 * `undefined` - only post-load direct calls return the real values,
 * which for pre-load `isReady` is the correct falsy answer anyway.
 *
 * The method list freezes into customer HTML with the paste; the
 * snippet test pins it to the live facade's keys, so adding a facade
 * method without extending the stub fails the build.
 *
 * `v` is the stub's generation. It exists because everything else
 * here is frozen the moment a customer pastes it: a bundle released
 * years later still meets whatever stub was current that day, and
 * without a marker it cannot tell them apart. Nothing reads it yet -
 * it is a handful of bytes bought now because it cannot be added
 * retroactively to pages already deployed. Raise it if the shape the
 * bundle adopts (`q`, or anything else it reaches for) ever changes.
 */
const SNIPPET_STUB_SOURCE =
  'window.keewano=window.keewano||function(){var k={q:[],v:1},m="init shutdown isReady setUserId setUserConsent markAsTestUser reportButtonClick reportWindowOpen reportWindowClose reportOnboardingMilestone reportABTestGroupAssignment reportInAppPurchase reportInAppPurchaseItemsGranted reportAdOffered reportAdRevenue reportAdItemsGranted reportSubscriptionRevenue reportSubscriptionItemsGranted reportItemsExchange reportItemsReset reportInstallCampaign reportGameLanguage reportCustomEvent logError".split(" ");for(var i=0;i<m.length;i++)(function(n){k[n]=function(){k.q.push([n].concat([].slice.call(arguments)))}})(m[i]);return k}();';

/**
 * Escape a value for use inside a double-quoted HTML attribute. `&`
 * goes first, or the entities the later replacements introduce would
 * be double-escaped. A quote must not break out of the attribute and
 * inject markup into whatever surface renders the snippet.
 */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** The full copy-paste snippet for a given bundle URL: inline stub + async bundle load. */
function buildSnippetHtml({ scriptUrl, integrity }: BuildSnippetHtmlArgs): string {
  const attributes = [`async src="${escapeAttribute(scriptUrl)}"`];
  if (integrity !== undefined) {
    attributes.push(`integrity="${escapeAttribute(integrity)}"`, 'crossorigin="anonymous"');
  }
  return [
    `<script>${SNIPPET_STUB_SOURCE}</script>`,
    `<script ${attributes.join(' ')}></script>`,
  ].join('\n');
}

export { SNIPPET_STUB_SOURCE, buildSnippetHtml };
