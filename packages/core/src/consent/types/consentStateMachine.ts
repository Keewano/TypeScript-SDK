import type { StorageAdapter } from '../../storage';

import type { ConsentState } from '../consentState';

/**
 * Args bag for `loadOrInitConsentState`.
 *
 * storage - Storage adapter backing the consent file.
 * requirePlayerConsent - Project setting. When `true`, a fresh
 *   install starts in `Pending` (the send loop keeps batches on
 *   disk until the user explicitly grants or denies). When `false`,
 *   it starts in `NotRequired` (no consent prompt needed, intended
 *   for jurisdictions where consent is not legally required).
 *   Ignored once a state has already been persisted - the disk
 *   value wins on subsequent launches.
 */
interface LoadOrInitConsentStateArgs {
  storage: StorageAdapter;
  requirePlayerConsent: boolean;
}

/**
 * Args bag for `setConsent`.
 *
 * storage - Storage adapter backing the consent file.
 * current - The current in-memory consent state. Pass the latest
 *   value the orchestration layer holds; the function only
 *   transitions out of `Pending` and returns `current` unchanged
 *   for any terminal state.
 * granted - User decision: `true` -> `Granted`, `false` -> `Denied`.
 *   Ignored when `current` is not `Pending`.
 */
interface SetConsentArgs {
  storage: StorageAdapter;
  current: ConsentState;
  granted: boolean;
}

export type { LoadOrInitConsentStateArgs, SetConsentArgs };
