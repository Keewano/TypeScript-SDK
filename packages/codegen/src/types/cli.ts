import type { ParsedCliArgs } from './argv';

/**
 * Parsed CLI argv shape.
 *
 * input - resolved absolute path to the input directory.
 * output - resolved absolute path of the .ts file to write. Defaults
 *   to `<input>/keewano-events.generated.ts`.
 * watch - when true, the CLI stays in foreground watching `input` and
 *   re-emits on debounced change.
 * help / version - meta flags that short-circuit the run.
 */
type CliArgs = ParsedCliArgs;

/**
 * Input for the internal `runOnce` orchestrator.
 *
 * input / output - resolved absolute paths chosen by `parseArgv`.
 */
interface RunOnceArgs {
  input: string;
  output: string;
}

export type { CliArgs, RunOnceArgs };
