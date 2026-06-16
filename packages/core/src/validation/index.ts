/**
 * Cross-cutting runtime validation predicates shared across the wire,
 * dispatcher, identity, and facade layers.
 */

export {
  hasControlChar,
  isByteString,
  isControlCharCode,
  isNonByteStringCharCode,
} from './headerSafe';
