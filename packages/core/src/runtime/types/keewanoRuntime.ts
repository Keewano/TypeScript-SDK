import type { KEventDispatcher } from '../../dispatcher';
import type { CustomEventSet } from '../../network';
import type { StorageAdapter } from '../../storage';

/**
 * Platform-agnostic runtime contract the shared `report*` emission and
 * the pre-init queue depend on. Each platform facade (React Native,
 * Node) builds a superset runtime that satisfies this interface and
 * installs it via `setRuntime`; the shared report helpers read only
 * the fields declared here, so the same emission logic produces
 * byte-identical events on every platform.
 *
 * dispatcher - Event accumulator the report methods emit through.
 * storage - Adapter the identity / test-user persistence writes to.
 * installId - 16-byte install UUID; read by getInstallId and the
 *   identity persistence path.
 * userId - 16-byte user UUID; all-zero until the host calls setUserId,
 *   which mutates it.
 * customEventSet - Optional host-declared custom-event schema; resolves
 *   a reportCustomEvent name to its wire id, or `undefined` when the
 *   host declared none.
 * onboardingCounters - Per-name dedup counter for reportOnboardingMilestone.
 * preSdkInFlight - One-shot latch serializing concurrent
 *   reportUserRegisteredBeforeSDKIntegration callers; `null` when idle.
 */
interface KeewanoRuntime {
  dispatcher: KEventDispatcher;
  storage: StorageAdapter;
  installId: Uint8Array;
  userId: Uint8Array;
  customEventSet: CustomEventSet | undefined;
  onboardingCounters: Map<string, number>;
  preSdkInFlight: Promise<void> | null;
}

export type { KeewanoRuntime };
