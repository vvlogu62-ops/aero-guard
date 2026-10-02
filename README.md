# AeroGuard — AI-Powered Industrial Safety Inspection Drone
### Fly • Inspect • Detect • Protect

> **SIMULATION MODE** — All controls and telemetry are demonstration-only. No real aircraft is connected unless MAVLink/Pixhawk integration is explicitly configured.

---

## Architecture

```
                 AeroGuard Backend (Node.js + Express + WebSocket)
                              │
                 ┌────────────┴────────────┐
                 │                         │
          Web Dashboard               Mobile App
       React + Leaflet             React Native + Expo
       Tailwind CSS                TypeScript + Maps
                 │                         │
                 └────────────┬────────────┘
                              │
                    Same API / Same Data
                    /api/snapshot   (REST)
                    /ws             (WebSocket)
```

---

## Project Structure

```
aeroguard/
├── web/                          # React web dashboard (Vite + Tailwind)
│   ├── src/
│   │   ├── App.tsx               # Main dashboard application
│   │   ├── SiteMap.tsx           # Leaflet map component
│   │   ├── api.ts                # Web API client (cookie-based auth)
│   │   └── styles.css            # Dark industrial UI styles
│   ├── package.json
│   └── vite.config.ts
│
├── mobile/                       # React Native Expo field app
│   ├── App.tsx                   # Full mobile application (~2700 lines)
│   ├── services/
│   │   └── api.ts                # Mobile API client (JWT Bearer auth)
│   ├── app.json                  # Expo configuration
│   ├── babel.config.js
│   ├── index.js                  # Entry point
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                      # Node.js API server
│   ├── src/
│   │   ├── index.ts              # App entry point
│   │   ├── server.ts             # Express routes + WebSocket server
│   │   ├── auth.ts               # JWT authentication middleware
│   │   ├── persistence.ts        # State storage (PostgreSQL or JSON)
│   │   ├── telemetry.ts          # Simulation/MAVLink adapter
│   │   └── notifications.ts      # Expo push notification delivery
│   └── package.json
│
├── packages/
│   └── shared/                   # Shared TypeScript types
│       └── src/
│           ├── index.ts          # All shared interfaces
│           └── simulation.ts     # Simulation logic
│
├── .env                          # Local environment variables
├── .env.example                  # Environment variable reference
├── package.json                  # npm workspace root
├── render.yaml                   # Render.com deployment config
└── README.md                     # This file
```

---

## Shared API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/health` | GET | None | Health check |
| `/api/auth/login` | POST | None | Sign in (returns cookie or JWT) |
| `/api/auth/logout` | POST | None | Sign out |
| `/api/auth/me` | GET | Required | Current operator info |
| `/api/auth/ws-ticket` | POST | Required | Issue WebSocket ticket |
| `/api/snapshot` | GET | Required | Full system state |
| `/api/missions` | POST | Operator+ | Create inspection mission |
| `/api/missions/:id/control` | POST | Operator+ | Control mission (pause/resume/return/land) |
| `/api/alerts/:id` | PATCH | All | Update alert status |
| `/api/detections/:id` | PATCH | All | Review AI detection |
| `/api/alerts` | POST | Supervisor | Create simulation alert |
| `/api/system/geofence` | PUT | Supervisor | Update geofence |
| `/api/system/telemetry` | POST | Supervisor | Switch telemetry adapter |
| `/api/push/register` | POST | Required | Register Expo push token |
| `/api/audit` | GET | Supervisor | View audit log |
| `/api/operators` | GET/POST | Supervisor | Manage operators |
| `/ws` | WebSocket | Ticket | Real-time snapshot stream |

---

## Authentication

### Web Dashboard
- Cookie-based session (`aeroguard_session` HttpOnly cookie)
- 8-hour expiry

### Mobile App
- JWT Bearer token stored in `expo-secure-store`
- Send `client: "mobile"` in login body to receive JWT token
- Token sent as `Authorization: Bearer <token>` on each request

---

## Shared Types (from `@aeroguard/shared`)

