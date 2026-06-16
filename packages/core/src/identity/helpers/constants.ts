/**
 * Identity-layer constants. File names are kept here so a future
 * rename touches one location instead of every read / write site.
 */

/**
 * On-disk file holding the 32-byte identity record: 16 bytes
 * `installId` followed by 16 bytes `userId`, both Microsoft
 * mixed-endian, no header / footer.
 */
const IDS_FILENAME = 'Keewano_Ids';

/**
 * Total on-disk size of the identifiers record. Two 16-byte GUIDs
 * concatenated back-to-back.
 */
const IDS_FILE_SIZE = 32;

/**
 * On-disk presence marker for "the user existed before this SDK was
 * integrated, and the pre-SDK registration date has already been
 * reported once". The file content is a single byte (`0x01`); only
 * its presence matters to readers.
 */
const PRE_SDK_REG_FILENAME = 'Keewano_PreSDKReg';

/**
 * On-disk file holding the QA test-user marker name as UTF-8 bytes.
 * Loaded on init so the marker survives app restart; persisted on
 * every `Keewano.markAsTestUser` call. Absence of the file means
 * the current install is not flagged as a test user.
 */
const TEST_USER_FILENAME = 'Keewano_TestUser';

/**
 * Soft upper bound for the persisted test-user name length, in
 * UTF-16 code units. A misuse / accidental megabyte payload would
 * blow up the on-disk footprint and the in-memory `K-Tester` header
 * value forever; rejecting at the boundary keeps both bounded.
 */
const TEST_USER_MAX_LENGTH = 256;

export {
  IDS_FILE_SIZE,
  IDS_FILENAME,
  PRE_SDK_REG_FILENAME,
  TEST_USER_FILENAME,
  TEST_USER_MAX_LENGTH,
};
