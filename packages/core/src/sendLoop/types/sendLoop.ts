import type { ConsentState } from '../../consent';
import type { Codec, EncodedBatch, EncodedBatchSlice } from '../../codec/types/codec';
import type { KBatch, KEventDispatcher } from '../../dispatcher';
import type { CustomEventSet, CustomEventsRegistrar, Transport } from '../../network';
import type { StorageAdapter } from '../../storage';

/**
 * Public args bag accepted by `runSendLoop`.
 *
 * storage - Storage adapter the loop reads / writes batches against.
 * dispatcher - Dispatcher that supplies the swap signal, the frozen
 *   sending batch, and the test-user marker.
 * endpoint - Ingress base URL. Joined with `/in` for batch POSTs.
 * apiKey - Project-scoped secret sent as `K-Token`.
 * installId - 16-byte install UUID sent as `K-InstallId`. A device SDK's
 *   real persisted id, or all-zero for a server-relay loop.
 * getConsent - Callback that returns the current consent state on
 *   every iteration. The runtime singleton is the source of truth;
 *   the loop reads through this function so a consent flip while
 *   the loop is mid-iteration takes effect on the next pass.
 * getNextBatchNum - Callback that returns and increments the
 *   runtime's monotonic batchNum counter. Each saved `.kwub` file
 *   gets a fresh number; the host owns the counter's seed (a device
 *   SDK starts at 0 per init, a server relay may reseed from disk).
 * signal - Abort signal that ends the loop. `shutdown()` aborts it.
 * batchesDir - Directory under the storage adapter where `.kwub`
 *   batch files live.
 * idleMs - Idle-wait timeout per iteration. Defaults to 30000.
 * batchesPerCycle - Maximum number of batches shipped per send
 *   pass. Defaults to 30 to bound RAM and HTTP concurrency.
 * capBytes - On-disk batch directory cap. Defaults to 50 MB.
 *   Batches exceeding this on next-iteration check are dropped
 *   via `reduceStorageSize`.
 * customEventSet - Optional custom-events schema. When set, the loop
 *   probes the registrar once per session and registers the map when
 *   the server does not know it, before any batch POST is allowed.
 * codec - Batch encoding for persist / load / tombstone passes.
 *   Defaults to the binary codec.
 * transport - Delivery protocol for the ship pass. Defaults to the
 *   binary transport.
 * customEventsRegistrar - Registration protocol paired with the
 *   transport. Defaults to the binary registrar; its `codecId` must
 *   match `transport.codecId` or the loop throws at startup, so a
 *   REST transport left with the silent binary default fails loudly
 *   instead of probing the wrong endpoint and never shipping.
 * onShipPass - Optional observer invoked after each completed ship
 *   pass with how many batch files the pass left on disk. Exists so
 *   a host can know when the queue is drained - the browser gates
 *   its exit-time delivery on that, because the server drops a
 *   lower-numbered batch arriving after a higher one. Not invoked
 *   when the pass is cut short by shutdown, nor when a concurrent
 *   persist overlapped the pass (the listing is stale then; the
 *   next pass reports). A throw is swallowed.
 *
 *   The staleness guard watches THIS loop's dispatcher, so `remaining`
 *   is only trustworthy where the same dispatcher writes the queue.
 *   A host that persists through a different one - the Node relay
 *   seals each user batch with a fresh per-batch dispatcher - can see
 *   `remaining: 0` while a file written by that other dispatcher sits
 *   in the directory. Such a host should treat this as "a pass ended"
 *   and take the depth from `listBatches`.
 * onPassEnd - Optional observer invoked at the end of every iteration's
 *   decision, whatever it decided: after a ship pass, after a delete
 *   pass, and on the paths that ship nothing - consent still pending,
 *   custom-event registration refused, the queue unreadable.
 *   `onShipPass` cannot serve a host waiting for the loop to reach a
 *   boundary, because it fires only when a pass COMPLETED: a host that
 *   declares a custom-event set while the registration endpoint is
 *   down would wait its whole exit grace for a tick that never comes,
 *   over a queue that could not have shipped. Carries nothing; the
 *   depth is the host's to read. A throw is swallowed.
 * onBatchesSealed - Optional observer of every batch the LOOP's own
 *   persist seals (see `PersistAccumulatedBatchArgs.onBatchesSealed`).
 *   Together with `onShipPass` it lets a host track queue emptiness
 *   without polling storage.
 * getExtraHeaders - Optional provider for extra HTTP headers. Resolved
 *   once per iteration (sync or async) and merged into every request;
 *   reserved headers win and a provider throw degrades to no extras.
 * filenameSuffix - Optional multi-writer discriminator this loop's
 *   persists append to batch filenames (see `SaveBatchArgs`).
 */
