import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { APIProvider, Map as GMap, AdvancedMarker, InfoWindow, Pin } from "@vis.gl/react-google-maps";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { getMapsKey } from "@/lib/maps-key";
import { MapsKeyPrompt } from "@/components/MapsKeyPrompt";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type LatestLoc = {
  user_id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  name: string;
  email: string;
};

function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [mapsKey, setMapsKeyState] = useState<string | null>(getMapsKey());
  const [rows, setRows] = useState<LatestLoc[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/tracker" });
  }, [loading, isAdmin, navigate]);

  // Re-render every 15s so "last seen" timestamps update
  useEffect(() => {
    const i = setInterval(() => tick((t) => t + 1), 15_000);
    return () => clearInterval(i);
  }, []);

  async function loadAll() {
    // Latest location per user (client-side reduction is fine for POC scale)
    const { data: locs } = await supabase
      .from("locations")
      .select("user_id, latitude, longitude, timestamp")
      .order("timestamp", { ascending: false })
      .limit(1000);
    const { data: profiles } = await supabase.from("profiles").select("id, name, email");
    if (!locs || !profiles) return;
    const byUser = new Map<string, typeof locs[number]>();
    for (const l of locs) if (!byUser.has(l.user_id)) byUser.set(l.user_id, l);
    const profMap = new Map(profiles.map((p) => [p.id, p]));
    setRows(
      Array.from(byUser.values()).map((l) => ({
        ...l,
        name: profMap.get(l.user_id)?.name ?? "Unknown",
        email: profMap.get(l.user_id)?.email ?? "",
      })),
    );
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadAll();
    // Realtime: refresh whenever a location row is inserted
    const channel = supabase
      .channel("locations-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "locations" }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin]);

  const center = useMemo(() => {
    if (!rows.length) return { lat: 20, lng: 0 };
    const lat = rows.reduce((s, r) => s + r.latitude, 0) / rows.length;
    const lng = rows.reduce((s, r) => s + r.longitude, 0) / rows.length;
    return { lat, lng };
  }, [rows]);

  if (loading || !isAdmin) return <div className="p-6 text-muted-foreground">Checking permissions…</div>;
  if (!mapsKey) return <MapsKeyPrompt onSaved={() => setMapsKeyState(getMapsKey())} />;

  const selectedRow = rows.find((r) => r.user_id === selected);

  return (
    <div className="container mx-auto grid gap-4 px-4 py-6 lg:grid-cols-[320px_1fr]">
      <Card className="lg:max-h-[70vh] lg:overflow-auto">
        <CardHeader><CardTitle className="text-base">Active users ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No locations yet. Have a user start tracking.</p>}
          {rows.map((r) => (
            <button
              key={r.user_id}
              onClick={() => setSelected(r.user_id)}
              className={`w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent ${selected === r.user_id ? "border-primary bg-accent" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.name}</span>
                <Badge variant="secondary" className="text-[10px]">{formatDistanceToNow(new Date(r.timestamp), { addSuffix: true })}</Badge>
              </div>
              <div className="truncate text-xs text-muted-foreground">{r.email}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="h-[70vh] overflow-hidden rounded-lg border">
        <APIProvider apiKey={mapsKey}>
          <GMap mapId="admin" defaultCenter={center} defaultZoom={rows.length ? 5 : 2} gestureHandling="greedy">
            {rows.map((r) => (
              <AdvancedMarker
                key={r.user_id}
                position={{ lat: r.latitude, lng: r.longitude }}
                onClick={() => setSelected(r.user_id)}
              >
                <Pin background="hsl(var(--primary))" borderColor="white" glyphColor="white" />
              </AdvancedMarker>
            ))}
            {selectedRow && (
              <InfoWindow position={{ lat: selectedRow.latitude, lng: selectedRow.longitude }} onCloseClick={() => setSelected(null)}>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{selectedRow.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedRow.email}</div>
                  <div className="font-mono text-xs">{selectedRow.latitude.toFixed(5)}, {selectedRow.longitude.toFixed(5)}</div>
                  <div className="text-xs">Last seen: {formatDistanceToNow(new Date(selectedRow.timestamp), { addSuffix: true })}</div>
                </div>
              </InfoWindow>
            )}
          </GMap>
        </APIProvider>
      </div>
    </div>
  );
}
