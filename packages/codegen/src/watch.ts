/**
 * `--watch` loop. Lazy-loads `chokidar` so a one-shot CLI invocation
 * (e.g. `--help`, `--version`) does not pay the cost of pulling in the
 * file-watcher native deps. The loop installs SIGINT / SIGTERM
 * shutdown handlers and resolves only when one of them fires.
 */

import type { RunOnceArgs } from './types/cli';

import { basename } from 'node:path';

import { CLI_DEFAULTS, EXIT_CODES } from './defaults';
import { IoError } from './errors';
import { stringifyError } from './stringifyError';

/**
 * Ignore dot-prefixed entries (`.DS_Store`, `.gitignore`, editor temp
 * files) by their OWN basename only. A regex against the full path -
 * e.g. `/(^|[/\\])\../` - would also match any dot-prefixed ANCESTOR
 * segment (`~/.config/events`, a hidden project dir), silently making
 * chokidar ignore every file under such a root so `--watch` never
 * fires. Matching the basename keeps the dotfile filter scoped to the
 * leaf entry regardless of where the watched directory lives.
 */
function isDotEntry(testPath: string): boolean {
  return basename(testPath).startsWith('.');
}

/**
 * Start watching `args.input` and re-run `onChange` (debounced) on
 * every `add`/`change`/`unlink` event. Resolves on SIGINT or SIGTERM
 * with the exit code of the last re-emit (0 if no change ever fired),
 * so a watch session that ends after a failed re-emit reports the
 * failure instead of a silent success.
 */
async function runWatchLoop({
  args,
  onChange,
}: {
  args: RunOnceArgs;
  onChange: (args: RunOnceArgs) => number;
}): Promise<number> {
  let chokidar: typeof import('chokidar');
  try {
    chokidar = await import('chokidar');
  } catch (err: unknown) {
    /**
     * A missing chokidar means `--watch` is structurally broken; surface
     * that as a typed error so the orchestrator maps it to the IO exit
     * code instead of letting the loop resolve with success and report
     * an OK exit for a watch that never started.
     */
    throw new IoError(`keewano-codegen: --watch requires "chokidar": ${stringifyError(err)}`);
  }
  process.stdout.write(`keewano-codegen: watching ${args.input}\n`);
  const watcher = chokidar.watch(args.input, {
    ignored: (testPath: string) => isDotEntry(testPath),
    persistent: true,
    ignoreInitial: true,
  });

  /**
   * Exit code of the most recent debounced re-emit. Returned on
   * shutdown so a watch session that ends after a failed re-emit
   * propagates that failure instead of a silent `OK`.
   */
  let lastExit: number = EXIT_CODES.OK;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const trigger = (): void => {
    if (scheduled !== undefined) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      scheduled = undefined;
      lastExit = onChange(args);
    }, CLI_DEFAULTS.WATCH_DEBOUNCE_MS);
  };
  watcher.on('add', trigger).on('change', trigger).on('unlink', trigger);

  await new Promise<void>((resolveLoop, rejectLoop) => {
    let settled = false;
    const cleanup = (): void => {
      if (scheduled !== undefined) clearTimeout(scheduled);
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      watcher.off('error', onError);
    };
    const shutdown = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      watcher.close().then(resolveLoop, resolveLoop);
    };
    /**
     * chokidar extends `EventEmitter`; an unhandled `error` event would
     * otherwise terminate the process with an uncaught exception. Route
     * the error through the promise rejection so the CLI orchestrator
     * can map it to the IO exit code via the typed-error classifier.
     */
    const onError = (err: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      watcher.close().finally(() => rejectLoop(err));
    };
    watcher.on('error', onError);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return lastExit;
}

export { isDotEntry, runWatchLoop };
