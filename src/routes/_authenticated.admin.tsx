import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map as GMap,
  AdvancedMarker,
  InfoWindow,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMapsKey } from "@/lib/maps-key";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

const ACTIVE_WINDOW_MS = 2 * 60_000;
const OFFLINE_WINDOW_MS = 5 * 60_000;
const RECENT_PATH_POINTS_PER_TRACKER = 40;
const RECENT_PATH_FETCH_LIMIT = 5_000;
const LOCATION_TABLES = ["locations"] as const;

type TrackingStatus = "ACTIVE" | "IDLE" | "OFFLINE";
type VisibilityFilter = "active" | "inactive" | "all";

type LocationPoint = {
  lat: number;
  lng: number;
  created_at: string;
};

type TrackingDevice = {
  id: string;
  tracker_id: string;
  user_id: string;
  session_id: string | null;
  device_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  created_at: string;
  name: string;
  email: string;
  trackerLabel: string;
  color: string;
  status: TrackingStatus;
  is_active: boolean;
  ageMs: number;
  network_type: string | null;
  connection_type: string | null;
  is_connected: boolean | null;
  is_internet_reachable: boolean | null;
  path: LocationPoint[];
};

type TrackingSession = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  status: string;
  is_active: boolean | null;
  last_seen: string | null;
  device_id: string | null;
  connection_type: string | null;
  device_label: string | null;
};

type LocationHistoryRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  device_id?: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  network_type?: string | null;
  connection_type?: string | null;
  is_connected?: boolean | null;
  is_internet_reachable?: boolean | null;
  created_at: string;
};

type DbLocation = LocationHistoryRow & {
  timestamp?: string;
};

type DbProfile = {
  id: string;
  name: string;
  email: string;
};

type LocationTableName = (typeof LOCATION_TABLES)[number];

