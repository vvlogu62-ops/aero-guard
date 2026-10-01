import type { Alert, Detection, Mission, SystemSnapshot, TemperatureReading } from './index.js';

const now = Date.now();
const stamp = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export function createInitialSnapshot(): SystemSnapshot {
  const detections: Detection[] = [
    { id: 'DET-1042', type: 'Corrosion', confidence: 0.91, asset: 'Pipeline-03', zone: 'Zone B', latitude: 37.7749, longitude: -122.4194, timestamp: stamp(3), image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1000&q=80', status: 'attention_required' },
    { id: 'DET-1041', type: 'Surface crack', confidence: 0.88, asset: 'Tank-01', zone: 'Zone A', latitude: 37.7757, longitude: -122.4178, timestamp: stamp(11), image: 'https://images.unsplash.com/photo-1565514020179-026b92b84bb6?auto=format&fit=crop&w=1000&q=80', status: 'attention_required' },
    { id: 'DET-1040', type: 'Normal', confidence: 0.96, asset: 'Motor-02', zone: 'Zone C', latitude: 37.7737, longitude: -122.4183, timestamp: stamp(22), image: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=1000&q=80', status: 'normal' }
  ];
  const alerts: Alert[] = [
    { id: 'ALT-223', severity: 'critical', title: 'High temperature', description: 'Motor-04 reached 78°C, above the 60°C threshold.', asset: 'Motor-04', timestamp: stamp(2), status: 'open' },
    { id: 'ALT-222', severity: 'warning', title: 'Corrosion detected', description: 'Possible corrosion identified on Pipeline-03. Human review required.', asset: 'Pipeline-03', timestamp: stamp(3), status: 'open' },
    { id: 'ALT-221', severity: 'warning', title: 'Surface crack detected', description: 'Possible surface crack identified on Tank-01.', asset: 'Tank-01', timestamp: stamp(11), status: 'open' },
    { id: 'ALT-220', severity: 'info', title: 'Mission completed', description: 'Zone B visual inspection completed.', asset: 'Pipeline-03', timestamp: stamp(35), status: 'reviewed' }
  ];
  const temperatures: TemperatureReading[] = Array.from({ length: 12 }, (_, index) => {
    const temperature = [43, 44, 45, 46, 44, 47, 48, 46, 49, 47, 46, 48][index];
    return { timestamp: stamp((11 - index) * 5), temperature, threshold: 60, status: 'normal', asset: 'Pipeline-03' };
  });
  const missions: Mission[] = [
    { id: 'MSN-0084', asset: 'Pipeline-03', zone: 'Zone B', type: 'Full Inspection', status: 'active', startTime: stamp(18), detections: 2, progress: 64 },
    { id: 'MSN-0083', asset: 'Tank-01', zone: 'Zone A', type: 'Visual Inspection', status: 'completed', startTime: stamp(72), endTime: stamp(43), detections: 1, progress: 100 },
    { id: 'MSN-0082', asset: 'Compressor-02', zone: 'Zone C', type: 'Temperature Monitoring', status: 'scheduled', startTime: stamp(-34), detections: 0, progress: 0 }
  ];
  return {
    mode: 'SIMULATION', updatedAt: new Date(now).toISOString(),
    drone: { id: 'AG-01', status: 'online', latitude: 37.7749, longitude: -122.4194, altitude: 24, speed: 4.8, battery: 82, signal: 94, satellites: 12, flightMode: 'AUTO', missionStatus: 'active', heading: 128 },
    detections, temperatures, alerts, missions,
    activity: [
      { id: 'EVT-01', title: 'Possible corrosion detected', detail: 'Pipeline-03 · Zone B · 91% confidence', timestamp: stamp(3), severity: 'warning' },
      { id: 'EVT-02', title: 'Mission waypoint reached', detail: 'AG-01 · Waypoint 08 of 12', timestamp: stamp(6), severity: 'info' },
      { id: 'EVT-03', title: 'Thermal reading normal', detail: 'Pipeline-03 · 48°C (threshold 60°C)', timestamp: stamp(8), severity: 'info' }
    ],
    flightPath: [[37.7739, -122.4212], [37.7744, -122.4204], [37.7749, -122.4194], [37.7753, -122.4186], [37.7758, -122.4179]]
  };
}

export function advanceSnapshot(snapshot: SystemSnapshot): SystemSnapshot {
  const tick = Date.now();
  const phase = tick / 18_000;
  const drone = {
    ...snapshot.drone,
    latitude: 37.7749 + Math.sin(phase) * 0.00045,
    longitude: -122.4194 + Math.cos(phase * 0.8) * 0.00052,
    altitude: Math.round(23 + Math.sin(phase * 1.7) * 3),
    speed: Number((4.4 + Math.abs(Math.sin(phase)) * 1.1).toFixed(1)),
    battery: Math.max(12, 82 - Math.floor((tick - now) / 240_000)),
    signal: Math.round(91 + Math.sin(phase * 0.7) * 5),
    heading: Math.round((128 + phase * 16) % 360)
  };
  const temperature: TemperatureReading = {
    timestamp: new Date(tick).toISOString(), temperature: Math.round(46 + Math.sin(phase * 0.5) * 3), threshold: 60, status: 'normal', asset: 'Pipeline-03'
  };
  const activeMission = snapshot.missions.find((mission) => mission.status === 'active');
  const missions = snapshot.missions.map((mission) => mission.status === 'active' ? { ...mission, progress: Math.min(96, mission.progress + 1) } : mission);
  return { ...snapshot, updatedAt: new Date(tick).toISOString(), drone, missions, temperatures: [...snapshot.temperatures.slice(-23), temperature] };
}
