/**
 * One-shot marker for "the pre-SDK registration date has already been
 * reported once". Presence-only file on the `StorageAdapter`-backed
 * disk: its existence is the signal; the content is never read.
 *
 * The caller writes the marker BEFORE dispatching the event, so a
 * failed dispatch is never retried on the next launch - a deliberate
 * "you only get one chance" semantic.
 */

import type { PreSdkMarkerArgs } from './types/preSdkMarker';

import { PRE_SDK_REG_FILENAME } from './helpers/constants';

/**
 * One byte, not empty: a backend that treats zero-length writes as
 * deletions must not accidentally clear the marker.
 */
const MARKER_BYTES = new Uint8Array([0x01]);

/** `true` when the pre-SDK marker file exists on disk. */
async function isPreSdkRegistered(args: PreSdkMarkerArgs): Promise<boolean> {
  const { storage } = args;
  const size = await storage.fileSize({ path: PRE_SDK_REG_FILENAME });
  return size !== null;
}

/** Idempotent: overwriting an existing marker leaves the same final state. */
async function markPreSdkRegistered(args: PreSdkMarkerArgs): Promise<void> {
  const { storage } = args;
  await storage.writeFile({ path: PRE_SDK_REG_FILENAME, bytes: MARKER_BYTES });
}

export { isPreSdkRegistered, markPreSdkRegistered };
