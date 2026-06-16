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
export type { CustomEventTypeValue } from './customEventType';
export type { Item, ItemArgs } from './item';
export type { KBatchDropReasonValue } from './batchDropReason';
export type { KEvent } from './kevents';
export { AdType } from './adType';
export { CustomEventType } from './customEventType';
export { item } from './item';
export { KBatchDropReason } from './batchDropReason';
export { KEvents } from './kevents';
