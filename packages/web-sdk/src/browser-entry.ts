/**
 * IIFE bundle entry: installs the `Keewano` facade as the lowercase
 * `keewano` global and drains the pre-load snippet stub's queue (see
 * `snippet/installGlobalFacade`). The facade is exposed by direct
 * reference - not as detached per-method exports - so every method
 * added to `WebKeewanoApi` reaches the CDN global automatically and
 * `this`-bound implementations keep working.
 */

import type { KeewanoGlobalHost } from './snippet';

import { Keewano } from './keewano';
import { installGlobalFacade } from './snippet';

/**
 * `globalThis` is ES2020; on older engines the reference itself is a
 * ReferenceError, so probe with `typeof` and fall back to `self`
 * (present in every window and worker realm).
 */
const globalObject = (typeof globalThis === 'undefined' ? self : globalThis) as KeewanoGlobalHost;

installGlobalFacade({ facade: Keewano, globalObject });
