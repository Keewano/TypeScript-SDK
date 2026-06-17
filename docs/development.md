[Back to overview](README.md)

# Development

Working on the SDK itself (not just using it)? The repo is a monorepo managed with npm
workspaces.

```bash
npm install      # install all workspace dependencies
npm run lint     # lint
npm run typecheck
npm test         # unit tests
npm run build    # build every package
```

Each package lives under `packages/`:

- `@keewano/core` - platform-agnostic core
- `@keewano/react-native-sdk` - bare React Native SDK
- `@keewano/react-native-expo-sdk` - Expo SDK
- `@keewano/codegen` - custom-events code generator

---

[Back to overview](README.md)
