/**
 * Contracts for the snippet global installation. The pre-load stub is
 * deliberately the dumbest possible shape - it lives in customer HTML
 * forever and can never be hotfixed: `window.keewano = { q: [] }`,
 * calls pushed as `[method, ...args]` tuples. All intelligence lives
 * in the bundle.
 */

import type { WebKeewanoApi } from '../../types/keewano';

/** One queued call: the facade method name followed by its arguments. */
type SnippetCommand = [string, ...unknown[]];

/**
 * The post-load replacement for the stub's `q`.
 *
 * push - Feeds each pushed tuple through the command pump: an `init`
 *   tuple (or anything after one) executes against the live facade;
 *   tuples pushed before any `init` are buffered and flushed in
 *   arrival order once `init` lands. Returns the running total of
 *   commands pushed, matching `Array.prototype.push`'s
 *   returned-length contract.
 */
interface LiveCommandQueue {
  push(...commands: unknown[]): number;
}

/**
 * The single arrival-ordered command feed behind the live queue.
 *
 * queue - The `push` surface installed as `q` on the facade and the
 *   stub.
 * ingest - Append raw commands to the feed without touching the push
 *   count; used for the one-time stub snapshot replay.
 * noteInit - Record an `init` that arrived DIRECTLY on the live
 *   facade rather than through the queue. Without it a page that
 *   queued reports via the stub and then called `init()` itself -
 *   the documented SPA flow - would strand the held buffer forever,
 *   since nothing else ever flows through the queue once the live
 *   facade is installed.
 */
interface CommandPump {
  queue: LiveCommandQueue;
  ingest(commands: readonly unknown[]): void;
  noteInit(): void;
}

/**
 * A queued tuple that survived validation.
 *
 * method - Facade method name from the tuple head.
 * args - Remaining tuple elements, passed through verbatim.
 * fn - The facade's own callable for `method`, captured at parse time.
 */
interface ParsedCommand {
  method: string;
  args: unknown[];
  fn: (...fnArgs: unknown[]) => unknown;
}

/**
 * Host global object surface the facade installs onto. The property
 * is `unknown` because the pre-load stub (or an unrelated page
 * script) may have put anything there.
 */
interface KeewanoGlobalHost {
  keewano?: unknown;
}

/**
 * facade - The real `Keewano` facade the stub is replaced with.
 * globalObject - Host global (`globalThis` in the browser entry;
 *   injectable in tests).
 * isBootActive - Probe telling the pump whether a dispatched `init`
 *   actually armed the boot; defaults to the runtime latches
 *   (injectable in tests).
 */
interface InstallGlobalFacadeArgs {
  facade: WebKeewanoApi;
  globalObject: KeewanoGlobalHost;
  isBootActive?: () => boolean;
}

/**
 * facade - Facade the pump dispatches against.
 * isBootActive - See {@link InstallGlobalFacadeArgs}.
 */
interface CreateCommandPumpArgs {
  facade: WebKeewanoApi;
  isBootActive?: () => boolean;
}

/**
 * facade - Facade whose own methods are the only valid targets.
 * command - One `[method, ...args]` tuple from the queue (untyped;
 *   validated before dispatch).
 */
interface ParseCommandArgs {
  facade: WebKeewanoApi;
  command: unknown;
}

/**
 * facade - `this` receiver for the parsed method call.
 * command - Validated tuple to invoke.
 */
interface RunCommandArgs {
  facade: WebKeewanoApi;
  command: ParsedCommand;
}

export type {
  CommandPump,
  CreateCommandPumpArgs,
  InstallGlobalFacadeArgs,
  KeewanoGlobalHost,
  LiveCommandQueue,
  ParseCommandArgs,
  ParsedCommand,
  RunCommandArgs,
  SnippetCommand,
};
