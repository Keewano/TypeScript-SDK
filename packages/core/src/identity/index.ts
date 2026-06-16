/**
 * On-disk identity primitives:
 *
 * - `loadOrInitIdentifiers` / `persistIdentifiers` - the persistent
 *   `installId` + `userId` record, generated on first launch and
 *   kept across app restarts.
 * - `isPreSdkRegistered` / `markPreSdkRegistered` - one-shot marker
 *   indicating that the pre-SDK registration date event has already
 *   been reported for this user.
 *
 * Public-API surface (`Keewano.setUserId`, `Keewano.getInstallId`,
 * `Keewano.reportUserRegisteredBeforeSDKIntegration`) lives in the
 * platform packages (`@keewano/react-native-sdk` and
 * `@keewano/react-native-expo-sdk`); this core module only handles
 * disk-level identity state.
 */

export type {
  LoadOrInitIdentifiersArgs,
  PersistIdentifiersArgs,
  UserIdentifiers,
} from './types/identifiers';
export type { PreSdkMarkerArgs } from './types/preSdkMarker';
export type { PersistTestUserNameArgs, TestUserStorageArgs } from './types/testUser';

export {
  IDS_FILE_SIZE,
  IDS_FILENAME,
  PRE_SDK_REG_FILENAME,
  TEST_USER_FILENAME,
  TEST_USER_MAX_LENGTH,
} from './helpers/constants';
export { loadOrInitIdentifiers, persistIdentifiers } from './identifiers';
export { isPreSdkRegistered, markPreSdkRegistered } from './preSdkMarker';
export { clearTestUserName, loadTestUserName, persistTestUserName } from './testUser';
