# @keewano/codegen

Build-time CLI for the Keewano TypeScript SDK: turns per-event JSON definitions into a typed `customEventSet` module with generated, type-safe report helpers.

## Documentation

See the [Custom Events guide](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/custom-events.md) and the full [Codegen reference](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/codegen.md).

## Installation

```bash
npm install --save-dev @keewano/codegen
```

## Quick start

```bash
npx keewano-codegen --input keewano-custom-events
```

Pass the generated `customEventSet` to `Keewano.init`, then call the typed `report*`
helpers the generator produces.

## License

MIT
