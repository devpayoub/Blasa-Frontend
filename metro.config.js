const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// `shared-types/api.ts` is generated from the backend OpenAPI schema and
// vendored into this repo so a fresh clone type-checks without the backend.
// Refresh it with `npm run sync:types` from a monorepo checkout.
config.resolver.alias = {
  ...(config.resolver.alias ?? {}),
  '@shared': path.resolve(__dirname, 'shared-types'),
};

module.exports = withNativeWind(config, { input: './global.css' });
