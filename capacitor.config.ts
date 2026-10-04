import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "it.teamgalileo.hub",
  appName: "GalileoHub",
  webDir: "dist",
  server: { androidScheme: "https" },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};
export default config;
