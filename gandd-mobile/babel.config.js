module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-worklets/plugin must be listed LAST. Required by
    // react-native-reanimated v4 — without it worklets fail to install
    // their native TurboModule (Exception in HostFunction at startup).
    plugins: ["react-native-worklets/plugin"],
  };
};
