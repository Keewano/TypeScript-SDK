/**
 * Consent-layer on-disk filename and byte size.
 */

/**
 * On-disk file holding the persisted consent state. The content is
 * a 4-byte little-endian `uint32` carrying the numeric
 * `ConsentState` value.
 */
const CONSENT_FILENAME = 'Keewano_UserConsent';

/**
 * Bytes used to encode a single `ConsentState` on disk.
 */
const CONSENT_FILE_SIZE = 4;

export { CONSENT_FILE_SIZE, CONSENT_FILENAME };
