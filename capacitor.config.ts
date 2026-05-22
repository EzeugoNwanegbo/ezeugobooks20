import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.gandd.app",
  appName: "G&D",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
