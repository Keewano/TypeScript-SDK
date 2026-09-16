/**
 * Web runtime singleton state: the platform-agnostic
 * {@link KeewanoRuntime} contract plus the web-specific lifecycle
 * fields below. Produced by `Keewano.init`, cleared by
 * `Keewano.shutdown`. The `storage` field narrows the base runtime's
 * adapter to the ladder-backed identity one, whose synchronous consent
 * read the exit path depends on; queue traffic uses `queueStorage`.
 *
 * config - The full caller-supplied config.
 * endpoint - Resolved ingress URL (config override or library default).
 * queueStorage - Durable event-queue adapter (IndexedDB by default;
 *   config override or in-memory fallback).
 * dataSessionId - 16-byte UUID, freshly generated on every init so
 *   each page load is a distinct session.
 * consentState - Current GDPR / CCPA gate value.
 * sendLoopAbort - AbortController that stops the background send loop.
 * sendLoopPromise - Resolves when the send loop has exited (after
 *   abort); `null` in unit-test runtimes that never start the loop.
 *   Shutdown awaits it before flushing so the final swap cannot race
 *   a live tick.
 * detachFns - Tracker cleanup callbacks; invoked best-effort on
 *   shutdown.
 * nextBatchNum - Monotonic counter for the next `.kwub` file's
 *   batchNum; seeded per init past the highest batchNum already in
 *   the queue so a reload cannot reuse a pending file's number.
 * batchFilenameSuffix - Per-session filename discriminator (first 8
 *   hex chars of the DataSessionId): two tabs sharing the origin
 *   queue seed the same batchNum and can cut within the same second,
 *   so without it they would overwrite each other's files.
 * codec - Batch encoding every path in this session uses. Held on the
 *   runtime because the send loop, the shutdown flush, and the exit
 *   flush must all agree: a batch written by one encoding and read by
 *   another is indistinguishable from a corrupt file.
 * transport - Delivery protocol paired with `codec`; the exit flush
 *   reuses the same instance for its exit-time hand-off.
 * exitSendSafe - `true` while sending at exit cannot reorder the
 *   session: the server drops a lower-numbered batch arriving after
 *   a higher one, so the exit path may only send when no earlier
 *   batch is still queued. Starts as whatever the boot read of the
 *   queue directory found - a previous visit's unsent files are still
 *   waiting, and a read that failed counts as not empty - then flips
 *   `false` whenever anything is persisted and back `true` when a ship
 *   pass reports the queue drained. When `false` the exit path
 *   persists only - the next visit ships everything in order.
 * exitSendStarted - `true` once this session handed batches to an
 *   exit send. Lives on the runtime because teardown runs the exit
 *   flush twice (visibilitychange, then the queued pagehide rerun):
 *   the second pass must not wake the send loop onto the very
 *   batches the first pass just handed to the keep-alive requests.
 *   Cleared when a ship pass reports the queue drained, so the guard
 *   lives exactly as long as those copies do.
 * customEventsRegistered - `true` once a completed ship pass proved
 *   the server knows the schema hash this session stamps on every
 *   batch. Starts `false`; a batch carrying an unknown hash is
 *   rejected, and on the next visit that rejection is
 *   indistinguishable from a duplicate, so the exit path may not
 *   send before it flips. Only the elected tab's send loop sets it -
 *   a tab that never ships never learns the schema is known.
 */

import type { Codec, ConsentState, KeewanoRuntime, StorageAdapter, Transport } from '@keewano/core';

import type { WebKeewanoConfig } from './config';
import type { WebIdentityStorageAdapter } from '../identity/identityStorageAdapter';

interface WebSdkRuntime extends KeewanoRuntime {
  config: WebKeewanoConfig;
  endpoint: string;
  storage: WebIdentityStorageAdapter;
  queueStorage: StorageAdapter;
  dataSessionId: Uint8Array;
  consentState: ConsentState;
  sendLoopAbort: AbortController;
  sendLoopPromise: Promise<void> | null;
  detachFns: Array<() => void>;
  nextBatchNum: number;
  batchFilenameSuffix: string;
  codec: Codec;
  transport: Transport;
  exitSendSafe: boolean;
  exitSendStarted: boolean;
  customEventsRegistered: boolean;
}

export type { WebSdkRuntime };
