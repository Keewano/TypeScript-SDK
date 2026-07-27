/**
 * The binary implementation of the `Codec` contract: the existing
 * wire format, byte-identical to the pre-seam pipeline.
 *
 * - Event encoding mirrors the dispatcher's historical inline writes:
 *   a 6-byte record header `[ts u32 LE][event_id u16 LE]` followed by
 *   the per-type payload bytes.
 * - Cut bookkeeping mirrors the historical rule: a cut is recorded at
 *   the boundary BEFORE an event when the bytes since the previous
 *   cut reach the threshold, so a cut never lands mid-event and a
 *   composite report never straddles two slices.
 * - The persisted container is the existing on-disk format (56-byte
 *   header + payload + 4-byte footer); the header/footer byte layout
 *   lives in the persistence helpers and is reused here unchanged.
 *
 * Byte-identity across the seam refactor is pinned by the golden
 * vectors in `__tests__/wire-pipeline.test.ts` and the differential
 * suite in `__tests__/binaryCodec.test.ts`.
 */

import type {
  BatchBuilder,
  BuilderBoolEventArgs,
  BuilderDateTimeEventArgs,
  BuilderEventArgs,
  BuilderFloatEventArgs,
  BuilderNumberEventArgs,
  BuilderStringCharEventArgs,
  BuilderStringEventArgs,
  BuilderStringItemsEventArgs,
  BuilderStringItemsExchangeEventArgs,
  BuilderUint16x2EventArgs,
  Codec,
  CreateBuilderArgs,
  EncodedBatch,
  EncodedBatchSlice,
  SealArgs,
  WireItem,
} from './types/codec';

/**
 * Internal cut bookkeeping: `pos` - byte offset of the boundary in
 * the encoded stream; `lastEventTime` - timestamp of the event the
 * closed span ends with.
 */
interface CutPoint {
  pos: number;
  lastEventTime: number;
}

import { BinaryStream } from '../encoding/binaryStream';
import { KFILE_FOOTER_SIZE, writeKFileFooter } from '../persistence/helpers/kfileFooter';
import {
  CURRENT_BATCH_VERSION,
  KFILE_HEADER_SIZE,
  readKFileHeader,
  writeKFileHeader,
} from '../persistence/helpers/kfileHeader';

/** Codec id stamped on every batch this codec encodes or decodes. */
const BINARY_CODEC_ID = 'binary';

class BinaryBatchBuilder implements BatchBuilder {
  private readonly stream: BinaryStream;
  private readonly cutThresholdBytes: number;
  private cutPositions: CutPoint[];
  private batchStartTime: number;
  private batchEndTime: number;

  constructor({ cutThresholdBytes }: CreateBuilderArgs) {
    this.stream = new BinaryStream();
    this.cutThresholdBytes = cutThresholdBytes;
    this.cutPositions = [];
    this.batchStartTime = 0;
    this.batchEndTime = 0;
  }

  addEvent({ eventId, timestamp }: BuilderEventArgs): void {
    this.writeHeader(eventId, timestamp);
  }

  addEventString({ eventId, timestamp, str }: BuilderStringEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeString(str);
  }

  addEventUint32({ eventId, timestamp, value }: BuilderNumberEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeUint32LE(value);
  }

  addEventInt32({ eventId, timestamp, value }: BuilderNumberEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeInt32LE(value);
  }

  addEventUint8({ eventId, timestamp, value }: BuilderNumberEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeUint8(value);
  }

  addEventFloat32({ eventId, timestamp, value }: BuilderFloatEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeFloat32LE(value);
  }

  addEventStringChar({ eventId, timestamp, str, charCode }: BuilderStringCharEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeString(str);
    this.stream.writeUint8(charCode);
  }

  addEventStringItems({ eventId, timestamp, str, items }: BuilderStringItemsEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeString(str);
    this.writeItems(items);
  }

  addEventStringItemsExchange({
    eventId,
    timestamp,
    str,
    from,
    to,
  }: BuilderStringItemsExchangeEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeString(str);
    this.writeItems(from);
    this.writeItems(to);
  }

  addEventUint16x2({ eventId, timestamp, x, y }: BuilderUint16x2EventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeUint16LE(x);
    this.stream.writeUint16LE(y);
  }

  addEventDateTime({ eventId, timestamp, dateUnixSec }: BuilderDateTimeEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeUint32LE(dateUnixSec);
  }

  addEventBool({ eventId, timestamp, flag }: BuilderBoolEventArgs): void {
    this.writeHeader(eventId, timestamp);
    this.stream.writeBool(flag);
  }

  byteSize(): number {
    return this.stream.length;
  }

  /**
   * Split the accumulation into slices of whole events along the
   * recorded cut points. Slice N spans `[prevCut.pos, cut.pos)` and
   * closes at the cut's `lastEventTime`; the tail closes at
   * `finalBatchEndTime`, clamped up to its own start so a backward
   * wall-clock move between event time and seal time can never emit
   * an inverted interval.
   */
  seal({ finalBatchEndTime }: SealArgs): EncodedBatchSlice[] {
    const payload = this.stream.toBytes();
    if (payload.length === 0) {
      return [];
    }
    const slices: EncodedBatchSlice[] = [];
    let lastReadPos = 0;
    let sliceStart = this.batchStartTime;
    for (const cut of this.cutPositions) {
      /**
       * Clamp every slice, not just the tail: frame timestamps are
       * wall-clock derived, so a backward clock move between two
       * events can invert an intermediate cut interval too. The
       * clamped value also seeds the next slice's start so intervals
       * stay monotonic across slices instead of overlapping.
       */
      const clampedEndTime = Math.max(sliceStart, cut.lastEventTime);
      if (cut.pos > lastReadPos) {
        slices.push({
          payload: payload.subarray(lastReadPos, cut.pos),
          batchStartTime: sliceStart,
          batchEndTime: clampedEndTime,
        });
      }
      lastReadPos = cut.pos;
      sliceStart = clampedEndTime;
    }
    if (lastReadPos < payload.length) {
      slices.push({
        payload: payload.subarray(lastReadPos),
        batchStartTime: sliceStart,
        batchEndTime: Math.max(sliceStart, finalBatchEndTime),
      });
    }
    return slices;
  }

