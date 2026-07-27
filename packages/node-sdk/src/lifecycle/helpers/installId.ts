/**
 * Relay install-id resolution. A server relay has no per-device install
 * id, but the backend requires a non-zero `K-InstallId`. The project id
 * embedded in the API-key JWT (the same token already identifies the
 * project) is a stable, backend-known value, so the relay sends that. A
 * host may override it with `config.installId`; a key that is not a
 * project JWT (e.g. a test key) falls back to the all-zero id, in which
 * case the backend rejects the request on the `K-Token` anyway.
 */

import type { NodeKeewanoConfig } from '../../types/config';

import { uuidToBytes } from '@keewano/core';

/** UUID byte length (the all-zero fallback id). */
const UUID_BYTE_LENGTH = 16;

/**
 * Extract the `projectId` claim from a project API-key JWT, or `null`
 * when `apiKey` is not a three-part JWT or carries no string `projectId`.
 * Never throws: a malformed key resolves to `null` so the caller can fall
 * back rather than crash init.
 */
function projectIdFromApiKey(apiKey: string): string | null {
  try {
    const parts = apiKey.split('.');
    const payload = parts[1];
    if (parts.length !== 3 || payload === undefined) {
      return null;
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      projectId?: unknown;
    };
    return typeof claims.projectId === 'string' ? claims.projectId : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the relay's install id: the explicit `config.installId`
 * override when set, otherwise the project id from the API-key JWT,
 * otherwise the all-zero id.
 *
 * @throws TypeError when the `installId` override is not a 36-char
 *   hyphenated UUID. A non-UUID `projectId` claim does NOT throw - it
 *   falls back to the all-zero id, since the API key is opaque to the
 *   host and must not crash init.
 */
function resolveInstallId(config: NodeKeewanoConfig): Uint8Array {
  if (typeof config.installId === 'string' && config.installId.length > 0) {
    return uuidToBytes(config.installId);
  }
  const projectId = projectIdFromApiKey(config.apiKey);
  if (projectId !== null) {
    try {
      return uuidToBytes(projectId);
    } catch {
      /* projectId is present but not a UUID; fall back to all-zero */
    }
  }
  return new Uint8Array(UUID_BYTE_LENGTH);
}

export { resolveInstallId };
