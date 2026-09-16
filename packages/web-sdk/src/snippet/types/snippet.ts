/**
 * Contracts for the customer-facing integration snippet.
 */

/**
 * Args bag for `buildSnippetHtml`.
 *
 * scriptUrl - URL the bundle is loaded from.
 * integrity - Subresource-integrity digest of the bundle at that URL,
 *   in the `sha384-<base64>` form. Optional because a page serving the
 *   bundle from its own origin has nothing to verify against a third
 *   party; supplying it is what pins a CDN copy to the exact build the
 *   integrator tested. When present the tag also carries
 *   `crossorigin="anonymous"`, without which a cross-origin script is
 *   opaque and the browser cannot check the digest at all.
 */
interface BuildSnippetHtmlArgs {
  scriptUrl: string;
  integrity?: string;
}

export type { BuildSnippetHtmlArgs };
