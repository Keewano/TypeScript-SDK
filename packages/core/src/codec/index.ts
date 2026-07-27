/**
 * Pluggable batch-encoding layer: the `Codec` / `BatchBuilder`
 * contracts and their implementations. See `types/codec.ts` for the
 * contract documentation; the binary codec (the existing wire format)
 * and the JSON codec (REST ingestion) implement it.
 */

export type {
  BatchBuilder,
  BatchMetadata,
  BuilderBoolEventArgs,
  BuilderDateTimeEventArgs,
  BuilderEventArgs,
  BuilderNumberEventArgs,
  BuilderStringEventArgs,
  BuilderUint16x2EventArgs,
  Codec,
  CreateBuilderArgs,
  EncodedBatch,
  EncodedBatchSlice,
  SealArgs,
} from './types/codec';

export { BINARY_CODEC_ID, BinaryCodec } from './binaryCodec';
