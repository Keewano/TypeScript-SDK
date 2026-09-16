[Back to overview](README.md)

# Data Format

You never touch the wire format directly - the SDK handles it - but here is what
happens under the hood, and why it is cheap.

## Compact binary on device, JSON in the browser

On the React Native, Expo, and Node.js SDKs events are encoded as a compact binary
stream, not JSON. Numbers use variable-length encoding and records are packed tightly,
so payloads stay small and there is no JSON serialization cost on the device. The web
SDK encodes the same events as JSON and posts them to the JSON ingestion API. Both
encodings describe the same events, so one backend ingests data from all of them.

## Batches

Events accumulate in memory and are grouped into **batches**. The SDK uses double
buffering - events are written into one buffer while a previous batch is being shipped -
so collecting and sending never block each other. Each batch is written to local
storage before any network attempt (see [Offline Analytics](offline.md)).

## Delivery

The device SDKs (React Native, Expo, Node.js) send a batch as a compact binary HTTP
body, with the batch metadata (ids, timestamps, the batch sequence number) in `K-*`
HTTP headers. The web SDK posts a JSON envelope to the JSON ingestion API instead,
carrying the same metadata as envelope fields and the API key as a `k-token` query
parameter. Both ship batches oldest-first. A batch file is removed once the backend
has settled it - accepted with a 2xx, or permanently rejected - and a batch file that
can no longer be decoded is removed without being sent.

## Custom-event schema

If your app declares [custom events](custom-events.md), their schema is registered
with the backend once per session so the server can decode the custom-event ids your
batches reference. The device and Node.js SDKs upload a gzipped schema blob; the web
SDK registers over the JSON API, which takes the schema as plain JSON.

> [!NOTE]
> All of this is automatic and stable. The format is versioned, so batches written by
> an older build still upload correctly after an app update.

---

Related: [Offline Analytics](offline.md) | [Event Types](event-types.md) | [Custom Events](custom-events.md)
