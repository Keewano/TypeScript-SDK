/**
 * Compose the generated `keewano-events.generated.ts` source from a
 * parsed event list. Two parts:
 *
 *   1. A typed wrapper function per event (`report{Name}`) that forwards
 *      to the target SDK's `reportCustomEvent`. For `react-native` /
 *      `expo` that is the top-level `Keewano.reportCustomEvent`; for
 *      `node` the wrapper takes a per-batch `UserReporter` (the relay
 *      emits inside `reportUserBatch`). The wrapper signatures give the
 *      host compile-time type safety; the runtime resolves the name to
 *      its wire id and payload type from the `events` list below.
 *   2. A `customEventSet` export carrying the binary payload (gzip bytes
 *      + FNV-1a version stamp) for `/custom` registration AND the
 *      readable `events` list the runtime uses to emit.
 *
 * The output is deterministic: same `events` + `target` -> byte-identical
 * TS source. No timestamps, no nondeterministic byte literals.
 */

import type { BuildResult } from './types/buildCustomEventSet';
import type { EmitArgs, EmitTarget, TargetSpec } from './types/emit';
import type { CustomEventTypeValue, ParsedEvent } from './types/event';

import { buildCustomEventSet } from './buildEventsSet';
import { EmitError } from './errors';
import { CUSTOM_EVENT_TYPE_NAMES } from './types/event';
import schema from '../schemas/custom-event.schema.json';

/**
 * Event-name validation shared with the parser: compiled from the
 * SAME schema (`custom-event.schema.json`) ajv enforces on the JSON
 * input, so the emit boundary can never accept a name the parser
 * would reject. Names are interpolated into identifier and
 * string-literal positions of the generated source; a name outside
 * `^[A-Z][A-Za-z0-9_]*$` (or over the schema length cap) would
 * produce a broken wrapper or inject code into the output.
 */
const EVENT_NAME_PATTERN = new RegExp(schema.properties.n.pattern);
const EVENT_NAME_MAX_LENGTH = schema.properties.n.maxLength;

/**
 * Emit spec per target. The `Record<EmitTarget, ...>` key union forces
 * every target to be covered here, so adding a target fails to compile
 * until its module + wrapper style are declared.
 */
const TARGET_SPECS: Readonly<Record<EmitTarget, TargetSpec>> = {
  'react-native': { moduleName: '@keewano/react-native-sdk', style: 'top-level' },
  expo: { moduleName: '@keewano/react-native-expo-sdk', style: 'top-level' },
  node: { moduleName: '@keewano/node-sdk', style: 'reporter' },
};

const DEFAULT_TARGET: EmitTarget = 'react-native';

/**
 * Per-type parameter list for the generated wrapper. Indexed by
 * `CustomEventTypeValue` so adding a new type forces this table to
 * compile (the `Record` key union enforces exhaustiveness). `None`
 * takes no argument and forwards no `value`.
 */
const WRAPPER_PARAM_BY_TYPE: Readonly<Record<CustomEventTypeValue, string>> = {
  0: '',
  1: 'value: string',
  2: 'value: number',
  3: 'value: boolean',
  4: 'value: Date',
  5: 'value: { x: number; y: number }',
  6: 'value: number',
};

function emitGeneratedSource({ events, target }: EmitArgs): string {
  const resolvedTarget = target ?? DEFAULT_TARGET;
  /**
   * `target` is typed, but the programmatic entry point can be called from
   * untyped JS. Validate through `isEmitTarget` (own keys only, via
   * `Object.hasOwn`) rather than an `undefined` check: a bare
   * `TARGET_SPECS[key]` lookup resolves inherited keys like `__proto__` /
   * `constructor` through the prototype chain, which would slip past an
   * `=== undefined` guard and emit malformed output instead of erroring.
   */
  if (!isEmitTarget(resolvedTarget)) {
    throw new EmitError(`emit: unsupported target "${String(resolvedTarget)}"`);
  }
  /**
   * The CLI path always feeds parser-validated events, but the
   * programmatic entry point can be handed arbitrary objects.
   * Validate at the boundary: names outside the parser's pattern
   * would break (or inject into) the generated source, and a type
   * outside the wrapper table would render a wrapper with an
   * `undefined` parameter list.
   */
  for (const event of events) {
    assertEmittableEvent(event);
  }
  const spec = TARGET_SPECS[resolvedTarget];
  const bytes = buildCustomEventSet(events);

  const sections = [
    renderHeaderComment(events),
    renderImports(spec),
    renderWrappers(events, spec),
    renderSetExport(bytes, events),
  ];
  return `${sections.join('\n\n')}\n`;
}

