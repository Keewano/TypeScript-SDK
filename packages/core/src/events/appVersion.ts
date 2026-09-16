/**
 * What APP_LAUNCH carries when the host supplied no application version.
 *
 * APP_LAUNCH is emitted on every start, version or not, so a session is
 * never missing from the stream merely because the host could not name
 * its build. The payload is then this literal rather than an empty
 * string: empty is structurally valid and reads downstream as a version
 * like any other, which would quietly fold every version-less session
 * into a cohort of its own without saying so. A named value can be
 * separated from a real version by anything reading the stream.
 *
 * One definition, because three packages emit this event and a second
 * spelling of the same idea is a second thing the backend would have to
 * recognise.
 */
const APP_VERSION_UNSPECIFIED = 'undefined';

/**
 * The APP_LAUNCH payload for a host-supplied version.
 *
 * An empty string counts as unsupplied for the same reason it does on
 * the other SDKs: a host that has no version and one that has an empty
 * one are the same case, and only one of them can be told apart later.
 * Truncation stays with the caller, which caps every string it emits
 * the same way.
 */
function appVersionPayload(version: string | undefined): string {
  return version === undefined || version === '' ? APP_VERSION_UNSPECIFIED : version;
}

export { APP_VERSION_UNSPECIFIED, appVersionPayload };
