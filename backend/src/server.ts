import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import type {
  Alert,
  Detection,
  GeofenceConfig,
  Mission,
  OperatorIdentity,
  OperatorRole,
} from "@aeroguard/shared";
import { createInitialSnapshot } from "@aeroguard/shared/simulation";
import {
  issueAccessToken,
  issueWebSocketTicket,
  requireAuth,
  requireRoles,
  verifyWebSocketTicket,
} from "./auth.js";
import {
  appendAudit,
  createOperator,
  currentState,
  findOperator,
  hasRole,
  initializePersistence,
  listOperators,
  registerPushToken,
  saveState,
} from "./persistence.js";
import { sendExpoPush } from "./notifications.js";
import { createTelemetryAdapter } from "./telemetry.js";

const app = express();
const server = createServer(app);
const sockets = new WebSocketServer({ noServer: true });
const consumedTickets = new Map<string, number>();
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const zoneCoordinates: Record<string, [number, number]> = {
  "Zone A": [37.7756, -122.4205],
  "Zone B": [37.7752, -122.4184],
  "Zone C": [37.7739, -122.4182],
  "Zone D": [37.7742, -122.4207],
};

app.set("trust proxy", 1);
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:8081")
    .split(",")
    .map((origin) => origin.trim()),
);
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    const localDevelopmentOrigin =
      process.env.NODE_ENV !== "production" &&
      !!origin &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (!origin || allowedOrigins.has(origin) || localDevelopmentOrigin)
      callback(null, true);
    else callback(new Error("Origin not allowed"));
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "64kb" }));
app.get("/api/health", (_request, response) =>
  response.json({ status: "ok", mode: currentState().snapshot.mode }),
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "production" ? 60 : 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
});
app.post("/api/auth/login", loginLimiter, async (request, response) => {
  const { email, password } = request.body as {
    email?: unknown;
    password?: unknown;
  };
  if (typeof email !== "string" || typeof password !== "string")
    return response.status(400).json({ error: "Email and password required" });
  const operator = await findOperator(email, password);
  if (!operator) return response.status(401).json({ error: "Invalid credentials" });
  await appendAudit(operator, "auth.login", operator.id);
  const token = issueAccessToken(operator);
  if (request.body.client === "mobile")
    return response.json({ token, operator });
  response.cookie("aeroguard_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
  return response.json({ operator });
});
app.post("/api/auth/logout", (_request, response) =>
  response.clearCookie("aeroguard_session", { httpOnly: true, sameSite: "strict", path: "/" }).json({ ok: true }),
);
app.get("/api/auth/me", requireAuth, (request, response) =>
  response.json(request.operator),
);
app.get("/api/operators", requireAuth, requireRoles("supervisor"), (_request, response) =>
  response.json(listOperators()),
);
app.post(
  "/api/operators",
  requireAuth,
  requireRoles("supervisor"),
  async (request, response) => {
    const { email, name, role, password } = request.body as Record<string, unknown>;
    if (
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof name !== "string" || !name.trim() || name.length > 80 ||
      !["operator", "supervisor", "maintenance"].includes(String(role)) ||
      typeof password !== "string" || password.length < 12
    )
      return response.status(400).json({ error: "Provide a valid email, name, role, and password of at least 12 characters" });
    try {
      const operator = await createOperator(
        { email, name: name.trim(), role: role as OperatorRole },
        password,
      );
      await appendAudit(request.operator!, "operator.create", operator.id, {
        email: operator.email,
        role: operator.role,
      });
      return response.status(201).json(operator);
    } catch (error) {
      return response.status(409).json({ error: error instanceof Error ? error.message : "Could not create operator" });
    }
  },
);
app.post("/api/auth/ws-ticket", requireAuth, (request, response) =>
  response.json({ ticket: issueWebSocketTicket(request.operator!) }),
);
app.get("/api/snapshot", requireAuth, (_request, response) =>
  response.json(currentState().snapshot),
);
app.get("/api/audit", requireAuth, requireRoles("supervisor"), (_request, response) =>
  response.json(currentState().audit.slice(-200).reverse()),
);
app.post(
  "/api/push/register",
  requireAuth,
  async (request, response) => {
    const { token } = request.body as { token?: unknown };
    if (typeof token !== "string" || !token.startsWith("ExponentPushToken["))
      return response.status(400).json({ error: "Invalid Expo push token" });
    await registerPushToken(request.operator!.id, token);
    await appendAudit(request.operator!, "push.register", token.slice(0, 16));
    return response.json({ registered: true });
  },
);

app.post(
  "/api/missions",
  requireAuth,
  requireRoles("operator", "supervisor"),
  async (request, response) => {
    const { asset, zone, type } = request.body as Partial<Mission>;
    const snapshot = currentState().snapshot;
    if (
      typeof asset !== "string" ||
      !Object.hasOwn(zoneCoordinates, String(zone)) ||
      !["Visual Inspection", "Temperature Monitoring", "Full Inspection"].includes(String(type))
    )
      return response.status(400).json({ error: "Select a valid asset, zone and inspection type" });
    const [latitude, longitude] = zoneCoordinates[zone!];
    const distance = distanceMeters(
      snapshot.geofence.centerLatitude,
      snapshot.geofence.centerLongitude,
      latitude,
      longitude,
    );
    if (snapshot.geofence.enabled && distance > snapshot.geofence.radiusMeters)
      return response.status(409).json({ error: "Preflight blocked: inspection zone is outside the active geofence" });
    if (snapshot.drone.battery < 25)
      return response.status(409).json({ error: "Preflight blocked: battery reserve is below 25%" });
    if (!snapshot.telemetryConnected)
      return response.status(409).json({ error: "Preflight blocked: telemetry adapter is disconnected" });

    const mission: Mission = {
      id: `MSN-${randomUUID().slice(0, 8).toUpperCase()}`,
      asset,
      zone: zone!,
      type: type as Mission["type"],
      status: "active",
      startTime: new Date().toISOString(),
      detections: 0,
      progress: 0,
    };
    await saveState({
      ...currentState(),
      snapshot: {
        ...snapshot,
        missions: [mission, ...snapshot.missions],
        drone: { ...snapshot.drone, missionStatus: "active", flightMode: "AUTO" },
      },
    });
    await appendAudit(request.operator!, "mission.create", mission.id, {
      asset,
      zone,
      type,
      geofenceDistanceMeters: Math.round(distance),
    });
    publishSnapshot();
    return response.status(201).json(mission);
  },
);

app.post(
  "/api/missions/:id/control",
  requireAuth,
  requireRoles("operator", "supervisor"),
  async (request, response) => {
    const action = String(request.body.action || "");
    if (!["pause", "resume", "return", "land"].includes(action))
      return response.status(400).json({ error: "Unsupported simulation action" });
    const state = currentState();
    const exists = state.snapshot.missions.some((mission) => mission.id === request.params.id);
    if (!exists) return response.status(404).json({ error: "Mission not found" });
    const missions = state.snapshot.missions.map((mission) =>
      mission.id === request.params.id
        ? {
            ...mission,
            status: action === "pause" ? "paused" as const : action === "land" ? "completed" as const : "active" as const,
            ...(action === "land" ? { endTime: new Date().toISOString() } : {}),
          }
        : mission,
    );
    const missionStatus = action === "pause" ? "paused" : action === "land" ? "completed" : "active";
    await saveState({
      ...state,
      snapshot: {
        ...state.snapshot,
        missions,
        drone: {
          ...state.snapshot.drone,
          missionStatus,
          flightMode: action === "return" ? "RTL" : action === "pause" ? "HOLD" : "AUTO",
        },
      },
    });
    await appendAudit(request.operator!, `mission.${action}`, String(request.params.id));
    publishSnapshot();
    return response.json({ ok: true, mode: "SIMULATION", action });
  },
);

app.put(
  "/api/system/geofence",
  requireAuth,
  requireRoles("supervisor"),
  async (request, response) => {
    const geofence = request.body as GeofenceConfig;
    if (
      !Number.isFinite(geofence.centerLatitude) ||
      !Number.isFinite(geofence.centerLongitude) ||
      geofence.centerLatitude < -90 || geofence.centerLatitude > 90 ||
      geofence.centerLongitude < -180 || geofence.centerLongitude > 180 ||
      !Number.isFinite(geofence.radiusMeters) || geofence.radiusMeters < 50 || geofence.radiusMeters > 2000 ||
      !Number.isFinite(geofence.maxAltitudeMeters) || geofence.maxAltitudeMeters < 10 || geofence.maxAltitudeMeters > 120 ||
      geofence.enabled !== true
    )
      return response.status(400).json({ error: "Geofence values are outside permitted demo limits" });
    const state = currentState();
    await saveState({ ...state, snapshot: { ...state.snapshot, geofence } });
    await appendAudit(request.operator!, "safety.geofence.update", "site-geofence", { ...geofence });
    publishSnapshot();
    return response.json(geofence);
  },
);

app.post(
  "/api/system/telemetry",
  requireAuth,
  requireRoles("supervisor"),
  async (request, response) => {
    const adapter = request.body.adapter;
    if (adapter === "mavlink")
      return response.status(409).json({ error: "MAVLink adapter is not configured. LIVE mode remains locked; no real telemetry is connected." });
    if (adapter !== "simulation")
      return response.status(400).json({ error: "Adapter must be simulation or mavlink" });
    const snapshot = currentState().snapshot;
    const selected = createTelemetryAdapter("simulation");
    await saveState({
      ...currentState(),
      snapshot: {
        ...snapshot,
        mode: "SIMULATION",
        telemetryAdapter: selected.id,
        telemetryConnected: selected.connected,
      },
    });
    await appendAudit(request.operator!, "telemetry.select", selected.id);
    publishSnapshot();
    return response.json({ mode: "SIMULATION", adapter: selected.id, connected: true });
  },
);

app.patch(
  "/api/alerts/:id",
  requireAuth,
  requireRoles("operator", "supervisor", "maintenance"),
  async (request, response) => {
    if (!["open", "reviewed"].includes(request.body.status))
      return response.status(400).json({ error: "Invalid alert status" });
    const state = currentState();
    if (!state.snapshot.alerts.some((alert) => alert.id === request.params.id))
      return response.status(404).json({ error: "Alert not found" });
    const alerts: Alert[] = state.snapshot.alerts.map((alert) =>
      alert.id === request.params.id ? { ...alert, status: request.body.status } : alert,
    );
    await saveState({ ...state, snapshot: { ...state.snapshot, alerts } });
    await appendAudit(request.operator!, "alert.review", String(request.params.id), { status: request.body.status });
    publishSnapshot();
    return response.json(alerts.find((alert) => alert.id === request.params.id));
  },
);

app.patch(
  "/api/detections/:id",
  requireAuth,
  requireRoles("operator", "supervisor", "maintenance"),
  async (request, response) => {
    const { status, reviewNote } = request.body as {
      status?: unknown;
      reviewNote?: unknown;
    };
    if (status !== undefined && !["reviewed", "false_positive"].includes(String(status)))
      return response.status(400).json({ error: "Review status must be reviewed or false_positive" });
    if (reviewNote !== undefined && typeof reviewNote !== "string")
      return response.status(400).json({ error: "Review note must be text" });
    const state = currentState();
    if (!state.snapshot.detections.some((detection) => detection.id === request.params.id))
      return response.status(404).json({ error: "Detection not found" });
    const detections: Detection[] = state.snapshot.detections.map((detection) =>
      detection.id === request.params.id
        ? {
            ...detection,
            ...(status ? { status: status as Detection["status"], reviewedBy: request.operator!.email, reviewedAt: new Date().toISOString() } : {}),
            ...(typeof reviewNote === "string" ? { reviewNote: reviewNote.slice(0, 1000) } : {}),
          }
        : detection,
    );
    await saveState({ ...state, snapshot: { ...state.snapshot, detections } });
    await appendAudit(request.operator!, "detection.review", String(request.params.id), {
      status: status ?? "note_updated",
      noteLength: typeof reviewNote === "string" ? reviewNote.length : 0,
    });
    publishSnapshot();
    return response.json(detections.find((detection) => detection.id === request.params.id));
  },
);

app.post(
  "/api/alerts",
  requireAuth,
  requireRoles("supervisor"),
  async (request, response) => {
    const { title, description, asset, severity } = request.body as Partial<Alert>;
    if (!title || !description || !asset || !["critical", "warning", "info"].includes(String(severity)))
      return response.status(400).json({ error: "Title, description, asset and valid severity are required" });
    const alert: Alert = {
      id: `ALT-${randomUUID().slice(0, 8).toUpperCase()}`,
      title,
      description,
      asset,
      severity: severity as Alert["severity"],
      timestamp: new Date().toISOString(),
      status: "open",
    };
    const alertSeverity = alert.severity;
    const state = currentState();
    await saveState({ ...state, snapshot: { ...state.snapshot, alerts: [alert, ...state.snapshot.alerts] } });
    await appendAudit(request.operator!, "alert.create", alert.id, { severity, asset });
    void sendExpoPush(
      state.pushTokens.map((registration) => registration.token),
      { title: `${alertSeverity.toUpperCase()}: ${title}`, body: `${asset} · ${description}`, data: { alertId: alert.id } },
    ).catch((error: unknown) => console.warn("Push delivery failed", error));
    publishSnapshot();
    return response.status(201).json(alert);
  },
);

app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found" }));
app.use(express.static(webDist, { index: false }));
app.get("*", (_request, response) => response.sendFile(resolve(webDist, "index.html")));

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = radians(lat2 - lat1);
  const deltaLongitude = radians(lon2 - lon1);
  const value = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function publishSnapshot() {
  const message = JSON.stringify(currentState().snapshot);
  for (const socket of sockets.clients)
    if (socket.readyState === 1) socket.send(message);
}

server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const ticket = url.searchParams.get("ticket");
    const now = Date.now();
    for (const [usedTicket, expiresAt] of consumedTickets)
      if (expiresAt <= now) consumedTickets.delete(usedTicket);
    if (url.pathname !== "/ws" || !ticket || consumedTickets.has(ticket))
      throw new Error("Invalid websocket ticket");
    verifyWebSocketTicket(ticket);
    consumedTickets.set(ticket, now + 30_000);
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});
sockets.on("connection", (socket) => socket.send(JSON.stringify(currentState().snapshot)));

export async function startServer() {
  await initializePersistence(createInitialSnapshot());
  const adapter = createTelemetryAdapter("simulation");
  setInterval(() => {
    const state = currentState();
    if (state.snapshot.mode !== "SIMULATION") return;
    const snapshot = adapter.next(state.snapshot);
    void saveState({ ...state, snapshot })
      .then(publishSnapshot)
      .catch((error: unknown) => console.error("Simulation persistence failed", error));
  }, 2000).unref();
  const port = Number(process.env.PORT || 4000);
  server.listen(port, "0.0.0.0", () => {
    const address = server.address() as AddressInfo;
    console.log(`AeroGuard ${process.env.DATABASE_URL ? "PostgreSQL" : "local JSON"} API listening on port ${address.port}`);
  });
  return server;
}