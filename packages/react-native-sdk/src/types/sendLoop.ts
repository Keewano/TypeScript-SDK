import type {
  ConsentState,
  CustomEventSet,
  KBatch,
  KEventDispatcher,
  StorageAdapter,
} from '@keewano/core';

/**
 * Public args bag accepted by `runSendLoop`.
 *
 * storage - Storage adapter the loop reads / writes batches against.
 * dispatcher - Dispatcher that supplies the swap signal, the frozen
 *   sending batch, and the test-user marker.
 * endpoint - Ingress base URL. Joined with `/in` for batch POSTs.
 * apiKey - Project-scoped secret sent as `K-Token`.
 * installId - 16-byte install GUID. Persisted across launches.
 * getConsent - Callback that returns the current consent state on
 *   every iteration. The runtime singleton is the source of truth;
 *   the loop reads through this function so a consent flip while
 *   the loop is mid-iteration takes effect on the next pass.
 * getNextBatchNum - Callback that returns and increments the
 *   runtime's monotonic batchNum counter. Each saved `.kwub` file
 *   gets a fresh number; the counter resets to 0 per init.
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
 *   probes `GET /custom` once per session and uploads via `POST /custom`
 *   on `204` before any `POST /in` is allowed.
 * getExtraHeaders - Optional provider for extra HTTP headers. Resolved
 *   once per iteration (sync or async) and merged into every request;
 *   reserved headers win and a provider throw degrades to no extras.
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
  getExtraHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
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
 * getExtraHeaders - See `RunSendLoopArgs.getExtraHeaders`. `undefined`
 *   when the host supplied no provider.
 * extraHeaders - Headers resolved from `getExtraHeaders` at the top of
 *   the current iteration. Empty object when no provider or the
 *   provider threw. Passed to every network call this iteration.
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
  getExtraHeaders: (() => Record<string, string> | Promise<Record<string, string>>) | undefined;
  extraHeaders: Record<string, string>;
}

/**
 * Private args bag for the dispatcher-signal / abort-signal race
 * helper.
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
 *   `allocBatchNum(runtime)` call.
 */
interface PersistAccumulatedBatchArgs {
  storage: StorageAdapter;
  dispatcher: KEventDispatcher;
  dir: string;
  allocBatchNum: () => number;
}

/**
 * Args bag for the private `saveAllSubBatches` helper that slices
 * the swapped sending batch along its `cutPositions` into multiple
 * `.kwub` files.
 *
 * storage - Storage adapter the sub-batch files are written through.
 * dir - Directory under the storage adapter for `.kwub` files.
 * sending - Dispatcher's currently-frozen sending batch to slice.
 * allocBatchNum - Allocator the helper calls once per slice so each
 *   on-disk file gets a fresh monotonic batchNum.
 */
interface SaveAllSubBatchesArgs {
  storage: StorageAdapter;
  dir: string;
  sending: KBatch;
  allocBatchNum: () => number;
}

/**
 * Args bag for the private `trySaveSubBatch` helper. Carries one
 * slice of the swapped payload (with its own batchNum + start/end
 * times) plus the identity fields cloned from the parent sending
 * batch. Centralizes the `KBatch` -> `BatchRecord` projection so
 * future wire-shape changes touch one place.
 *
 * storage - Storage adapter the slice is written through.
 * dir - Directory under the storage adapter for `.kwub` files.
 * sending - Source sending batch the identity fields are pulled
 *   from (userId / dataSessionId / batchVersion / customEventsVersion).
 * data - Raw payload bytes for this slice (a `subarray` view into
 *   the sending batch's data buffer).
 * batchStartTime - Slice-window start, Unix seconds.
 * batchEndTime - Slice-window end, Unix seconds.
 * batchNum - Allocated batch number for this slice.
 */
interface TrySaveSubBatchArgs {
  storage: StorageAdapter;
  dir: string;
  sending: KBatch;
  data: Uint8Array;
  batchStartTime: number;
  batchEndTime: number;
  batchNum: number;
}

export type {
  LoopContext,
  PersistAccumulatedBatchArgs,
  RunSendLoopArgs,
  SaveAllSubBatchesArgs,
  TrySaveSubBatchArgs,
  WaitForSignalOrTimeoutArgs,
};
