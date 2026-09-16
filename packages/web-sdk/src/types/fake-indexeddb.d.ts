/**
 * Typings for the `fake-indexeddb` deep imports the tests use. The
 * package ships root types as ESM-only, which a CommonJS-compiled
 * test cannot reference (TS1479); the `lib/*` subpaths carry no
 * types at all but do ship CommonJS builds. Declaring the one
 * subpath the tests need keeps the imports both type-safe and
 * require-compatible.
 */
declare module 'fake-indexeddb/lib/FDBFactory' {
  const FDBFactory: new () => IDBFactory;
  export = FDBFactory;
}
