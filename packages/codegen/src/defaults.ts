/**
 * Defaults + exit codes for the CLI. Grouped as namespaced `as const`
 * objects so consumers reference them via `CLI_DEFAULTS.INPUT_DIR`
 * etc. rather than importing loose top-level constants.
 *
 * CLI_DEFAULTS - boot-time defaults for the user-facing flags.
 *   INPUT_DIR - default `--input` directory (relative to cwd).
 *   GENERATED_FILE_NAME - default output basename.
 *   WATCH_DEBOUNCE_MS - chokidar event coalescing window.
 *
 * EXIT_CODES - documented contract:
 *   OK         - emit succeeded (or no-op when output already matches).
 *   VALIDATION - input rejected by schema / coherence checks (`ParseError`).
 *   IO         - filesystem operation failed (`IoError`).
 *   INTERNAL   - unexpected error (`EmitError` or unknown throw type).
 */

const CLI_DEFAULTS = {
  INPUT_DIR: 'keewano-custom-events',
  GENERATED_FILE_NAME: 'keewano-events.generated.ts',
  WATCH_DEBOUNCE_MS: 100,
  UNKNOWN_VERSION: 'unknown',
} as const;

const EXIT_CODES = {
  OK: 0,
  VALIDATION: 1,
  IO: 2,
  INTERNAL: 3,
} as const;

const USAGE = [
  'Usage: keewano-codegen [options]',
  '',
  'Options:',
  `  --input <dir>     Source directory of *.json event files (default: ./${CLI_DEFAULTS.INPUT_DIR})`,
  `  --output <file>   Destination .ts file (default: <input>/${CLI_DEFAULTS.GENERATED_FILE_NAME})`,
  '  --target <sdk>    Target SDK: react-native (default), expo, or node',
  '  --watch           Watch input dir for changes and re-emit on save',
  '  --help            Print this help and exit',
  '  --version         Print package version and exit',
].join('\n');

export { CLI_DEFAULTS, EXIT_CODES, USAGE };
