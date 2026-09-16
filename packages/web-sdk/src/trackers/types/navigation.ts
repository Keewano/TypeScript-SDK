/**
 * Types for the navigation tracker.
 *
 * WindowLocationLike - the location fields a window-name resolver may
 *   read. Mirrors the live `location` shape.
 *
 * ResolveWindowName - host-supplied mapping from the current location
 *   to the reported window name; the default returns `pathname`.
 *
 * HistoryLike / NavigationWindowLike - the browser surface the
 *   tracker patches and listens on, extracted as a seam for tests.
 *
 * NavigationReportSeam - report functions the tracker emits through;
 *   defaults to the core WINDOW_OPEN / WINDOW_CLOSE reporters.
 *
 * NavigationTrackerArgs - optional resolver, browser seam, and report
 *   seam; every field defaults to the live implementation.
 */

interface WindowLocationLike {
  pathname: string;
  search: string;
  hash: string;
  href: string;
}

type ResolveWindowName = (location: WindowLocationLike) => string;

interface HistoryLike {
  pushState(...args: unknown[]): unknown;
  replaceState(...args: unknown[]): unknown;
}

interface NavigationWindowLike {
  history: HistoryLike;
  location: WindowLocationLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface NavigationReportSeam {
  open(name: string): void;
  close(name: string): void;
}

interface NavigationTrackerArgs {
  resolveWindowName?: ResolveWindowName;
  win?: NavigationWindowLike;
  report?: NavigationReportSeam;
}

export type {
  HistoryLike,
  NavigationReportSeam,
  NavigationTrackerArgs,
  NavigationWindowLike,
  ResolveWindowName,
  WindowLocationLike,
};
