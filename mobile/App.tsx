import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert as NativeAlert,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import MapView, {
  Callout,
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
} from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  Alert,
  Detection,
  Mission,
  OperatorIdentity,
  OperatorRole,
  SystemSnapshot,
} from "@aeroguard/shared";
import {
  checkLiveTelemetry,
  controlMission,
  createSimulationAlert,
  fetchSnapshot,
  getAuditLog,
  registerPushToken,
  reviewAlert,
  restoreSession,
  signIn,
  signOut,
  startMission,
  updateDetection,
  updateGeofence,
} from "./services/api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Tab = "Home" | "Map" | "Mission" | "Alerts" | "More";
type MorePage = "More" | "Detections" | "Temperature" | "Reports" | "Settings" | "Audit";
const colors = {
  bg: "#101614",
  panel: "#18211d",
  panel2: "#202b25",
  line: "#2b3831",
  text: "#e8f0ea",
  muted: "#91a097",
  mint: "#5cdbb1",
  cyan: "#76c8c1",
  orange: "#e9a16b",
  red: "#e6786c",
  green: "#70d8a5",
};
const tabs: Array<{ id: Tab; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "Home", icon: "home" },
  { id: "Map", icon: "map" },
  { id: "Mission", icon: "navigate" },
  { id: "Alerts", icon: "warning" },
  { id: "More", icon: "menu" },
];
const assets = ["Pipeline-03", "Tank-01", "Motor-04", "Compressor-02"];
const types = [
  "Visual Inspection",
  "Temperature Monitoring",
  "Full Inspection",
];
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function App() {
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("Home");
  const [morePage, setMorePage] = useState<MorePage>("More");
  const [offline, setOffline] = useState(false);
  const [asset, setAsset] = useState(assets[0]);
  const [zone, setZone] = useState("Zone B");
  const [inspectionType, setInspectionType] = useState(types[2]);
  const [showMissionForm, setShowMissionForm] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(
    null,
  );
  const [selectedReport, setSelectedReport] = useState<Mission | null>(null);
  const [filter, setFilter] = useState<"all" | Alert["severity"]>("all");
  const [pushEnabled, setPushEnabled] = useState(false);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const initialAlertsLoaded = useRef(false);

  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((identity) => {
        if (active) setOperator(identity);
      })
      .finally(() => {
        if (active) setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!operator) return;
    let active = true;
    const load = async () => {
      try {
        const next = await fetchSnapshot();
        if (active) {
          setSnapshot(next);
          setOffline(false);
        }
      } catch {
        if (active) setOffline(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [operator]);

  useEffect(() => {
    if (!snapshot) return;
    if (!initialAlertsLoaded.current) {
      seenAlertIds.current = new Set(snapshot.alerts.map((alert) => alert.id));
      initialAlertsLoaded.current = true;
      return;
    }
    const newAlerts = snapshot.alerts.filter(
      (alert) => alert.status === "open" && !seenAlertIds.current.has(alert.id),
    );
    for (const alert of newAlerts) {
      if (pushEnabled)
        void Notifications.scheduleNotificationAsync({
          content: {
            title: `${alert.severity.toUpperCase()}: ${alert.title}`,
            body: `${alert.asset} · ${alert.description}`,
            data: { alertId: alert.id },
          },
          trigger: null,
        });
    }
    seenAlertIds.current = new Set(snapshot.alerts.map((alert) => alert.id));
  }, [snapshot, pushEnabled]);

  const handleLogin = async (email: string, password: string) => {
    setOperator(await signIn(email, password));
  };
  const handleLogout = async () => {
    await signOut();
    setOperator(null);
    setSnapshot(null);
  };
  const enablePush = async () => {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted)
      permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      NativeAlert.alert(
        "Notifications disabled",
        "Enable notifications in device settings to receive critical alerts.",
      );
      return;
    }
    setPushEnabled(true);
    const projectId =
      Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      NativeAlert.alert(
        "Local alerts enabled",
        "In-app notifications are active. Remote push requires an EAS project ID and APNs/FCM credentials.",
      );
      return;
    }
    try {
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      const response = await registerPushToken(token);
      if (!response.ok) throw new Error("Registration rejected");
      NativeAlert.alert(
        "Notifications enabled",
        "This device is registered for AeroGuard alert notifications.",
      );
    } catch {
      NativeAlert.alert(
        "Push setup unavailable",
        "Check EAS/APNs/FCM credentials and try again.",
      );
    }
  };

  const runControl = async (action: string) => {
    const mission = snapshot?.missions.find(
      (item) => item.status === "active" || item.status === "paused",
    );
    if (!mission) {
      NativeAlert.alert(
        "No active mission",
        "Start an inspection mission to use simulation controls.",
      );
      return;
    }
    try {
      await controlMission(mission.id, action);
    } catch {
      NativeAlert.alert(
        "API unavailable",
        "Check the simulation server connection.",
      );
    }
  };
  const createMission = async () => {
    try {
      await startMission({ asset, zone, type: inspectionType });
      setShowMissionForm(false);
      NativeAlert.alert(
        "Mission started",
        "Demo mission created. No real aircraft is being controlled.",
      );
    } catch {
      NativeAlert.alert(
        "API unavailable",
        "Could not reach the simulation server.",
      );
    }
  };
  const toggleAlert = async (alert: Alert) => {
    try {
      await reviewAlert(
        alert.id,
        alert.status === "open" ? "reviewed" : "open",
      );
    } catch {
      NativeAlert.alert("API unavailable", "Could not update the alert.");
    }
  };
  const saveDetectionReview = async (
    id: string,
    update: { status?: "reviewed" | "false_positive"; reviewNote?: string },
  ) => {
    const response = await updateDetection(id, update);
    if (!response.ok)
      NativeAlert.alert("Review unavailable", "Could not update this finding.");
  };
  const openMore = (page: MorePage) => {
    setMorePage(page);
    setTab("More");
  };

  if (!sessionReady)
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar barStyle="light-content" />
        <Brand />
        <ActivityIndicator color={colors.mint} />
        <Text style={styles.muted}>Checking operator session...</Text>
      </SafeAreaView>
    );
  if (!operator)
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar barStyle="light-content" />
        <LoginScreen onLogin={handleLogin} />
      </SafeAreaView>
    );
  const canOperate = operator.role !== "maintenance";
  if (!snapshot)
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar barStyle="light-content" />
        <Brand />
        <ActivityIndicator color={colors.mint} />
        <Text style={styles.muted}>
          {offline
            ? "API offline · start the simulation server"
            : "Connecting to shared simulation..."}
        </Text>
      </SafeAreaView>
    );
  const openAlerts = snapshot.alerts.filter((alert) => alert.status === "open");
  const mission = snapshot.missions.find(
    (item) => item.status === "active" || item.status === "paused",
  );
  const detectionDetail = selectedDetection;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.topbar}>
        <Brand />
        <Pressable style={styles.modeChip} onPress={() => setTab("Alerts")}>
          <View style={styles.liveDot} />
          <Text style={styles.modeText}>DEMO / SIM</Text>
        </Pressable>
        <Pressable style={styles.bellButton} onPress={() => setTab("Alerts")}>
          <Ionicons
            name="notifications-outline"
            size={21}
            color={colors.text}
          />
          {openAlerts.length > 0 && (
            <View style={styles.bellCount}>
              <Text style={styles.bellCountText}>{openAlerts.length}</Text>
            </View>
          )}
        </Pressable>
      </View>
      {offline && (
        <Pressable
          style={styles.offlineStrip}
          onPress={() =>
            void fetchSnapshot()
              .then(setSnapshot)
              .catch(() => undefined)
          }
        >
          <Text style={styles.offlineText}>
            SIMULATION API DISCONNECTED · TAP TO RETRY
          </Text>
        </Pressable>
      )}
      <View style={styles.content}>
        {tab === "Home" && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.homeHeading}>
              <View>
                <Text style={styles.eyebrow}>
                  FIELD OPERATIONS · NORTH YARD
                </Text>
                <Text style={styles.title}>AG-01</Text>
              </View>
              <View style={styles.onlineBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.onlineText}>ONLINE</Text>
              </View>
            </View>
            <View style={styles.statusBand}>
              <View style={styles.statusIcon}>
                <Ionicons name="airplane" size={18} color={colors.mint} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusValue}>
                  {mission ? mission.status.toUpperCase() : "STANDBY"}
                </Text>
                <Text style={styles.statusCaption}>
                  {mission
                    ? `${mission.asset} · ${mission.type}`
                    : "No active inspection"}
                </Text>
              </View>
              <Text style={styles.flightMode}>{snapshot.drone.flightMode}</Text>
            </View>
            <View style={styles.telemetryGrid}>
              <Metric
                icon="battery-half"
                label="BATTERY"
                value={`${snapshot.drone.battery}%`}
                tone="mint"
              />
              <Metric
                icon="cellular"
                label="SIGNAL"
                value={`${snapshot.drone.signal}%`}
                tone="cyan"
              />
              <Metric
                icon="location"
                label="GPS FIXED"
                value={`${snapshot.drone.satellites} sats`}
                tone="mint"
              />
              <Metric
                icon="arrow-up"
                label="ALTITUDE"
                value={`${snapshot.drone.altitude} m`}
                tone="cyan"
              />
            </View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>LIVE MAP</Text>
              <Pressable onPress={() => setTab("Map")}>
                <Text style={styles.linkText}>
                  Expand map <Ionicons name="arrow-forward" size={12} />
                </Text>
              </Pressable>
            </View>
            <MiniMap
              snapshot={snapshot}
              onDetection={(item) => setSelectedDetection(item)}
            />
            <View style={styles.mapTelemetry}>
              <Text style={styles.mapStat}>
                {snapshot.drone.speed} m/s{" "}
                <Text style={styles.mapMuted}>SPEED</Text>
              </Text>
              <Text style={styles.mapStat}>
                {snapshot.drone.altitude} m{" "}
                <Text style={styles.mapMuted}>ALT</Text>
              </Text>
              <Text style={styles.mapCoordinates}>
                {snapshot.drone.latitude.toFixed(4)}° N
              </Text>
            </View>
            {openAlerts.length > 0 && (
              <Pressable
                style={styles.alertBanner}
                onPress={() => setTab("Alerts")}
              >
                <Ionicons name="warning" size={18} color={colors.orange} />
                <Text style={styles.alertBannerText}>
                  {openAlerts.length} ACTIVE ALERT
                  {openAlerts.length === 1 ? "" : "S"}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={colors.muted}
                />
              </Pressable>
            )}
            <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>
            <View style={styles.quickActions}>
              {canOperate && <QuickAction
                icon="navigate"
                label="START MISSION"
                onPress={() => {
                  setTab("Mission");
                  setShowMissionForm(true);
                }}
              />}
              <QuickAction
                icon="map"
                label="LIVE MAP"
                onPress={() => setTab("Map")}
              />
              <QuickAction
                icon="warning"
                label="VIEW ALERTS"
                onPress={() => setTab("Alerts")}
              />
              <QuickAction
                icon="document-text"
                label="REPORTS"
                onPress={() => openMore("Reports")}
              />
            </View>
            {canOperate && <MissionControls mission={mission} onControl={runControl} />}
            <Text style={styles.disclaimer}>
              SIMULATED TELEMETRY · NOT CONNECTED TO A REAL AIRCRAFT
            </Text>
          </ScrollView>
        )}
        {tab === "Map" && (
          <View style={styles.mapScreen}>
            <View style={styles.mapScreenHeading}>
              <Text style={styles.title}>Site map</Text>
              <Text style={styles.mutedSmall}>DEMO GPS · NORTH YARD</Text>
            </View>
            <View style={styles.mapLargeWrap}>
              <MiniMap
                snapshot={snapshot}
                onDetection={(item) => setSelectedDetection(item)}
                large
              />
              <View style={styles.mapLegend}>
                <Text style={styles.legendText}>
                  <Text style={{ color: colors.mint }}>●</Text> AG-01
                </Text>
                <Text style={styles.legendText}>
                  <Text style={{ color: colors.mint }}>━</Text> FLIGHT PATH
                </Text>
                <Text style={styles.legendText}>
                  <Text style={{ color: colors.red }}>●</Text> POSSIBLE DEFECT
                </Text>
              </View>
            </View>
            <View style={styles.mapDroneCard}>
              <View style={styles.mapDroneHead}>
                <Text style={styles.sectionTitle}>AG-01 TELEMETRY</Text>
                <View style={styles.liveDot} />
              </View>
              <View style={styles.mapStatsRow}>
                <MapStat
                  label="ALTITUDE"
                  value={`${snapshot.drone.altitude} m`}
                />
                <MapStat label="SPEED" value={`${snapshot.drone.speed} m/s`} />
                <MapStat label="BATTERY" value={`${snapshot.drone.battery}%`} />
              </View>
              <Pressable
                style={styles.outlineButton}
                onPress={() => setTab("Home")}
              >
                <Ionicons name="locate" size={16} color={colors.mint} />
                <Text style={styles.outlineButtonText}>CENTER DRONE</Text>
              </Pressable>
            </View>
          </View>
        )}
        {tab === "Mission" && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.eyebrow}>MISSION PLANNER · SIMULATION</Text>
            <Text style={[styles.title, styles.screenTitle]}>
              Inspection mission
            </Text>
            {mission && !showMissionForm && (
              <View style={styles.missionActiveCard}>
                <View style={styles.missionCardTop}>
                  <View>
                    <Text style={styles.eyebrow}>
                      MISSION ACTIVE · {mission.id}
                    </Text>
                    <Text style={styles.cardTitle}>
                      {mission.asset} · {mission.zone}
                    </Text>
                  </View>
                  <Text style={styles.progressValue}>{mission.progress}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${mission.progress}%` },
                    ]}
                  />
                </View>
                <View style={styles.timeline}>
                  <TimelineItem label="Mission created" done />
                  <TimelineItem label="Takeoff" done />
                  <TimelineItem label="Navigating" done />
                  <TimelineItem label="Inspecting" current />
                  <TimelineItem label="Returning" />
                </View>
                <View style={styles.mapStatsRow}>
                  <MapStat
                    label="ALTITUDE"
                    value={`${snapshot.drone.altitude} m`}
                  />
                  <MapStat
                    label="SPEED"
                    value={`${snapshot.drone.speed} m/s`}
                  />
                  <MapStat
                    label="BATTERY"
                    value={`${snapshot.drone.battery}%`}
                  />
                </View>
                {canOperate && <MissionControls mission={mission} onControl={runControl} />}
                {canOperate && <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setShowMissionForm(true)}
                >
                  <Text style={styles.secondaryButtonText}>
                    PLAN NEW INSPECTION
                  </Text>
                </Pressable>}
              </View>
            )}
            {canOperate && (!mission || showMissionForm) && (
              <View style={styles.formPanel}>
                <StepLabel n="01" label="SELECT ASSET" />
                <ChoiceRow
                  values={assets}
                  selected={asset}
                  onSelect={setAsset}
                />
                <StepLabel n="02" label="INSPECTION ZONE" />
                <ChoiceRow
                  values={["Zone A", "Zone B", "Zone C", "Zone D"]}
                  selected={zone}
                  onSelect={setZone}
                />
                <StepLabel n="03" label="INSPECTION TYPE" />
                {types.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => setInspectionType(item)}
                    style={[
                      styles.typeOption,
                      inspectionType === item && styles.typeOptionSelected,
                    ]}
                  >
                    <View
                      style={[
                        styles.radio,
                        inspectionType === item && styles.radioSelected,
                      ]}
                    />{" "}
                    <Text style={styles.typeText}>{item}</Text>
                  </Pressable>
                ))}
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>MISSION SUMMARY</Text>
                  <Text style={styles.summaryTitle}>
                    {asset} · {zone}
                  </Text>
                  <Text style={styles.summaryMeta}>
                    {inspectionType.toUpperCase()} · THERMAL{" "}
                    {inspectionType !== "Visual Inspection" ? "ON" : "OFF"} ·
                    AUTO
                  </Text>
                </View>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void createMission()}
                >
                  <Ionicons name="navigate" size={17} color={colors.bg} />
                  <Text style={styles.primaryButtonText}>START MISSION</Text>
                </Pressable>
                <Text style={styles.disclaimer}>
                  DEMO CONTROLS ONLY · NO REAL DRONE CONNECTED
                </Text>
                {mission && (
                  <Pressable
                    style={styles.textOnlyButton}
                    onPress={() => setShowMissionForm(false)}
                  >
                    <Text style={styles.linkText}>CANCEL NEW INSPECTION</Text>
                  </Pressable>
                )}
              </View>
            )}
            {!canOperate && <Text style={styles.settingsHint}>Maintenance role is read-only for flight missions and controls.</Text>}
          </ScrollView>
        )}
        {tab === "Alerts" && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.eyebrow}>FIELD ALERT INBOX</Text>
            <Text style={[styles.title, styles.screenTitle]}>
              Alerts{" "}
              <Text style={styles.alertCountTitle}>
                {openAlerts.length} open
              </Text>
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
            >
              {(["all", "critical", "warning", "info"] as const).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setFilter(item)}
                  style={[
                    styles.filterChip,
                    filter === item && styles.filterActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      filter === item && styles.filterTextActive,
                    ]}
                  >
                    {item === "all"
                      ? "All"
                      : item[0].toUpperCase() + item.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {snapshot.alerts
              .filter((alert) => filter === "all" || alert.severity === filter)
              .map((alert) => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  onToggle={() => void toggleAlert(alert)}
                  onLocation={() => setTab("Map")}
                />
              ))}
            <Text style={styles.disclaimer}>
              AI FINDINGS ARE INDICATIVE · QUALIFIED HUMAN REVIEW REQUIRED
            </Text>
          </ScrollView>
        )}
        {tab === "More" && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {morePage === "More" ? (
              <>
                <Text style={styles.eyebrow}>AEROGUARD OPERATOR</Text>
                <Text style={[styles.title, styles.screenTitle]}>More</Text>
                <Text style={styles.operatorRole}>{operator.name} · {operator.role.toUpperCase()}</Text>
                <View style={styles.moreMenu}>
                  <MoreItem
                    icon="scan"
                    title="AI detections"
                    subtitle="Possible defects · human review"
                    onPress={() => setMorePage("Detections")}
                  />
                  <MoreItem
                    icon="thermometer"
                    title="Temperature"
                    subtitle="Thermal monitoring and trend"
                    onPress={() => setMorePage("Temperature")}
                  />
                  <MoreItem
                    icon="document-text"
                    title="Inspection reports"
                    subtitle="Mission history and findings"
                    onPress={() => setMorePage("Reports")}
                  />
                  <MoreItem
                    icon="shield-checkmark-outline"
                    title="Safety & telemetry"
                    subtitle="Geofence · adapter status"
                    onPress={() => setMorePage("Settings")}
                  />
                  {operator.role === "supervisor" && (
                    <MoreItem
                      icon="list"
                      title="Audit log"
                      subtitle="Supervisor access"
                      onPress={() => setMorePage("Audit")}
                    />
                  )}
                  <MoreItem
                    icon="notifications"
                    title="Enable push alerts"
                    subtitle="Register this device for critical alerts"
                    onPress={() => void enablePush()}
                  />
                  <MoreItem
                    icon="settings"
                    title="System settings"
                    subtitle="Connections · simulation status"
                    onPress={() =>
                      NativeAlert.alert(
                        "System settings",
                        "REST API + simulation stream\nPixhawk / ArduPilot: not connected\nRaspberry Pi / YOLO: simulated",
                      )
                    }
                  />
                  <MoreItem
                    icon="log-out-outline"
                    title="Sign out"
                    subtitle="End this operator session"
                    onPress={() => void handleLogout()}
                  />
                </View>
                <View style={styles.safetyBox}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={18}
                    color={colors.orange}
                  />
                  <Text style={styles.safetyText}>
                    AeroGuard assists qualified personnel; it does not certify
                    equipment or replace site safety procedures.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => setMorePage("More")}
                  style={styles.backLink}
                >
                  <Ionicons name="arrow-back" size={16} color={colors.mint} />
                  <Text style={styles.linkText}>MORE</Text>
                </Pressable>
                {morePage === "Detections" && (
                  <>
                    <Text style={styles.eyebrow}>YOLO · OPENCV · EDGE AI</Text>
                    <Text style={[styles.title, styles.screenTitle]}>
                      AI detections
                    </Text>
                    {snapshot.detections.map((item) => (
                      <DetectionItem
                        key={item.id}
                        detection={item}
                        onPress={() => setSelectedDetection(item)}
                      />
                    ))}
                  </>
                )}
                {morePage === "Temperature" && (
                  <TemperatureScreen snapshot={snapshot} />
                )}
                {morePage === "Reports" &&
                  (selectedReport ? (
                    <ReportDetail
                      mission={selectedReport}
                      snapshot={snapshot}
                      onBack={() => setSelectedReport(null)}
                      onDetection={setSelectedDetection}
                    />
                  ) : (
                    <ReportsScreen
                      snapshot={snapshot}
                      onSelect={setSelectedReport}
                    />
                  ))}
                {morePage === "Settings" && (
                  <SettingsScreen snapshot={snapshot} role={operator.role} />
                )}
                {morePage === "Audit" && operator.role === "supervisor" && (
                  <AuditScreen />
                )}
              </>
            )}
          </ScrollView>
        )}
      </View>
      <View style={styles.bottomNav}>
        {tabs.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              setTab(item.id);
              if (item.id === "Mission") setShowMissionForm(false);
              if (item.id === "More") setMorePage("More");
            }}
            style={styles.tabButton}
          >
            <View
              style={[styles.tabIcon, tab === item.id && styles.tabIconActive]}
            >
              <Ionicons
                name={item.icon}
                size={19}
                color={tab === item.id ? colors.mint : colors.muted}
              />
              {item.id === "Alerts" && openAlerts.length > 0 && (
                <View style={styles.tabDot} />
              )}
            </View>
            <Text
              style={[styles.tabText, tab === item.id && styles.tabTextActive]}
            >
              {item.id}
            </Text>
          </Pressable>
        ))}
      </View>
      {detectionDetail && (
        <DetectionModal
          detection={detectionDetail}
          onUpdate={(update) => saveDetectionReview(detectionDetail.id, update)}
          onClose={() => setSelectedDetection(null)}
          onMap={() => {
            setSelectedDetection(null);
            setTab("Map");
          }}
        />
      )}
    </SafeAreaView>
  );
}

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandIcon}>
        <Ionicons name="shield-checkmark" size={19} color={colors.mint} />
      </View>
      <View>
        <Text style={styles.brandName}>AEROGUARD</Text>
        <Text style={styles.brandSub}>FIELD INTELLIGENCE</Text>
      </View>
    </View>
  );
}
function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [operatorId, setOperatorId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.loginPanel}>
      <Brand />
      <Text style={styles.eyebrow}>FIELD OPERATOR ACCESS</Text>
      <Text style={styles.loginTitle}>AeroGuard</Text>
      <Text style={styles.loginSubtitle}>
        Industrial inspection, in the field.
      </Text>
      <Text style={styles.loginLabel}>EMAIL / OPERATOR ID</Text>
      <TextInput
        value={operatorId}
        onChangeText={setOperatorId}
        autoCapitalize="none"
        autoComplete="username"
        placeholder="operator@site.com"
        placeholderTextColor="#6f7d74"
        style={styles.loginInput}
      />
      <Text style={styles.loginLabel}>PASSWORD</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        placeholder="Enter password"
        placeholderTextColor="#6f7d74"
        style={styles.loginInput}
      />
      <Pressable
        disabled={!operatorId.trim() || !password}
        style={[
          styles.primaryButton,
          (!operatorId.trim() || !password) && styles.disabled,
        ]}
        onPress={() => {
          setBusy(true);
          setError("");
          void onLogin(operatorId, password)
            .catch((loginError: unknown) =>
              setError(loginError instanceof Error ? loginError.message : "Sign in failed"),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Text style={styles.primaryButtonText}>{busy ? "CHECKING..." : "SIGN IN"}</Text>
      </Pressable>
      {error ? <Text style={styles.loginError}>{error}</Text> : null}
      <Text style={styles.loginDemo}>ROLE-BASED OPERATOR ACCESS</Text>
      <Text style={styles.loginFootnote}>
        Sign-in is verified by the AeroGuard service.
      </Text>
    </View>
  );
}
function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: "mint" | "cyan";
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        <Ionicons
          name={icon}
          size={17}
          color={tone === "mint" ? colors.mint : colors.cyan}
        />
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}
function MiniMap({
  snapshot,
  onDetection,
  large = false,
}: {
  snapshot: SystemSnapshot;
  onDetection: (detection: Detection) => void;
  large?: boolean;
}) {
  const drone = snapshot.drone;
  return (
    <View style={[styles.mapContainer, large && styles.mapContainerLarge]}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: drone.latitude,
          longitude: drone.longitude,
          latitudeDelta: large ? 0.004 : 0.0028,
          longitudeDelta: large ? 0.004 : 0.0028,
        }}
        region={{
          latitude: drone.latitude,
          longitude: drone.longitude,
          latitudeDelta: large ? 0.004 : 0.0028,
          longitudeDelta: large ? 0.004 : 0.0028,
        }}
        showsCompass={false}
        showsUserLocation={false}
        toolbarEnabled={false}
      >
        {snapshot.geofence.enabled && (
          <Circle
            center={{
              latitude: snapshot.geofence.centerLatitude,
              longitude: snapshot.geofence.centerLongitude,
            }}
            radius={snapshot.geofence.radiusMeters}
            strokeColor="#6cc39f"
            strokeWidth={1.5}
            fillColor="#6cc39f16"
            lineDashPattern={[5, 7]}
          />
        )}
        <Polyline
          coordinates={snapshot.flightPath.map(([latitude, longitude]) => ({
            latitude,
            longitude,
          }))}
          strokeColor={colors.mint}
          strokeWidth={3}
          lineDashPattern={[7, 6]}
        />
        <Marker
          coordinate={{ latitude: drone.latitude, longitude: drone.longitude }}
          title="AG-01"
          description={`${drone.altitude} m · SIMULATION`}
        >
          <View style={styles.droneMarker}>
            <Ionicons name="airplane" size={17} color={colors.bg} />
          </View>
          <Callout>
            <Text>AG-01 · SIMULATION</Text>
          </Callout>
        </Marker>
        {snapshot.detections
          .filter((item) => item.status !== "normal")
          .map((item) => (
            <Marker
              key={item.id}
              coordinate={{
                latitude: item.latitude,
                longitude: item.longitude,
              }}
              onPress={() => onDetection(item)}
              title={`Possible ${item.type}`}
              description={`${item.asset} · ${Math.round(item.confidence * 100)}%`}
            >
              <View style={styles.defectMarker} />
            </Marker>
          ))}
      </MapView>
      <View style={styles.mapSimBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.mapSimText}>SIMULATED GPS</Text>
      </View>
    </View>
  );
}
function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quickAction} onPress={onPress}>
      <Ionicons name={icon} size={20} color={colors.mint} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}
function MissionControls({
  mission,
  onControl,
}: {
  mission?: SystemSnapshot["missions"][number];
  onControl: (action: string) => void;
}) {
  return (
    <View style={styles.controls}>
      <View style={styles.controlsHeader}>
        <Text style={styles.sectionTitle}>DRONE CONTROL</Text>
        <Text style={styles.demoLabel}>SIM ONLY</Text>
      </View>
      <View style={styles.controlButtons}>
        <Pressable
          disabled={!mission}
          onPress={() =>
            mission &&
            onControl(mission.status === "paused" ? "resume" : "pause")
          }
          style={[styles.controlButton, !mission && styles.disabled]}
        >
          <Ionicons
            name={mission?.status === "paused" ? "play" : "pause"}
            size={16}
            color={colors.text}
          />
          <Text style={styles.controlText}>
            {mission?.status === "paused" ? "RESUME" : "PAUSE"}
          </Text>
        </Pressable>
        <Pressable
          disabled={!mission}
          onPress={() => onControl("return")}
          style={[
            styles.controlButton,
            styles.returnControl,
            !mission && styles.disabled,
          ]}
        >
          <Ionicons name="home" size={16} color={colors.orange} />
          <Text style={[styles.controlText, { color: colors.orange }]}>
            RETURN TO HOME
          </Text>
        </Pressable>
        <Pressable
          disabled={!mission}
          onPress={() => onControl("land")}
          style={[
            styles.controlButton,
            styles.landControl,
            !mission && styles.disabled,
          ]}
        >
          <Ionicons name="arrow-down" size={16} color={colors.red} />
          <Text style={[styles.controlText, { color: colors.red }]}>LAND</Text>
        </Pressable>
      </View>
      <Text style={styles.simOnlyText}>
        SIMULATION CONTROLS · NO FLIGHT API CONNECTED
      </Text>
    </View>
  );
}
function StepLabel({ n, label }: { n: string; label: string }) {
  return (
    <View style={styles.stepLabel}>
      <Text style={styles.stepNumber}>{n}</Text>
      <Text style={styles.stepText}>{label}</Text>
    </View>
  );
}
function ChoiceRow({
  values,
  selected,
  onSelect,
}: {
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.choiceScroll}
    >
      {values.map((value) => (
        <Pressable
          key={value}
          onPress={() => onSelect(value)}
          style={[
            styles.choiceChip,
            selected === value && styles.choiceSelected,
          ]}
        >
          <Text
            style={[
              styles.choiceText,
              selected === value && styles.choiceTextSelected,
            ]}
          >
            {value}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
function TimelineItem({
  label,
  done,
  current,
}: {
  label: string;
  done?: boolean;
  current?: boolean;
}) {
  return (
    <View style={styles.timelineItem}>
      <View
        style={[
          styles.timelineDot,
          done && styles.timelineDone,
          current && styles.timelineCurrent,
        ]}
      >
        {done && <Ionicons name="checkmark" size={10} color={colors.bg} />}
      </View>
      <Text
        style={[styles.timelineText, current && styles.timelineTextCurrent]}
      >
        {label}
      </Text>
    </View>
  );
}
function AlertItem({
  alert,
  onToggle,
  onLocation,
}: {
  alert: Alert;
  onToggle: () => void;
  onLocation: () => void;
}) {
  const tone =
    alert.severity === "critical"
      ? colors.red
      : alert.severity === "warning"
        ? colors.orange
        : colors.cyan;
  return (
    <View style={[styles.alertItem, { borderLeftColor: tone }]}>
      <View style={styles.alertItemTop}>
        <Text style={[styles.severityLabel, { color: tone }]}>
          {alert.severity.toUpperCase()}
        </Text>
        <Text style={styles.alertTime}>{time(alert.timestamp)}</Text>
      </View>
      <Text style={styles.alertTitle}>{alert.title}</Text>
      <Text style={styles.alertDescription}>{alert.description}</Text>
      <View style={styles.alertItemFooter}>
        <Text style={styles.alertAsset}>{alert.asset}</Text>
        <View style={styles.alertActions}>
          <Pressable onPress={onLocation} style={styles.smallAction}>
            <Ionicons name="location-outline" size={13} color={colors.cyan} />
            <Text style={styles.smallActionText}>MAP</Text>
          </Pressable>
          <Pressable onPress={onToggle} style={styles.smallAction}>
            {alert.status === "reviewed" && (
              <Ionicons name="checkmark" size={13} color={colors.green} />
            )}
            <Text
              style={[
                styles.smallActionText,
                alert.status === "reviewed" && { color: colors.green },
              ]}
            >
              {alert.status === "reviewed" ? "REVIEWED" : "REVIEW"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
function MoreItem({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.moreItem} onPress={onPress}>
      <View style={styles.moreIcon}>
        <Ionicons name={icon} size={19} color={colors.mint} />
      </View>
      <View style={styles.moreText}>
        <Text style={styles.moreTitle}>{title}</Text>
        <Text style={styles.moreSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.muted} />
    </Pressable>
  );
}
function DetectionItem({
  detection,
  onPress,
}: {
  detection: Detection;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.detectionItem} onPress={onPress}>
      <View
        style={[
          styles.detectionDot,
          detection.status === "normal" && { backgroundColor: colors.green },
        ]}
      />
      <View style={styles.detectionText}>
        <Text style={styles.detectionTitle}>
          {detection.status === "normal"
            ? "NORMAL"
            : detection.type.toUpperCase()}
        </Text>
        <Text style={styles.detectionSub}>
          {detection.asset} · {detection.zone}
        </Text>
        <Text style={styles.detectionTime}>
          {time(detection.timestamp)} · {Math.round(detection.confidence * 100)}
          % confidence
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}
function TemperatureScreen({ snapshot }: { snapshot: SystemSnapshot }) {
  const current = snapshot.temperatures.at(-1)?.temperature ?? 48;
  return (
    <>
      <Text style={styles.eyebrow}>THERMAL SENSOR · EDGE STREAM</Text>
      <Text style={[styles.title, styles.screenTitle]}>Temperature</Text>
      <View style={styles.tempHero}>
        <View>
          <Text style={styles.tempNumber}>{current}°</Text>
          <Text style={styles.tempUnit}>CELSIUS · PIPELINE-03</Text>
        </View>
        <View style={styles.tempNormal}>
          <View style={styles.liveDot} />
          <Text style={styles.tempNormalText}>NORMAL</Text>
        </View>
      </View>
      <View style={styles.tempStats}>
        <MapStat label="THRESHOLD" value="60°C" />
        <MapStat label="MAX TODAY" value="54°C" />
        <MapStat label="AVERAGE" value="46°C" />
      </View>
      <View style={styles.tempChart}>
        <Text style={styles.sectionTitle}>LAST HOUR · SIMULATED</Text>
        <View style={styles.bars}>
          {snapshot.temperatures.slice(-12).map((reading, index) => (
            <View
              key={`${reading.timestamp}-${index}`}
              style={styles.barColumn}
            >
              <View
                style={[
                  styles.bar,
                  {
                    height: `${Math.max(25, ((reading.temperature - 35) / 30) * 100)}%`,
                  },
                ]}
              />
              <Text style={styles.barLabel}>
                {index % 3 === 0 ? time(reading.timestamp) : ""}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.thresholdLine}>
          <View />
          <Text>60°C THRESHOLD</Text>
        </View>
      </View>
      <Text style={styles.disclaimer}>
        THERMAL DATA IS SIMULATED · VERIFY WITH CALIBRATED INSTRUMENTS
      </Text>
    </>
  );
}
function ReportsScreen({
  snapshot,
  onSelect,
}: {
  snapshot: SystemSnapshot;
  onSelect: (mission: Mission) => void;
}) {
  return (
    <>
      <Text style={styles.eyebrow}>MISSION HISTORY</Text>
      <Text style={[styles.title, styles.screenTitle]}>Reports</Text>
      {snapshot.missions
        .filter((item) => item.status !== "active")
        .map((mission) => (
          <Pressable
            key={mission.id}
            onPress={() => onSelect(mission)}
            style={styles.reportItem}
          >
            <View style={styles.reportIcon}>
              <Ionicons
                name="document-text-outline"
                size={19}
                color={colors.mint}
              />
            </View>
            <View style={styles.reportText}>
              <Text style={styles.reportAsset}>{mission.asset}</Text>
              <Text style={styles.reportSub}>
                {mission.zone} · {mission.type}
              </Text>
              <Text style={styles.reportSub}>
                {new Date(mission.startTime).toLocaleDateString()} ·{" "}
                {mission.detections} detections
              </Text>
              <Text style={styles.reportTemp}>
                Temperature normal · Human review required
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
        ))}
    </>
  );
}
function ReportDetail({
  mission,
  snapshot,
  onBack,
  onDetection,
}: {
  mission: Mission;
  snapshot: SystemSnapshot;
  onBack: () => void;
  onDetection: (detection: Detection) => void;
}) {
  const detections = snapshot.detections.filter(
    (detection) => detection.asset === mission.asset,
  );
  const relatedAlerts = snapshot.alerts.filter(
    (alert) => alert.asset === mission.asset,
  );
  const start = new Date(mission.startTime).getTime();
  const end = mission.endTime ? new Date(mission.endTime).getTime() : start;
  const duration = Math.max(0, Math.round((end - start) / 60_000));
  return (
    <>
      <Pressable onPress={onBack} style={styles.backLink}>
        <Ionicons name="arrow-back" size={16} color={colors.mint} />
        <Text style={styles.linkText}>REPORTS</Text>
      </Pressable>
      <Text style={styles.eyebrow}>INSPECTION REPORT · {mission.id}</Text>
      <Text style={[styles.title, styles.screenTitle]}>{mission.asset}</Text>
      <View style={styles.reportDetailCard}>
        <MapStat
          label="ASSET / ZONE"
          value={`${mission.asset} · ${mission.zone}`}
        />
        <MapStat label="MISSION TYPE" value={mission.type} />
        <MapStat
          label="DATE"
          value={new Date(mission.startTime).toLocaleDateString()}
        />
        <MapStat label="DURATION" value={`${duration} min`} />
        <MapStat
          label="AI FINDINGS"
          value={`${mission.detections} detections`}
        />
        <MapStat label="TEMPERATURE" value="Normal · under 60°C" />
        <MapStat
          label="GPS"
          value={`${snapshot.drone.latitude.toFixed(4)}, ${snapshot.drone.longitude.toFixed(4)}`}
        />
        <MapStat label="MISSION STATUS" value={mission.status.toUpperCase()} />
      </View>
      <Text style={[styles.sectionTitle, styles.reportSectionTitle]}>
        POSSIBLE DEFECTS · HUMAN REVIEW
      </Text>
      {detections.length ? (
        detections.map((detection) => (
          <DetectionItem
            key={detection.id}
            detection={detection}
            onPress={() => onDetection(detection)}
          />
        ))
      ) : (
        <Text style={styles.muted}>No detections recorded for this asset.</Text>
      )}
      {detections.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.reportImages}
        >
          {detections.map((detection) => (
            <Pressable
              key={detection.id}
              onPress={() => onDetection(detection)}
            >
              <Image
                source={{ uri: detection.image }}
                style={styles.reportImage}
              />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text style={[styles.sectionTitle, styles.reportSectionTitle]}>
        RELATED ALERTS
      </Text>
      {relatedAlerts.length ? (
        relatedAlerts.map((alert) => (
          <View key={alert.id} style={styles.reportAlert}>
            <Text style={styles.reportAsset}>{alert.title}</Text>
            <Text style={styles.reportSub}>
              {alert.severity.toUpperCase()} · {time(alert.timestamp)} ·{" "}
              {alert.status}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>No alerts recorded for this asset.</Text>
      )}
      <Text style={styles.disclaimer}>
        SIMULATION REPORT · REVIEW REQUIRED BEFORE MAINTENANCE DECISIONS
      </Text>
    </>
  );
}
function SettingsScreen({
  snapshot,
  role,
}: {
  snapshot: SystemSnapshot;
  role: OperatorRole;
}) {
  const [radius, setRadius] = useState(snapshot.geofence.radiusMeters);
  const canEdit = role === "supervisor";
  const saveFence = async () => {
    const response = await updateGeofence({ ...snapshot.geofence, radiusMeters: radius });
    NativeAlert.alert(
      response.ok ? "Geofence saved" : "Update blocked",
      response.ok ? "The new site boundary is now enforced during mission preflight." : "Supervisor permission is required and the safety limits must be met.",
    );
  };
  const checkLive = async () => {
    const response = await checkLiveTelemetry();
    const result = (await response.json()) as { error?: string };
    NativeAlert.alert("LIVE mode locked", result.error || "No real telemetry adapter is connected.");
  };
  const sendTestAlert = async () => {
    const response = await createSimulationAlert({
      title: "Push notification test",
      description: "Supervisor test alert from the mobile app.",
      asset: "Pipeline-03",
      severity: "info",
    });
    NativeAlert.alert(response.ok ? "Test alert sent" : "Test alert failed", response.ok ? "Registered Expo devices will receive the test notification." : "Supervisor access is required.");
  };
  return (
    <>
      <Text style={styles.eyebrow}>SAFETY CONFIGURATION</Text>
      <Text style={[styles.title, styles.screenTitle]}>System settings</Text>
      <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>TELEMETRY SOURCE</Text>
        <Text style={styles.settingsValue}>{snapshot.mode} · {snapshot.telemetryAdapter.toUpperCase()}</Text>
        <Text style={styles.settingsHint}>Pixhawk / ArduPilot adapter is not configured. Simulated values are never real telemetry.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void checkLive()}>
          <Text style={styles.secondaryButtonText}>CHECK MAVLINK READINESS</Text>
        </Pressable>
      </View>
      <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>ACTIVE GEOFENCE</Text>
        <Text style={styles.settingsHint}>Mission zones outside this circle are blocked before dispatch.</Text>
        <View style={styles.radiusRow}>
          <Text style={styles.mapStatLabel}>RADIUS</Text>
          <View style={styles.radiusStepper}>
            <Pressable disabled={!canEdit || radius <= 50} style={styles.stepButton} onPress={() => setRadius((value) => Math.max(50, value - 25))}><Ionicons name="remove" size={17} color={canEdit ? colors.mint : colors.muted} /></Pressable>
            <Text style={styles.radiusValue}>{radius} m</Text>
            <Pressable disabled={!canEdit || radius >= 1000} style={styles.stepButton} onPress={() => setRadius((value) => Math.min(1000, value + 25))}><Ionicons name="add" size={17} color={canEdit ? colors.mint : colors.muted} /></Pressable>
          </View>
        </View>
        <Text style={styles.settingsHint}>Maximum altitude: {snapshot.geofence.maxAltitudeMeters} m · center {snapshot.geofence.centerLatitude.toFixed(4)}, {snapshot.geofence.centerLongitude.toFixed(4)}</Text>
        <Pressable disabled={!canEdit} style={[styles.primaryButton, !canEdit && styles.disabled]} onPress={() => void saveFence()}>
          <Text style={styles.primaryButtonText}>{canEdit ? "SAVE GEOFENCE" : "SUPERVISOR ACCESS REQUIRED"}</Text>
        </Pressable>
      </View>
      {canEdit && <Pressable style={styles.secondaryButton} onPress={() => void sendTestAlert()}><Text style={styles.secondaryButtonText}>SEND PUSH TEST ALERT</Text></Pressable>}
      <Text style={styles.disclaimer}>SIMULATION SAFETY CHECKS ONLY · NOT A FLIGHT CERTIFICATION</Text>
    </>
  );
}

function AuditScreen() {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof getAuditLog>>>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    void getAuditLog().then(setEntries).catch(() => setError(true));
  }, []);
  return (
    <>
      <Text style={styles.eyebrow}>SUPERVISOR · AUDITED ACTIONS</Text>
      <Text style={[styles.title, styles.screenTitle]}>Audit log</Text>
      {error && <Text style={styles.settingsHint}>Could not load audit activity.</Text>}
      {entries.map((entry) => (
        <View key={entry.id} style={styles.auditItem}>
          <View style={styles.auditHead}><Text style={styles.auditAction}>{entry.action}</Text><Text style={styles.auditTime}>{time(entry.createdAt)}</Text></View>
          <Text style={styles.auditDetail}>{entry.actorEmail} · {entry.targetId}</Text>
        </View>
      ))}
      {!entries.length && !error && <Text style={styles.settingsHint}>No audited actions yet.</Text>}
    </>
  );
}

function MapStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mapStatCell}>
      <Text style={styles.mapStatLabel}>{label}</Text>
      <Text style={styles.mapStatValue}>{value}</Text>
    </View>
  );
}
function DetectionModal({
  detection,
  onUpdate,
  onClose,
  onMap,
}: {
  detection: Detection;
  onUpdate: (update: {
    status?: "reviewed" | "false_positive";
    reviewNote?: string;
  }) => Promise<void>;
  onClose: () => void;
  onMap: () => void;
}) {
  const [note, setNote] = useState(detection.reviewNote ?? "");
  return (
    <View style={styles.modalBack}>
      <View style={styles.detailSheet}>
        <View style={styles.sheetHandle} />
        <Pressable onPress={onClose} style={styles.sheetClose}>
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.eyebrow}>AI INSPECTION · {detection.id}</Text>
        <Image
          source={{ uri: detection.image }}
          style={{ width: "100%", height: 145, borderRadius: 4, marginTop: 5 }}
        />
        <Text style={styles.detailTitle}>
          {detection.status === "normal"
            ? "Normal condition"
            : `Possible ${detection.type.toLowerCase()}`}
        </Text>
        <Text style={styles.detailDisclaimer}>
          AI-assisted finding · Human review required
        </Text>
        <View style={styles.detailGrid}>
          <MapStat
            label="CONFIDENCE"
            value={`${Math.round(detection.confidence * 100)}%`}
          />
          <MapStat label="ASSET" value={detection.asset} />
          <MapStat label="ZONE" value={detection.zone} />
          <MapStat label="CAPTURED" value={time(detection.timestamp)} />
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a field review note"
          placeholderTextColor="#718077"
          multiline
          style={styles.reviewInput}
        />
        <Pressable style={styles.primaryButton} onPress={onMap}>
          <Ionicons name="map" size={16} color={colors.bg} />
          <Text style={styles.primaryButtonText}>VIEW ON MAP</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => void onUpdate({ reviewNote: note })}
        >
          <Text style={styles.secondaryButtonText}>SAVE REVIEW NOTE</Text>
        </Pressable>
        <Pressable
          style={styles.textOnlyButton}
          onPress={() => {
            void onUpdate({ status: "reviewed" });
            onClose();
          }}
        >
          <Text style={styles.linkText}>MARK AS REVIEWED</Text>
        </Pressable>
        <Pressable
          style={styles.textOnlyButton}
          onPress={() => {
            void onUpdate({ status: "false_positive" });
            onClose();
          }}
        >
          <Text style={[styles.linkText, { color: colors.orange }]}>MARK FALSE POSITIVE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 17,
  },
  loginPanel: {
    width: "100%",
    maxWidth: 390,
    padding: 20,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
  },
  loginTitle: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "800",
    marginTop: 16,
  },
  loginSubtitle: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 5,
    marginBottom: 20,
  },
  loginLabel: {
    color: "#a8b4ab",
    fontSize: 8,
    letterSpacing: 0.6,
    fontFamily: "monospace",
    marginTop: 10,
    marginBottom: 6,
  },
  loginInput: {
    height: 42,
    paddingHorizontal: 10,
    backgroundColor: colors.bg,
    color: colors.text,
    borderWidth: 1,
    borderColor: "#39463e",
    borderRadius: 3,
    fontSize: 11,
  },
  loginDemo: {
    color: colors.orange,
    fontFamily: "monospace",
    fontSize: 7,
    marginTop: 16,
    textAlign: "center",
  },
  loginFootnote: {
    color: colors.muted,
    fontSize: 8,
    marginTop: 8,
    textAlign: "center",
  },
  loginError: { color: colors.red, fontSize: 9, textAlign: "center", marginTop: 8 },
  operatorRole: { color: colors.muted, fontSize: 9, marginTop: -12, marginBottom: 12, fontFamily: "monospace" },
  muted: { color: colors.muted, fontSize: 12 },
  mutedSmall: { color: colors.muted, fontSize: 9, fontFamily: "monospace" },
  topbar: {
    height: 57,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  brandIcon: {
    height: 33,
    width: 33,
    borderRadius: 7,
    backgroundColor: "#1c3a31",
    borderWidth: 1,
    borderColor: "#315b4d",
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  brandSub: { color: "#87938c", fontSize: 7, letterSpacing: 1, marginTop: 2 },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#674932",
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 6,
    marginRight: 7,
  },
  modeText: { color: "#e9ad7e", fontSize: 8, fontFamily: "monospace" },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 4,
    backgroundColor: colors.green,
  },
  bellButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  bellCount: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: colors.red,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  bellCountText: { color: "white", fontSize: 8, fontWeight: "700" },
  offlineStrip: {
    padding: 7,
    backgroundColor: "#3a2721",
    alignItems: "center",
  },
  offlineText: { fontSize: 8, color: "#f1aa92", fontFamily: "monospace" },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 15, paddingTop: 18, paddingBottom: 25 },
  homeHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  eyebrow: {
    color: "#80c8ae",
    fontSize: 8,
    letterSpacing: 1,
    fontFamily: "monospace",
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 25,
    letterSpacing: 0,
  },
  screenTitle: { marginBottom: 17 },
  onlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1e362b",
    borderWidth: 1,
    borderColor: "#345644",
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  onlineText: { color: colors.green, fontFamily: "monospace", fontSize: 8 },
  statusBand: {
    height: 66,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.panel,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 11,
    marginBottom: 9,
  },
  statusIcon: {
    width: 37,
    height: 37,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#20372e",
    marginRight: 10,
  },
  statusText: { flex: 1 },
  statusValue: {
    color: colors.green,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
  },
  statusCaption: { color: colors.muted, fontSize: 9, marginTop: 4 },
  flightMode: {
    fontSize: 8,
    fontFamily: "monospace",
    color: colors.cyan,
    backgroundColor: "#233638",
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 2,
  },
  telemetryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 17,
  },
  metric: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    height: 76,
    padding: 10,
    justifyContent: "space-between",
  },
  metricTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricLabel: { color: colors.muted, fontSize: 8, fontFamily: "monospace" },
  metricValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    color: "#aab6ae",
    fontSize: 9,
    letterSpacing: 0.8,
    fontFamily: "monospace",
    fontWeight: "600",
  },
  linkText: { color: colors.cyan, fontSize: 9 },
  mapContainer: {
    height: 190,
    overflow: "hidden",
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
  },
  mapContainerLarge: { height: "100%", borderRadius: 0, borderWidth: 0 },
  mapSimBadge: {
    position: "absolute",
    left: 8,
    top: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#101614dd",
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 3,
  },
  mapSimText: { color: "#d8e2db", fontSize: 7, fontFamily: "monospace" },
  droneMarker: {
    width: 30,
    height: 30,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.mint,
    backgroundColor: colors.mint,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "35deg" }],
    elevation: 4,
  },
  defectMarker: {
    width: 14,
    height: 14,
    borderRadius: 8,
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: "white",
    elevation: 3,
  },
  mapTelemetry: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    gap: 13,
  },
  mapStat: { color: colors.text, fontSize: 10, fontFamily: "monospace" },
  mapMuted: { color: colors.muted, fontSize: 7 },
  mapCoordinates: {
    marginLeft: "auto",
    color: colors.muted,
    fontSize: 8,
    fontFamily: "monospace",
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderColor: "#624a31",
    backgroundColor: "#2b261e",
    padding: 11,
    borderRadius: 4,
    marginBottom: 18,
  },
  alertBannerText: {
    flex: 1,
    color: "#efc18b",
    fontFamily: "monospace",
    fontSize: 9,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 9,
    marginBottom: 16,
  },
  quickAction: {
    width: "48%",
    flexGrow: 1,
    minHeight: 58,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  quickLabel: { color: "#d8e3da", fontSize: 8, fontWeight: "700" },
  controls: {
    backgroundColor: colors.panel,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 12,
  },
  controlsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  demoLabel: { color: colors.orange, fontSize: 7, fontFamily: "monospace" },
  controlButtons: { flexDirection: "row", gap: 7 },
  controlButton: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: "#39463e",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: colors.panel2,
  },
  returnControl: { borderColor: "#654832", backgroundColor: "#2b261f" },
  landControl: { borderColor: "#67403a", backgroundColor: "#2d211f" },
  disabled: { opacity: 0.45 },
  controlText: {
    color: colors.text,
    fontSize: 7,
    fontFamily: "monospace",
    fontWeight: "700",
  },
  simOnlyText: {
    color: "#a98b70",
    fontSize: 7,
    textAlign: "center",
    marginTop: 9,
    fontFamily: "monospace",
  },
  disclaimer: {
    color: "#79877f",
    fontSize: 7,
    fontFamily: "monospace",
    textAlign: "center",
    marginTop: 12,
    lineHeight: 13,
  },
  bottomNav: {
    height: 61,
    backgroundColor: "#141c18",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  tabButton: {
    width: "20%",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabIcon: {
    width: 34,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    borderRadius: 5,
  },
  tabIconActive: { backgroundColor: "#20372e" },
  tabDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 4,
    backgroundColor: colors.red,
    top: 1,
    right: 4,
  },
  tabText: { color: colors.muted, fontSize: 8 },
  tabTextActive: { color: colors.mint },
  mapScreen: { flex: 1 },
  mapScreenHeading: {
    position: "absolute",
    top: 12,
    left: 14,
    zIndex: 2,
    backgroundColor: "#101614dd",
    padding: 9,
    borderRadius: 4,
  },
  mapLegend: {
    position: "absolute",
    bottom: 9,
    left: 8,
    right: 8,
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#101614df",
    padding: 9,
    borderRadius: 4,
    justifyContent: "space-around",
  },
  legendText: { color: "#cbd5ce", fontSize: 7, fontFamily: "monospace" },
  legendMint: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.mint,
  },
  legendRoute: { width: 11, height: 2, backgroundColor: colors.mint },
  legendRed: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.red,
  },
  mapLargeWrap: { flex: 1 },
  mapDroneCard: {
    padding: 13,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  mapDroneHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  mapStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
  },
  mapStatCell: { flex: 1 },
  mapStatLabel: {
    color: colors.muted,
    fontSize: 7,
    letterSpacing: 0.5,
    fontFamily: "monospace",
  },
  mapStatValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 5,
  },
  outlineButton: {
    height: 39,
    borderWidth: 1,
    borderColor: "#386350",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  outlineButtonText: {
    color: colors.mint,
    fontSize: 9,
    fontFamily: "monospace",
    fontWeight: "700",
  },
  formPanel: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    padding: 13,
  },
  stepLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 7,
    marginBottom: 8,
  },
  stepNumber: { color: colors.mint, fontSize: 8, fontFamily: "monospace" },
  stepText: {
    color: "#a5b2a9",
    fontSize: 8,
    fontFamily: "monospace",
    letterSpacing: 0.7,
  },
  choiceScroll: { marginBottom: 9, flexGrow: 0 },
  choiceChip: {
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "#39463e",
    borderRadius: 4,
    marginRight: 6,
    backgroundColor: "#141c18",
  },
  choiceSelected: { borderColor: colors.mint, backgroundColor: "#20372e" },
  choiceText: { color: "#acb7ae", fontSize: 9 },
  choiceTextSelected: { color: "#a2e8cf" },
  typeOption: {
    minHeight: 37,
    borderWidth: 1,
    borderColor: "#323e37",
    borderRadius: 4,
    marginBottom: 5,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  typeOptionSelected: { borderColor: "#41846b", backgroundColor: "#1d3028" },
  radio: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#718178",
  },
  radioSelected: {
    borderColor: colors.mint,
    backgroundColor: colors.mint,
    shadowColor: colors.mint,
    shadowRadius: 3,
  },
  typeText: { color: "#dce6de", fontSize: 9 },
  summaryBox: {
    padding: 11,
    marginTop: 8,
    backgroundColor: "#111815",
    borderWidth: 1,
    borderColor: "#34433a",
    borderRadius: 4,
    gap: 5,
  },
  summaryLabel: { color: "#88c5a6", fontSize: 7, fontFamily: "monospace" },
  summaryTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  summaryMeta: { color: "#9aa79e", fontSize: 7, fontFamily: "monospace" },
  primaryButton: {
    minHeight: 44,
    borderRadius: 4,
    backgroundColor: colors.mint,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  primaryButtonText: {
    color: colors.bg,
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  missionActiveCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    padding: 13,
  },
  missionCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  progressValue: { color: colors.mint, fontSize: 15, fontFamily: "monospace" },
  progressTrack: { height: 5, backgroundColor: "#303b34", borderRadius: 3 },
  progressFill: { height: 5, backgroundColor: colors.mint, borderRadius: 3 },
  timeline: { marginTop: 13, marginBottom: 5 },
  timelineItem: {
    minHeight: 29,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  timelineDot: {
    width: 13,
    height: 13,
    borderWidth: 1,
    borderColor: "#65736a",
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineDone: { backgroundColor: colors.mint, borderColor: colors.mint },
  timelineCurrent: { borderColor: colors.orange, backgroundColor: "#4a3220" },
  timelineText: { color: colors.muted, fontSize: 9 },
  timelineTextCurrent: { color: colors.orange, fontWeight: "700" },
  filterScroll: { flexGrow: 0, marginBottom: 12 },
  filterChip: {
    borderWidth: 1,
    borderColor: "#344139",
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginRight: 6,
  },
  filterActive: { borderColor: "#54816d", backgroundColor: "#1d342b" },
  filterText: { color: "#9ba79e", fontSize: 9 },
  filterTextActive: { color: "#a0e2ca" },
  alertCountTitle: {
    color: colors.orange,
    fontSize: 10,
    fontFamily: "monospace",
    fontWeight: "500",
  },
  alertItem: {
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderRadius: 4,
    backgroundColor: colors.panel,
    padding: 11,
    marginBottom: 8,
  },
  alertItemTop: { flexDirection: "row", justifyContent: "space-between" },
  severityLabel: { fontSize: 8, fontFamily: "monospace", fontWeight: "700" },
  alertTime: { color: colors.muted, fontSize: 8, fontFamily: "monospace" },
  alertTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 7,
  },
  alertDescription: {
    color: "#a4b0a7",
    fontSize: 9,
    lineHeight: 15,
    marginTop: 4,
  },
  alertItemFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  alertAsset: { color: "#b7c3ba", fontSize: 8, fontFamily: "monospace" },
  alertActions: { flexDirection: "row", gap: 12 },
  smallAction: { flexDirection: "row", alignItems: "center", gap: 3 },
  smallActionText: { color: colors.cyan, fontSize: 7, fontFamily: "monospace" },
  moreMenu: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    overflow: "hidden",
  },
  moreItem: {
    minHeight: 67,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 10,
  },
  settingsCard: {
    padding: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    marginBottom: 9,
  },
  settingsValue: { color: colors.mint, fontSize: 11, fontFamily: "monospace", marginTop: 9 },
  settingsHint: { color: colors.muted, fontSize: 8, lineHeight: 14, marginTop: 7 },
  radiusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 13 },
  radiusStepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: colors.panel2 },
  radiusValue: { color: colors.text, fontSize: 11, fontFamily: "monospace", minWidth: 56, textAlign: "center" },
  auditItem: { paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line },
  auditHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  auditAction: { flex: 1, color: colors.text, fontSize: 9, fontFamily: "monospace" },
  auditTime: { color: colors.muted, fontSize: 7, fontFamily: "monospace" },
  auditDetail: { color: colors.muted, fontSize: 8, marginTop: 5 },
  moreIcon: {
    width: 34,
    height: 34,
    backgroundColor: "#20372e",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { flex: 1 },
  moreTitle: { color: colors.text, fontSize: 11, fontWeight: "600" },
  moreSubtitle: { color: colors.muted, fontSize: 8, marginTop: 4 },
  safetyBox: {
    flexDirection: "row",
    gap: 9,
    padding: 11,
    backgroundColor: "#29261f",
    borderWidth: 1,
    borderColor: "#514632",
    borderRadius: 4,
    marginTop: 12,
  },
  safetyText: { flex: 1, color: "#ccbd99", fontSize: 9, lineHeight: 15 },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 2,
    marginBottom: 15,
  },
  detectionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 67,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    paddingHorizontal: 11,
    marginBottom: 7,
  },
  detectionDot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    backgroundColor: colors.orange,
  },
  detectionText: { flex: 1 },
  detectionTitle: { color: colors.text, fontSize: 10, fontWeight: "700" },
  detectionSub: { color: "#a8b3ab", fontSize: 8, marginTop: 4 },
  detectionTime: {
    color: colors.muted,
    fontSize: 7,
    marginTop: 4,
    fontFamily: "monospace",
  },
  tempHero: {
    minHeight: 128,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 17,
    backgroundColor: colors.panel,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tempNumber: { color: colors.text, fontSize: 48, fontWeight: "700" },
  tempUnit: { color: colors.muted, fontSize: 8, fontFamily: "monospace" },
  tempNormal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1d382b",
    borderRadius: 3,
    padding: 7,
  },
  tempNormalText: { color: colors.green, fontSize: 8, fontFamily: "monospace" },
  tempStats: {
    flexDirection: "row",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 8,
    padding: 11,
    borderRadius: 4,
  },
  tempChart: {
    height: 175,
    marginTop: 10,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    padding: 12,
  },
  bars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingTop: 15,
    paddingBottom: 13,
  },
  barColumn: {
    height: "100%",
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    marginHorizontal: 2,
  },
  bar: {
    width: "65%",
    minHeight: 8,
    borderRadius: 2,
    backgroundColor: colors.orange,
  },
  barLabel: {
    position: "absolute",
    bottom: -12,
    color: colors.muted,
    fontSize: 6,
  },
  thresholdLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    position: "absolute",
    top: 37,
    right: 10,
  },
  reportItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    backgroundColor: colors.panel,
    marginBottom: 7,
  },
  reportDetailCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    padding: 12,
    gap: 13,
  },
  reportSectionTitle: { marginTop: 18, marginBottom: 9 },
  reportImages: { flexGrow: 0, marginTop: 4 },
  reportImage: { width: 116, height: 78, borderRadius: 4, marginRight: 7 },
  reportAlert: {
    padding: 10,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    marginBottom: 6,
  },
  reportIcon: {
    width: 33,
    height: 33,
    borderRadius: 4,
    backgroundColor: "#20372e",
    alignItems: "center",
    justifyContent: "center",
  },
  reportText: { flex: 1 },
  reportAsset: { color: colors.text, fontSize: 10, fontWeight: "700" },
  reportSub: { color: colors.muted, fontSize: 8, marginTop: 4 },
  reportTemp: { color: "#86c9aa", fontSize: 7, marginTop: 5 },
  modalBack: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: "flex-end",
    backgroundColor: "#0009",
  },
  detailSheet: {
    maxHeight: "90%",
    backgroundColor: colors.panel,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 17,
    paddingTop: 10,
    paddingBottom: 22,
  },
  sheetHandle: {
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#718077",
    alignSelf: "center",
    marginBottom: 13,
  },
  sheetClose: {
    position: "absolute",
    top: 10,
    right: 13,
    zIndex: 2,
    padding: 5,
  },
  detectionPhoto: { width: "100%", height: 145, borderRadius: 4, marginTop: 5 },
  detailTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "700",
    marginTop: 12,
    textTransform: "capitalize",
  },
  detailDisclaimer: { color: colors.muted, fontSize: 9, marginTop: 4 },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingVertical: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  reviewInput: {
    minHeight: 54,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    paddingHorizontal: 9,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 9,
    textAlignVertical: "top",
  },
  secondaryButton: {
    height: 38,
    borderWidth: 1,
    borderColor: "#46534b",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  secondaryButtonText: { color: "#d5dfd8", fontSize: 9, fontWeight: "700" },
  textOnlyButton: { alignItems: "center", padding: 12 },
});
