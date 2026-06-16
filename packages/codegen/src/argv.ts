/**
 * CLI argv parser. Returns a `ParsedCliArgs` shape with resolved
 * absolute paths and boolean flags; throws `ParseError` on unknown
 * flags or value-flags missing their value.
 */

import type { ApplyArgvTokenArgs, ParsedCliArgs, ReadValueArgArgs } from './types/argv';

import { isAbsolute, resolve as resolvePath } from 'node:path';

import { CLI_DEFAULTS } from './defaults';
import { ParseError } from './errors';

function parseArgv(argv: readonly string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    input: resolvePath(process.cwd(), CLI_DEFAULTS.INPUT_DIR),
    output: '',
    watch: false,
    help: false,
    version: false,
  };
  let i = 0;
  while (i < argv.length) {
    i += applyArgvToken({ args, token: argv[i], argv, index: i });
  }
  if (args.output === '') {
    args.output = resolvePath(args.input, CLI_DEFAULTS.GENERATED_FILE_NAME);
  }
  return args;
}

/**
 * Apply one argv token (and any value it consumes) to the in-flight
 * `args` object. Returns the slot count the token consumed (1 for
 * boolean flags, 2 for value flags). Throws on unknown options or on
 * a value flag whose next slot is missing.
 */
function applyArgvToken({ args, token, argv, index }: ApplyArgvTokenArgs): number {
  switch (token) {
    case '--input':
      args.input = resolveArgPath(readValueArg({ name: '--input', argv, index }));
      return 2;
    case '--output':
      args.output = resolveArgPath(readValueArg({ name: '--output', argv, index }));
      return 2;
    case '--watch':
      args.watch = true;
      return 1;
    case '--help':
    case '-h':
      args.help = true;
      return 1;
    case '--version':
    case '-v':
      args.version = true;
      return 1;
    default:
      throw new ParseError(`parse: unknown option "${String(token)}"`);
  }
}

function readValueArg({ name, argv, index }: ReadValueArgArgs): string {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new ParseError(`parse: ${name} requires a value`);
  }
  return next;
}

function resolveArgPath(value: string): string {
  return isAbsolute(value) ? value : resolvePath(process.cwd(), value);
}

export { parseArgv };
