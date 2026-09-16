[Back to overview](README.md)

# Development

Working on the SDK itself (not just using it)? The repo is a monorepo managed with npm
workspaces.

Node.js 20+ is required (see `.nvmrc`).

```bash
npm install      # install all workspace dependencies
npm run lint     # lint
npm run format   # prettier check (npm run format:fix to write)
npm run typecheck
npm test         # unit tests
npm run build    # build every package
```

Each package lives under `packages/`:

- `@keewano/core` - platform-agnostic core
- `@keewano/react-native-sdk` - bare React Native SDK
- `@keewano/react-native-expo-sdk` - Expo SDK
- `@keewano/node-sdk` - Node.js server relay SDK
- `@keewano/web-sdk` - browser SDK

`@keewano/codegen`, the custom-events code generator, lives in its own repository: one
tool serves every Keewano SDK, so it is not tied to this workspace.

---

[Back to overview](README.md)
