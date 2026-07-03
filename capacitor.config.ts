import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.gandd.app",
  appName: "G&D",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    // Proper Android keyboard/IME handling. `resize: native` lets Android
    // resize the window for the keyboard (adjustResize), which fixes focused
    // WebView inputs not receiving text on Android 15.
    Keyboard: {
      resize: "native" as never,
    },
  },
};

export default config;
