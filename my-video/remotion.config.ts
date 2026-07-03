/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    output: {
      ...withTailwind.output,
      // Avoid webpack's wasm-hash crash (wasm-hash.js "Cannot read properties
      // of undefined") by using Node's native crypto hashes instead.
      hashFunction: "sha256",
    },
    // Fully disable webpack caching. The persistent *filesystem* cache (under
    // node_modules/.cache/webpack) corrupts on the 2nd bundle with Node 22 and
    // crashes in FileSystemInfo snapshot hashing ("data" argument undefined).
    // `type: "memory"` was not enough — Remotion re-enables a filesystem cache
    // after this override — so disable caching outright (`false`).
    cache: false,
    // Also stop webpack from snapshotting node_modules for the managed-paths
    // cache, which is what actually triggers the bad hash on rebundle.
    snapshot: {
      managedPaths: [],
    },
  };
});
