import type { SystemSnapshot } from "@aeroguard/shared";

const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:4000";
export async function getSnapshot(): Promise<SystemSnapshot> {
  const response = await fetch(`${baseUrl}/api/snapshot`);
  if (!response.ok) throw new Error("API unavailable");
  return response.json() as Promise<SystemSnapshot>;
}
export function subscribeToSnapshot(
  onSnapshot: (snapshot: SystemSnapshot) => void,
) {
  const socketUrl = baseUrl.replace(/^http/, "ws") + "/ws";
  const socket = new WebSocket(socketUrl);
  socket.onmessage = (event) =>
    onSnapshot(JSON.parse(event.data) as SystemSnapshot);
  return socket;
}
export async function postMission(payload: {
  asset: string;
  zone: string;
  type: string;
}) {
  const response = await fetch(`${baseUrl}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Mission could not be started");
  return response.json();
}
export async function controlMission(id: string, action: string) {
  return fetch(`${baseUrl}/api/missions/${id}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}
export async function updateAlert(id: string, status: "open" | "reviewed") {
  return fetch(`${baseUrl}/api/alerts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
export async function updateDetection(
  id: string,
  update: { status?: "reviewed"; reviewNote?: string },
) {
  return fetch(`${baseUrl}/api/detections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}
