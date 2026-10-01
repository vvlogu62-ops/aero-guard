import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  advanceSnapshot,
  createInitialSnapshot,
} from "@aeroguard/shared/simulation";
import type { Alert, Detection, Mission } from "@aeroguard/shared";

const app = express();
const server = createServer(app);
const sockets = new WebSocketServer({ server, path: "/ws" });
let snapshot = createInitialSnapshot();
app.use(cors());
app.use(express.json());
app.get("/api/health", (_request, response) =>
  response.json({ status: "ok", mode: "SIMULATION" }),
);
app.get("/api/snapshot", (_request, response) => response.json(snapshot));
app.post("/api/missions", (request, response) => {
  const { asset, zone, type } = request.body as Pick<
    Mission,
    "asset" | "zone" | "type"
  >;
  if (!asset || !zone || !type)
    return response
      .status(400)
      .json({ error: "asset, zone and type are required" });
  const mission: Mission = {
    id: `MSN-${String(Date.now()).slice(-4)}`,
    asset,
    zone,
    type,
    status: "active",
    startTime: new Date().toISOString(),
    detections: 0,
    progress: 0,
  };
  snapshot = {
    ...snapshot,
    missions: [mission, ...snapshot.missions],
    drone: { ...snapshot.drone, missionStatus: "active", flightMode: "AUTO" },
  };
  publish();
  return response.status(201).json(mission);
});
app.post("/api/missions/:id/control", (request, response) => {
  const action = String(request.body.action || "");
  if (!["pause", "resume", "return", "land"].includes(action))
    return response
      .status(400)
      .json({ error: "Unsupported simulation action" });
  const missions = snapshot.missions.map((mission) =>
    mission.id === request.params.id
      ? {
          ...mission,
          status:
            action === "pause"
              ? ("paused" as const)
              : action === "resume" || action === "return"
                ? ("active" as const)
                : ("completed" as const),
        }
      : mission,
  );
  const currentStatus =
    action === "pause" ? "paused" : action === "land" ? "completed" : "active";
  snapshot = {
    ...snapshot,
    missions,
    drone: {
      ...snapshot.drone,
      missionStatus: currentStatus,
      flightMode:
        action === "return" ? "RTL" : action === "pause" ? "HOLD" : "AUTO",
    },
  };
  publish();
  return response.json({ ok: true, mode: "SIMULATION", action });
});
app.patch("/api/alerts/:id", (request, response) => {
  const status = request.body.status === "reviewed" ? "reviewed" : "open";
  const alerts: Alert[] = snapshot.alerts.map((alert) =>
    alert.id === request.params.id ? { ...alert, status } : alert,
  );
  snapshot = { ...snapshot, alerts };
  publish();
  return response.json(
    snapshot.alerts.find((alert) => alert.id === request.params.id) ?? null,
  );
});
app.patch("/api/detections/:id", (request, response) => {
  const exists = snapshot.detections.some(
    (detection) => detection.id === request.params.id,
  );
  if (!exists)
    return response.status(404).json({ error: "Detection not found" });
  const detections: Detection[] = snapshot.detections.map((detection) =>
    detection.id === request.params.id
      ? {
          ...detection,
          ...(request.body.status === "reviewed"
            ? { status: "reviewed" as const }
            : {}),
          ...(typeof request.body.reviewNote === "string"
            ? { reviewNote: request.body.reviewNote.slice(0, 1000) }
            : {}),
        }
      : detection,
  );
  snapshot = { ...snapshot, detections };
  publish();
  return response.json(
    detections.find((detection) => detection.id === request.params.id),
  );
});
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(webDist, { index: false }));
app.get("*", (_request, response) =>
  response.sendFile(resolve(webDist, "index.html")),
);
function publish() {
  const message = JSON.stringify(snapshot);
  for (const socket of sockets.clients)
    if (socket.readyState === 1) socket.send(message);
}
setInterval(() => {
  snapshot = advanceSnapshot(snapshot);
  publish();
}, 2000);
sockets.on("connection", (socket) => socket.send(JSON.stringify(snapshot)));
const port = Number(process.env.PORT || 4000);
server.listen(port, "0.0.0.0", () =>
  console.log(`AeroGuard simulation API listening on http://localhost:${port}`),
);
