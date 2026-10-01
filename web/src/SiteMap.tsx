import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { SystemSnapshot } from '@aeroguard/shared';

const droneIcon = L.divIcon({ className: 'drone-map-icon', html: '<span>↗</span>', iconSize: [32, 32], iconAnchor: [16, 16] });
const alertIcon = L.divIcon({ className: 'alert-map-icon', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });
function FollowDrone({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.panTo(position, { animate: true }); }, [map, position]);
  return null;
}
export default function SiteMap({ snapshot, compact = false }: { snapshot: SystemSnapshot; compact?: boolean }) {
  const position: [number, number] = [snapshot.drone.latitude, snapshot.drone.longitude];
  return <div className={`map-frame ${compact ? 'map-compact' : ''}`}>
    <MapContainer center={position} zoom={17} scrollWheelZoom={!compact} zoomControl={!compact}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FollowDrone position={position} />
      <Polyline positions={snapshot.flightPath} pathOptions={{ color: '#2dd4bf', weight: 3, dashArray: '7 8' }} />
      <Marker position={position} icon={droneIcon}><Popup>AG-01 · {snapshot.drone.altitude} m · SIMULATION</Popup></Marker>
      {snapshot.detections.filter((detection) => detection.status !== 'normal').map((detection) => <Marker key={detection.id} position={[detection.latitude, detection.longitude]} icon={alertIcon}><Popup><strong>{detection.type}</strong><br />{detection.asset} · {Math.round(detection.confidence * 100)}%<br />Human review required</Popup></Marker>)}
    </MapContainer>
    <div className="map-attribution">OPENSTREETMAP · DEMO TELEMETRY</div>
  </div>;
}
