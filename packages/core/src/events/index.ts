/**
 * Wire-protocol event types: the predefined event-ID catalogue
 * (`KEvents`), the per-event payload-shape enums (`AdType`,
 * `KBatchDropReason`, `CustomEventType`), and the `Item` payload
 * entity used by inventory-bearing events.
 *
 * All values serialize as fixed-width integers on the wire and are
 * part of the public wire-protocol contract.
 */

export type { AdTypeValue } from './adType';
export type {
  CustomEventIdArgs,
  CustomEventIdCollision,
  CustomEventIdEntry,
} from './types/customEventId';
export type { CustomEventTypeValue } from './customEventType';
export type { Item, ItemArgs } from './item';
export type { KBatchDropReasonValue } from './batchDropReason';
export type { KEvent } from './kevents';
export { APP_VERSION_UNSPECIFIED, appVersionPayload } from './appVersion';
export { AdType } from './adType';
export { CUSTOM_EVENT_BASE, CUSTOM_EVENT_DATA_TYPE_NAME, CustomEventType } from './customEventType';
export { customEventIdAt, findCustomEventIdCollision } from './customEventId';
export { CUSTOM_EVENT_MIN_ID, isCustomEventId } from './customEventType';
export { item } from './item';
export { KBatchDropReason } from './batchDropReason';
export { KEvents } from './kevents';
