import type {
  Alert,
  GeofenceConfig,
  OperatorIdentity,
  SystemSnapshot,
} from "@aeroguard/shared";
import * as SecureStore from "expo-secure-store";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://aeroguard-kit6.onrender.com";
const tokenKey = "aeroguard-access-token";
let accessToken: string | null = null;

export async function restoreSession(): Promise<OperatorIdentity | null> {
  accessToken = await SecureStore.getItemAsync(tokenKey);
  if (!accessToken) return null;
  try {
    const operator = await getCurrentOperator();
    return operator;
  } catch {
    await signOut();
    return null;
  }
}

export async function signIn(email: string, password: string) {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, client: "mobile" }),
  });
  let body: {
    error?: string;
    token?: string;
    operator?: OperatorIdentity;
  } = {};
  const text = await response.text();
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(text || `Sign in failed with status ${response.status}`);
  }
  if (!response.ok || !body.token || !body.operator)
    throw new Error(body.error || "Sign in failed");
  accessToken = body.token;
  await SecureStore.setItemAsync(tokenKey, body.token);
  return body.operator;
}

export async function signOut() {
  accessToken = null;
  await SecureStore.deleteItemAsync(tokenKey);
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function getCurrentOperator(): Promise<OperatorIdentity> {
  const response = await authorizedFetch("/api/auth/me");
  if (!response.ok) throw new Error("Session expired");
  return response.json() as Promise<OperatorIdentity>;
}

export async function fetchSnapshot(): Promise<SystemSnapshot> {
  const response = await authorizedFetch("/api/snapshot");
  if (!response.ok) throw new Error("AeroGuard API unavailable");
  return response.json() as Promise<SystemSnapshot>;
}

export async function startMission(payload: {
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
    throw new Error(body.error || "Could not start mission");
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

export async function reviewAlert(id: string, status: Alert["status"]) {
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

export async function registerPushToken(token: string) {
  return authorizedFetch("/api/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  targetId: string;
  createdAt: string;
  detail: Record<string, unknown>;
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

export async function checkLiveTelemetry() {
  return authorizedFetch("/api/system/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adapter: "mavlink" }),
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