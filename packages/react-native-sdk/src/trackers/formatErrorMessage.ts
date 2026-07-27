/**
 * Re-export of the shared `formatErrorMessage` from `@keewano/core`. The
 * error-message formatter is platform-agnostic, so it lives in the core
 * and every platform's error hook produces a byte-identical ERROR_MSG
 * payload. Kept here as the stable internal import path for the
 * ErrorTracker.
 */

export { formatErrorMessage } from '@keewano/core';
