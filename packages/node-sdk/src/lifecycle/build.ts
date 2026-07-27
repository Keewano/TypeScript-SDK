/**
 * Lifecycle construction helpers: turn resolved state + config into the
 * inert send-loop dispatcher and the runtime singleton object. Pure
 * factories with no side effects beyond constructing the dispatcher.
 */

import type { BuildDispatcherArgs, BuildRuntimeArgs } from '../types/build';
import type { NodeRuntime } from '../types/runtime';

import { KEventDispatcher } from '@keewano/core';

import { MS_PER_SECOND } from './helpers/constants';

/**
 * Construct a Node dispatcher. Used for both the inert send-loop dispatcher
 * (built at init, which never accumulates events and only drives the loop's
 * idle wait / wake mechanism and is the swap-restore target) and the
 * per-user batch dispatcher (built per `reportUserBatch`). Seeds the
 * custom-events version on both batch buffers so the persisted batch
 * carries the right hash. The dispatcher `unref`s its idle timer so it
 * never keeps the process alive.
 */
function buildDispatcher({
  installId,
  userId,
  dataSessionId,
  customEventSet,
}: BuildDispatcherArgs): KEventDispatcher {
  const dispatcher = new KEventDispatcher({
    installId,
    userId,
    dataSessionId,
    initialTimestamp: Math.floor(Date.now() / MS_PER_SECOND),
    unrefTimers: true,
  });
  if (customEventSet !== undefined) {
    dispatcher.currentInBatch.customEventsVersion = customEventSet.version;
    dispatcher.currentSendingBatch.customEventsVersion = customEventSet.version;
  }
  return dispatcher;
}

/**
 * Assemble the runtime singleton from resolved dependencies. Starts with
 * a fresh AbortController and empty per-batch / queue state; the send loop
 * attaches its promise afterwards.
 */
function buildRuntime({
  config,
  endpoint,
  storage,
  dispatcher,
  installId,
  userId,
  dataSessionId,
}: BuildRuntimeArgs): NodeRuntime {
  return {
    config,
    endpoint,
    storage,
    dispatcher,
    installId,
    userId,
    dataSessionId,
    sendLoopAbort: new AbortController(),
    sendLoopPromise: null,
    nextBatchNum: 0,
    onboardingCounters: new Map<string, number>(),
    preSdkInFlight: null,
    customEventSet: config.customEventSet,
  };
}

export { buildDispatcher, buildRuntime };