/** True when `value` names a supported emit target; narrows for the CLI's `--target` validation. */
function isEmitTarget(value: string): value is EmitTarget {
  return Object.hasOwn(TARGET_SPECS, value);
}

/**
 * Reject an event whose `name` fails the parser's schema pattern /
 * length cap or whose `type` is not a key of the wrapper table.
 * `Object.hasOwn` (not an index lookup) so prototype-chain keys
 * cannot slip through, mirroring `isEmitTarget`.
 */
function assertEmittableEvent(event: ParsedEvent): void {
  if (
    typeof event.name !== 'string' ||
    event.name.length > EVENT_NAME_MAX_LENGTH ||
    !EVENT_NAME_PATTERN.test(event.name)
  ) {
    throw new EmitError(`emit: invalid event name "${String(event.name)}"`);
  }
  if (!Object.hasOwn(WRAPPER_PARAM_BY_TYPE, event.type)) {
    throw new EmitError(`emit: unsupported event type ${String(event.type)}`);
  }
}

function renderHeaderComment(events: readonly ParsedEvent[]): string {
  /**
   * `**\/*.generated.ts` is excluded from ESLint via the repo's root
   * `ignorePatterns`, so no per-file `eslint-disable` comment is
   * emitted here. The header is pure documentation.
   */
  const body =
    events.length === 0
      ? ' *   (no events defined)'
      : events
          .map((e) => ` *   ${e.id}  ${e.name}  (${CUSTOM_EVENT_TYPE_NAMES[e.type]})`)
          .join('\n');
  return [
    '/**',
    ' * AUTO-GENERATED by @keewano/codegen.',
    ' * DO NOT EDIT. Re-run `npx @keewano/codegen` to regenerate.',
    ' *',
    ' * Events (sorted ordinal-by-name; index determines wire id):',
    body,
    ' */',
  ].join('\n');
}

function renderImports(spec: TargetSpec): string {
  if (spec.style === 'reporter') {
    /**
     * The relay emits through the reporter handed to `reportUserBatch`,
     * so the wrapper takes a `UserReporter`; there is no top-level
     * `Keewano` value to import.
     */
    return `import type { CustomEventSet, UserReporter } from '${spec.moduleName}';`;
  }
  return [
    `import type { CustomEventSet } from '${spec.moduleName}';`,
    '',
    `import { Keewano } from '${spec.moduleName}';`,
  ].join('\n');
}

function renderWrappers(events: readonly ParsedEvent[], spec: TargetSpec): string {
  if (events.length === 0) {
    return '// (no custom events declared yet)';
  }
  return events.map((event) => renderWrapper(event, spec)).join('\n\n');
}

function renderWrapper(event: ParsedEvent, spec: TargetSpec): string {
  const fnName = `report${event.name}`;
  const valueParam = WRAPPER_PARAM_BY_TYPE[event.type];
  const forwardValue = valueParam === '' ? '' : ', value';
  const reporterParam = spec.style === 'reporter' ? 'reporter: UserReporter' : '';
  const receiver = spec.style === 'reporter' ? 'reporter' : 'Keewano';
  const params = [reporterParam, valueParam].filter((p) => p !== '').join(', ');
  return [
    `export function ${fnName}(${params}): void {`,
    `  ${receiver}.reportCustomEvent({ name: '${event.name}'${forwardValue} });`,
    '}',
  ].join('\n');
}

function renderSetExport(bytes: BuildResult, events: readonly ParsedEvent[]): string {
  const versionLiteral = `0x${bytes.version.toString(16).toUpperCase().padStart(8, '0')}`;
  const gzipLiteral = formatBytesLiteral(bytes.gzipData);
  const eventsLiteral = renderEventsLiteral(events);
  return [
    'export const customEventSet: CustomEventSet = {',
    `  version: ${versionLiteral},`,
    `  eventCount: ${bytes.eventCount.toString(10)},`,
    `  gzipData: new Uint8Array(${gzipLiteral}),`,
    `  events: ${eventsLiteral},`,
    '};',
  ].join('\n');
}

function renderEventsLiteral(events: readonly ParsedEvent[]): string {
  if (events.length === 0) return '[]';
  const entries = events.map((e) => `    { name: '${e.name}', type: ${e.type} }`).join(',\n');
  return `[\n${entries},\n  ]`;
}

function formatBytesLiteral(bytes: Uint8Array): string {
  if (bytes.length === 0) return '[]';
  const tokens: string[] = [];
  for (const byte of bytes) {
    tokens.push(`0x${byte.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  return `[${tokens.join(', ')}]`;
}

export { DEFAULT_TARGET, emitGeneratedSource, isEmitTarget };
