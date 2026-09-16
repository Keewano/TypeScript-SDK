# @keewano/web-sdk

Keewano analytics SDK for web browsers.

## Documentation

See the [documentation](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/README.md)
for configuration, automatic tracking, and the full API. For generating a
custom-event schema, see the
[codegen reference](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/codegen.md).

## Install

```bash
npm install @keewano/web-sdk
```

## Usage

```ts
import { Keewano } from '@keewano/web-sdk';

Keewano.init({ apiKey: 'YOUR_API_KEY' });
Keewano.reportButtonClick('Play');
```

Or via the script snippet (CDN, no build step). The stub defines the
same methods as the npm API; calls made before the bundle loads are
queued and replayed in order once it arrives. Calls made before
`init` are buffered (up to 1000) and flushed in arrival order once
`init` lands, so call order relative to `init` does not matter:

<!-- The stub line below must stay byte-identical to the versioned SNIPPET_STUB_SOURCE the snippet test executes. -->
<!-- prettier-ignore -->
```html
<script>
  window.keewano=window.keewano||function(){var k={q:[],v:1},m="init shutdown isReady setUserId setUserConsent markAsTestUser reportButtonClick reportWindowOpen reportWindowClose reportOnboardingMilestone reportABTestGroupAssignment reportInAppPurchase reportInAppPurchaseItemsGranted reportAdOffered reportAdRevenue reportAdItemsGranted reportSubscriptionRevenue reportSubscriptionItemsGranted reportItemsExchange reportItemsReset reportInstallCampaign reportGameLanguage reportCustomEvent logError".split(" ");for(var i=0;i<m.length;i++)(function(n){k[n]=function(){k.q.push([n].concat([].slice.call(arguments)))}})(m[i]);return k}();
</script>
<script async src="https://unpkg.com/@keewano/web-sdk@VERSION/dist/browser/keewano.iife.js"></script>
<script>
  keewano.init({ apiKey: 'YOUR_API_KEY' });
  keewano.reportButtonClick('Play');
</script>
```

Replace `VERSION` with the version you want. Always pin one:
without it the URL resolves to whatever is newest, so a future
release would start running on your pages without you deploying
anything.

Pushing `[method, ...args]` tuples into `keewano.q` directly also
works and reaches methods added after the stub was pasted.

## Supported browsers

The two delivery channels have different floors, because only one of
them is compiled by us.

The prebuilt script bundle is built with a Safari 15.4 target, so every
language feature newer than that is transpiled away before it reaches
the page. It runs on that Safari and on any Chromium or Firefox build
that understands the same level of JavaScript.

The npm package ships untranspiled modern JavaScript. Its floor is
whatever your own bundler targets, not ours, because the SDK is
compiled as part of your app.

Either way, the one platform feature the SDK depends on is the Web
Locks API: it elects a single sending tab per origin, so several open
tabs do not ship the same queue. Safari added it in 15.4, which is why
the bundle targets that release; test for `navigator.locks` if you need
to know whether some other browser you support has it.

Where it is missing the SDK still collects and still delivers. Each
open tab simply runs its own send loop instead of queueing behind an
elected one, so a visitor with several tabs can send the same events
more than once, and the backend deduplicates them.

## Consent

By default the web SDK collects and holds: events accumulate on the
client from the first moment, but nothing is sent until the page
signals consent. Wire your consent banner to one call:

```ts
Keewano.setUserConsent(true); // grant: held data ships, delivery starts
Keewano.setUserConsent(false); // deny: everything held is deleted
```

Call it any time after `init` is issued (snippet pages can call it
even earlier - it queues like every other method). The decision
persists across visits and is one-shot: once the visitor has granted
or denied, later `setUserConsent` calls are no-ops - the same rule the
device SDKs follow.

Where no consent requirement applies, opt out of the gate and events
flow immediately:

```ts
Keewano.init({ apiKey: 'YOUR_API_KEY', requirePlayerConsent: false });
```

All SDK state (identity, consent, the event queue) lives in first-party
storage on your origin - localStorage, first-party cookies, and
IndexedDB. The SDK sets no third-party cookies, and at runtime it talks
to nothing but the Keewano ingress.

## License

MIT