  reset(): void {
    this.stream.reset();
    this.cutPositions = [];
    this.batchStartTime = 0;
    this.batchEndTime = 0;
  }

  /**
   * Pack an items array into the stream inline. Wire layout:
   * `[int32 count][repeating: string name | uint32 count]`. The
   * element count is int32 LE; each per-item count is uint32 LE.
   * Empty arrays are valid and written as `00 00 00 00`. Entries
   * arrive pre-normalized (filtered, truncated, clamped) from the
   * report layer, so they are written verbatim.
   */
  private writeItems(items: readonly WireItem[]): void {
    this.stream.writeInt32LE(items.length);
    for (const item of items) {
      this.stream.writeString(item.name);
      this.stream.writeUint32LE(item.count);
    }
  }

  /**
   * Record a pending cut at the boundary BEFORE this event, mark the
   * batch start on the first event, advance the end stamp, then write
   * the 6-byte record header. Order matters: the cut decision uses
   * the pre-event size and the PREVIOUS event's timestamp, exactly as
   * the pre-seam dispatcher did.
   */
  private writeHeader(eventId: number, timestamp: number): void {
    const currentSize = this.stream.length;
    const lastCutPos = this.cutPositions.at(-1)?.pos ?? 0;
    if (currentSize - lastCutPos >= this.cutThresholdBytes) {
      this.cutPositions.push({
        lastEventTime: this.batchEndTime,
        pos: currentSize,
      });
    }
    if (currentSize === 0) {
      this.batchStartTime = timestamp;
    }
    this.batchEndTime = timestamp;
    this.stream.writeUint32LE(timestamp);
    this.stream.writeUint16LE(eventId);
  }
}

class BinaryCodec implements Codec {
  readonly id = BINARY_CODEC_ID;

  createBuilder(args: CreateBuilderArgs): BatchBuilder {
    return new BinaryBatchBuilder(args);
  }

  /**
   * Compose the on-disk container: header + payload + footer. The
   * writer always stamps the CURRENT batch version regardless of
   * `batch.metadata.batchVersion` - that field exists for the load
   * path (the reader accepts older versions), mirroring the pre-seam
   * `saveBatch` semantics.
   */
  serializeContainer(batch: EncodedBatch): Uint8Array {
    /**
     * `Uint8Array.prototype.set` accepts any ArrayLike and silently
     * coerces non-byte values, so a plain number array would slip
     * through and emit a corrupted payload. Fail loudly at the
     * boundary instead (mirrors the identity-buffer guards inside
     * `writeKFileHeader`).
     */
    if (!(batch.payload instanceof Uint8Array)) {
      throw new TypeError('serializeContainer: payload must be a Uint8Array');
    }
    const header = writeKFileHeader({
      batchVersion: CURRENT_BATCH_VERSION,
      userId: batch.metadata.userId,
      dataSessionId: batch.metadata.dataSessionId,
      batchNum: batch.batchNum,
      batchStartTime: batch.batchStartTime,
      batchEndTime: batch.batchEndTime,
      dataSize: batch.payload.length,
    });
    const footer = writeKFileFooter(batch.metadata.customEventsVersion);
    const bytes = new Uint8Array(KFILE_HEADER_SIZE + batch.payload.length + KFILE_FOOTER_SIZE);
    bytes.set(header, 0);
    bytes.set(batch.payload, KFILE_HEADER_SIZE);
    bytes.set(footer, KFILE_HEADER_SIZE + batch.payload.length);
    return bytes;
  }

  /**
   * Strict inverse of {@link serializeContainer}. Returns `null` on
   * any corruption: short input, bad FourCC, unsupported version,
   * negative fields, or a `dataSize` that disagrees with the actual
   * byte length (trailing garbage rejects the whole container).
   */
  deserializeContainer(bytes: Uint8Array): EncodedBatch | null {
    const header = readKFileHeader(bytes);
    if (header === null) {
      return null;
    }
    const payloadEnd = KFILE_HEADER_SIZE + header.dataSize;
    if (payloadEnd + KFILE_FOOTER_SIZE !== bytes.length) {
      return null;
    }
    /**
     * Slice into owned buffers so the caller can keep the result past
     * the lifetime of the parent view (a storage adapter may reuse
     * internal buffers between reads).
     */
    const payload = bytes.slice(KFILE_HEADER_SIZE, payloadEnd);
    const footerView = new DataView(bytes.buffer, bytes.byteOffset + payloadEnd, KFILE_FOOTER_SIZE);
    return {
      codecId: BINARY_CODEC_ID,
      metadata: {
        userId: header.userId,
        dataSessionId: header.dataSessionId,
        batchVersion: header.batchVersion,
        customEventsVersion: footerView.getUint32(0, true),
      },
      batchNum: header.batchNum,
      batchStartTime: header.batchStartTime,
      batchEndTime: header.batchEndTime,
      payload,
    };
  }
}

export { BINARY_CODEC_ID, BinaryCodec };