interface RunSendLoopArgs {
  storage: StorageAdapter;
  dispatcher: KEventDispatcher;
  endpoint: string;
  apiKey: string;
  installId: Uint8Array;
  getConsent: () => ConsentState;
  getNextBatchNum: () => number;
  signal: AbortSignal;
  batchesDir: string;
  idleMs?: number;
  batchesPerCycle?: number;
  capBytes?: number;
  customEventSet?: CustomEventSet;
  codec?: Codec;
  transport?: Transport;
  customEventsRegistrar?: CustomEventsRegistrar;
  onShipPass?: (args: OnShipPassArgs) => void;
  onPassEnd?: () => void;
  onBatchesSealed?: (batches: readonly EncodedBatch[]) => void;
  getExtraHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  filenameSuffix?: string;
}

/**
 * Args for the `onShipPass` observer.
 *
 * remaining - Batch files still on disk when the pass ended, counted
 *   against the full directory listing (files beyond the per-cycle
 *   cap are still queued and count as remaining).
 */
interface OnShipPassArgs {
  remaining: number;
}

/**
 * Frozen view of `RunSendLoopArgs` that the loop's internal helpers
 * consume. Defaults are resolved into concrete values so helpers do
 * not branch on `undefined` per iteration. Field semantics match
 * `RunSendLoopArgs`; the only shape difference is that
 * `batchesPerCycle` and `capBytes` are non-optional here.
 *
 * storage - See `RunSendLoopArgs.storage`.
 * dispatcher - See `RunSendLoopArgs.dispatcher`.
 * endpoint - See `RunSendLoopArgs.endpoint`.
 * apiKey - See `RunSendLoopArgs.apiKey`.
 * installId - See `RunSendLoopArgs.installId`.
 * getConsent - See `RunSendLoopArgs.getConsent`.
 * getNextBatchNum - See `RunSendLoopArgs.getNextBatchNum`.
 * signal - See `RunSendLoopArgs.signal`.
 * batchesDir - See `RunSendLoopArgs.batchesDir`.
 * batchesPerCycle - Concrete cap (default 30 applied at args parse).
 * capBytes - Concrete cap (default 50 MB applied at args parse).
 * customEventSet - See `RunSendLoopArgs.customEventSet`.
 * customEventsRegistered - Mutable session flag flipped to `true`
 *   once the server has confirmed it knows `customEventSet.version`
 *   (either `GET /custom` returned `200` or a `POST /custom` upload
 *   was accepted). Stays `true` for the rest of the session. Held
 *   on the context (not the runtime) because only the loop reads
 *   and writes it; a fresh init starts a fresh session with
 *   `registered = false` regardless of any prior session's result.
 * configErrorLogged - Mutable session flag flipped to `true` after
 *   the first configuration-bug log (a TypeError / RangeError from
 *   the transport's validation layer). Keeps the console.error
 *   one-shot per loop session instead of repeating every iteration.
 * registrarErrorLogged - Mutable session flag flipped to `true` after
 *   the first registrar-unavailable warn (an `'error'` probe status).
 *   Keeps the console.warn one-shot per loop session so a stalled
 *   registration is visible without per-iteration spam.
 * lastRetryableReason - Last logged retryable-failure reason, `null`
 *   whenever the queue is empty (a successful delivery, a completed
 *   pass that left nothing, or a consent wipe). Suppresses consecutive
 *   duplicates so an outage logs once at its start (and again on a
 *   reason change) instead of every retry cycle.
 * filenameSuffix - Optional multi-writer discriminator forwarded into
 *   every persisted batch filename; `undefined` on single-writer
 *   platforms.
 * getExtraHeaders - See `RunSendLoopArgs.getExtraHeaders`. `undefined`
 *   when the host supplied no provider.
 * extraHeaders - Headers resolved from `getExtraHeaders` at the top of
 *   the current iteration. Empty object when no provider or the
 *   provider threw. Passed to every network call this iteration.
 * registrar - Concrete custom-events registration protocol (default
 *   binary applied at args parse), driven by the loop's
 *   probe-then-register orchestration.
 * onShipPass - See `RunSendLoopArgs.onShipPass`.
 * onPassEnd - See `RunSendLoopArgs.onPassEnd`.
 * onBatchesSealed - See `RunSendLoopArgs.onBatchesSealed`.
 */
interface LoopContext {
  storage: StorageAdapter;
  dispatcher: KEventDispatcher;
  endpoint: string;
  apiKey: string;
  installId: Uint8Array;
  getConsent: () => ConsentState;
  getNextBatchNum: () => number;
  signal: AbortSignal;
  batchesDir: string;
  batchesPerCycle: number;
  capBytes: number;
  customEventSet: CustomEventSet | undefined;
  customEventsRegistered: boolean;
  configErrorLogged: boolean;
  registrarErrorLogged: boolean;
  lastRetryableReason: string | null;
  filenameSuffix: string | undefined;
  getExtraHeaders: (() => Record<string, string> | Promise<Record<string, string>>) | undefined;
  extraHeaders: Record<string, string>;
  codec: Codec;
  transport: Transport;
  registrar: CustomEventsRegistrar;
  onShipPass: ((args: OnShipPassArgs) => void) | undefined;
  onPassEnd: (() => void) | undefined;
  onBatchesSealed: ((batches: readonly EncodedBatch[]) => void) | undefined;
}