```typescript
interface DroneStatus {
  id: string;            // "AG-01"
  status: "online" | "offline";
  latitude: number;
  longitude: number;
  altitude: number;      // meters AGL
  speed: number;         // m/s ground speed
  battery: number;       // percentage 0-100
  signal: number;        // percentage 0-100
  satellites: number;    // GPS satellite count
  flightMode: "AUTO" | "HOLD" | "RTL";
  missionStatus: MissionStatus;
  heading: number;       // degrees 0-360
}

interface Detection {
  id: string;
  type: string;          // "Corrosion", "Surface crack", "Normal"
  confidence: number;    // 0.0 - 1.0
  asset: string;         // "Pipeline-03", "Tank-01" etc.
  zone: string;          // "Zone A" - "Zone D"
  latitude: number;
  longitude: number;
  timestamp: string;     // ISO 8601
  image: string;         // URL to inspection image
  status: "attention_required" | "reviewed" | "false_positive" | "normal";
  reviewNote?: string;
}

interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  asset: string;
  timestamp: string;
  status: "open" | "reviewed";
}

interface Mission {
  id: string;
  asset: string;
  zone: string;
  type: "Visual Inspection" | "Temperature Monitoring" | "Full Inspection";
  status: "active" | "paused" | "completed" | "scheduled";
  startTime: string;
  endTime?: string;
  detections: number;
  progress: number;      // 0-100
}

interface SystemSnapshot {
  mode: "SIMULATION" | "LIVE";
  telemetryAdapter: "simulation" | "mavlink";
  telemetryConnected: boolean;
  geofence: GeofenceConfig;
  updatedAt: string;
  drone: DroneStatus;
  detections: Detection[];
  temperatures: TemperatureReading[];
  alerts: Alert[];
  missions: Mission[];
  activity: ActivityEvent[];
  flightPath: Array<[number, number]>;
}
```

---

## Mobile App Features

| Screen | Description |
|---|---|
| **Home** | Drone status, battery, signal, GPS, altitude, mini-map, mission status, alerts banner, quick actions, drone controls |
| **Map** | Full-screen map with drone marker, flight path, defect markers, geofence circle, telemetry overlay |
| **Mission** | Step-based mission planner (asset → zone → type → review → start), active mission with timeline and controls |
| **Alerts** | Alert inbox with severity filter, review/mark reviewed, location button |
| **More → AI Detections** | Detection cards with confidence, tap to open detail sheet |
| **More → Temperature** | Current temperature, status indicator, sparkline chart |
| **More → Reports** | Mission history, tap to open full report with images and related detections |
| **More → Settings** | Telemetry source, geofence editor, push test (supervisor only) |
| **More → Audit Log** | Supervisor-only action audit trail |

---

## Operator Roles

| Role | Capabilities |
|---|---|
| `operator` | View all data, start/control missions, review alerts/detections |
| `supervisor` | All operator access + manage geofence, send test alerts, view audit log, create operators |
| `maintenance` | View all data, review alerts/detections — **cannot start or control missions** |

---

## Simulation Mode

The backend runs a continuous simulation loop (every 2 seconds) that:
- Moves the drone position on a sinusoidal path
- Decreases battery over time
- Updates signal strength and heading
- Advances active mission progress
- Streams updates to all connected WebSocket clients

Both the web dashboard and mobile app receive the same simulated state.

---

## Setup & Running

### Prerequisites
```
Node.js >= 18
npm >= 9
Expo CLI (npm install -g expo-cli)  — or use npx expo
```

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values (defaults work for local development)
```

### 3. Run everything locally

```bash
# Backend + Web dashboard together
npm run dev

# Mobile app (separate terminal)
npm run dev:mobile
```

### 4. Open the mobile app

- **Expo Go (physical phone)**: Scan the QR code shown in terminal
- **iOS Simulator**: Press `i` in the Expo terminal
- **Android Emulator**: Press `a` in the Expo terminal

> For physical phone: Set `EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:4000` in `.env`

---

## Deployment (Render.com)

The backend and web dashboard are deployed together on Render.com:

```
URL: https://aeroguard-kit6.onrender.com
```

The mobile app connects to this URL by default when `EXPO_PUBLIC_API_URL` is not set.

### Credentials (demo)
```
Email:    veera@aeroguard.demo
Password: [set in AEROGUARD_ADMIN_PASSWORD on Render]
```

---

## Future Integration Points

### Real Drone (Pixhawk + ArduPilot)
```
Pixhawk → ArduPilot → MAVLink → Backend (telemetry.ts) → Web + Mobile
```
- Switch to `mavlink` adapter via `/api/system/telemetry`
- Backend `telemetry.ts` ready for MAVLink driver implementation

### AI Detection (Raspberry Pi + YOLO)
```
Camera → Raspberry Pi → OpenCV → YOLO → Detection API → Backend → Web + Mobile
```
- POST new detections to the backend's state
- Images served via URL in detection records

### Temperature Sensors
```
Thermal Sensor → Raspberry Pi → Backend → Web + Mobile
```
- Temperature readings already typed and displayed in both apps
- Backend ready to receive sensor readings

### Push Notifications (Production)
```
Backend → Expo Push API → APNs/FCM → Mobile
```
- Push token registration: `POST /api/push/register`
- Requires EAS project ID + APNs/FCM credentials
- Local in-app alerts work without additional setup

---

## Safety Notice

> AeroGuard assists qualified inspection personnel; it does not certify equipment or replace site safety procedures. All AI detections require human review before maintenance decisions. Flight controls affect simulation only unless a real Pixhawk/ArduPilot connection is established.
