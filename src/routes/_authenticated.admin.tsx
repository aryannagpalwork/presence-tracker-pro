import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map as GMap,
  AdvancedMarker,
  InfoWindow,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { getMapsKey } from "@/lib/maps-key";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

const LIVE_WINDOW_MS = 45_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const RECENT_PATH_POINTS_PER_USER = 30;
const RECENT_PATH_FETCH_LIMIT = 5_000;

type LocationPoint = {
  lat: number;
  lng: number;
  created_at: string;
};

type LatestLoc = {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  created_at: string;
  name: string;
  email: string;
  trackerLabel: string;
  color: string;
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
};

type LocationHistoryRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  network_type?: string | null;
  is_connected?: boolean | null;
  is_internet_reachable?: boolean | null;
  created_at: string;
};

type DbLocation = {
  id?: string;
  user_id: string;
  session_id?: string | null;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  created_at?: string;
  timestamp?: string;
};

type DbProfile = {
  id: string;
  name: string;
  email: string;
};

function colorForUser(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 78% 46%)`;
}

function isLive(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < LIVE_WINDOW_MS;
}

function isActive(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < ACTIVE_WINDOW_MS;
}

function shortId(userId: string) {
  return userId.slice(0, 8);
}

function personLabel(index: number) {
  return `Person ${index + 1}`;
}

function locationTime(location: DbLocation) {
  return location.created_at ?? location.timestamp ?? new Date().toISOString();
}

function latestPerUser(locations: DbLocation[]) {
  const byUser = new Map<string, DbLocation>();

  for (const location of locations) {
    if (!byUser.has(location.user_id)) byUser.set(location.user_id, location);
  }

  return Array.from(byUser.values());
}

async function fetchRecentLocations(orderColumn: "created_at" | "timestamp") {
  const { data, error } = await supabase
    .from("locations")
    .select(`id, user_id, latitude, longitude, accuracy, ${orderColumn}`)
    .order(orderColumn, { ascending: false })
    .limit(RECENT_PATH_FETCH_LIMIT)
    .returns<DbLocation[]>();

  if (error) return null;
  return data ?? [];
}

async function fetchLocationHistory() {
  const withNetwork = await supabase
    .from("locations")
    .select(
      "id, user_id, session_id, latitude, longitude, accuracy, network_type, is_connected, is_internet_reachable, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<LocationHistoryRow[]>();

  if (!withNetwork.error) return { data: withNetwork.data ?? [], error: null };

  const basic = await supabase
    .from("locations")
    .select("id, user_id, session_id, latitude, longitude, accuracy, created_at")
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<LocationHistoryRow[]>();

  return { data: basic.data ?? [], error: basic.error ?? withNetwork.error };
}

function UserPaths({ users }: { users: LatestLoc[] }) {
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
          strokeOpacity: 0.85,
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

function UserMapLabels({ users, selected }: { users: LatestLoc[]; selected: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const overlays = users.map((user) => {
      class LabelOverlay extends google.maps.OverlayView {
        private div?: HTMLDivElement;

        onAdd() {
          const div = document.createElement("div");
          div.style.position = "absolute";
          div.style.transform = "translate(-50%, -112px)";
          div.style.background = selected === user.user_id ? "#111827" : "#ffffff";
          div.style.border = `2px solid ${user.color}`;
          div.style.borderRadius = "8px";
          div.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.18)";
          div.style.color = selected === user.user_id ? "#ffffff" : "#0f172a";
          div.style.fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif";
          div.style.fontSize = "12px";
          div.style.fontWeight = "700";
          div.style.lineHeight = "1.25";
          div.style.padding = "7px 9px";
          div.style.pointerEvents = "none";
          div.style.whiteSpace = "nowrap";

          const title = document.createElement("div");
          title.textContent = user.trackerLabel;

          const coords = document.createElement("div");
          coords.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
          coords.style.fontSize = "10px";
          coords.style.fontWeight = "500";
          coords.style.marginTop = "2px";
          coords.style.opacity = ".78";
          coords.textContent = `${user.latitude.toFixed(5)}, ${user.longitude.toFixed(5)}`;

          div.append(title, coords);
          this.div = div;
          this.getPanes()?.overlayMouseTarget.appendChild(div);
        }

        draw() {
          const projection = this.getProjection();
          const point = projection.fromLatLngToDivPixel(
            new google.maps.LatLng(user.latitude, user.longitude),
          );
          if (!point || !this.div) return;
          this.div.style.left = `${point.x}px`;
          this.div.style.top = `${point.y}px`;
        }

        onRemove() {
          this.div?.remove();
          this.div = undefined;
        }
      }

      const overlay = new LabelOverlay();
      overlay.setMap(map);
      return overlay;
    });

    return () => overlays.forEach((overlay) => overlay.setMap(null));
  }, [map, selected, users]);

  return null;
}

function FitMapToUsers({
  users,
  selectedUser,
}: {
  users: LatestLoc[];
  selectedUser: LatestLoc | null;
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
  const [rows, setRows] = useState<LatestLoc[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState("Waiting for live locations");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [sessions, setSessions] = useState<TrackingSession[]>([]);
  const [historyRows, setHistoryRows] = useState<LocationHistoryRow[]>([]);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!loading && !canUseAdmin) navigate({ to: "/tracker" });
  }, [loading, canUseAdmin, navigate]);

  useEffect(() => {
    const i = setInterval(() => tick((t) => t + 1), 5_000);
    return () => clearInterval(i);
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    const [
      { data: latestRows, error: latestError },
      { data: profiles, error: profilesError },
      { data: sessionRows, error: sessionsError },
      { data: history, error: historyError },
    ] = await Promise.all([
      supabase
        .from("latest_locations")
        .select("id, user_id, latitude, longitude, accuracy, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, name, email"),
      supabase
        .from("tracking_sessions")
        .select(
          "id, user_id, started_at, ended_at, start_latitude, start_longitude, end_latitude, end_longitude, status",
        )
        .order("started_at", { ascending: false })
        .limit(25)
        .returns<TrackingSession[]>(),
      fetchLocationHistory(),
    ]);

    setSessions(sessionRows ?? []);
    setHistoryRows(history ?? []);

    let latestLocations = (latestRows ?? []) as DbLocation[];
    let recentLocations: DbLocation[] = [];

    if (latestError) {
      recentLocations =
        (await fetchRecentLocations("created_at")) ??
        (await fetchRecentLocations("timestamp")) ??
        [];
      latestLocations = latestPerUser(recentLocations);
    } else {
      recentLocations =
        (await fetchRecentLocations("created_at")) ??
        (await fetchRecentLocations("timestamp")) ??
        [];
    }

    const warnings = [];
    if (profilesError) {
      warnings.push("Profiles are not readable, so showing tracked devices without names.");
    }
    if (sessionsError || historyError) {
      warnings.push("Run the tracking_sessions migration in Supabase to see full session history.");
    }
    setLoadError(warnings.length ? warnings.join(" ") : null);

    const profMap = new Map(
      ((profiles ?? []) as DbProfile[]).map((profile) => [profile.id, profile]),
    );
    const pathsByUser = new Map<string, LocationPoint[]>();

    for (const loc of recentLocations) {
      const path = pathsByUser.get(loc.user_id) ?? [];
      if (path.length < RECENT_PATH_POINTS_PER_USER) {
        path.push({
          lat: loc.latitude,
          lng: loc.longitude,
          created_at: locationTime(loc),
        });
        pathsByUser.set(loc.user_id, path);
      }
    }

    const orderedLatestLocations = [...latestLocations].sort((a, b) =>
      a.user_id.localeCompare(b.user_id),
    );

    setRows(
      orderedLatestLocations.map((loc, index) => {
        const profile = profMap.get(loc.user_id);
        return {
          id: loc.id ?? `${loc.user_id}-${locationTime(loc)}`,
          user_id: loc.user_id,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy ?? null,
          created_at: locationTime(loc),
          name: profile?.name || "Unknown user",
          email: profile?.email ?? "",
          trackerLabel: personLabel(index),
          color: colorForUser(loc.user_id),
          path: [...(pathsByUser.get(loc.user_id) ?? [])].reverse(),
        };
      }),
    );
    setLoadStatus(
      latestLocations.length
        ? `Loaded ${latestLocations.length} tracked device${latestLocations.length === 1 ? "" : "s"}`
        : latestError
          ? "No readable locations found. If the phone sent data, your web user may not have admin RLS access."
          : "No locations found yet. Start sharing from a phone.",
    );
  }, []);

  useEffect(() => {
    if (!canUseAdmin) return;

    loadAll();
    const channel = supabase
      .channel("admin-locations-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "locations" }, () =>
        loadAll(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canUseAdmin, loadAll]);

  const center = useMemo(() => {
    if (!rows.length) return { lat: 20, lng: 0 };
    const lat = rows.reduce((sum, row) => sum + row.latitude, 0) / rows.length;
    const lng = rows.reduce((sum, row) => sum + row.longitude, 0) / rows.length;
    return { lat, lng };
  }, [rows]);

  const visibleRows = showAllHistory ? rows : rows.filter((row) => isActive(row.created_at));
  const selectedRow = visibleRows.find((row) => row.user_id === selected) ?? null;
  const liveCount = visibleRows.filter((row) => isLive(row.created_at)).length;
  const idleCount = visibleRows.length - liveCount;

  if (loading || !canUseAdmin)
    return <div className="p-6 text-muted-foreground">Checking permissions...</div>;

  return (
    <div className="container mx-auto grid gap-4 px-4 py-6 lg:grid-cols-[390px_1fr]">
      <Card className="lg:max-h-[78vh] lg:overflow-auto">
        <CardHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Tracking Control</CardTitle>
              <Badge variant={liveCount ? "default" : "secondary"}>{liveCount} LIVE</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{loadStatus}</p>
            {loadError && <p className="text-xs text-destructive">{loadError}</p>}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{visibleRows.length}</div>
                <div className="text-muted-foreground">Devices</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{liveCount}</div>
                <div className="text-muted-foreground">Live</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="font-mono text-lg font-semibold">{idleCount}</div>
                <div className="text-muted-foreground">Idle</div>
              </div>
            </div>
            <button
              className="text-left text-xs font-medium text-primary"
              onClick={() => setShowAllHistory((value) => !value)}
              type="button"
            >
              {showAllHistory ? "Showing all historical devices" : "Showing active devices only"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {visibleRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active locations. Have a phone user start sharing, or show historical devices.
            </p>
          )}
          {visibleRows.map((row) => {
            const live = isLive(row.created_at);
            return (
              <button
                key={row.user_id}
                onClick={() => setSelected(row.user_id)}
                className={`w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent ${
                  selected === row.user_id ? "border-primary bg-accent" : ""
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
                      User ID: {shortId(row.user_id)}
                    </div>
                    <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={live ? "default" : "secondary"} className="text-[10px]">
                      {live ? "LIVE" : "IDLE"}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="h-[78vh] overflow-hidden rounded-lg border">
        {mapsKey ? (
          <APIProvider apiKey={mapsKey}>
            <GMap
              mapId="admin"
              defaultCenter={center}
              defaultZoom={rows.length ? 12 : 2}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <UserPaths users={visibleRows} />
              <UserMapLabels users={visibleRows} selected={selected} />
              <FitMapToUsers users={visibleRows} selectedUser={selectedRow} />
              {visibleRows.map((row) => {
                const selectedMarker = selected === row.user_id;
                return (
                  <AdvancedMarker
                    key={row.user_id}
                    position={{ lat: row.latitude, lng: row.longitude }}
                    zIndex={selectedMarker ? 20 : 1}
                    onClick={() => setSelected(row.user_id)}
                  >
                    <Pin
                      background={row.color}
                      borderColor={selectedMarker ? "#111827" : "#ffffff"}
                      glyphColor="#ffffff"
                      glyph={String(
                        visibleRows.findIndex((item) => item.user_id === row.user_id) + 1,
                      )}
                      scale={selectedMarker ? 1.25 : 1}
                    />
                  </AdvancedMarker>
                );
              })}
              {selectedRow && (
                <InfoWindow
                  position={{ lat: selectedRow.latitude, lng: selectedRow.longitude }}
                  onCloseClick={() => setSelected(null)}
                >
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 font-semibold">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: selectedRow.color }}
                      />
                      {selectedRow.trackerLabel}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedRow.name} {selectedRow.email ? `(${selectedRow.email})` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      User ID: {shortId(selectedRow.user_id)}
                    </div>
                    <div className="font-mono text-xs">
                      {selectedRow.latitude.toFixed(5)}, {selectedRow.longitude.toFixed(5)}
                    </div>
                    {selectedRow.accuracy !== null && (
                      <div className="text-xs">Accuracy: {Math.round(selectedRow.accuracy)} m</div>
                    )}
                    <div className="text-xs">
                      Last seen:{" "}
                      {formatDistanceToNow(new Date(selectedRow.created_at), { addSuffix: true })}
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
                <span className="font-mono"> .env</span> file to enable the map. Coordinate history
                and tracking sessions are still available below.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coordinate History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-auto rounded-md border">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Person</th>
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">Latitude</th>
                    <th className="px-3 py-2">Longitude</th>
                    <th className="px-3 py-2">Accuracy</th>
                    <th className="px-3 py-2">Network</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-muted-foreground" colSpan={7}>
                        No coordinate history yet.
                      </td>
                    </tr>
                  )}
                  {historyRows.map((row) => {
                    const person = rows.find((item) => item.user_id === row.user_id);
                    return (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          {person?.trackerLabel ?? shortId(row.user_id)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.session_id ? row.session_id.slice(0, 8) : "legacy"}
                        </td>
                        <td className="px-3 py-2 font-mono">{row.latitude.toFixed(6)}</td>
                        <td className="px-3 py-2 font-mono">{row.longitude.toFixed(6)}</td>
                        <td className="px-3 py-2">
                          {row.accuracy === null ? "unknown" : `${Math.round(row.accuracy)} m`}
                        </td>
                        <td className="px-3 py-2">
                          {row.network_type ?? "unknown"}
                          {row.is_internet_reachable === false ? " / offline" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-auto rounded-md border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">Person</th>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Start Coordinates</th>
                    <th className="px-3 py-2">Ended</th>
                    <th className="px-3 py-2">End Coordinates</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-muted-foreground" colSpan={7}>
                        No tracking sessions yet.
                      </td>
                    </tr>
                  )}
                  {sessions.map((session) => {
                    const person = rows.find((item) => item.user_id === session.user_id);
                    return (
                      <tr key={session.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{session.id.slice(0, 8)}</td>
                        <td className="px-3 py-2">
                          {person?.trackerLabel ?? shortId(session.user_id)}
                        </td>
                        <td className="px-3 py-2">
                          {new Date(session.started_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {session.start_latitude === null || session.start_longitude === null
                            ? "unknown"
                            : `${session.start_latitude.toFixed(6)}, ${session.start_longitude.toFixed(6)}`}
                        </td>
                        <td className="px-3 py-2">
                          {session.ended_at ? new Date(session.ended_at).toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {session.end_latitude === null || session.end_longitude === null
                            ? "-"
                            : `${session.end_latitude.toFixed(6)}, ${session.end_longitude.toFixed(6)}`}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={session.status === "active" ? "default" : "secondary"}>
                            {session.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
