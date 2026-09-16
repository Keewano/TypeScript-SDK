/**
 * Bundle-side half of the snippet mechanic. The stub's `q.push` is
 * repointed at the command pump because page code may have captured
 * the stub before the bundle arrived. Everything is
 * hostile-input-hardened: the "stub" can be anything a page script
 * left on the global, and a malformed queue must cost at most a
 * `console.error`, never a throw into the page.
 */

import type {
  CommandPump,
  CreateCommandPumpArgs,
  InstallGlobalFacadeArgs,
  LiveCommandQueue,
  ParseCommandArgs,
  ParsedCommand,
  RunCommandArgs,
} from './types/installGlobalFacade';

import { isInitialized, isInitializing } from '../runtime';

/**
 * Marker stamped on an installed facade so a second copy of this
 * bundle (double-pasted `<script>`, two plugins bundling the SDK) can
 * recognize it and stand down. A fixed string, NOT a per-module
 * `Symbol`: the duplicate script runs its OWN copy of this module, so
 * a fresh Symbol would never match. Non-enumerable so the facade's
 * public key set stays exactly the API surface.
 */
const LIVE_FACADE_MARKER = '__keewanoLiveFacade';

const INIT_METHOD = 'init';

/** Bounds the memory a page that never calls `init` can pin. */
const PRE_INIT_BUFFER_LIMIT = 1000;

/**
 * `init` can reject synchronously (invalid config / apiKey) without
 * arming the runtime's boot latch; a valid init arms it BEFORE its
 * first await. The pump gates the held-buffer flush on this probe so
 * a rejected init keeps the buffer for a later corrected one.
 */
function defaultIsBootActive(): boolean {
  return isInitialized() || isInitializing();
}

/** `true` when `existing` is a live facade installed by any copy of this module. */
function isLiveFacade(existing: unknown): boolean {
  if (existing === null || typeof existing !== 'object') {
    return false;
  }
  try {
    return (existing as Record<string, unknown>)[LIVE_FACADE_MARKER] === true;
  } catch {
    return false;
  }
}

/**
 * The whole body sits inside the try/catch: a hostile Proxy tuple
 * can throw from `length`, an index read, or the rest-destructure's
 * iterator, and none of those may escape into the replay loop.
 * `Object.prototype.hasOwnProperty` (not `Object.hasOwn`, missing on
 * Safari <= 15.3) keeps inherited members (`constructor`,
 * `hasOwnProperty`, ...) from resolving as facade methods.
 */
function parseCommand({ facade, command }: ParseCommandArgs): ParsedCommand | null {
  try {
    if (!Array.isArray(command) || command.length === 0 || typeof command[0] !== 'string') {
      console.error('keewano: dropped malformed queued call.');
      return null;
    }
    const [method, ...args] = command as [string, ...unknown[]];
    const fn = Object.prototype.hasOwnProperty.call(facade, method)
      ? (facade as unknown as Record<string, unknown>)[method]
      : undefined;
    if (typeof fn !== 'function') {
      console.error(`keewano: dropped queued call to unknown method "${method}".`);
      return null;
    }
    return { method, args, fn: fn as (...fnArgs: unknown[]) => unknown };
  } catch {
    console.error('keewano: dropped malformed queued call.');
    return null;
  }
}

/**
 * Facade methods are themselves guard-wrapped; the try/catch covers only
 * the dispatch plumbing. A returned promise gets a no-op rejection
 * handler as defense against a future unguarded async method.
 */
function runCommand({ facade, command }: RunCommandArgs): void {
  try {
    const result = command.fn.apply(facade, command.args);
    if (result instanceof Promise) {
      result.catch(() => undefined);
    }
  } catch (err: unknown) {
    console.error(`keewano: queued call to "${command.method}" failed.`, err);
  }
}

/**
 * Three ordering rules the flat array in the stub cannot express:
 *   - Commands arriving before the first `init` tuple are buffered
 *     (bounded) and flushed in arrival order right after `init` runs;
 *     executing them earlier would hit the facade's not-initialized
 *     guard and silently drop them.
 *   - The flush waits for an `init` that actually ARMED the boot: an
 *     init rejected synchronously (invalid config / apiKey) leaves
 *     the buffer intact, so a later corrected init still delivers
 *     every buffered report instead of losing them to the same guard.
 *   - A push arriving while a drain is running appends behind the
 *     in-flight feed instead of executing re-entrantly, so arrival
 *     order survives a command that synchronously pushes more.
 */
