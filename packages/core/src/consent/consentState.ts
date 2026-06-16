/**
 * GDPR / CCPA user-consent state. The numeric values are part of the
 * on-disk persistence schema: `consentStateMachine.ts` serializes
 * this enum as a single integer, so reordering or reassigning members
 * would silently corrupt persisted consent across upgrades.
 *
 * Explicit values are kept here even though TypeScript would auto-
 * number them - implicit ordering would let a future contributor
 * reorder members and silently corrupt every shipped install's
 * consent file. Pinning values defends against that class of bug.
 *
 * `NotRequired` - Consent is not required for this build (e.g. the
 *   project disables GDPR gating). The send loop always proceeds.
 * `Pending` - Consent has not been answered yet. Initial state when
 *   `requirePlayerConsent` is on; batches stay on disk until the
 *   user grants or denies.
 * `Granted` - User granted consent. Send loop proceeds.
 * `Denied` - User denied consent. Batches are silently dropped
 *   without contacting the server.
 *
 * State transitions and persistence live in `consentStateMachine.ts`.
 * This file only fixes the wire-stable numeric mapping.
 */
enum ConsentState {
  NotRequired = 0,
  Pending = 1,
  Granted = 2,
  Denied = 3,
}

export { ConsentState };
