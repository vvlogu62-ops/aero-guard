import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Battery,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Download,
  Gauge,
  MapPin,
  Menu,
  MoreHorizontal,
  Navigation,
  Plus,
  Radio,
  Settings,
  Shield,
  ShieldAlert,
  Thermometer,
  Wifi,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Alert,
  Detection,
  GeofenceConfig,
  Mission,
  OperatorIdentity,
  SystemSnapshot,
} from "@aeroguard/shared";
import SiteMap from "./SiteMap";
import {
  clearAccessToken,
  createSimulationAlert,
  createOperator,
  controlMission,
  getAuditLog,
  getCurrentOperator,
  getOperators,
  getSnapshot,
  postMission,
  selectTelemetryAdapter,
  signIn,
  subscribeToSnapshot,
  updateAlert,
  updateDetection,
  updateGeofence,
} from "./api";
import type { AuditEntry } from "./api";

type Page =
  | "overview"
  | "map"
  | "missions"
  | "detections"
  | "temperature"
  | "alerts"
  | "reports"
  | "settings";
const pages: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "map", label: "Live map", icon: MapPin },
  { id: "missions", label: "Missions", icon: Navigation },
  { id: "detections", label: "AI detections", icon: ShieldAlert },
  { id: "temperature", label: "Temperature", icon: Thermometer },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "reports", label: "Reports", icon: Download },
  { id: "settings", label: "Settings", icon: Settings },
];
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const date = (value: string) =>
  new Date(value).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function App() {
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [drawer, setDrawer] = useState(false);
  const [showMission, setShowMission] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<string | null>(
    null,
  );
  const [selectedReport, setSelectedReport] = useState<Mission | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [geofenceRadius, setGeofenceRadius] = useState(350);
  const [alertFilter, setAlertFilter] = useState<"all" | Alert["severity"]>(
    "all",
  );
  const [apiError, setApiError] = useState(false);
  useEffect(() => {
    getCurrentOperator()
      .then(setOperator)
      .catch(() => clearAccessToken())
      .finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    if (!operator) return;
    const refreshSnapshot = () => {
      getSnapshot()
        .then((next) => {
          setSnapshot(next);
          setApiError(false);
        })
        .catch(() => setApiError(true));
    };
    refreshSnapshot();
    const refreshTimer = window.setInterval(refreshSnapshot, 5000);
    const closeSocket = subscribeToSnapshot(
      (next) => {
        setSnapshot(next);
        setApiError(false);
      },
      () => setApiError(false),
      () => setApiError(true),
    );
    return () => {
      window.clearInterval(refreshTimer);
      closeSocket();
    };
  }, [operator]);
  useEffect(() => {
    if (page !== "settings" || operator?.role !== "supervisor") return;
    getAuditLog().then(setAuditEntries).catch(() => setAuditEntries([]));
  }, [page, operator]);
  if (!authReady)
    return (
      <div className="loading-screen">
        <div className="brand-mark"><Shield size={20} /></div>
        <span>AEROGUARD</span>
        <small>Checking operator session...</small>
      </div>
    );
  if (!operator)
    return (
      <LoginScreen
        onLogin={async (email, password) => setOperator(await signIn(email, password))}
      />
    );
  if (!snapshot)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Shield size={20} />
        </div>
        <span>AEROGUARD</span>
        <small>
          {apiError
            ? "API OFFLINE · Start the simulation server"
            : "Connecting to simulation..."}
        </small>
      </div>
    );
  const canOperate = operator.role !== "maintenance";
  const openAlerts = snapshot.alerts.filter((alert) => alert.status === "open");
  const currentMission = snapshot.missions.find(
    (mission) => mission.status === "active" || mission.status === "paused",
  );
  const detection = snapshot.detections.find(
    (item) => item.id === selectedDetection,
  );

  const createMission = async (asset: string, zone: string, type: string) => {
    try {
      await postMission({ asset, zone, type });
      setShowMission(false);
      setPage("missions");
    } catch {
      window.alert("Could not reach the simulation API.");
    }
  };
  const markAlert = async (alert: Alert) => {
    await updateAlert(alert.id, alert.status === "open" ? "reviewed" : "open");
  };
  const saveDetectionReview = async (
    id: string,
    update: { status?: "reviewed" | "false_positive"; reviewNote?: string },
  ) => {
    const response = await updateDetection(id, update);
    if (!response.ok) window.alert("Could not update the AI review.");
  };
  const sendControl = async (action: string) => {
    if (currentMission) await controlMission(currentMission.id, action);
  };
  const saveGeofence = async () => {
    const geofence: GeofenceConfig = {
      ...snapshot.geofence,
      radiusMeters: geofenceRadius,
    };
    const response = await updateGeofence(geofence);
    if (!response.ok)
      window.alert("Could not update the geofence. Supervisor access is required.");
  };
  const testPushAlert = async () => {
    const response = await createSimulationAlert({
      title: "Push notification test",
      description: "Supervisor test alert from the simulation console.",
      asset: "Pipeline-03",
      severity: "info",
    });
    if (!response.ok) window.alert("Could not create test alert.");
    else window.alert("Test alert sent to registered Expo devices.");
  };
  const requestLiveTelemetry = async () => {
    const response = await selectTelemetryAdapter("mavlink");
    const body = (await response.json()) as { error?: string };
    window.alert(body.error || "Live telemetry is unavailable.");
  };
  const exportReports = () => {
    const rows = [
      "Mission,Asset,Zone,Type,Status,Progress,Detections,Started",
      ...snapshot.missions.map((mission) =>
        [
          mission.id,
          mission.asset,
          mission.zone,
          mission.type,
          mission.status,
          mission.progress,
          mission.detections,
          mission.startTime,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.join("\n")], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "aeroguard-mission-reports.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${drawer ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Shield size={19} strokeWidth={2.4} />
          </div>
          <div>
            <strong>AEROGUARD</strong>
            <small>FIELD INTELLIGENCE</small>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setDrawer(false)}
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>
        <div className="site-select">
          <span className="site-dot" />
          <div>
            <small>ACTIVE SITE</small>
            <strong>North Yard · SF-04</strong>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">OPERATIONS</div>
        <nav>
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "selected" : ""}`}
              onClick={() => {
                setPage(id);
                setDrawer(false);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === "alerts" && openAlerts.length > 0 && (
                <em>{openAlerts.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="pulse-dot" />
            <div>
              <strong>Simulation active</strong>
              <small>Telemetry streaming · 2s</small>
            </div>
          </div>
            <button
              className="operator"
              onClick={async () => {
                await clearAccessToken();
                setOperator(null);
                setSnapshot(null);
              }}
              title="Sign out"
            >
              <span className="avatar">{operator.name.slice(0, 1).toUpperCase()}</span>
            <span>
                <strong>{operator.name}</strong>
                <small>{operator.role} · Sign out</small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>
      {drawer && (
        <button
          className="scrim"
          onClick={() => setDrawer(false)}
          aria-label="Close menu"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumb">
            OPERATIONS <span>/</span>{" "}
            <strong>
              {pages.find((item) => item.id === page)?.label.toUpperCase()}
            </strong>
          </div>
          <div className="topbar-actions">
            <div className="sim-pill">
              <span /> DEMO MODE
            </div>
            <div className="top-separator" />
            <span className="top-clock">
              <Clock3 size={14} />{" "}
              {new Date(snapshot.updatedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <button
              className="icon-button notification-button"
              onClick={() => setPage("alerts")}
              aria-label="Open alerts"
            >
              <Bell size={18} />
              {openAlerts.length > 0 && <i />}
            </button>
          </div>
        </header>
        <div className="page-wrap">
          {page === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    THURSDAY, {date(snapshot.updatedAt).toUpperCase()}
                  </div>
                  <h1>Operations overview</h1>
                  <p>
                    Industrial inspection at a glance. Human review required for
                    all AI detections.
                  </p>
                </div>
                {canOperate && <button
                  className="primary-button"
                  onClick={() => setShowMission(true)}
                >
                  <Plus size={16} /> New inspection
                </button>}
              </div>
              <div className="metric-grid">
                <Metric
                  icon={Navigation}
                  label="Aircraft status"
                  value="In flight"
                  note="AG-01 · AUTO"
                  good
                />
                <Metric
                  icon={Battery}
                  label="Battery"
                  value={`${snapshot.drone.battery}%`}
                  note="Est. 18 min remaining"
                />
                <Metric
                  icon={Radio}
                  label="Link quality"
                  value={`${snapshot.drone.signal}%`}
                  note={`${snapshot.drone.satellites} satellites`}
                  good
                />
                <Metric
                  icon={AlertTriangle}
                  label="Open alerts"
                  value={String(openAlerts.length).padStart(2, "0")}
                  note="1 critical · 2 warnings"
                  danger
                />
              </div>
              <div className="overview-grid">
                <section className="panel map-panel">
                  <PanelHeader
                    title="Live operations map"
                    tag="LIVE FEED"
                    action={
                      <button
                        className="text-button"
                        onClick={() => setPage("map")}
                      >
                        Full map <ArrowUpRight size={14} />
                      </button>
                    }
                  />
                  <SiteMap snapshot={snapshot} compact />
                  <div className="map-foot">
                    <span>
                      <i className="legend-drone" /> AG-01 <b>·</b>{" "}
                      {snapshot.drone.altitude} m AGL
                    </span>
                    <span>
                      <span className="legend-route" /> Flight path
                    </span>
                    <span className="mono">
                      {snapshot.drone.latitude.toFixed(4)}° N,{" "}
                      {Math.abs(snapshot.drone.longitude).toFixed(4)}° W
                    </span>
                  </div>
                </section>
                <section className="panel mission-panel">
                  <PanelHeader title="Active inspection" tag="MISSION 084" />
                  <div className="mission-asset">
                    <span className="asset-icon">
                      <Activity size={19} />
                    </span>
                    <div>
                      <strong>
                        {currentMission?.asset ?? "No active mission"}
                      </strong>
                      <small>
                        {currentMission
                          ? `${currentMission.zone} · ${currentMission.type}`
                          : "Ready for dispatch"}
                      </small>
                    </div>
                    <span
                      className={`status-tag ${currentMission?.status ?? "completed"}`}
                    >
                      {currentMission?.status ?? "READY"}
                    </span>
                  </div>
                  <div className="progress-line">
                    <span
                      style={{ width: `${currentMission?.progress ?? 0}%` }}
                    />
                  </div>
                  <div className="progress-meta">
                    <span>Mission progress</span>
                    <strong>{currentMission?.progress ?? 0}%</strong>
                  </div>
                  <div className="mission-stats">
                    <div>
                      <small>ALTITUDE</small>
                      <strong>
                        {snapshot.drone.altitude} <i>m</i>
                      </strong>
                    </div>
                    <div>
                      <small>GROUND SPEED</small>
                      <strong>
                        {snapshot.drone.speed} <i>m/s</i>
                      </strong>
                    </div>
                    <div>
                      <small>FLIGHT MODE</small>
                      <strong>{snapshot.drone.flightMode}</strong>
                    </div>
                  </div>
                  {canOperate && <div className="control-row">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void sendControl(
                          currentMission?.status === "paused"
                            ? "resume"
                            : "pause",
                        )
                      }
                      disabled={!currentMission}
                    >
                      {currentMission?.status === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button
                      className="warning-button"
                      onClick={() => void sendControl("return")}
                      disabled={!currentMission}
                    >
                      Return to home
                    </button>
                  </div>}
                  <div className="simulation-note">
                    <CircleHelp size={13} /> Controls affect simulation only
                  </div>
                </section>
              </div>
              <div className="lower-grid">
                <section className="panel">
                  <PanelHeader
                    title="Recent detections"
                    action={
                      <button
                        className="text-button"
                        onClick={() => setPage("detections")}
                      >
                        View all <ArrowUpRight size={14} />
                      </button>
                    }
                  />
                  <div className="detection-list">
                    {snapshot.detections.slice(0, 3).map((item) => (
                      <button
                        className="detection-row"
                        key={item.id}
                        onClick={() => setSelectedDetection(item.id)}
                      >
                        <span
                          className={`severity-mark ${item.status === "normal" ? "normal" : "warning"}`}
                        />
                        <span className="detection-name">
                          <strong>
                            {item.type === "Normal"
                              ? "No defect detected"
                              : `Possible ${item.type.toLowerCase()}`}
                          </strong>
                          <small>
                            {item.asset} · {item.zone}
                          </small>
                        </span>
                        <span className="confidence">
                          {Math.round(item.confidence * 100)}%
                        </span>
                        <span className="mono quiet">
                          {time(item.timestamp)}
                        </span>
                        <ArrowUpRight size={14} className="row-arrow" />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel activity-panel">
                  <PanelHeader
                    title="Activity log"
                    action={
                      <button
                        className="text-button"
                        onClick={() => setPage("reports")}
                      >
                        All activity <ArrowUpRight size={14} />
                      </button>
                    }
                  />
                  {snapshot.activity.map((event) => (
                    <div className="activity-row" key={event.id}>
                      <span className={`activity-dot ${event.severity}`} />
                      <div>
                        <strong>{event.title}</strong>
                        <small>{event.detail}</small>
                      </div>
                      <time>{time(event.timestamp)}</time>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
          {page === "map" && (
            <>
              <PageHeading
                title="Live map"
                description="Drone telemetry, inspection zones and possible defects · simulation coordinates"
                badge="SIMULATION"
              />
              <div className="full-map-layout">
                <SiteMap snapshot={snapshot} />
                <div className="map-side panel">
                  <PanelHeader title="AG-01 telemetry" />
                  <div className="telemetry-grid">
                    <Telemetry
                      icon={Navigation}
                      label="ALTITUDE"
                      value={`${snapshot.drone.altitude} m`}
                    />
                    <Telemetry
                      icon={Gauge}
                      label="GROUND SPEED"
                      value={`${snapshot.drone.speed} m/s`}
                    />
                    <Telemetry
                      icon={Battery}
                      label="BATTERY"
                      value={`${snapshot.drone.battery}%`}
                    />
                    <Telemetry
                      icon={Compass}
                      label="HEADING"
                      value={`${snapshot.drone.heading}°`}
                    />
                    <Telemetry
                      icon={Wifi}
                      label="SIGNAL"
                      value={`${snapshot.drone.signal}%`}
                    />
                    <Telemetry
                      icon={MapPin}
                      label="GPS FIX"
                      value={`${snapshot.drone.satellites} sats`}
                    />
                  </div>
                  <div className="map-key">
                    <small>MAP LAYERS</small>
                    <p>
                      <i className="legend-drone" /> Drone location
                    </p>
                    <p>
                      <span className="legend-route" /> Flight path
                    </p>
                    <p>
                      <span className="legend-alert" /> Possible defect · review
                      required
                    </p>
                  </div>
                  {canOperate && <button
                    className="secondary-button full-button"
                    onClick={() => setShowMission(true)}
                  >
                    <Plus size={15} /> New inspection
                  </button>}
                </div>
              </div>
            </>
          )}
          {page === "missions" && (
            <>
              <PageHeading
                title="Inspection missions"
                description="Plan and monitor autonomous inspection flights."
                action={canOperate ? (
                  <button
                    className="primary-button"
                    onClick={() => setShowMission(true)}
                  >
                    <Plus size={16} /> Create mission
                  </button>
                ) : undefined}
              />
              <div className="panel table-panel">
                <table>
                  <thead>
                    <tr>
                      <th>MISSION</th>
                      <th>ASSET / ZONE</th>
                      <th>INSPECTION TYPE</th>
                      <th>STATUS</th>
                      <th>PROGRESS</th>
                      <th>DETECTIONS</th>
                      <th>STARTED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.missions.map((mission) => (
                      <MissionRow key={mission.id} mission={mission} />
                    ))}
                  </tbody>
                </table>
              </div>
              {canOperate && <section className="panel control-card">
                <PanelHeader title="Flight controls" tag="SIMULATION ONLY" />
                <div className="control-card-content">
                  <div>
                    <strong>
                      AG-01 · {currentMission?.asset ?? "Standby"}
                    </strong>
                    <small>
                      These controls update demo telemetry only. No real
                      aircraft is connected.
                    </small>
                  </div>
                  <div className="control-row">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void sendControl(
                          currentMission?.status === "paused"
                            ? "resume"
                            : "pause",
                        )
                      }
                      disabled={!currentMission}
                    >
                      {currentMission?.status === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button
                      className="warning-button"
                      onClick={() => void sendControl("return")}
                      disabled={!currentMission}
                    >
                      Return to home
                    </button>
                    <button
                      className="danger-button"
                      onClick={() => void sendControl("land")}
                      disabled={!currentMission}
                    >
                      Land
                    </button>
                  </div>
                </div>
              </section>}
            </>
          )}
          {page === "detections" && (
            <>
              <PageHeading
                title="AI detections"
                description="Edge AI findings from the inspection feed. All findings require human review."
                badge="YOLO · EDGE AI"
              />
              <div className="detection-cards">
                {snapshot.detections.map((item) => (
                  <button
                    className="detection-card"
                    key={item.id}
                    onClick={() => setSelectedDetection(item.id)}
                  >
                    <div
                      className="detection-image"
                      style={{ backgroundImage: `url(${item.image})` }}
                    >
                      <span
                        className={`status-tag ${item.status === "normal" ? "completed" : "warning"}`}
                      >
                        {item.status === "normal"
                          ? "NORMAL"
                          : "REVIEW REQUIRED"}
                      </span>
                    </div>
                    <div className="detection-card-info">
                      <div className="detection-card-title">
                        <strong>
                          {item.type === "Normal"
                            ? "No defect detected"
                            : `Possible ${item.type.toLowerCase()}`}
                        </strong>
                        <b>{Math.round(item.confidence * 100)}%</b>
                      </div>
                      <span>
                        {item.asset} · {item.zone}
                      </span>
                      <small>
                        {date(item.timestamp)} · {time(item.timestamp)}{" "}
                        <ArrowUpRight size={13} />
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {page === "temperature" && (
            <>
              <PageHeading
                title="Temperature monitoring"
                description="Thermal sensor readings across active inspection assets."
                badge="EDGE SENSOR"
              />
              <div className="metric-grid temp-metrics">
                <Metric
                  icon={Thermometer}
                  label="Current temperature"
                  value={`${snapshot.temperatures.at(-1)?.temperature ?? 48}°C`}
                  note="Pipeline-03 · normal"
                  good
                />
                <Metric
                  icon={ArrowUpRight}
                  label="Maximum today"
                  value="54°C"
                  note="Motor-02 · 10:42"
                />
                <Metric
                  icon={Activity}
                  label="Daily average"
                  value="46°C"
                  note="Across 4 assets"
                />
                <Metric
                  icon={AlertTriangle}
                  label="Alert threshold"
                  value="60°C"
                  note="1 asset above threshold"
                  danger
                />
              </div>
              <section className="panel chart-panel">
                <PanelHeader title="Thermal trend" tag="LAST 60 MINUTES" />
                <ResponsiveContainer width="100%" height={310}>
                  <AreaChart data={snapshot.temperatures}>
                    <defs>
                      <linearGradient
                        id="temperatureFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#ef8b57"
                          stopOpacity={0.22}
                        />
                        <stop
                          offset="100%"
                          stopColor="#ef8b57"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 6"
                      vertical={false}
                      stroke="#26312d"
                    />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value) => time(value)}
                      stroke="#64726c"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <YAxis
                      domain={[35, 65]}
                      stroke="#64726c"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      unit="°"
                    />
                    <Tooltip
                      labelFormatter={(value) => time(String(value))}
                      formatter={(value) => [`${value}°C`, "Temperature"]}
                      contentStyle={{
                        background: "#18211e",
                        border: "1px solid #303b36",
                        borderRadius: 6,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="temperature"
                      stroke="#e99565"
                      fill="url(#temperatureFill)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="threshold"
                      stroke="#dc6860"
                      strokeDasharray="5 5"
                      fill="transparent"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="chart-caption">
                  <span>
                    <i className="chart-legend temp" /> Temperature
                  </span>
                  <span>
                    <i className="chart-legend threshold" /> Threshold · 60°C
                  </span>
                  <span>OpenAI / OpenCV edge reading · demo data</span>
                </div>
              </section>
            </>
          )}
          {page === "alerts" && (
            <>
              <PageHeading
                title="Alert inbox"
                description={`${openAlerts.length} alerts need attention across the active site.`}
              />
              <div className="filter-row">
                {(["all", "critical", "warning", "info"] as const).map(
                  (filter) => (
                    <button
                      key={filter}
                      className={`filter-chip ${alertFilter === filter ? "active" : ""}`}
                      onClick={() => setAlertFilter(filter)}
                    >
                      {filter === "all"
                        ? "All alerts"
                        : filter[0].toUpperCase() + filter.slice(1)}
                      {filter === "all" && (
                        <span>{snapshot.alerts.length}</span>
                      )}
                    </button>
                  ),
                )}
              </div>
              <div className="alert-list">
                {snapshot.alerts
                  .filter(
                    (alert) =>
                      alertFilter === "all" || alert.severity === alertFilter,
                  )
                  .map((alert) => (
                    <AlertRow
                      alert={alert}
                      onToggle={() => void markAlert(alert)}
                      key={alert.id}
                    />
                  ))}
              </div>
            </>
          )}
          {page === "reports" && (
            <>
              <PageHeading
                title="Inspection reports"
                description="Completed mission summaries and findings for qualified review."
                action={
                  <button className="secondary-button" onClick={exportReports}>
                    <Download size={15} /> Export reports
                  </button>
                }
              />
              <div className="report-list">
                {snapshot.missions
                  .filter((mission) => mission.status !== "active")
                  .map((mission) => (
                    <article className="panel report-row" key={mission.id}>
                      <span className="report-icon">
                        <Download size={18} />
                      </span>
                      <div className="report-main">
                        <strong>{mission.asset}</strong>
                        <small>
                          {mission.zone} · {mission.type} ·{" "}
                          {date(mission.startTime)}
                        </small>
                      </div>
                      <div className="report-summary">
                        <strong>{mission.detections} detections</strong>
                        <small>Temperature within normal range</small>
                      </div>
                      <span className={`status-tag ${mission.status}`}>
                        {mission.status}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`View ${mission.asset} report`}
                        onClick={() => setSelectedReport(mission)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </article>
                  ))}
              </div>
            </>
          )}
          {page === "settings" && (
            <>
              <PageHeading
                title="System settings"
                description={`Authenticated as ${operator.name} · ${operator.role.toUpperCase()} · simulation safety controls`}
              />
              <div className="settings-grid">
                <section className="panel settings-section">
                  <PanelHeader title="System connections" />
                  <SettingRow
                    title="Flight controller"
                    subtitle="Pixhawk · ArduPilot adapter"
                    value={snapshot.telemetryAdapter === "mavlink" ? "LIVE LOCKED" : "Not connected"}
                  />
                  <SettingRow
                    title="Edge computer"
                    subtitle="Raspberry Pi · OpenCV / YOLO"
                    value="Simulation"
                  />
                  <SettingRow
                    title="Thermal sensor"
                    subtitle="Sensor stream"
                    value="Simulation"
                  />
                  <SettingRow
                    title="Operator API"
                    subtitle="REST + WebSocket"
                    value={`${operator.role} session`}
                  />
                </section>
                <section className="panel settings-section">
                  <PanelHeader title="Safety & data" />
                  <div className="safety-copy">
                    <ShieldAlert size={18} />
                    <p>
                      Simulated telemetry is not real aircraft data. AI
                      detections indicate possible defects and must be verified
                      by qualified personnel. AeroGuard does not replace site
                      safety procedures.
                    </p>
                  </div>
                  <div className="geofence-control">
                    <div><strong>Site geofence</strong><small>Inspection boundary · maximum altitude {snapshot.geofence.maxAltitudeMeters} m</small></div>
                    <label>RADIUS <strong>{geofenceRadius} m</strong><input type="range" min="50" max="1000" step="25" value={geofenceRadius} disabled={operator.role !== "supervisor"} onChange={(event) => setGeofenceRadius(Number(event.target.value))} /></label>
                    <button className="secondary-button" disabled={operator.role !== "supervisor"} onClick={() => void saveGeofence()}>Save geofence</button>
                  </div>
                  <div className="safety-actions">
                    <button className="secondary-button" onClick={() => void requestLiveTelemetry()}>Check MAVLink readiness</button>
                    {operator.role === "supervisor" && <button className="secondary-button" onClick={() => void testPushAlert()}>Send test alert</button>}
                  </div>
                  <small className="settings-footnote">LIVE telemetry remains locked until a validated MAVLink adapter is connected.</small>
                </section>
                {operator.role === "supervisor" && <section className="panel settings-section audit-section"><PanelHeader title="Recent audit activity" tag="SUPERVISOR" />{auditEntries.length ? auditEntries.slice(0, 12).map((entry) => <div className="audit-row" key={entry.id}><span><strong>{entry.action}</strong><small>{entry.actorEmail} · {entry.targetId}</small></span><time>{time(entry.createdAt)}</time></div>) : <p className="settings-footnote">No operator actions recorded yet.</p>}</section>}
                {operator.role === "supervisor" && <section className="panel settings-section audit-section"><PanelHeader title="Operator accounts" tag="SUPERVISOR" /><OperatorManagement onCreated={() => getAuditLog().then(setAuditEntries).catch(() => undefined)} /></section>}
              </div>
            </>
          )}
        </div>
      </main>
      {showMission && (
        <MissionDialog
          onClose={() => setShowMission(false)}
          onCreate={createMission}
        />
      )}
      {detection && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setSelectedDetection(null);
          }}
        >
          <div className="detail-dialog">
            <button
              className="icon-button modal-close"
              onClick={() => setSelectedDetection(null)}
              aria-label="Close detection"
            >
              <X size={18} />
            </button>
            <img src={detection.image} alt="Inspection frame" />
            <div className="detail-content">
              <span className="eyebrow">AI INSPECTION · {detection.id}</span>
              <h2>
                {detection.type === "Normal"
                  ? "Normal condition"
                  : `Possible ${detection.type.toLowerCase()}`}
              </h2>
              <p>
                AI-assisted image analysis. Human review required before
                maintenance decisions.
              </p>
              <div className="detail-facts">
                <span>
                  CONFIDENCE
                  <strong>{Math.round(detection.confidence * 100)}%</strong>
                </span>
                <span>
                  ASSET<strong>{detection.asset}</strong>
                </span>
                <span>
                  ZONE<strong>{detection.zone}</strong>
                </span>
                <span>
                  CAPTURED<strong>{time(detection.timestamp)}</strong>
                </span>
                <span>
                  GPS
                  <strong>
                    {detection.latitude.toFixed(4)},{" "}
                    {detection.longitude.toFixed(4)}
                  </strong>
                </span>
                <span>
                  STATUS
                  <strong>
                    {detection.status === "normal"
                      ? "Normal"
                      : detection.status === "false_positive"
                        ? "False positive"
                        : detection.status === "reviewed"
                          ? `Reviewed by ${detection.reviewedBy || "operator"}`
                          : "Attention required"}
                  </strong>
                </span>
              </div>
              <DetectionReviewTools
                detection={detection}
                onUpdate={(update) => saveDetectionReview(detection.id, update)}
              />
              <button
                className="primary-button"
                onClick={() => {
                  setSelectedDetection(null);
                  setPage("map");
                }}
              >
                View on map <MapPin size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedReport && (
        <ReportDialog
          mission={selectedReport}
          snapshot={snapshot}
          onClose={() => setSelectedReport(null)}
        />
      )}
    </div>
  );
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-screen">
      <div className="login-panel">
        <div className="brand-mark">
          <Shield size={21} />
        </div>
        <div className="eyebrow">FIELD INTELLIGENCE · OPERATOR ACCESS</div>
        <h1>AEROGUARD</h1>
        <p>Industrial inspection command center</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onLogin(email, password);
            } catch (loginError) {
              setError(loginError instanceof Error ? loginError.message : "Sign in failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            EMAIL / OPERATOR ID
            <input
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              placeholder="veera@aeroguard.demo"
            />
          </label>
          <label>
            PASSWORD
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter password"
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Checking..." : "Sign in"} <ArrowUpRight size={15} />
          </button>
        </form>
        <div className="login-demo">
          <span className="pulse-dot" /> ROLE-BASED OPERATOR ACCESS
        </div>
        <small>
          Login is verified by the AeroGuard service.
        </small>
      </div>
      <div className="login-coordinate">AEROGUARD / NORTH YARD · AG-01</div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
  good,
  danger,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  note: string;
  good?: boolean;
  danger?: boolean;
}) {
  return (
    <section className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <div className="metric-value">{value}</div>
      <div
        className={`metric-note ${good ? "tone-good" : danger ? "tone-danger" : ""}`}
      >
        <span className="metric-note-dot" />
        {note}
      </div>
    </section>
  );
}
function PanelHeader({
  title,
  tag,
  action,
}: {
  title: string;
  tag?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {tag && <span className="panel-tag">{tag}</span>}
      {action && <div className="panel-action">{action}</div>}
    </div>
  );
}
function PageHeading({
  title,
  description,
  action,
  badge,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {badge && <div className="eyebrow">{badge}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Telemetry({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="telemetry-item">
      <span>
        <Icon size={15} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
function MissionRow({ mission }: { mission: Mission }) {
  return (
    <tr>
      <td className="mono">{mission.id}</td>
      <td>
        <strong>{mission.asset}</strong>
        <small>{mission.zone}</small>
      </td>
      <td>{mission.type}</td>
      <td>
        <span className={`status-tag ${mission.status}`}>{mission.status}</span>
      </td>
      <td>
        <div className="table-progress">
          <span style={{ width: `${mission.progress}%` }} />
        </div>
        <small>{mission.progress}%</small>
      </td>
      <td>{mission.detections}</td>
      <td>{date(mission.startTime)}</td>
    </tr>
  );
}
function AlertRow({ alert, onToggle }: { alert: Alert; onToggle: () => void }) {
  return (
    <article className={`alert-card ${alert.severity}`}>
      <span className={`alert-severity ${alert.severity}`}>
        {alert.severity === "critical"
          ? "CRITICAL"
          : alert.severity.toUpperCase()}
      </span>
      <div className="alert-copy">
        <strong>{alert.title}</strong>
        <p>{alert.description}</p>
        <small>
          {alert.asset} · {date(alert.timestamp)} · {time(alert.timestamp)}
        </small>
      </div>
      <button className={`review-button ${alert.status}`} onClick={onToggle}>
        {alert.status === "reviewed" ? (
          <>
            <Check size={14} /> Reviewed
          </>
        ) : (
          "Mark reviewed"
        )}
      </button>
    </article>
  );
}
function SettingRow({
  title,
  subtitle,
  value,
}: {
  title: string;
  subtitle: string;
  value: string;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <span>{value}</span>
    </div>
  );
}
function MissionDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (asset: string, zone: string, type: string) => void;
}) {
  const [asset, setAsset] = useState("Pipeline-03");
  const [zone, setZone] = useState("Zone B");
  const [type, setType] = useState("Full Inspection");
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mission-dialog">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">DISPATCH PLANNER</span>
            <h2>New inspection</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        <label>
          ASSET
          <select
            value={asset}
            onChange={(event) => setAsset(event.target.value)}
          >
            {["Pipeline-03", "Tank-01", "Motor-04", "Compressor-02"].map(
              (item) => (
                <option key={item}>{item}</option>
              ),
            )}
          </select>
        </label>
        <label>
          INSPECTION ZONE
          <select
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          >
            {["Zone A", "Zone B", "Zone C", "Zone D"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          INSPECTION TYPE
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {[
              "Visual Inspection",
              "Temperature Monitoring",
              "Full Inspection",
            ].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="mission-summary">
          <small>MISSION SUMMARY</small>
          <strong>
            {asset} · {zone}
          </strong>
          <span>{type} · AUTO FLIGHT · SIMULATION</span>
        </div>
        <p className="dialog-disclaimer">
          Starting a mission updates simulated flight telemetry only.
        </p>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => onCreate(asset, zone, type)}
          >
            Start mission <Navigation size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DetectionReviewTools({
  detection,
  onUpdate,
}: {
  detection: Detection;
  onUpdate: (update: {
    status?: "reviewed" | "false_positive";
    reviewNote?: string;
  }) => Promise<void>;
}) {
  const [note, setNote] = useState(detection.reviewNote ?? "");
  return (
    <div className="review-tools">
      <label htmlFor="review-note">OPERATOR REVIEW NOTE</label>
      <textarea
        id="review-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Record a field observation..."
      />
      <div className="review-tools-actions">
        <button
          className="secondary-button"
          onClick={() => void onUpdate({ reviewNote: note })}
        >
          Save note
        </button>
        <button
          className="secondary-button"
          onClick={() => void onUpdate({ status: "reviewed" })}
        >
          Mark reviewed
        </button>
        <button
          className="secondary-button"
          onClick={() => void onUpdate({ status: "false_positive" })}
        >
          Mark false positive
        </button>
      </div>
    </div>
  );
}

function OperatorManagement({ onCreated }: { onCreated: () => void }) {
  const [operators, setOperators] = useState<OperatorIdentity[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<OperatorIdentity["role"]>("operator");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const loadOperators = () => getOperators().then(setOperators).catch(() => setError("Unable to load operator accounts."));
  useEffect(() => { void loadOperators(); }, []);
  return (
    <>
      <form className="operator-form" onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const response = await createOperator({ email, name, role, password });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          setError(body.error || "Could not create operator.");
          return;
        }
        setEmail("");
        setName("");
        setPassword("");
        await loadOperators();
        onCreated();
      }}>
        <input required type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Operator name" maxLength={80} />
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@site.com" />
        <select value={role} onChange={(event) => setRole(event.target.value as OperatorIdentity["role"])}>
          <option value="operator">Operator</option>
          <option value="maintenance">Maintenance</option>
          <option value="supervisor">Supervisor</option>
        </select>
        <input required type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Temporary password · 12+ chars" />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit">Add operator</button>
      </form>
      {operators.map((operator) => <div className="setting-row" key={operator.id}><div><strong>{operator.name}</strong><small>{operator.email}</small></div><span>{operator.role}</span></div>)}
    </>
  );
}

function ReportDialog({
  mission,
  snapshot,
  onClose,
}: {
  mission: Mission;
  snapshot: SystemSnapshot;
  onClose: () => void;
}) {
  const relatedDetections = snapshot.detections.filter(
    (detection) => detection.asset === mission.asset,
  );
  const relatedAlerts = snapshot.alerts.filter(
    (alert) => alert.asset === mission.asset,
  );
  const started = new Date(mission.startTime).getTime();
  const finished = mission.endTime
    ? new Date(mission.endTime).getTime()
    : started;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mission-dialog report-dialog">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">INSPECTION REPORT · {mission.id}</span>
            <h2>{mission.asset}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close report"
          >
            <X size={18} />
          </button>
        </div>
        <div className="detail-facts report-facts">
          <span>
            ZONE<strong>{mission.zone}</strong>
          </span>
          <span>
            MISSION TYPE<strong>{mission.type}</strong>
          </span>
          <span>
            DATE<strong>{date(mission.startTime)}</strong>
          </span>
          <span>
            DURATION
            <strong>
              {Math.max(0, Math.round((finished - started) / 60_000))} min
            </strong>
          </span>
          <span>
            DETECTIONS<strong>{mission.detections} recorded</strong>
          </span>
          <span>
            TEMPERATURE
            <strong>
              {snapshot.temperatures.at(-1)?.temperature ?? 48}°C · normal
            </strong>
          </span>
          <span>
            GPS
            <strong>
              {snapshot.drone.latitude.toFixed(4)},{" "}
              {snapshot.drone.longitude.toFixed(4)}
            </strong>
          </span>
          <span>
            STATUS<strong>{mission.status}</strong>
          </span>
        </div>
        <div className="report-detail-section">
          <h3>Possible defects</h3>
          {relatedDetections.length ? (
            relatedDetections.map((detection) => (
              <div className="report-detection" key={detection.id}>
                <span
                  className={`severity-mark ${detection.status === "normal" ? "normal" : "warning"}`}
                />
                <strong>
                  {detection.type === "Normal"
                    ? "Normal condition"
                    : `Possible ${detection.type.toLowerCase()}`}
                </strong>
                <span>
                  {Math.round(detection.confidence * 100)}% · {detection.zone}
                </span>
              </div>
            ))
          ) : (
            <p>No defects recorded for this asset.</p>
          )}
        </div>
        <div className="report-detail-section">
          <h3>Related alerts</h3>
          {relatedAlerts.length ? (
            relatedAlerts.map((alert) => (
              <div className="report-detection" key={alert.id}>
                <span className={`activity-dot ${alert.severity}`} />
                <strong>{alert.title}</strong>
                <span>
                  {time(alert.timestamp)} · {alert.status}
                </span>
              </div>
            ))
          ) : (
            <p>No related alerts.</p>
          )}
        </div>
        <p className="dialog-disclaimer">
          SIMULATION REPORT · VERIFY ALL FINDINGS WITH QUALIFIED PERSONNEL
        </p>
      </div>
    </div>
  );
}
