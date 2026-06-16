/**
 * One-shot marker for "the user existed before this SDK was
 * integrated, and the pre-SDK registration date has already been
 * reported once". Implemented as a presence-only file on the
 * `StorageAdapter`-backed disk: the file's existence is the signal;
 * its content is a single byte that never gets read.
 *
 * The public-API caller writes the marker BEFORE dispatching the
 * corresponding event. If the event dispatch then fails (network
 * error, batch dropped, etc.), the marker is still in place and the
 * next launch will not retry the event. This is a deliberate
 * "you only get one chance" semantic.
 */

import type { PreSdkMarkerArgs } from './types/preSdkMarker';

import { PRE_SDK_REG_FILENAME } from './helpers/constants';

/**
 * Marker file content: a single byte (`0x01`). Only presence matters
 * to readers, but a one-byte payload is written instead of an empty
 * file so a storage backend that treats zero-length writes as
 * deletions cannot accidentally clear the marker.
 */
const MARKER_BYTES = new Uint8Array([0x01]);

/**
 * `true` when the pre-SDK marker file exists on disk. Uses
 * `fileSize` (no payload read) since the content is irrelevant.
 */
async function isPreSdkRegistered(args: PreSdkMarkerArgs): Promise<boolean> {
  const { storage } = args;
  const size = await storage.fileSize({ path: PRE_SDK_REG_FILENAME });
  return size !== null;
}

/**
 * Idempotently mark the pre-SDK registration as reported. Writing
 * over an existing marker file is a no-op from the caller's
 * perspective: the file ends up in the same final state either way.
 */
async function markPreSdkRegistered(args: PreSdkMarkerArgs): Promise<void> {
  const { storage } = args;
  await storage.writeFile({ path: PRE_SDK_REG_FILENAME, bytes: MARKER_BYTES });
}

export { isPreSdkRegistered, markPreSdkRegistered };
