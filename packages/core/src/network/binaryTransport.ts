/**
 * The binary implementation of the `Transport` contract: ships an
 * `EncodedBatch` produced by the binary codec over the existing
 * ingress protocol (`POST /in`, K-* headers), behavior-identical to
 * the pre-seam direct `sendBatch` path.
 *
 * Outcome mapping: a 2xx response classifies as `ok`; any non-2xx or
 * network failure classifies as `retryable` (the historical
 * `false`); cancellation (`AbortError` / `TimeoutError`) propagates
 * as a throw so the send loop can stop the pass without retrying a
 * batch the caller asked to abort. The only `fatal` outcome is a
 * codec-id mismatch: a batch this transport can never ship.
 */

import type { Transport, TransportResult, TransportSendArgs } from './types/transport';

import { BINARY_CODEC_ID } from '../codec/binaryCodec';

import { sendBatch } from './sendBatch';

class BinaryTransport implements Transport {
  readonly codecId = BINARY_CODEC_ID;

  async send({ batch, ctx }: TransportSendArgs): Promise<TransportResult> {
    /**
     * This transport can never ship a foreign encoding, and a retry
     * would fail the same way forever; `fatal` is honest.
     */
    if (batch.codecId !== this.codecId) {
      return {
        kind: 'fatal',
        reason: `codec mismatch: expected ${this.codecId}, got ${batch.codecId}`,
      };
    }
    const ok = await sendBatch({
      baseUrl: ctx.endpoint,
      apiKey: ctx.apiKey,
      batch: {
        installId: ctx.installId,
        userId: batch.metadata.userId,
        dataSessionId: batch.metadata.dataSessionId,
        batchNum: batch.batchNum,
        batchStartTime: batch.batchStartTime,
        batchEndTime: batch.batchEndTime,
        batchVersion: batch.metadata.batchVersion,
        customEventsVersion: batch.metadata.customEventsVersion,
        data: batch.payload,
      },
      testUser: ctx.testUser,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      ...(ctx.extraHeaders === undefined ? {} : { extraHeaders: ctx.extraHeaders }),
    });
    return ok ? { kind: 'ok' } : { kind: 'retryable', reason: 'non-2xx or network failure' };
  }
}

export { BinaryTransport };
