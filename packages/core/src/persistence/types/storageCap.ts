/**
 * Args for the disk-cap reduction pass.
 *
 * storage - Storage adapter that backs the batch directory.
 * dir - Adapter-relative batch directory to reduce.
 * capBytes - Byte budget the directory must not exceed.
 * codec - Codec used to parse the oversized containers and encode
 *   the replacement tombstones.
 */

import type { Codec } from '../../codec/types/codec';
import type { StorageAdapter } from '../../storage';

interface ReduceStorageSizeArgs {
  storage: StorageAdapter;
  dir: string;
  capBytes: number;
  codec: Codec;
}

export type { ReduceStorageSizeArgs };
