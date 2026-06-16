/**
 * CLI orchestrator. Boots the binary, parses argv, runs the parse +
 * emit pipeline (one-shot or watched), and translates thrown errors
 * into exit codes via `instanceof` checks on the typed error
 * hierarchy declared in `errors.ts`.
 *
 * Exit code contract (also documented on `EXIT_CODES`):
 *
 *   0  emit succeeded (or no-op when output already matches)
 *   1  validation error (ParseError)
 *   2  I/O error (IoError, or NodeJS errno-shaped error)
 *   3  internal error (EmitError, or unknown throw type)
 */

import type { CliArgs, RunOnceArgs } from './types/cli';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

import { parseArgv } from './argv';
import { CLI_DEFAULTS, EXIT_CODES, USAGE } from './defaults';
import { emitGeneratedSource } from './emit';
import { EmitError, IoError, ParseError } from './errors';
import { parseEventDirectory } from './parse';
import { runWatchLoop } from './watch';
import { stringifyError } from './stringifyError';

async function run(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgv(argv);
  } catch (err: unknown) {
    process.stderr.write(`${stringifyError(err)}\n${USAGE}\n`);
    return EXIT_CODES.VALIDATION;
  }

  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_CODES.OK;
  }
  if (args.version) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return EXIT_CODES.OK;
  }

  const initialExit = runOnce({ input: args.input, output: args.output });
  if (!args.watch) return initialExit;
  if (initialExit !== EXIT_CODES.OK) return initialExit;

  try {
    /**
     * The loop returns the exit code of the last re-emit so a watch
     * session ending after a failed save propagates that failure
     * instead of a silent `OK`.
     */
    return await runWatchLoop({
      args: { input: args.input, output: args.output },
      onChange: runOnce,
    });
  } catch (err: unknown) {
    /**
     * A throw out of `runWatchLoop` is either a chokidar-not-installed
     * IoError or an unexpected internal failure; route through the same
     * typed-error classifier the one-shot path uses so the documented
     * exit code contract holds for `--watch` too.
     */
    process.stderr.write(`${stringifyError(err)}\n`);
    return classifyExitCode(err);
  }
}

function runOnce({ input, output }: RunOnceArgs): number {
  try {
    const { events } = parseEventDirectory({ inputDir: input });
    const source = emitGeneratedSource({ events });
    const existing = readExistingSource(output);
    if (existing === source) {
      process.stdout.write(`keewano-codegen: ${output} up to date (${events.length} events)\n`);
      return EXIT_CODES.OK;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, source, 'utf8');
    process.stdout.write(`keewano-codegen: wrote ${output} (${events.length} events)\n`);
    return EXIT_CODES.OK;
  } catch (err: unknown) {
    process.stderr.write(`${stringifyError(err)}\n`);
    return classifyExitCode(err);
  }
}

/**
 * Map a thrown value to the documented exit code. Typed error classes
 * win first; legacy NodeJS errno-shaped errors are routed to IO.
 */
function classifyExitCode(err: unknown): number {
  if (err instanceof ParseError) return EXIT_CODES.VALIDATION;
  if (err instanceof IoError) return EXIT_CODES.IO;
  if (err instanceof EmitError) return EXIT_CODES.INTERNAL;
  if (isFsErrnoError(err)) return EXIT_CODES.IO;
  return EXIT_CODES.INTERNAL;
}

/**
 * Read the existing generated file. Returns `undefined` when the file
 * does not exist; rethrows on any other error so a permission /
 * locked-file problem surfaces as IO, not as a silent overwrite.
 */
function readExistingSource(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (err: unknown) {
    if (isErrnoCode(err, 'ENOENT')) return undefined;
    throw err;
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === code;
}

function isFsErrnoError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(code);
}

function readPackageVersion(): string {
  /**
   * Two candidate paths cover both deployments:
   *
   *   1. Compiled CLI:   `dist/src/cli.js` -> `../..` -> `<pkg>/package.json`
   *   2. Source / tests: `src/cli.ts`      -> `..`    -> `<pkg>/package.json`
   *
   * The compiled path is tried first because production is the hot
   * case; the source path is the fallback so a jest run or programmatic
   * invocation surfaces the real version instead of silently returning
   * `UNKNOWN_VERSION` and masking packaging regressions.
   */
  const candidatePaths = [
    resolvePath(__dirname, '..', '..', 'package.json'),
    resolvePath(__dirname, '..', 'package.json'),
  ];
  for (const pkgPath of candidatePaths) {
    try {
      const raw = readFileSync(pkgPath, 'utf8');
      /**
       * JSON.parse returns `any`. Narrow to the only field we touch so
       * a corrupted package.json (missing `version`, wrong type) falls
       * through to the next candidate instead of producing
       * `undefined.toString()` later.
       */
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      /** Try the next candidate path. */
    }
  }
  return CLI_DEFAULTS.UNKNOWN_VERSION;
}

export { EXIT_CODES, run };
