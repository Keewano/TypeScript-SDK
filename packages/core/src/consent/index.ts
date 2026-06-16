/**
 * GDPR / CCPA consent primitives. This module exposes:
 *
 * - `ConsentState` - the 4-state enum with pinned numeric values
 *   (wire / on-disk stable; `consentStateMachine.ts` relies on these
 *   exact integers when serializing).
 * - `consentGate` - pure decision function that maps a state to a
 *   send-loop action (`'send'` / `'delete'` / `'keep'`).
 * - `loadOrInitConsentState` / `setConsent` - the persistent
 *   transition surface backing those decisions.
 */

export type { ConsentGateDecision } from './types/consentGate';
export type { LoadOrInitConsentStateArgs, SetConsentArgs } from './types/consentStateMachine';

export { CONSENT_FILE_SIZE, CONSENT_FILENAME } from './helpers/constants';
export { ConsentState } from './consentState';
export { consentGate } from './consentGate';
export { loadOrInitConsentState, setConsent } from './consentStateMachine';
