/**
 * Internal lifecycle barrel: the boot, teardown, and relay entry points
 * the public `Keewano` facade assembles. Not part of the package's public
 * API.
 */

export { init } from './init';
export { reportUserBatch } from './relay';
export { shutdown } from './shutdown';
