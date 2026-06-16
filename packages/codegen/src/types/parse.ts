import type { ParsedEvent } from './event';

/**
 * Input arguments for {@link parseEventDirectory}.
 *
 * inputDir - absolute path of the source directory. Must exist and be
 *   readable. Non-`.json` entries are ignored.
 */
interface ParseArgs {
  inputDir: string;
}

/**
 * Successful parse result. `events` is sorted ordinal-by-name and each
 * entry's `id` is already populated.
 */
interface ParseResult {
  events: readonly ParsedEvent[];
}

export type { ParseArgs, ParseResult };
