# AeroGuard Mobile Operator

Expo / React Native field application for AeroGuard. It reads the shared simulation API and uses the same mission, alert, detection and telemetry state as the web dashboard.

Set `EXPO_PUBLIC_API_URL` before starting. Use `http://localhost:4000` for a local iOS simulator; Android emulator use may require `http://10.0.2.2:4000`; a physical phone needs the development machine's LAN IP (for example `http://192.168.1.20:4000`).

Run `npm run dev:api` from the repository root, then `npm run dev:mobile` and open the Expo project in Expo Go or a simulator. Map tiles require network access. All aircraft controls are simulation-only.
