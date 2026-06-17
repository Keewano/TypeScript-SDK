[Back to overview](README.md)

# Data Format

You never touch the wire format directly - the SDK handles it - but here is what
happens under the hood, and why it is cheap.

## Compact binary, not JSON

Events are encoded as a compact binary stream, not JSON. Numbers use variable-length
encoding and records are packed tightly, so payloads stay small and there is no
JSON serialization cost on the device. The format is identical to the Keewano Unity
SDK, so the same backend ingests data from both.

## Batches

Events accumulate in memory and are grouped into **batches**. The SDK uses double
buffering - events are written into one buffer while a previous batch is being shipped -
so collecting and sending never block each other. Each batch is written to a file on
disk before any network attempt (see [Offline Analytics](offline.md)).

## Delivery

A batch is sent as a compact binary HTTP body; the batch metadata (ids, timestamps,
counts) travels in `K-*` HTTP headers alongside it. The send loop ships batches
oldest-first and deletes each one only after the backend confirms receipt.

## Custom-event schema

If your app declares [custom events](custom-events.md), their schema is registered
with the backend once per session (sent compressed) so the server can decode the
custom-event ids your batches reference.

> [!NOTE]
> All of this is automatic and stable. The format is versioned, so batches written by
> an older build still upload correctly after an app update.

---

Related: [Offline Analytics](offline.md) | [Event Types](event-types.md) | [Custom Events](custom-events.md)
