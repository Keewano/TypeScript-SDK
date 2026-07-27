import type { ParsedEvent } from './event';

/**
 * SDK the generated module is emitted for. Selects both the import
 * module and the wrapper shape: `react-native` / `expo` forward to the
 * top-level `Keewano.reportCustomEvent`; `node` takes a per-batch
 * `UserReporter` because the relay emits inside `reportUserBatch`.
 */
type EmitTarget = 'react-native' | 'expo' | 'node';

/**
 * Per-target emit spec.
 *
 * moduleName - public package the generated file imports from.
 * style - `top-level` imports `{ Keewano }` and forwards to
 *   `Keewano.reportCustomEvent`; `reporter` imports the `UserReporter`
 *   type and threads a `reporter` parameter through each wrapper.
 */
interface TargetSpec {
  moduleName: string;
  style: 'top-level' | 'reporter';
}

/**
 * Input for `emitGeneratedSource`.
 *
 * events - parsed + sorted event list. Wrapper emission order follows
 *   this array.
 * target - which SDK to emit for; defaults to `react-native`.
 */
interface EmitArgs {
  events: readonly ParsedEvent[];
  target?: EmitTarget;
}

export type { EmitArgs, EmitTarget, TargetSpec };
