/**
 * The binary implementation of the `CustomEventsRegistrar` contract:
 * a thin delegation to the existing `/custom` sub-protocol functions,
 * so binary hosts keep their exact pre-seam registration behavior.
 */

import type {
  CustomEventMapStatus,
  GetCustomEventMapStatusArgs,
  RegisterCustomEventMapArgs,
} from './types/customEventMap';
import type { CustomEventsRegistrar } from './types/customEventsRegistrar';

import { BINARY_CODEC_ID } from '../codec/binaryCodec';
import { getCustomEventMapStatus, registerCustomEventMap } from './customEventMap';

class BinaryCustomEventsRegistrar implements CustomEventsRegistrar {
  readonly codecId = BINARY_CODEC_ID;

  getStatus(args: GetCustomEventMapStatusArgs): Promise<CustomEventMapStatus> {
    return getCustomEventMapStatus(args);
  }

  register(args: RegisterCustomEventMapArgs): Promise<boolean> {
    return registerCustomEventMap(args);
  }
}

export { BinaryCustomEventsRegistrar };
