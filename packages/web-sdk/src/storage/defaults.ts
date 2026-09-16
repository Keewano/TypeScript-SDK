/** Web storage defaults shared by the queue plumbing. */

/**
 * Disk budget for the persisted event queue: 10 MB. The mobile SDKs
 * cap at 50 MB, which does not fit browser origin quotas (private
 * mode and mobile browsers can grant far less).
 */
const WEB_STORAGE_CAP_BYTES = 10 * 1024 * 1024;

export { WEB_STORAGE_CAP_BYTES };
