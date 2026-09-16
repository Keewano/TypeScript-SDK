/**
 * Environment-burst tracker: emits the canonical init burst
 *
 *   APP_LAUNCH -> PLATFORM -> DEVICE_TYPE -> OS -> RAM_SIZE ->
 *   SCREEN_RESOLUTION -> SYSTEM_LANG
 *
 * once per attach, web-sourced. The event ORDER is part of the wire
 * protocol shared with the device SDKs, and all seven events always
 * emit: where `navigator.deviceMemory` is unavailable (everything
 * but Chromium), RAM_SIZE carries 0 - the same "unknown" encoding
 * the device SDKs use, keeping the seven-event preamble the server
 * relies on intact on every browser.
 *
 * Value vocabulary mirrors the device SDKs so the server sees one
 * alphabet: DEVICE_TYPE is 'phone' / 'tablet' / 'desktop' / 'unknown';
 * every unavailable string source degrades to 'unknown'. PLATFORM
 * carries `browser/engine` from a deliberately minimal user-agent
 * sniff (no parser dependency - coarse values are the accepted
 * trade-off), OS the coarse OS name. APP_LAUNCH carries the host's
 * configured app version, or 'unknown' when none is configured: a
 * browser exposes no version of the page's own application.
 *
 * Known coarse spots, accepted by design: iPadOS 13+ presents a
 * desktop Safari user agent, so iPads report as macOS desktops;
 * SCREEN_RESOLUTION is CSS pixels with devicePixelRatio deliberately
 * NOT multiplied in (stability across zoom levels beats physical
 * pixel counts).
 *
 * GENUINITY_CHECK, VRAM_SIZE, GPU_TYPE, and LOW_MEM_WARNING have no
 * browser API and are skipped - the same skip list as the device
 * port.
 */
import type { KeewanoTracker } from '../types/config';
import type { EnvironmentLike, EnvironmentTrackerArgs } from './types/environment';

import {
  KEvents,
  appVersionPayload,
  clampUint16,
  clampUint32,
  truncateString,
} from '@keewano/core';

import { noopDetach } from './noopDetach';

const UNKNOWN = 'unknown';

const MB_PER_GIB = 1024;

/** Read the live browser surface defensively; absent pieces stay undefined. */
function readGlobalEnvironment(): EnvironmentLike {
  const env: EnvironmentLike = {};
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (nav !== undefined) {
      if (typeof nav.userAgent === 'string') env.userAgent = nav.userAgent;
      if (typeof nav.language === 'string') env.language = nav.language;
      const memory = (nav as { deviceMemory?: unknown }).deviceMemory;
      if (typeof memory === 'number' && Number.isFinite(memory) && memory > 0) {
        env.deviceMemory = memory;
      }
    }
  } catch {
    /* A denied navigator getter leaves the fields at their fallbacks. */
  }
  try {
    const screen = (globalThis as { screen?: { width?: unknown; height?: unknown } }).screen;
    if (typeof screen?.width === 'number') env.screenWidth = screen.width;
    if (typeof screen?.height === 'number') env.screenHeight = screen.height;
  } catch {
    /* Same: no screen, no resolution event payload. */
  }
  return env;
}

/**
 * `browser/engine` from the user agent. Order matters: every
 * Chromium-family UA also claims Chrome and Safari, so the more
 * specific tokens are tested first.
 */
function detectPlatform(userAgent: string): string {
  if (userAgent.includes('Edg/')) return 'Edge/Blink';
  if (userAgent.includes('OPR/')) return 'Opera/Blink';
  if (userAgent.includes('Chrome/') || userAgent.includes('CriOS/')) return 'Chrome/Blink';
  if (userAgent.includes('Firefox/') || userAgent.includes('FxiOS/')) return 'Firefox/Gecko';
  if (userAgent.includes('Safari/')) return 'Safari/WebKit';
  return UNKNOWN;
}

/** Coarse OS name. Android before Linux (Android UAs contain "Linux"). */
function detectOs(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'Windows';
  if (userAgent.includes('Android')) return 'Android';
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
  if (userAgent.includes('CrOS')) return 'ChromeOS';
  if (userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')) return 'macOS';
  if (userAgent.includes('Linux')) return 'Linux';
  return UNKNOWN;
}

/**
 * Coarse device class in the device-SDK vocabulary. "Mobi" is the
 * cross-browser mobile marker; an Android UA without it is a tablet.
 */
function detectDeviceType(userAgent: string): string {
  if (userAgent.includes('iPad') || userAgent.includes('Tablet')) return 'tablet';
  if (userAgent.includes('Mobi') || userAgent.includes('iPhone')) return 'phone';
  if (userAgent.includes('Android')) return 'tablet';
  return 'desktop';
}

class EnvironmentTracker implements KeewanoTracker {
  readonly name = 'EnvironmentTracker';
  /** The burst is the session preamble the server expects; a failed emit must fail init. */
  readonly criticalPath = true;

  private readonly args: EnvironmentTrackerArgs;

  constructor(args: EnvironmentTrackerArgs) {
    this.args = args;
  }

  /** One-shot emitter: the burst happens on attach, nothing listens afterwards. */
  attach(): () => void {
    const env = this.args.env ?? readGlobalEnvironment();
    const dispatcher = this.args.dispatcher;
    const userAgent = env.userAgent ?? '';
    const appVersion = this.args.appVersion;

    dispatcher.addEventString({
      eventId: KEvents.APP_LAUNCH,
      str: truncateString(appVersionPayload(appVersion)),
    });
    dispatcher.addEventString({
      eventId: KEvents.PLATFORM,
      str: userAgent === '' ? UNKNOWN : detectPlatform(userAgent),
    });
    dispatcher.addEventString({
      eventId: KEvents.DEVICE_TYPE,
      str: userAgent === '' ? UNKNOWN : detectDeviceType(userAgent),
    });
    dispatcher.addEventString({
      eventId: KEvents.OS,
      str: userAgent === '' ? UNKNOWN : detectOs(userAgent),
    });
    dispatcher.addEventUint32({
      eventId: KEvents.RAM_SIZE,
      value:
        env.deviceMemory === undefined ? 0 : clampUint32(Math.round(env.deviceMemory * MB_PER_GIB)),
    });
    dispatcher.addEventUint16x2({
      eventId: KEvents.SCREEN_RESOLUTION,
      x: clampUint16(env.screenWidth ?? 0),
      y: clampUint16(env.screenHeight ?? 0),
    });
    dispatcher.addEventString({
      eventId: KEvents.SYSTEM_LANG,
      str: env.language === undefined ? UNKNOWN : truncateString(env.language),
    });

    return noopDetach;
  }
}

export type { EnvironmentLike, EnvironmentTrackerArgs } from './types/environment';
export { EnvironmentTracker };
