/**
 * Event dispatcher: in-memory batch accumulation, cut-point bookkeeping,
 * atomic swap, and AutoResetEvent-style signal mechanism. Composes the
 * wire primitives (`BinaryStream`) with the event-id catalogue
 * (`KEvents`) to produce the on-wire byte stream that the storage and
 * HTTP layers eventually persist and ship.
 *
 * Module-level wire constants (`CURRENT_BATCH_VERSION`, `THRESHOLDS`)
 * are intentionally NOT re-exported - they are implementation details
 * of the dispatcher / serializer and live with their tests inside the
 * module. External consumers must go through the public classes
 * instead of inspecting raw wire values.
 */

export type { KBatchArgs } from './batch';
export type {
  AddEventBoolArgs,
  AddEventDateTimeArgs,
  AddEventNumberArgs,
  AddEventStringArgs,
  AddEventUint16x2Args,
  KEventDispatcherArgs,
  WaitForSignalArgs,
} from './dispatcher';
export { KBatch } from './batch';
export { KEventDispatcher } from './dispatcher';
