/**
 * Shared no-op detach for trackers that degrade gracefully: when the
 * browser API a tracker needs is absent (non-DOM realm, exotic
 * embedder), `attach()` returns this instead of throwing so SDK boot
 * proceeds without the tracker.
 */
function noopDetach(): void {
  /* Nothing was attached, so there is nothing to detach. */
}

export { noopDetach };
