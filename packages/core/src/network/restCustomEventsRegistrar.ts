/**
 * The REST implementation of the `CustomEventsRegistrar` contract,
 * over the JSON ingestion API:
 *
 * - `GET /event/ingress/v1/json/custom?customEventsHash=<n>` - 200
 *   (`{customEventsHash, registered: true}`) means the map is known,
 *   204 means it needs registration.
 * - `POST /event/ingress/v1/json/custom` with the JSON body
 *   `{"customEventsHash": N, "eventTypes": [{"eventTypeId",
 *   "name", "dataType"}]}` - a 2xx receipt registers the map.
 *
 * Both carry the key in the `k-token` header; unlike the ingestion
 * route, these two reject it as a query parameter.
 *
 * Unlike the binary `/custom` protocol there is no gzip blob: the
 * registration body is built from the set's readable `events`
 * entries, so a `CustomEventSet` without them cannot register over
 * REST (a configuration error, thrown loudly).
 */

import type {
  CustomEventMapStatus,
  GetCustomEventMapStatusArgs,
  RegisterCustomEventMapArgs,
} from './types/customEventMap';
import type { CustomEventsRegistrar } from './types/customEventsRegistrar';

import { JSON_CODEC_ID } from '../codec/jsonCodec';
import { assertIntInRange } from '../encoding/assertions';
import {
  CUSTOM_EVENT_DATA_TYPE_NAME,
  customEventIdAt,
  findCustomEventIdCollision,
} from '../events';

import { LIMITS } from '../encoding/limits';
import { assertHeaderValue } from './helpers/assertHeaderValue';
import { hardenedRequestInit } from './helpers/hardenedRequestInit';
import { isAbortError } from './helpers/isAbortError';
import { joinEndpoint } from './helpers/joinEndpoint';
import { mergeExtraHeaders } from './helpers/mergeExtraHeaders';
import { releaseResponseBody } from './helpers/releaseResponseBody';
import { resolveTransportFetch } from './transportFetch';

/**
 * Endpoint path of the JSON custom-events pair, relative to the
 * configured base URL. See the note on the ingestion path: the
 * deployed service answers on `/event/ingress/v1/json/...`, not on the
 * `/api/v1/json/...` the published reference shows.
 */
const REST_CUSTOM_PATH = '/event/ingress/v1/json/custom';

/**
 * The batch route takes the key as a query parameter, because the
 * request a closing page issues cannot set headers. These two routes
 * are different: the check route validates its query strictly and
 * refuses an unknown `k-token` parameter outright, and neither of them
 * is ever issued from a closing page. Both send the key as a header.
 */
const REST_AUTH_HEADER = 'k-token';

/** `200` - the server knows the map; `204` - it wants a registration; anything else is a transient failure. */
function mapStatus(status: number): CustomEventMapStatus {
  if (status === 200) {
    return 'known';
  }
  if (status === 204) {
    return 'needs-registration';
  }
  return 'error';
}

class RestCustomEventsRegistrar implements CustomEventsRegistrar {
  readonly codecId = JSON_CODEC_ID;

  async getStatus(args: GetCustomEventMapStatusArgs): Promise<CustomEventMapStatus> {
    const { baseUrl, apiKey, version, signal, extraHeaders } = args;
    assertHeaderValue({
      value: apiKey,
      fnName: 'restRegistrar.getStatus',
      field: 'apiKey',
      allowEmpty: false,
    });
    assertIntInRange({
      fnName: 'restRegistrar.getStatus: version',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: version,
    });
    const url = `${joinEndpoint({ baseUrl, path: REST_CUSTOM_PATH })}?customEventsHash=${version}`;
    const init = hardenedRequestInit({
      method: 'GET',
      headers: mergeExtraHeaders({
        reserved: { [REST_AUTH_HEADER]: apiKey },
        extra: extraHeaders,
        fnName: 'restRegistrar.getStatus',
      }),
      signal,
    });
    let response: Response;
    try {
      response = await resolveTransportFetch().call(globalThis, url, init);
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error;
      }
      return 'error';
    }
    const result = mapStatus(response.status);
    try {
      await releaseResponseBody(response);
    } catch {
      /** Best-effort cleanup only; preserve the mapped protocol result. */
    }
    return result;
  }

  async register(args: RegisterCustomEventMapArgs): Promise<boolean> {
    const { baseUrl, apiKey, ceSet, signal, extraHeaders } = args;
    assertHeaderValue({
      value: apiKey,
      fnName: 'restRegistrar.register',
      field: 'apiKey',
      allowEmpty: false,
    });
    assertIntInRange({
      fnName: 'restRegistrar.register: ceSet.version',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: ceSet.version,
    });
    /**
     * A set without readable entries cannot be expressed as a JSON
     * registration body. Codegen always emits `events`; its absence
     * is a wiring bug, surfaced as a throw so it cannot masquerade
     * as a transient registration retry.
     */
    if (ceSet.events === undefined) {
      throw new TypeError('restRegistrar.register: ceSet.events required');
    }
    /**
     * Two entries on one id would register cleanly and be wrong forever:
     * the body keeps whichever came last, and every report of the other
     * arrives under its name. Same wiring-bug throw as the checks around
     * it - a set that cannot be registered truthfully must not be.
     */
    const collision = findCustomEventIdCollision(ceSet.events);
    if (collision !== null) {
      throw new TypeError(
        `restRegistrar.register: "${collision.names[0]}" and "${collision.names[1]}" both resolve to id ${String(collision.id)}`,
      );
    }
    const eventTypes = ceSet.events.map((def, index) => {
      const dataType = CUSTOM_EVENT_DATA_TYPE_NAME[def.type];
      /**
       * A set is host-supplied and may be hand-built. An unmapped
       * payload type would drop the field from the body entirely, and
       * the server would reject the registration on every tick -
       * blocking all delivery for the session behind a body that
       * looks almost right. Same wiring-bug throw as a missing
       * `events` above.
       */
      if (dataType === undefined) {
        throw new TypeError(`restRegistrar.register: unknown payload type ${def.type}`);
      }
      const eventTypeId = customEventIdAt({ declaredId: def.id, index });
      return { eventTypeId, name: def.name, dataType };
    });
    const body = JSON.stringify({ customEventsHash: ceSet.version, eventTypes });
    const url = joinEndpoint({ baseUrl, path: REST_CUSTOM_PATH });
    const init = hardenedRequestInit({
      method: 'POST',
      headers: mergeExtraHeaders({
        reserved: { 'Content-Type': 'application/json', [REST_AUTH_HEADER]: apiKey },
        extra: extraHeaders,
        fnName: 'restRegistrar.register',
      }),
      body,
      signal,
    });
    try {
      const response = await resolveTransportFetch().call(globalThis, url, init);
      const ok = response.ok;
      try {
        await releaseResponseBody(response);
      } catch {
        /** Best-effort cleanup only; preserve the real HTTP result. */
      }
      return ok;
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error;
      }
      return false;
    }
  }
}

export { RestCustomEventsRegistrar };