function createCommandPump({
  facade,
  isBootActive = defaultIsBootActive,
}: CreateCommandPumpArgs): CommandPump {
  const pending: unknown[] = [];
  const held: ParsedCommand[] = [];
  let initSeen = false;
  let flushPending = false;
  let overflowLogged = false;
  let draining = false;
  /**
   * Stands in for `Array.push`'s returned length: nothing is retained
   * after execution, so a running total keeps snippet code written
   * against a plain array observing a growing number.
   */
  let pushedCount = 0;

  const holdCommand = (parsed: ParsedCommand): void => {
    if (held.length >= PRE_INIT_BUFFER_LIMIT) {
      if (!overflowLogged) {
        overflowLogged = true;
        console.error('keewano: pre-init command buffer is full; dropping queued calls.');
      }
      return;
    }
    held.push(parsed);
  };

  /** `false` when the boot never armed - the buffer stays for a later init. */
  const flushHeldIfBooted = (): boolean => {
    if (!isBootActive()) {
      return false;
    }
    flushPending = false;
    for (const heldCommand of held.splice(0)) {
      runCommand({ facade, command: heldCommand });
    }
    return true;
  };

  /** Shared by a queued `init` and a direct one: arm the seen flag, then flush. */
  const noteInitArrived = (): void => {
    const firstInit = !initSeen;
    initSeen = true;
    if (firstInit || flushPending) {
      flushPending = !flushHeldIfBooted();
    }
  };

  const processOne = (raw: unknown): void => {
    const parsed = parseCommand({ facade, command: raw });
    if (parsed === null) {
      return;
    }
    if (parsed.method === INIT_METHOD) {
      runCommand({ facade, command: parsed });
      noteInitArrived();
      return;
    }
    if (initSeen) {
      if (flushPending && !flushHeldIfBooted()) {
        /** Boot still not armed: buffer behind the held reports to keep arrival order. */
        holdCommand(parsed);
        return;
      }
      runCommand({ facade, command: parsed });
      return;
    }
    holdCommand(parsed);
  };

  const drain = (): void => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      while (pending.length > 0) {
        processOne(pending.shift());
      }
    } finally {
      draining = false;
    }
  };

  const ingest = (commands: readonly unknown[]): void => {
    for (const command of commands) {
      pending.push(command);
    }
    drain();
  };

  return {
    queue: {
      push(...commands: unknown[]): number {
        pushedCount += commands.length;
        ingest(commands);
        return pushedCount;
      },
    },
    ingest,
    noteInit: noteInitArrived,
  };
}

/**
 * `splice(0)` both returns the tuples and empties the original array,
 * so repointing the stub's `q` afterwards cannot replay anything twice.
 */
function snapshotQueue(existing: unknown): unknown[] {
  if (existing === null || typeof existing !== 'object') {
    return [];
  }
  try {
    const queue = (existing as { q?: unknown }).q;
    return Array.isArray(queue) ? queue.splice(0) : [];
  } catch {
    return [];
  }
}

/**
 * A LIVE facade already installed (duplicate SDK script) wins:
 * replacing it would orphan its session runtime, and re-draining
 * could replay commands twice.
 *
 * The stub queue is spliced only AFTER the global assignment
 * succeeds: on a hostile host where the read or the assignment
 * throws, the untouched stub keeps queueing and nothing queued is
 * lost.
 *
 * The global name `keewano` (lowercase) is final: it cannot change
 * after the snippet ships into customer HTML.
 */
function installGlobalFacade({
  facade,
  globalObject,
  isBootActive,
}: InstallGlobalFacadeArgs): void {
  let existing: unknown;
  try {
    existing = globalObject.keewano;
  } catch (err: unknown) {
    console.error('keewano: reading the global failed; SDK not installed.', err);
    return;
  }
  if (isLiveFacade(existing)) {
    console.warn('keewano: duplicate SDK script detected; keeping the first installed SDK.');
    return;
  }
  const pump = createCommandPump({
    facade,
    ...(isBootActive === undefined ? {} : { isBootActive }),
  });
  /**
   * A page that queued reports via the stub and later calls `init()`
   * directly is the documented SPA flow, and nothing else ever
   * enters the queue once the live facade is installed - so the
   * direct call itself has to tell the pump an init landed, or the
   * held reports stay stranded for the life of the page. On the
   * common path the boot latch arms before the first await and the
   * synchronous note flushes immediately.
   */
  const directInit = (facade as { init: (config: unknown) => Promise<void> }).init.bind(facade);
  (facade as { init: (config: unknown) => Promise<void> }).init = (config: unknown) => {
    const result = directInit(config);
    pump.noteInit();
    /**
     * A boot parked behind an in-flight shutdown arms its latch only
     * after that await, so the synchronous note above finds it
     * inactive and the flush stays pending with nothing left to
     * re-drive it. Note again once the call settles: the flush is a
     * no-op unless the boot actually armed, so a rejected init still
     * keeps the buffer for a later corrected one.
     */
    Promise.resolve(result)
      .catch(() => undefined)
      .then(() => {
        pump.noteInit();
      });
    return result;
  };
  (facade as { q?: LiveCommandQueue }).q = pump.queue;
  Object.defineProperty(facade, LIVE_FACADE_MARKER, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  try {
    globalObject.keewano = facade;
  } catch (err: unknown) {
    console.error('keewano: installing the global failed; the snippet stub keeps queueing.', err);
    return;
  }
  const queued = snapshotQueue(existing);
  if (existing !== null && typeof existing === 'object') {
    try {
      (existing as { q?: unknown }).q = pump.queue;
    } catch {
      /** Frozen / hostile stub: captured references stay queue-dead, the global still works. */
    }
  }
  pump.ingest(queued);
}

export { installGlobalFacade };
