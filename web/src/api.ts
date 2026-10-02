import type { GeofenceConfig, OperatorIdentity, SystemSnapshot } from "@aeroguard/shared";

export interface AuditEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId: string;
  createdAt: string;
  detail: Record<string, unknown>;
}

const baseUrl = import.meta.env.VITE_API_URL || "";

export async function clearAccessToken() {
  await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

export async function signIn(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let body: { error?: string; operator?: OperatorIdentity } = {};
  const text = await response.text();
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(text || `Sign in failed with status ${response.status}`);
  }
  if (!response.ok || !body.operator)
    throw new Error(body.error || "Sign in failed");
  return body.operator;
}

export async function getCurrentOperator(): Promise<OperatorIdentity> {
  const response = await authorizedFetch("/api/auth/me");
  if (!response.ok) throw new Error("Session expired");
  return response.json() as Promise<OperatorIdentity>;
}

export async function getSnapshot(): Promise<SystemSnapshot> {
  const response = await authorizedFetch("/api/snapshot");
  if (!response.ok) throw new Error("API unavailable");
  return response.json() as Promise<SystemSnapshot>;
}

export function subscribeToSnapshot(
  onSnapshot: (snapshot: SystemSnapshot) => void,
  onConnect: () => void,
  onError: () => void,
) {
  let socket: WebSocket | null = null;
  let closed = false;
  void authorizedFetch("/api/auth/ws-ticket", { method: "POST" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Session expired");
      return (await response.json()) as { ticket: string };
    })
    .then(({ ticket }) => {
      if (closed) return;
      const socketUrl = baseUrl
        ? baseUrl.replace(/^http/, "ws") + "/ws"
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
      socket = new WebSocket(`${socketUrl}?ticket=${encodeURIComponent(ticket)}`);
      socket.onopen = onConnect;
      socket.onmessage = (event) =>
        onSnapshot(JSON.parse(event.data) as SystemSnapshot);
      socket.onerror = onError;
    })
    .catch(onError);
  return () => {
    closed = true;
    socket?.close();
  };
}

export async function postMission(payload: {
  asset: string;
  zone: string;
  type: string;
}) {
  const response = await authorizedFetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error || "Mission could not be started");
  }
  return response.json();
}

export async function controlMission(id: string, action: string) {
  return authorizedFetch(`/api/missions/${id}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export async function updateAlert(id: string, status: "open" | "reviewed") {
  return authorizedFetch(`/api/alerts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function updateDetection(
  id: string,
  update: { status?: "reviewed" | "false_positive"; reviewNote?: string },
) {
  return authorizedFetch(`/api/detections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

export async function getAuditLog() {
  const response = await authorizedFetch("/api/audit");
  if (!response.ok) throw new Error("Supervisor access required");
  return response.json() as Promise<AuditEntry[]>;
}

export async function updateGeofence(geofence: GeofenceConfig) {
  return authorizedFetch("/api/system/geofence", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geofence),
  });
}

export async function selectTelemetryAdapter(adapter: "simulation" | "mavlink") {
  return authorizedFetch("/api/system/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adapter }),
  });
}

export async function createSimulationAlert(alert: {
  title: string;
  description: string;
  asset: string;
  severity: "critical" | "warning" | "info";
}) {
  return authorizedFetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(alert),
  });
}

export async function getOperators() {
  const response = await authorizedFetch("/api/operators");
  if (!response.ok) throw new Error("Supervisor access required");
  return response.json() as Promise<OperatorIdentity[]>;
}

export async function createOperator(payload: {
  email: string;
  name: string;
  role: OperatorIdentity["role"];
  password: string;
}) {
  return authorizedFetch("/api/operators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}