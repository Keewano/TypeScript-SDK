import type { ParsedEvent } from './event';

/**
 * Input for `emitGeneratedSource`.
 *
 * events - parsed + sorted event list. Wrapper emission order follows
 *   this array.
 * sdkModuleName - the public module specifier the generated file
 *   imports `Keewano` and `CustomEventSet` from. Defaults to
 *   `@keewano/react-native-sdk`; Expo hosts pass
 *   `@keewano/react-native-expo-sdk`.
 */
interface EmitArgs {
  events: readonly ParsedEvent[];
  sdkModuleName?: string;
}

export type { EmitArgs };
