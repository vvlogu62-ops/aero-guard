export type Severity = "critical" | "warning" | "info";
export type RecordStatus = "open" | "reviewed";
export type MissionStatus = "active" | "paused" | "completed" | "scheduled";
export type DetectionStatus = "attention_required" | "reviewed" | "normal";

export interface DroneStatus {
  id: string;
  status: "online" | "offline";
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  battery: number;
  signal: number;
  satellites: number;
  flightMode: "AUTO" | "HOLD" | "RTL";
  missionStatus: MissionStatus;
  heading: number;
}

export interface Detection {
  id: string;
  type: string;
  confidence: number;
  asset: string;
  zone: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  image: string;
  status: DetectionStatus;
  reviewNote?: string;
}

export interface TemperatureReading {
  timestamp: string;
  temperature: number;
  threshold: number;
  status: "normal" | "warning" | "critical";
  asset: string;
}

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  asset: string;
  timestamp: string;
  status: RecordStatus;
}

export interface Mission {
  id: string;
  asset: string;
  zone: string;
  type: "Visual Inspection" | "Temperature Monitoring" | "Full Inspection";
  status: MissionStatus;
  startTime: string;
  endTime?: string;
  detections: number;
  progress: number;
}

export interface ActivityEvent {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  severity: Severity;
}

export interface SystemSnapshot {
  mode: "SIMULATION";
  updatedAt: string;
  drone: DroneStatus;
  detections: Detection[];
  temperatures: TemperatureReading[];
  alerts: Alert[];
  missions: Mission[];
  activity: ActivityEvent[];
  flightPath: Array<[number, number]>;
}
