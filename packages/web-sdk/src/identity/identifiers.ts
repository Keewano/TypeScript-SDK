/**
 * Web identity load: the core load-or-init flow plus a read-back
 * adoption pass for the first-visit multi-tab race.
 */

import type { UserIdentifiers } from '@keewano/core';

import type { LoadAdoptedIdentifiersArgs } from './types/identifiers';

import { IDS_FILE_SIZE, IDS_FILENAME, isAllZeroUuid, loadOrInitIdentifiers } from '@keewano/core';

/** Byte length of a single mixed-endian UUID buffer. */
const UUID_SIZE = 16;

/**
 * Load (or initialize) the identifiers, then read the stored record
 * back once and return THAT. Two first-visit tabs can both generate
 * installIds and race the persist; the record is ONE atomic ladder
 * key, so the extra read adopts whichever write landed last and the
 * losing tab converges instead of burning a one-session ghost
 * install. The read-back is one raw `readFile`, NOT a second
 * load-or-init pass: an unreadable record must fall back to our own
 * just-persisted identity, never trigger a second regeneration.
 */
async function loadAdoptedIdentifiers({
  storage,
}: LoadAdoptedIdentifiersArgs): Promise<UserIdentifiers> {
  const own = await loadOrInitIdentifiers({ storage });
  let bytes: Uint8Array | null = null;
  try {
    bytes = await storage.readFile({ path: IDS_FILENAME });
  } catch {
    /** Read-back failed; our own identity is already usable. */
  }
  if (bytes?.length !== IDS_FILE_SIZE) {
    return own;
  }
  const installId = bytes.slice(0, UUID_SIZE);
  if (isAllZeroUuid(installId)) {
    return own;
  }
  return { installId, userId: bytes.slice(UUID_SIZE, IDS_FILE_SIZE) };
}

export { loadAdoptedIdentifiers };
