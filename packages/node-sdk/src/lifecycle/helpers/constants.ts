/**
 * Lifecycle on-disk directory and time-unit constants.
 */

/**
 * Directory (relative to the storage root) under which `.kwub` batch
 * files live; used by the send loop and shutdown teardown.
 */
const BATCHES_DIR = 'keewano';

/**
 * Divisor converting `Date.now()` milliseconds to the wire's Unix-seconds
 * timestamp.
 */
const MS_PER_SECOND = 1000;

export { BATCHES_DIR, MS_PER_SECOND };
