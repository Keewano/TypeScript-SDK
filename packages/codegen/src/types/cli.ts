import type { ParsedCliArgs } from './argv';
import type { EmitTarget } from './emit';

/**
 * Parsed CLI argv shape.
 *
 * input - resolved absolute path to the input directory.
 * output - resolved absolute path of the .ts file to write. Defaults
 *   to `<input>/keewano-events.generated.ts`.
 * target - SDK the generated module is emitted for.
 * watch - when true, the CLI stays in foreground watching `input` and
 *   re-emits on debounced change.
 * help / version - meta flags that short-circuit the run.
 */
type CliArgs = ParsedCliArgs;

/**
 * Input for the internal `runOnce` orchestrator.
 *
 * input / output - resolved absolute paths chosen by `parseArgv`.
 * target - SDK to emit for; forwarded to `emitGeneratedSource`.
 */
interface RunOnceArgs {
  input: string;
  output: string;
  target: EmitTarget;
}

export type { CliArgs, RunOnceArgs };
