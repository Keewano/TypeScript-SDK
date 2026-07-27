/**
 * Public programmatic entrypoint for `@keewano/codegen`.
 *
 * The package is shipped primarily as the `keewano-codegen` CLI; this
 * barrel exists so hosts that want to invoke the codegen step from a
 * build script can `import { parseEventDirectory, emitGeneratedSource }
 * from '@keewano/codegen'` without poking at internals.
 */

export type { BuildResult } from './types/buildCustomEventSet';
export type { CliArgs, RunOnceArgs } from './types/cli';
export type { CustomEventTypeValue, ParsedEvent, RawEventFile } from './types/event';
export type { EmitArgs, EmitTarget } from './types/emit';
export type { ParseArgs, ParseResult } from './types/parse';

export {
  buildCustomEventSet,
  normalizeGzipHeader,
  PIPELINE,
  serializeEvents,
} from './buildEventsSet';
export { CUSTOM_EVENT_TYPE_NAMES, CustomEventType, FIRST_CUSTOM_EVENT_ID } from './types/event';
export { EmitError, IoError, ParseError } from './errors';
export { emitGeneratedSource } from './emit';
export { EXIT_CODES, run } from './cli';
export { parseArgv } from './argv';
export { parseEventDirectory } from './parse';
export { stringifyError } from './stringifyError';
