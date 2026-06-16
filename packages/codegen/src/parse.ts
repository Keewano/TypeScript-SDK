/**
 * Parse a directory of per-event JSON files into a sorted, validated
 * `ParsedEvent[]`.
 *
 * Algorithm:
 *   1. Enumerate every `*.json` under `inputDir` (non-recursive).
 *   2. JSON.parse each file and run the ajv-validated schema.
 *   3. Enforce the cross-file invariants: filename basename equals
 *      `n`; every `n` is unique.
 *   4. Sort the surviving entries ordinal (UTF-16 code-unit) by name
 *      so the wire `id` assignment is stable across builds.
 *   5. Stamp each entry with `id = FIRST_CUSTOM_EVENT_ID + index`.
 *
 * Errors are thrown as typed `ParseError` / `IoError` instances so the
 * CLI catch site can route exit codes via `instanceof` rather than
 * matching message prefixes.
 */

import type { ParseArgs, ParseResult } from './types/parse';
import type { ParsedEvent, RawEventFile } from './types/event';
import type { Dirent } from 'node:fs';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020';

import { FIRST_CUSTOM_EVENT_ID } from './types/event';
import { IoError, ParseError } from './errors';
import { stringifyError } from './stringifyError';
import schema from '../schemas/custom-event.schema.json';

// `Ajv2020` ships the draft-2020-12 meta-schema; the legacy `Ajv` default would throw "no schema with key or ref draft/2020-12/schema" at compile time.
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile<RawEventFile>(schema);

interface CollectedEntry {
  name: string;
  type: RawEventFile['t'];
  sourceFile: string;
}

/**
 * Wire-format ceiling on the number of custom events: every event id
 * is serialised as a `uint16 LE`, so the highest id that can round-trip
 * through the binary pipeline is 0xFFFF. With `FIRST_CUSTOM_EVENT_ID`
 * reserving the low ids, the practical maximum is `0x10000 - 2500`.
 * Past this threshold ids would silently wrap to 0 and corrupt the wire
 * map; reject the input directory upstream so the failure is loud.
 */
const MAX_CUSTOM_EVENT_COUNT = 0x10000 - FIRST_CUSTOM_EVENT_ID;

function parseEventDirectory({ inputDir }: ParseArgs): ParseResult {
  assertInputDirectory(inputDir);
  const fileNames = listJsonFiles(inputDir);
  const collected = collectEvents({ inputDir, fileNames });
  /**
   * The directory enumeration already sorts ordinal-by-filename, which
   * equals ordinal-by-name because we enforce `basename === n`. Re-sort
   * defensively against future changes in `readdirSync` ordering.
   */
  collected.sort((a, b) => ordinalCompare(a.name, b.name));
  enforceEventCountCap(collected.length);
  const events: ParsedEvent[] = collected.map((entry, index) => ({
    name: entry.name,
    type: entry.type,
    id: FIRST_CUSTOM_EVENT_ID + index,
    sourceFile: entry.sourceFile,
  }));
  return { events };
}

function enforceEventCountCap(count: number): void {
  if (count > MAX_CUSTOM_EVENT_COUNT) {
    throw new ParseError(
      `parse: too many custom events (${count}); maximum supported is ${MAX_CUSTOM_EVENT_COUNT}`,
    );
  }
}

function assertInputDirectory(inputDir: string): void {
  if (!existsSync(inputDir)) {
    throw new IoError(`parse: input directory ${inputDir} not found`);
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(inputDir);
  } catch (err: unknown) {
    throw new IoError(`parse: cannot stat input directory ${inputDir}: ${stringifyError(err)}`);
  }
  if (!stat.isDirectory()) {
    throw new IoError(`parse: ${inputDir} is not a directory`);
  }
}

function listJsonFiles(inputDir: string): string[] {
  /**
   * `withFileTypes: true` plus `entry.isFile()` filters out directories
   * named `foo.json/` that would otherwise trip the `.json` extension
   * filter and then crash `readFileSync` with `EISDIR`, aborting the
   * whole parse. Symbolic links to directories are also excluded.
   *
   * The wrap around `readdirSync` preserves the typed-error contract:
   * a permission/transient I/O failure (`EACCES`, `EBUSY`, race
   * between `assertInputDirectory` and the read) is re-thrown as an
   * `IoError` so both programmatic callers and the CLI orchestrator
   * map it consistently.
   */
  let entries: Dirent[];
  try {
    entries = readdirSync(inputDir, { withFileTypes: true });
  } catch (err: unknown) {
    throw new IoError(`parse: cannot read input directory ${inputDir}: ${stringifyError(err)}`);
  }
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
    .map((entry) => entry.name)
    .sort(ordinalCompare);
}

function collectEvents({
  inputDir,
  fileNames,
}: {
  inputDir: string;
  fileNames: readonly string[];
}): CollectedEntry[] {
  const seenNames = new Set<string>();
  const collected: CollectedEntry[] = [];
  for (const fileName of fileNames) {
    const entry = parseEventFile({ inputDir, fileName });
    if (seenNames.has(entry.name)) {
      throw new ParseError(`parse: duplicate event name "${entry.name}"`);
    }
    seenNames.add(entry.name);
    collected.push(entry);
  }
  return collected;
}

function parseEventFile({
  inputDir,
  fileName,
}: {
  inputDir: string;
  fileName: string;
}): CollectedEntry {
  const filePath = join(inputDir, fileName);
  /**
   * Strip the extension by its actual length rather than `basename(name,
   * '.json')`: the listing filter matches `.json` case-insensitively, so
   * a `Foo.JSON` entry must lose its uppercase extension too. A
   * case-sensitive strip would leave `Foo.JSON` and make the `n` check
   * blame the user's JSON for a filename-case mismatch.
   */
  const baseName = basename(fileName).slice(0, -extname(fileName).length);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    throw new IoError(`parse: ${fileName}: cannot read file: ${stringifyError(err)}`);
  }
  /**
   * Strip a leading UTF-8 BOM (U+FEFF). Some editors and Windows tooling
   * prepend it; left in place it makes `JSON.parse` throw an opaque
   * "Unexpected token" that never mentions the BOM.
   */
  if (raw.codePointAt(0) === 0xfeff) raw = raw.slice(1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new ParseError(`parse: ${fileName}: malformed JSON: ${stringifyError(err)}`);
  }
  if (!validate(parsed)) {
    const reason = ajv.errorsText(validate.errors, { dataVar: 'event', separator: '; ' });
    throw new ParseError(`parse: ${fileName}: ${reason}`);
  }
  if (parsed.n !== baseName) {
    throw new ParseError(`parse: ${fileName}: declares name "${parsed.n}"; expected "${baseName}"`);
  }
  return { name: parsed.n, type: parsed.t, sourceFile: filePath };
}

/**
 * Strict ordinal (UTF-16 code-unit) string comparator. The same input
 * set must produce the same event-id assignment across builds, so the
 * comparator must NOT use `localeCompare` (locale-dependent on
 * Turkish / Polish / German collation).
 */
function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export { enforceEventCountCap, MAX_CUSTOM_EVENT_COUNT, parseEventDirectory };
