/**
 * Local types for argv parsing. Kept distinct from the public `CliArgs`
 * re-export in `types/cli.ts` so internal helpers can be refactored
 * without churning the public surface.
 */

/**
 * Resolved argv shape after `parseArgv` runs.
 *
 * input - resolved absolute path to the input directory.
 * output - resolved absolute path of the .ts file to write.
 * watch - when true, the CLI stays in foreground and re-emits on change.
 * help / version - meta flags that short-circuit the run.
 */
interface ParsedCliArgs {
  input: string;
  output: string;
  watch: boolean;
  help: boolean;
  version: boolean;
}

/**
 * Per-token consumer state for the inner argv loop.
 *
 * args - the in-flight result object being populated.
 * token - the current argv token under inspection.
 * argv - the full argv array (for value-flag lookahead).
 * index - position of `token` within `argv`.
 */
interface ApplyArgvTokenArgs {
  args: ParsedCliArgs;
  token: string | undefined;
  argv: readonly string[];
  index: number;
}

/**
 * Helper input for reading a `--flag <value>` argv pair.
 *
 * name - the flag whose value is being read (for error messages).
 * argv - the full argv array.
 * index - position of the flag; the value is the next slot.
 */
interface ReadValueArgArgs {
  name: string;
  argv: readonly string[];
  index: number;
}

export type { ApplyArgvTokenArgs, ParsedCliArgs, ReadValueArgArgs };
