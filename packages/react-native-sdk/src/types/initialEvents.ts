/**
 * Args bag for the initial-events emitter.
 *
 * dispatcher - Dispatcher that receives the seven initial events.
 * platform - Adapter that supplies the per-event payloads (OS, RAM,
 *   screen resolution, language, app version, etc.).
 */

import type { KEventDispatcher } from '@keewano/core';

import type { PlatformAdapter } from './platformAdapter';

interface EmitInitialEventsArgs {
  dispatcher: KEventDispatcher;
  platform: PlatformAdapter;
}

export type { EmitInitialEventsArgs };
