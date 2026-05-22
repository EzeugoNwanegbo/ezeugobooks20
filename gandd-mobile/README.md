# G&D Mobile

Separate Expo project for the G&D mobile app.

This first version is a native Expo shell that opens the existing G&D website in
a mobile WebView. That lets us test on iPhone immediately through Expo Go while
keeping the production website untouched. Native React Native screens can be
added here one at a time later.

## iPhone preview

1. Install **Expo Go** from the App Store.
2. From the main website project, start G&D so your phone can reach it:

   ```bash
   npm run dev -- --host 0.0.0.0 --port 3001
   ```

3. Copy `.env.example` to `.env` and set:

   ```env
   EXPO_PUBLIC_GD_WEB_URL=http://YOUR_COMPUTER_WIFI_IP:3001
   ```

4. Start Expo:

   ```bash
   npm run start:lan
   ```

5. Scan the QR code with Expo Go.

If LAN does not connect, try:

```bash
npm run start:tunnel
```

## Production URL

For normal testing, set `EXPO_PUBLIC_GD_WEB_URL` to the deployed G&D website:

```env
EXPO_PUBLIC_GD_WEB_URL=https://your-gandd-site.com
```

## App Store path

To ship this as an iPhone app, use EAS Build:

```bash
npx eas build:configure
npx eas build --platform ios
```

You will need an Apple Developer account for TestFlight and App Store release.
