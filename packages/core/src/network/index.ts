/**
 * HTTP transport layer for the Keewano ingress and custom-events
 * sub-protocol. Pure transport: stateless functions that wrap
 * `fetch` and map response codes into typed results. Orchestration
 * (consent gating, custom-events caching, retry loops) lives in
 * higher-level modules.
 */

export type { SendBatchArgs, SendBatchInput } from './types/sendBatch';
export type {
  Transport,
  TransportContext,
  TransportResult,
  TransportSendArgs,
} from './types/transport';
export type {
  CustomEventMapStatus,
  GetCustomEventMapStatusArgs,
  RegisterCustomEventMapArgs,
} from './types/customEventMap';
export type { CustomEventDef, CustomEventSet } from './types/customEventSet';
export type { CustomEventsRegistrar } from './types/customEventsRegistrar';
export type { RestIngestReceipt } from './types/restTransport';
export type { TransportFetch } from './types/transportFetch';

export {
  CONTENT_TYPE_OCTET_STREAM,
  ENDPOINT_PATH,
  KEEWANO_DEFAULT_BASE_URL,
} from './helpers/constants';
export { isAbortError } from './helpers/isAbortError';
export { joinEndpoint } from './helpers/joinEndpoint';
export { configureSdkPlatform } from './helpers/sdkTag';

export { BinaryCustomEventsRegistrar } from './binaryCustomEventsRegistrar';
export { BinaryTransport } from './binaryTransport';
export { getCustomEventMapStatus, registerCustomEventMap } from './customEventMap';
export { RestCustomEventsRegistrar } from './restCustomEventsRegistrar';
export { EXIT_MAX_BODY_BYTES, REST_MAX_BODY_BYTES, RestTransport } from './restTransport';
export { sendBatch } from './sendBatch';
export {
  configureTransportFetch,
  isTransportFetchConfigured,
  resolveTransportFetch,
} from './transportFetch';
