/** Args types for the tracker lifecycle pipeline. */

import type { WebKeewanoConfig } from './config';
import type { ResolveWindowName } from '../trackers/types/navigation';
import type { WebSdkRuntime } from './runtime';

/**
 * runtime - Active runtime whose `detachFns` collects the teardown
 *   callbacks.
 * config - Caller-supplied init config; `plugins`, the `disable*`
 *   tracker flags, and `resolveWindowName` are read.
 */
interface AttachTrackersArgs {
  runtime: WebSdkRuntime;
  config: WebKeewanoConfig;
}

/**
 * runtime - Active runtime; supplies the dispatcher the direct-write
 *   trackers emit into.
 * config - Caller-supplied init config; the `disable*` flags gate
 *   which built-ins are constructed, `resolveWindowName` feeds the
 *   navigation tracker.
 */
interface BuildBuiltInsArgs {
  runtime: WebSdkRuntime;
  config: WebKeewanoConfig;
}

/**
 * Guarded snapshot of the tracker-gating config fields. Every gate
 * defaults to enabled; `resolveWindowName` is present only when the
 * config supplied a function.
 *
 * navigation / button / error / appState / network - `true` when the
 *   corresponding built-in tracker should attach.
 * resolveWindowName - validated host resolver for the navigation
 *   tracker.
 */
interface BuiltInGates {
  navigation: boolean;
  button: boolean;
  error: boolean;
  appState: boolean;
  network: boolean;
  resolveWindowName?: ResolveWindowName;
}

/**
 * runtime - Active runtime whose `detachFns` collects the teardown
 *   callbacks.
 * tracker - One candidate tracker entry. `unknown` because plugin
 *   arrays can come from untyped page JS; validated before attach.
 */
interface AttachOneTrackerArgs {
  runtime: WebSdkRuntime;
  tracker: unknown;
}

/**
 * value - Whatever the tracker's `attach()` returned; `unknown`
 *   because plugins come from untyped page JS.
 * tracker - The owning tracker entry, named in the diagnostic when
 *   `value` violates the detach contract.
 */
interface NormalizeDetachArgs {
  value: unknown;
  tracker: unknown;
}

export type {
  AttachOneTrackerArgs,
  AttachTrackersArgs,
  BuildBuiltInsArgs,
  BuiltInGates,
  NormalizeDetachArgs,
};