function colorForTracker(trackerId: string) {
  let hash = 0;
  for (let i = 0; i < trackerId.length; i += 1) {
    hash = trackerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 78% 44%)`;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function trackerKey(location: Pick<DbLocation, "session_id" | "user_id" | "device_id">) {
  return location.session_id ?? location.device_id ?? location.user_id;
}

function locationTime(location: Pick<DbLocation, "created_at" | "timestamp">) {
  return location.created_at ?? location.timestamp ?? new Date(0).toISOString();
}

function locationMillis(location: Pick<DbLocation, "created_at" | "timestamp">) {
  const time = new Date(locationTime(location)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function statusFor(createdAt: string): TrackingStatus {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs <= ACTIVE_WINDOW_MS) return "ACTIVE";
  if (ageMs <= OFFLINE_WINDOW_MS) return "IDLE";
  return "OFFLINE";
}

function statusVariant(status: TrackingStatus) {
  return status === "ACTIVE" ? "default" : "secondary";
}

function hasValidCoordinates(location: DbLocation) {
  return (
    typeof location.latitude === "number" &&
    typeof location.longitude === "number" &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude)
  );
}

function latestPerTracker(locations: DbLocation[]) {
  const byTracker = new Map<string, DbLocation>();

  for (const location of locations) {
    const key = trackerKey(location);
    const current = byTracker.get(key);
    if (!current || locationMillis(location) > locationMillis(current)) {
      byTracker.set(key, location);
    }
  }

  return Array.from(byTracker.values());
}

function matchesSearch(device: TrackingDevice, search: string) {
  const value = search.trim().toLowerCase();
  if (!value) return true;
  return [
    device.trackerLabel,
    device.user_id,
    device.session_id ?? "",
    device.device_id ?? "",
    device.name,
    device.email,
    device.network_type ?? "",
  ].some((field) => field.toLowerCase().includes(value));
}

async function selectLocations(
  table: LocationTableName,
  orderColumn: "created_at" | "timestamp",
  includeTrackingColumns: boolean,
) {
  const selectColumns = includeTrackingColumns
    ? `id, user_id, session_id, device_id, latitude, longitude, accuracy, network_type, connection_type, is_connected, is_internet_reachable, ${orderColumn}`
    : `id, user_id, session_id, latitude, longitude, accuracy, network_type, is_connected, is_internet_reachable, ${orderColumn}`;

  const { data, error } = await supabase
    .from(table)
    .select(selectColumns)
    .order(orderColumn, { ascending: false })
    .limit(RECENT_PATH_FETCH_LIMIT)
    .returns<DbLocation[]>();

  console.log("Supabase response:", data);
  console.log("Supabase error:", error);

  return { data, error };
}

async function fetchRecentLocations(orderColumn: "created_at" | "timestamp") {
  for (const table of LOCATION_TABLES) {
    const primary = await selectLocations(table, orderColumn, true);
    if (!primary.error) return primary.data ?? [];

    console.error("[Admin] Failed to fetch recent locations", {
      table,
      orderColumn,
      message: primary.error.message,
      details: primary.error.details,
    });

    const fallback = await selectLocations(table, orderColumn, false);
    if (!fallback.error) return fallback.data ?? [];

    const minimal = await supabase
      .from(table)
      .select(`id, user_id, latitude, longitude, ${orderColumn}`)
      .order(orderColumn, { ascending: false })
      .limit(RECENT_PATH_FETCH_LIMIT)
      .returns<DbLocation[]>();

    console.log("Supabase response:", minimal.data);
    console.log("Supabase error:", minimal.error);

    if (!minimal.error) return minimal.data ?? [];
  }

  return null;
}

async function fetchLocationHistory() {
  for (const table of LOCATION_TABLES) {
    const primary = await supabase
      .from(table)
      .select(
        "id, user_id, session_id, device_id, latitude, longitude, accuracy, network_type, connection_type, is_connected, is_internet_reachable, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(150)
      .returns<LocationHistoryRow[]>();

    console.log("Supabase response:", primary.data);
    console.log("Supabase error:", primary.error);

    if (!primary.error) return { data: primary.data ?? [], error: null };

    const fallback = await supabase
      .from(table)
      .select(
        "id, user_id, session_id, latitude, longitude, accuracy, network_type, is_connected, is_internet_reachable, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(150)
      .returns<LocationHistoryRow[]>();

    console.log("Supabase response:", fallback.data);
    console.log("Supabase error:", fallback.error);

    if (!fallback.error) return { data: fallback.data ?? [], error: fallback.error };

    const minimal = await supabase
      .from(table)
      .select("id, user_id, latitude, longitude, created_at")
      .order("created_at", { ascending: false })
      .limit(150)
      .returns<LocationHistoryRow[]>();

    console.log("Supabase response:", minimal.data);
    console.log("Supabase error:", minimal.error);

    if (!minimal.error) return { data: minimal.data ?? [], error: null };
  }

  return { data: [], error: new Error("No readable locations table") };
}

async function fetchTrackingSessions() {
  const { data, error } = await supabase
    .from("tracking_sessions")
    .select(
      "id, user_id, started_at, ended_at, start_latitude, start_longitude, end_latitude, end_longitude, status, is_active, last_seen, device_id, connection_type, device_label",
    )
    .order("started_at", { ascending: false })
    .limit(500)
    .returns<TrackingSession[]>();

  console.log("Supabase response:", data);
  console.log("Supabase error:", error);

  if (!error) return { data: data ?? [], error };

  const fallback = await supabase
    .from("tracking_sessions")
    .select(
      "id, user_id, started_at, ended_at, start_latitude, start_longitude, end_latitude, end_longitude, status",
    )
    .order("started_at", { ascending: false })
    .limit(500)
    .returns<TrackingSession[]>();

  console.log("Supabase response:", fallback.data);
  console.log("Supabase error:", fallback.error);

  if (!fallback.error) return { data: fallback.data ?? [], error: null };

  console.warn(
    "[Admin] Tracking sessions are not readable. Rendering locations without session state.",
    {
      message: error.message,
      fallbackMessage: fallback.error?.message,
    },
  );
  return { data: [], error: fallback.error ?? error };
}

async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("id, name, email");
  console.log("Supabase response:", data);
  console.log("Supabase error:", error);
  return { data, error };
}

async function assertReadableTables() {
  const checks = await Promise.allSettled([
    supabase.from("tracking_sessions").select("id", { count: "exact", head: true }),
    supabase.from("locations").select("id", { count: "exact", head: true }),
  ]);

  checks.forEach((result, index) => {
    if (result.status === "rejected") {
      console.log("Supabase response:", {
        table: ["tracking_sessions", "locations"][index],
        count: null,
        status: "rejected",
      });
      console.log("Supabase error:", result.reason);
      return;
    }

    console.log("Supabase response:", {
      table: ["tracking_sessions", "locations"][index],
      count: result.value.count,
      status: result.value.status,
    });
    console.log("Supabase error:", result.value.error);
  });
}

function UserPaths({ users }: { users: TrackingDevice[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const polylines = users
      .filter((user) => user.path.length > 1)
      .map((user) => {
        const polyline = new google.maps.Polyline({
          path: user.path.map((point) => ({ lat: point.lat, lng: point.lng })),
          geodesic: true,
          strokeColor: user.color,
          strokeOpacity: user.status === "ACTIVE" ? 0.9 : 0.45,
          strokeWeight: 4,
        });
        polyline.setMap(map);
        return polyline;
      });

    return () => {
      polylines.forEach((polyline) => polyline.setMap(null));
    };
  }, [map, users]);

  return null;
}

function markerPosition(user: TrackingDevice, index: number, users: TrackingDevice[]) {
  const sameCoordinateIndex = users
    .slice(0, index)
    .filter(
      (item) =>
        Math.abs(item.latitude - user.latitude) < 0.00001 &&
        Math.abs(item.longitude - user.longitude) < 0.00001,
    ).length;

  if (sameCoordinateIndex === 0) return { lat: user.latitude, lng: user.longitude };

  const angle = sameCoordinateIndex * 1.0472;
  const radius = 0.00003 * Math.ceil(sameCoordinateIndex / 6);
  return {
    lat: user.latitude + Math.sin(angle) * radius,
    lng: user.longitude + Math.cos(angle) * radius,
  };
}

function FitMapToUsers({
  users,
  selectedUser,
}: {
  users: TrackingDevice[];
  selectedUser: TrackingDevice | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || users.length === 0) return;

    if (selectedUser) {
      map.panTo({ lat: selectedUser.latitude, lng: selectedUser.longitude });
      if ((map.getZoom() ?? 0) < 15) map.setZoom(15);
      return;
    }

    if (users.length === 1) {
      map.panTo({ lat: users[0].latitude, lng: users[0].longitude });
      map.setZoom(15);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    users.forEach((user) => bounds.extend({ lat: user.latitude, lng: user.longitude }));
    map.fitBounds(bounds, 72);
  }, [map, selectedUser, users]);

  return null;
}

function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const canUseAdmin = isAdmin || import.meta.env.DEV;
  const mapsKey = getMapsKey();
  const [devices, setDevices] = useState<TrackingDevice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("active");
  const [search, setSearch] = useState("");
  const [loadStatus, setLoadStatus] = useState("Waiting for live locations");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [sessions, setSessions] = useState<TrackingSession[]>([]);
  const [historyRows, setHistoryRows] = useState<LocationHistoryRow[]>([]);
  const [realtimeNonce, setRealtimeNonce] = useState(0);
  const [, tick] = useState(0);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    if (!loading && !canUseAdmin) navigate({ to: "/tracker" });
  }, [loading, canUseAdmin, navigate]);

  useEffect(() => {
    const i = window.setInterval(() => tick((t) => t + 1), 5_000);
    return () => window.clearInterval(i);
  }, []);

  const loadAll = useCallback(async () => {
    const loadRequestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = loadRequestId;
    setLoadError(null);

    void assertReadableTables();

    const [{ data: profiles, error: profilesError }, { data: sessionRows, error: sessionsError }] =
      await Promise.all([fetchProfiles(), fetchTrackingSessions()]);

    const [recentLocations, { data: history, error: historyError }] = await Promise.all([
      fetchRecentLocations("created_at").then(
        async (rows) => rows ?? (await fetchRecentLocations("timestamp")) ?? [],
      ),
      fetchLocationHistory(),
    ]);

    if (loadRequestId !== loadRequestIdRef.current) {
      console.log("[Admin] Ignoring stale location fetch response", {
        loadRequestId,
        latestRequestId: loadRequestIdRef.current,
      });
      return;
    }

    const validLocations = recentLocations.filter(hasValidCoordinates);
    const latestLocations = latestPerTracker(validLocations);
    const profMap = new Map(
      ((profiles ?? []) as DbProfile[]).map((profile) => [profile.id, profile]),
    );
    const sessionMap = new Map((sessionRows ?? []).map((session) => [session.id, session]));
    const pathsByTracker = new Map<string, LocationPoint[]>();

    for (const loc of validLocations) {
      const key = trackerKey(loc);
      const path = pathsByTracker.get(key) ?? [];
      if (path.length < RECENT_PATH_POINTS_PER_TRACKER) {
        path.push({
          lat: loc.latitude,
          lng: loc.longitude,
          created_at: locationTime(loc),
        });
        pathsByTracker.set(key, path);
      }
    }

    const nextDevices = latestLocations
      .sort((a, b) => trackerKey(a).localeCompare(trackerKey(b)))
      .map((loc, index) => {
        const key = trackerKey(loc);
        const profile = profMap.get(loc.user_id);
        const session = loc.session_id ? sessionMap.get(loc.session_id) : null;
        const createdAt = locationTime(loc);
        const status = statusFor(createdAt);
        const isActiveSharing = session
          ? session.status === "active" && session.is_active !== false && status !== "OFFLINE"
          : status === "ACTIVE";
        return {
          id: loc.id,
          tracker_id: key,
          user_id: loc.user_id,
          session_id: loc.session_id ?? null,
          device_id: loc.device_id ?? null,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy ?? null,
          created_at: createdAt,
          name: profile?.name || "Unknown user",
          email: profile?.email ?? "",
          trackerLabel: loc.device_id ? `Device ${shortId(loc.device_id)}` : `Device ${index + 1}`,
          color: colorForTracker(key),
          status,
          is_active: isActiveSharing,
          ageMs: Date.now() - new Date(createdAt).getTime(),
          network_type: loc.network_type ?? null,
          connection_type: loc.connection_type ?? loc.network_type ?? null,
          is_connected: loc.is_connected ?? null,
          is_internet_reachable: loc.is_internet_reachable ?? null,
          path: [...(pathsByTracker.get(key) ?? [])].reverse(),
        };
      });

    const activeUsers = nextDevices.filter(
      (device) => device.status === "ACTIVE" && device.is_active,
    );
    console.log("Active sessions:", activeUsers);
    setDevices(nextDevices);
    setSessions(sessionRows ?? []);
    setHistoryRows(history ?? []);
    setLastLoadedAt(new Date());
    setLoadStatus(
      nextDevices.length
        ? `Tracking ${nextDevices.length} device${nextDevices.length === 1 ? "" : "s"}`
        : "No tracking data found. Start sharing from a phone.",
    );

    const warnings = [];
    if (profilesError) warnings.push("Profiles are not readable, so names may be missing.");
    if (sessionsError)
      warnings.push("Session state is not readable; rendering live rows from locations.");
    if (historyError)
      warnings.push("Location history query failed; using recent live locations only.");
    setLoadError(warnings.length ? warnings.join(" ") : null);
  }, []);

  const closeStaleSessions = useCallback(async () => {
    const latestByTracker = new Map(devices.map((device) => [device.tracker_id, device]));
    const staleActiveSessions = sessions.filter((session) => {
      if (session.status !== "active") return false;
      const latest = latestByTracker.get(session.id);
      return !latest || latest.status === "OFFLINE";
    });

    if (staleActiveSessions.length === 0) {
      setLoadStatus("No stale active sessions to remove.");
      return;
    }

    await Promise.all(
      staleActiveSessions.map((session) => {
        const latest = latestByTracker.get(session.id);
        return supabase
          .from("tracking_sessions")
          .update({
            status: "ended",
            is_active: false,
            ended_at: new Date().toISOString(),
            end_latitude: latest?.latitude ?? null,
            end_longitude: latest?.longitude ?? null,
            end_accuracy: latest?.accuracy ?? null,
          })
          .eq("id", session.id);
      }),
    );

    setLoadStatus(`Removed ${staleActiveSessions.length} stale session(s).`);
    await loadAll();
  }, [devices, loadAll, sessions]);

  useEffect(() => {
    if (!canUseAdmin) return;

    loadAll();
    let active = true;
    const channel = supabase
      .channel(`admin-locations-live-${realtimeNonce}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, (payload) => {
        console.log("Realtime update received:", payload.new ?? payload.old ?? payload);
        loadAll();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracking_sessions" },
        (payload) => {
          console.log("Realtime update received:", payload.new ?? payload.old ?? payload);
          loadAll();
        },
      )
      .subscribe((status, error) => {
        console.log("[Admin] Realtime subscription status", { status, error });
        if (
          active &&
          (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        ) {
          window.setTimeout(() => setRealtimeNonce((value) => value + 1), 1_000);
        }
      });
    const poll = window.setInterval(loadAll, 10_000);
    const reconnect = () => {
      console.log("[Admin] Reconnecting realtime and refreshing locations");
      setRealtimeNonce((value) => value + 1);
      void loadAll();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);

    return () => {
      active = false;
      window.clearInterval(poll);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      supabase.removeChannel(channel);
    };
  }, [canUseAdmin, loadAll, realtimeNonce]);

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      const matchesVisibility =
        visibilityFilter === "all" ||
        (visibilityFilter === "active" && device.status === "ACTIVE") ||
        (visibilityFilter === "inactive" && device.status !== "ACTIVE");
      return matchesVisibility && matchesSearch(device, search);
    });
  }, [devices, search, visibilityFilter]);

  const mapDevices = filteredDevices.filter(
    (device) => device.status === "ACTIVE" && device.is_active,
  );
  const selectedRow = filteredDevices.find((row) => row.tracker_id === selected) ?? null;
  const selectedMapRow = mapDevices.find((row) => row.tracker_id === selected) ?? null;
  const liveCount = devices.filter((row) => row.status === "ACTIVE" && row.is_active).length;
  const idleCount = devices.filter((row) => row.status === "IDLE").length;
  const offlineCount = devices.filter((row) => row.status === "OFFLINE").length;
  const markers = mapDevices.map((device, index) => ({
    trackerId: device.tracker_id,
    position: markerPosition(device, index, mapDevices),
    status: device.status,
  }));
  markers.forEach((marker) => console.log("Rendering marker:", marker));

  if (loading || !canUseAdmin)
    return <div className="p-6 text-muted-foreground">Checking permissions...</div>;

  return (
    <div className="container mx-auto grid gap-4 px-4 py-6 lg:grid-cols-[420px_1fr]">
      <Card className="lg:max-h-[78vh] lg:overflow-auto">
        <CardHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" /> GeoTrack Admin
              </CardTitle>
              <Badge variant={liveCount ? "default" : "secondary"}>{liveCount} ACTIVE</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{loadStatus}</p>
            {lastLoadedAt && (
              <p className="text-xs text-muted-foreground">
                Last updated {lastLoadedAt.toLocaleTimeString()}
              </p>
            )}
            {loadError && <p className="text-xs text-destructive">{loadError}</p>}
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{devices.length}</div>
                <div className="text-muted-foreground">Total</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{liveCount}</div>
                <div className="text-muted-foreground">Active</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{idleCount}</div>
                <div className="text-muted-foreground">Idle</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{offlineCount}</div>
                <div className="text-muted-foreground">Offline</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant={visibilityFilter === "active" ? "default" : "outline"}
                onClick={() => setVisibilityFilter("active")}
              >
                Active Users
              </Button>
              <Button
                size="sm"
                variant={visibilityFilter === "inactive" ? "default" : "outline"}
                onClick={() => setVisibilityFilter("inactive")}
              >
                Inactive Users
              </Button>
              <Button
                size="sm"
                variant={visibilityFilter === "all" ? "default" : "outline"}
                onClick={() => setVisibilityFilter("all")}
              >
                Show All
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search user or session"
                  value={search}
                />
              </div>
              <Button size="icon" variant="outline" onClick={loadAll} title="Refresh tracking data">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" className="w-full" onClick={closeStaleSessions}>
              Remove stale sessions
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredDevices.length === 0 && (
            <p className="text-sm text-muted-foreground">No devices match the current filters.</p>
          )}
          {filteredDevices.map((row) => (
            <button
              key={row.tracker_id}
              onClick={() => setSelected(row.tracker_id)}
              className={`w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent ${
                selected === row.tracker_id ? "border-primary bg-accent" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="truncate font-medium">{row.trackerLabel}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {row.name} {row.email ? `(${row.email})` : ""}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    User: {shortId(row.user_id)}
                    {row.session_id ? ` / Session: ${shortId(row.session_id)}` : " / Legacy"}
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={statusVariant(row.status)} className="text-[10px]">
                    {row.status}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="h-[78vh] overflow-hidden rounded-lg border">
        {mapsKey ? (
          <APIProvider apiKey={mapsKey}>
            <GMap
              mapId="admin"
              defaultCenter={{ lat: 20, lng: 0 }}
              defaultZoom={mapDevices.length ? 12 : 2}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <UserPaths users={mapDevices} />
              <FitMapToUsers users={mapDevices} selectedUser={selectedMapRow} />
              {mapDevices.map((row, index) => {
                const selectedMarker = selected === row.tracker_id;
                const position = markerPosition(row, index, mapDevices);
                return (
                  <AdvancedMarker
                    key={`${row.tracker_id}-${row.created_at}`}
                    position={position}
                    zIndex={selectedMarker ? 20 : row.status === "ACTIVE" ? 10 : 1}
                    onClick={() => setSelected(row.tracker_id)}
                  >
                    <Pin
                      background={row.status === "ACTIVE" ? row.color : "#64748b"}
                      borderColor={selectedMarker ? "#111827" : "#ffffff"}
                      glyphColor="#ffffff"
                      glyph={String(
                        mapDevices.findIndex((item) => item.tracker_id === row.tracker_id) + 1,
                      )}
                      scale={selectedMarker ? 1.25 : row.status === "ACTIVE" ? 1.1 : 0.95}
                    />
                  </AdvancedMarker>
                );
              })}
              {selectedMapRow && (
                <InfoWindow
                  position={{ lat: selectedMapRow.latitude, lng: selectedMapRow.longitude }}
                  onCloseClick={() => setSelected(null)}
                >
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 font-semibold">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: selectedMapRow.color }}
                      />
                      {selectedMapRow.trackerLabel}
                    </div>
                    <Badge variant={statusVariant(selectedMapRow.status)}>
                      {selectedMapRow.status}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      User: {selectedMapRow.user_id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Session: {selectedMapRow.session_id ?? "legacy"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Device: {selectedMapRow.device_id ?? "unknown"}
                    </div>
                    <div className="font-mono text-xs">
                      {selectedMapRow.latitude.toFixed(6)}, {selectedMapRow.longitude.toFixed(6)}
                    </div>
                    <div className="text-xs">
                      Last update: {new Date(selectedMapRow.created_at).toLocaleString()}
                    </div>
                    <div className="text-xs">
                      Connection:{" "}
                      {selectedMapRow.connection_type ?? selectedMapRow.network_type ?? "unknown"}
                      {selectedMapRow.is_internet_reachable === false ? " / offline" : ""}
                    </div>
                  </div>
                </InfoWindow>
              )}
            </GMap>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/30 p-6 text-center">
            <div className="max-w-md space-y-2">
              <h2 className="text-lg font-semibold">Map disabled</h2>
              <p className="text-sm text-muted-foreground">
                Add <span className="font-mono">VITE_GOOGLE_MAPS_API_KEY</span> to the web
                <span className="font-mono"> .env</span> file to enable the map.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Admin Tracking Table
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-auto rounded-md border">
              <table className="w-full min-w-[1160px] text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">User ID</th>
                    <th className="px-3 py-2">Session ID</th>
                    <th className="px-3 py-2">Device ID</th>
                    <th className="px-3 py-2">Latitude</th>
                    <th className="px-3 py-2">Longitude</th>
                    <th className="px-3 py-2">Last Updated</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Online</th>
                    <th className="px-3 py-2">Connection</th>
                    <th className="px-3 py-2">Sharing</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-muted-foreground" colSpan={10}>
                        No tracking rows match the current filters.
                      </td>
                    </tr>
                  )}
                  {filteredDevices.map((row) => (
                    <tr key={row.tracker_id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{shortId(row.user_id)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.session_id ? shortId(row.session_id) : "legacy"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.device_id ? shortId(row.device_id) : "unknown"}
                      </td>
                      <td className="px-3 py-2 font-mono">{row.latitude.toFixed(6)}</td>
                      <td className="px-3 py-2 font-mono">{row.longitude.toFixed(6)}</td>
                      <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={row.status === "OFFLINE" ? "secondary" : "default"}>
                          {row.status === "OFFLINE" ? "Offline" : "Online"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {row.connection_type ?? row.network_type ?? "unknown"}
                        {row.is_internet_reachable === false ? " / no internet" : ""}
                      </td>
                      <td className="px-3 py-2">
                        {row.is_active ? "active sharing" : "not sharing"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-auto rounded-md border">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">Latitude</th>
                    <th className="px-3 py-2">Longitude</th>
                    <th className="px-3 py-2">Accuracy</th>
                    <th className="px-3 py-2">Network</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.session_id ? shortId(row.session_id) : "legacy"}
                      </td>
                      <td className="px-3 py-2 font-mono">{row.latitude.toFixed(6)}</td>
                      <td className="px-3 py-2 font-mono">{row.longitude.toFixed(6)}</td>
                      <td className="px-3 py-2">
                        {row.accuracy == null ? "unknown" : `${Math.round(row.accuracy)} m`}
                      </td>
                      <td className="px-3 py-2">{row.network_type ?? "unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
