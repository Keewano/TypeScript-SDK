/**
 * Args bag for `reportABTestGroupAssignment`.
 *
 * testName - Test / experiment identifier (truncated to 256 chars).
 * group - Single-character ASCII group label (`'A'`, `'B'`, ...).
 *   Emitted on the wire as one raw uint8 byte (no length prefix).
 *   Multi-character or non-ASCII inputs are dropped.
 */
interface ReportABTestGroupAssignmentArgs {
  testName: string;
  group: string;
}

export type { ReportABTestGroupAssignmentArgs };
