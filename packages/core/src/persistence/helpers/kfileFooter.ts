/**
 * Pack and unpack the 4-byte `.kwub` footer (`CustomEventsVersion`,
 * encoded as `uint32 LE`). Kept as a dedicated helper alongside
 * {@link ./kfileHeader} so the on-disk layout stays inspectable from
 * either end of the file.
 *
 * The footer is the schema-version stamp for the custom-events map
 * that produced the events in the payload. The server uses it to
 * decode `(uint16 customEventId)` payloads against the right schema.
 */

/** Footer byte length. */
const KFILE_FOOTER_SIZE = 4;

/**
 * Serialize the footer into a fresh 4-byte `Uint8Array`.
 *
 * @throws RangeError when `customEventsVersion` is not a non-negative
 *   integer below 2^32.
 */
function writeKFileFooter(customEventsVersion: number): Uint8Array {
  if (
    !Number.isInteger(customEventsVersion) ||
    customEventsVersion < 0 ||
    customEventsVersion > 0xffffffff
  ) {
    throw new RangeError('writeKFileFooter: customEventsVersion must be a uint32');
  }
  const footer = new Uint8Array(KFILE_FOOTER_SIZE);
  new DataView(footer.buffer, footer.byteOffset, footer.byteLength).setUint32(
    0,
    customEventsVersion,
    true,
  );
  return footer;
}

/**
 * Parse the 4-byte footer. Returns `null` when the input is too short
 * so a truncated file is rejected gracefully alongside header / payload
 * truncations.
 */
function readKFileFooter(bytes: Uint8Array): number | null {
  if (bytes.length < KFILE_FOOTER_SIZE) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}

export { KFILE_FOOTER_SIZE, readKFileFooter, writeKFileFooter };
