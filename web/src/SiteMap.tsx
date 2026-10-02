import { useEffect, useState } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Detection, SystemSnapshot } from '@aeroguard/shared';

function createDroneIcon(heading: number) {
  return L.divIcon({
    className: 'drone-map-marker-wrap',
    html: `<div style="transform: rotate(${heading}deg); width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: #13241d; border: 2px solid #55d6ae; color: #55d6ae; font-size: 16px; box-shadow: 0 0 14px rgba(85,214,174,0.5);">
      <span style="display:inline-block; transform: rotate(-45deg);">✈</span>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}

const alertIcon = L.divIcon({
  className: 'alert-map-marker-wrap',
  html: `<div style="width: 16px; height: 16px; background: #e37468; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(227,116,104,0.7);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [map]);
  return null;
}

function DroneFollower({
  position,
  tracking,
  onUserPan,
}: {
  position: [number, number];
  tracking: boolean;
  onUserPan: () => void;
}) {
  const map = useMap();
  useMapEvents({
    dragstart: onUserPan,
  });

  useEffect(() => {
    if (tracking) {
      map.panTo(position, { animate: true, duration: 1.2 });
    }
  }, [map, position, tracking]);

  return null;
}

function CenterButton({ position, onTrack }: { position: [number, number]; onTrack: () => void }) {
  const map = useMap();
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 500, display: 'flex', gap: 6 }}>
      <button
        onClick={() => {
          map.setView(position, 17, { animate: true });
          onTrack();
        }}
        style={{
          background: '#14201b',
          border: '1px solid #32473c',
          color: '#55d6ae',
          padding: '6px 11px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
          fontFamily: "'DM Mono', monospace",
        }}
      >
        🎯 RE-CENTER AG-01
      </button>
    </div>
  );
}

export default function SiteMap({
  snapshot,
  compact = false,
  onSelectDetection,
}: {
  snapshot: SystemSnapshot;
  compact?: boolean;
  onSelectDetection?: (detection: Detection) => void;
}) {
  const position: [number, number] = [snapshot.drone.latitude, snapshot.drone.longitude];
  const [tracking, setTracking] = useState(true);

  return (
    <div className={`map-frame ${compact ? 'map-compact' : ''}`}>
      <MapContainer
        center={position}
        zoom={17}
        scrollWheelZoom={!compact}
        zoomControl={!compact}
        style={{ width: '100%', height: '100%' }}
      >
        <MapResizer />
        {/* CartoDB Dark Matter base layer matching industrial dark theme */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={19}
        />
        {snapshot.geofence.enabled && (
          <Circle
            center={[snapshot.geofence.centerLatitude, snapshot.geofence.centerLongitude]}
            radius={snapshot.geofence.radiusMeters}
            pathOptions={{
              color: '#55d6ae',
              fillColor: '#55d6ae',
              fillOpacity: 0.08,
              dashArray: '6 8',
              weight: 1.5,
            }}
          />
        )}
        <DroneFollower
          position={position}
          tracking={tracking}
          onUserPan={() => setTracking(false)}
        />
        <Polyline
          positions={snapshot.flightPath}
          pathOptions={{ color: '#2dd4bf', weight: 3, dashArray: '6 8' }}
        />
        <Marker position={position} icon={createDroneIcon(snapshot.drone.heading)}>
          <Popup>
            <div style={{ color: '#111815', fontSize: 11, lineHeight: 1.5, minWidth: 150 }}>
              <strong style={{ color: '#1a4435', fontSize: 12 }}>🚁 AG-01 (ACTIVE)</strong>
              <br />
              <b>Altitude:</b> {snapshot.drone.altitude} m AGL
              <br />
              <b>Speed:</b> {snapshot.drone.speed} m/s
              <br />
              <b>Battery:</b> {snapshot.drone.battery}%
              <br />
              <b>Mode:</b> {snapshot.drone.flightMode}
              <br />
              <small style={{ color: '#888' }}>SIMULATION TELEMETRY</small>
            </div>
          </Popup>
        </Marker>
        {snapshot.detections
          .filter((detection) => detection.status !== 'normal')
          .map((detection) => (
            <Marker
              key={detection.id}
              position={[detection.latitude, detection.longitude]}
              icon={alertIcon}
              eventHandlers={{
                click: () => onSelectDetection?.(detection),
              }}
            >
              <Popup>
                <div style={{ color: '#111815', fontSize: 11, lineHeight: 1.5, minWidth: 180 }}>
                  <div style={{ background: '#fdedec', color: '#c0392b', padding: '3px 6px', borderRadius: 3, fontWeight: 700, fontSize: 10, marginBottom: 4 }}>
                    ⚠️ {detection.type.toUpperCase()} DETECTED
                  </div>
                  <b>Asset:</b> {detection.asset}
                  <br />
                  <b>Zone:</b> {detection.zone}
                  <br />
                  <b>Confidence:</b> {Math.round(detection.confidence * 100)}%
                  <br />
                  <b>Status:</b> {detection.status.replace('_', ' ').toUpperCase()}
                  <br />
                  <small style={{ color: '#666' }}>Human review required</small>
                </div>
              </Popup>
            </Marker>
          ))}
        {!compact && <CenterButton position={position} onTrack={() => setTracking(true)} />}
      </MapContainer>
      <div className="map-attribution">CARTO &bull; OPENSTREETMAP &bull; DEMO TELEMETRY</div>
    </div>
  );
}
