/**
 * Typed error hierarchy. The CLI routes exit codes via `instanceof`
 * checks (see `cli.ts`), so throw sites stamp the intent into the
 * type system instead of a magic message prefix.
 *
 * ParseError - JSON, schema, or file-content validation failed. CLI
 *   maps to `EXIT_CODES.VALIDATION` (1).
 * IoError - filesystem operation failed (missing input, permission,
 *   write target unreachable). CLI maps to `EXIT_CODES.IO` (2).
 * EmitError - emit-side internal failure (unreachable type, encoder
 *   bug). CLI maps to `EXIT_CODES.INTERNAL` (3).
 */
class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

class IoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IoError';
  }
}

class EmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmitError';
  }
}

export { EmitError, IoError, ParseError };
