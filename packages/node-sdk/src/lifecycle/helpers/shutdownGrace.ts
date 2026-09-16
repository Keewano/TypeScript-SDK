import { MAX_TIMER_MS } from './within';

/**
 * How long teardown may spend shipping what is queued.
 *
 * Three seconds by default: enough for a healthy endpoint to take the
 * queue (a drain of forty batches measured in milliseconds), short
 * enough to sit inside the ten-second grace a container runtime gives
 * a process between SIGTERM and SIGKILL.
 *
 * A host under a tighter deadline lowers it; zero opts out entirely and
 * restores the teardown that shipped before the drain existed.
 */
const DEFAULT_SHUTDOWN_GRACE_MS = 3000;

/**
 * Read the configured grace, falling back to the default.
 *
 * Resolved at init rather than at teardown, and reported rather than
 * thrown: the value only bounds how long exit may take, so refusing to
 * start over it would cost a run of telemetry to protect a knob, and
 * raising it at exit would surface the misconfiguration at the one
 * moment nobody is reading the logs.
 */
function resolveShutdownGraceMs(configured: number | undefined): number {
  if (configured === undefined) return DEFAULT_SHUTDOWN_GRACE_MS;
  if (!Number.isInteger(configured) || configured < 0) {
    console.error('Keewano.init: shutdownGraceMs must be a whole number of milliseconds.');
    return DEFAULT_SHUTDOWN_GRACE_MS;
  }
  /**
   * Above the timer ceiling the number stops meaning anything a host
   * could have wanted: a wait cannot be scheduled past it, so a grace
   * of years would silently become a shutdown that hangs for weeks.
   * Reported and refused, like the other shapes that cannot be honoured.
   */
  if (configured > MAX_TIMER_MS) {
    console.error(
      `Keewano.init: shutdownGraceMs above ${String(MAX_TIMER_MS)} ms cannot be honoured; using the default.`,
    );
    return DEFAULT_SHUTDOWN_GRACE_MS;
  }
  return configured;
}

export { DEFAULT_SHUTDOWN_GRACE_MS, resolveShutdownGraceMs };
