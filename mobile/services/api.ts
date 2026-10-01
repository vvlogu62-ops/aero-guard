import type { Alert, SystemSnapshot } from "@aeroguard/shared";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://aeroguard-kit6.onrender.com";
export async function fetchSnapshot(): Promise<SystemSnapshot> {
  const response = await fetch(`${API_URL}/api/snapshot`);
  if (!response.ok) throw new Error("AeroGuard API unavailable");
  return response.json() as Promise<SystemSnapshot>;
}
export async function startMission(payload: {
  asset: string;
  zone: string;
  type: string;
}) {
  const response = await fetch(`${API_URL}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not start mission");
  return response.json();
}
export async function controlMission(id: string, action: string) {
  return fetch(`${API_URL}/api/missions/${id}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}
export async function reviewAlert(id: string, status: Alert["status"]) {
  return fetch(`${API_URL}/api/alerts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
export async function updateDetection(
  id: string,
  update: { status?: "reviewed"; reviewNote?: string },
) {
  return fetch(`${API_URL}/api/detections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}
