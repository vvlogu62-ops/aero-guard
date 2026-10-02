import { advanceSnapshot } from "@aeroguard/shared/simulation";
import type { SystemSnapshot } from "@aeroguard/shared";

export interface TelemetryAdapter {
  readonly id: "simulation" | "mavlink";
  readonly connected: boolean;
  next(snapshot: SystemSnapshot): SystemSnapshot;
}

export class SimulationTelemetryAdapter implements TelemetryAdapter {
  readonly id = "simulation" as const;
  readonly connected = true;

  next(snapshot: SystemSnapshot) {
    return {
      ...advanceSnapshot(snapshot),
      mode: "SIMULATION" as const,
      telemetryAdapter: this.id,
      telemetryConnected: this.connected,
    };
  }
}

export class MavlinkTelemetryAdapter implements TelemetryAdapter {
  readonly id = "mavlink" as const;
  readonly connected = false;

  next(snapshot: SystemSnapshot) {
    return {
      ...snapshot,
      mode: "SIMULATION" as const,
      telemetryAdapter: this.id,
      telemetryConnected: false,
    };
  }
}

export function createTelemetryAdapter(id: "simulation" | "mavlink") {
  return id === "simulation"
    ? new SimulationTelemetryAdapter()
    : new MavlinkTelemetryAdapter();
}