import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, Square, Crosshair } from "lucide-react";
import { getMapsKey } from "@/lib/maps-key";
import { MapsKeyPrompt } from "@/components/MapsKeyPrompt";

export const Route = createFileRoute("/_authenticated/tracker")({
  component: TrackerPage,
});

const PING_INTERVAL_MS = 10_000;

function TrackerPage() {
  const { user } = useAuth();
  const [mapsKey, setMapsKeyState] = useState<string | null>(getMapsKey());
  const [tracking, setTracking] = useState(false);
  const [lastPos, setLastPos] = useState<{ lat: number; lng: number; at: Date } | null>(null);
  const [pingCount, setPingCount] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => () => stopTracking(), []); // cleanup on unmount

  async function pushOnce() {
    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          setLastPos({ lat: latitude, lng: longitude, at: new Date() });
          const { error } = await supabase.from("locations").insert({
            user_id: user!.id,
            latitude,
            longitude,
            accuracy,
          });
          if (error) toast.error(error.message);
          else setPingCount((c) => c + 1);
          resolve();
        },
        (err) => {
          toast.error(`Location error: ${err.message}`);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });
  }

  function startTracking() {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported in this browser");
      return;
    }
    setTracking(true);
    pushOnce();
    intervalRef.current = window.setInterval(pushOnce, PING_INTERVAL_MS);
    toast.success("Tracking started");
  }

  function stopTracking() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setTracking(false);
  }

  if (!mapsKey) return <MapsKeyPrompt onSaved={() => setMapsKeyState(getMapsKey())} />;

  return (
    <div className="container mx-auto grid gap-4 px-4 py-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Location tracking</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Status</span>
              <Badge variant={tracking ? "default" : "secondary"}>{tracking ? "LIVE" : "Stopped"}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Pings sent</span><span className="font-mono">{pingCount}</span>
            </div>
            {lastPos && (
              <div className="rounded-md bg-muted p-2 text-xs">
                <div className="flex items-center gap-1 font-medium"><Crosshair className="h-3 w-3" /> Last fix</div>
                <div className="font-mono mt-1">{lastPos.lat.toFixed(5)}, {lastPos.lng.toFixed(5)}</div>
                <div className="text-muted-foreground mt-1">{lastPos.at.toLocaleTimeString()}</div>
              </div>
            )}
            {tracking ? (
              <Button variant="destructive" className="w-full" onClick={stopTracking}><Square className="mr-2 h-4 w-4" /> Stop</Button>
            ) : (
              <Button className="w-full" onClick={startTracking}><Play className="mr-2 h-4 w-4" /> Start tracking</Button>
            )}
            <p className="text-xs text-muted-foreground">Sends your location every 10 seconds while running.</p>
          </CardContent>
        </Card>
      </div>
      <div className="h-[70vh] overflow-hidden rounded-lg border">
        <APIProvider apiKey={mapsKey}>
          <Map
            mapId="tracker"
            defaultCenter={lastPos ?? { lat: 37.7749, lng: -122.4194 }}
            center={lastPos ? { lat: lastPos.lat, lng: lastPos.lng } : undefined}
            defaultZoom={lastPos ? 15 : 3}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            {lastPos && (
              <AdvancedMarker position={{ lat: lastPos.lat, lng: lastPos.lng }}>
                <Pin background="hsl(var(--primary))" borderColor="white" glyphColor="white" />
              </AdvancedMarker>
            )}
          </Map>
        </APIProvider>
      </div>
    </div>
  );
}