/**
 * Args bag for the "reset both in-memory buffers" helper.
 *
 * dispatcher - Dispatcher whose in-batch and sending batch are reset.
 */
interface DropInMemoryBatchesArgs {
  dispatcher: KEventDispatcher;
}

/**
 * Args bag for the consent-revocation purge helper.
 *
 * dispatcher - Dispatcher whose in-memory buffers are reset.
 * deleteQueued - Platform-supplied deletion of the on-disk queue;
 *   always awaited, even when a buffer reset threw.
 */
interface PurgeRevokedDataArgs {
  dispatcher: KEventDispatcher;
  deleteQueued: () => Promise<void>;
}

/**
 * Args bag for the dispatcher-signal / abort-signal race helper.
 *
 * dispatcher - Dispatcher whose `waitForSignal` is raced against
 *   the abort listener.
 * idleMs - Timeout passed to `waitForSignal`. The race resolves
 *   either on dispatcher signal, on abort, or on this timeout.
 * signal - Abort signal that resolves the race immediately when
 *   the loop is shutting down.
 */
interface WaitForSignalOrTimeoutArgs {
  dispatcher: KEventDispatcher;
  idleMs: number;
  signal: AbortSignal;
}

/**
 * Args bag for the shared "drain dispatcher to disk" helper called
 * from both the send loop's per-iteration tick and the shutdown
 * final flush.
 *
 * storage - Storage adapter the batch is written through.
 * dispatcher - Dispatcher whose accumulated in-batch is being persisted.
 * dir - Directory under the storage adapter for `.kwub` files.
 * allocBatchNum - Callback that returns the next monotonic batchNum.
 *   Loop wires it to `getNextBatchNum`; shutdown wires it to a direct
 *   `allocBatchNum(runtime)` call. Like the observer below, it runs
 *   inside the swap and must not re-enter `persistAccumulatedBatch`
 *   on this dispatcher.
 * filenameSuffix - Optional multi-writer discriminator forwarded into
 *   the on-disk filename (see `SaveBatchArgs`).
 * onBatchesSealed - Optional synchronous observer of the fully
 *   identified batches, invoked once before the first storage write.
 *   Exists for the browser exit path, where a closing page can still
 *   issue a request but can no longer await a storage write: the
 *   observer runs while the page is guaranteed alive, and persistence
 *   proceeds unchanged afterwards. A throw from the observer is
 *   swallowed - observing must never cost the caller its persistence.
 *   Payload buffers are owned (the codec seal contract), so an
 *   observer may hold them past the persist and past later events.
 *   It must not, however, call `persistAccumulatedBatch` on this
 *   dispatcher: it runs inside the swap, before the persist has been
 *   registered for serialization, so a call from here would find no
 *   persist in flight and race a second swap against this one. That
 *   ordering is what lets the observer run synchronously at all, and
 *   nothing in the types or the lint rules can catch a caller that
 *   breaks this.
 */
interface PersistAccumulatedBatchArgs {
  storage: StorageAdapter;
  dispatcher: KEventDispatcher;
  dir: string;
  allocBatchNum: () => number;
  codec?: Codec;
  filenameSuffix?: string;
  onBatchesSealed?: (batches: readonly EncodedBatch[]) => void;
}

/**
 * Args bag for the private `saveSlices` helper that persists the
 * sealed slices of one swapped sending batch.
 *
 * storage - Storage adapter the slice files are written through.
 * dir - Directory under the storage adapter for `.kwub` files.
 * codec - Batch encoding that serializes each container.
 * sending - Source sending batch the identity fields are pulled
 *   from (userId / dataSessionId / batchVersion / customEventsVersion).
 * slices - Whole-event slices produced by the builder seal.
 * allocBatchNum - Allocator the helper calls once per slice so each
 *   on-disk file gets a fresh monotonic batchNum.
 * onBatchesSealed - See `PersistAccumulatedBatchArgs.onBatchesSealed`.
 */
interface SaveSlicesArgs {
  storage: StorageAdapter;
  dir: string;
  codec: Codec;
  sending: KBatch;
  slices: readonly EncodedBatchSlice[];
  allocBatchNum: () => number;
  filenameSuffix?: string;
  onBatchesSealed?: (batches: readonly EncodedBatch[]) => void;
}

export type {
  DropInMemoryBatchesArgs,
  OnShipPassArgs,
  LoopContext,
  PurgeRevokedDataArgs,
  PersistAccumulatedBatchArgs,
  RunSendLoopArgs,
  SaveSlicesArgs,
  WaitForSignalOrTimeoutArgs,
};
