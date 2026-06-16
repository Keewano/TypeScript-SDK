/**
 * Decision returned by `consentGate` for a single batch.
 *
 * `'send'` - Caller should attempt the HTTP send. If the send
 *   succeeds the batch is deleted from disk; on failure it stays
 *   for the next cycle. Reached when consent is `NotRequired` or
 *   `Granted`.
 * `'delete'` - Caller MUST NOT contact the server. The batch is
 *   dropped from disk without ever leaving the device. Reached
 *   when consent is `Denied` (and as the safe fallback for unknown
 *   states - drop the batch locally rather than retry forever).
 * `'keep'` - Caller MUST NOT contact the server. The batch stays
 *   on disk so a future state transition (`Pending → Granted`)
 *   can flush it. Reached only when consent is `Pending`.
 */
type ConsentGateDecision = 'send' | 'delete' | 'keep';

export type { ConsentGateDecision };
