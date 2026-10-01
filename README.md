# AeroGuard

AeroGuard is an industrial inspection prototype with a React/Vite web command center, an Expo operator app, and one Node.js API. Both clients read the same simulation snapshot and send mission and review actions to the same backend. All telemetry, alerts, AI findings, and flight controls are simulated; no Pixhawk, Raspberry Pi, YOLO service, or production authentication is connected.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Expo Go or an iOS/Android simulator to run the mobile app
- Internet access for OpenStreetMap tiles and the sample inspection images

## Install and run

From the repository root:

```powershell
npm install
npm run dev
```

The combined command starts the API and web dashboard:

- Web: http://localhost:5173
- REST API: http://localhost:4000/api/snapshot
- API health: http://localhost:4000/api/health
- WebSocket telemetry: ws://localhost:4000/ws

Sign in with any non-empty operator ID and password. This local demo login is not security. In separate terminals, start the mobile app with `npm run dev:mobile`; use the Expo QR code with Expo Go or launch a simulator.

## Deploy to Render

The `render.yaml` Blueprint deploys the built web dashboard, REST API, and WebSocket endpoint as one Node service. Push the repository to GitHub, then in Render choose **New → Blueprint**, connect `vvlogu62-ops/aero-guard`, select the `main` branch, and apply the Blueprint. Render builds with `npm ci && npm run build`, starts the backend workspace, and checks `/api/health`. The generated Render URL serves the dashboard and API from the same origin.

The mobile app defaults to the deployed Render URL. For EAS builds, set `EXPO_PUBLIC_API_URL` to the generated service URL in the EAS build environment. For local Expo Go testing, override it with your local backend address as described below.

The Blueprint uses Render's free plan. Free instances can sleep when idle, and this prototype keeps simulated state in memory, so state resets after a restart or redeploy. The API and mock login are not authenticated; deploy only demo data, never real drone telemetry or sensitive site information. Real operations require production authentication, persistent audited storage, and qualified safety review.

### Mobile API address

Expo Go on a physical phone cannot reach the development machine through `localhost`. Set `EXPO_PUBLIC_API_URL` to the computer's LAN address before starting Expo. In PowerShell:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:4000"
npm run dev:mobile
```

Replace the example IP with the development computer's LAN IP. The phone and computer must be on the same network, and the firewall must allow port 4000. Android emulators commonly use `http://10.0.2.2:4000`; iOS simulators can usually use `http://localhost:4000`.

Web API address can be overridden with `VITE_API_URL` in `web/.env.local`. Mobile can also read `EXPO_PUBLIC_API_URL` from `mobile/.env`.

## Validation

```powershell
npm run typecheck
npm run build
npm run dev:mobile
```

`npm run typecheck` checks shared types, backend, web, and mobile. `npm run build` produces the shared, backend, and web production builds. Expo's development server provides the native mobile bundle.

## Prototype workflows

- Monitor AG-01 simulated GPS, altitude, speed, signal, battery and mission progress.
- View drone path and possible-defect markers on web and mobile maps.
- Create an inspection mission; pause, resume, return-to-home, and land actions update simulated state only.
- Review alerts and detections. AI detection notes and reviewed status are shared across clients through the API.
- Browse simulated temperature history and completed mission reports.

## Architecture

```text
web (React/Vite) ───┐
                    ├── REST + WebSocket ── Node API ── simulation service
mobile (Expo) ──────┘                         │
                                      shared TypeScript contracts
```

The API is the single source of truth in demo mode. The simulation adapter can later be replaced by real telemetry, edge-AI, and thermal-sensor adapters without putting simulated values in UI components. Production use would additionally require authentication, authorization, audited data storage, secure transport, and qualified safety review.
