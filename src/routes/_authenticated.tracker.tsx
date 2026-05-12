import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { APIProvider, Map as GMap, AdvancedMarker, Pin, useMap } from "@vis.gl/react-google-maps";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Crosshair, Play, Radio, Square } from "lucide-react";
import { getMapsKey } from "@/lib/maps-key";
import { MapsKeyPrompt } from "@/components/MapsKeyPrompt";

export const Route = createFileRoute("/_authenticated/tracker")({
  component: TrackerPage,
});

const SEND_INTERVAL_MS = 7_500;
const MIN_DISTANCE_METERS = 10;

type LocationPoint = {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: Date;
};

function distanceMeters(a: LocationPoint, b: LocationPoint) {
  const earthRadius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function locationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED)
    return "Location permission denied. Enable location access to share live movement.";
  if (error.code === error.POSITION_UNAVAILABLE)
    return "Location unavailable. Your device could not provide a reliable fix.";
  if (error.code === error.TIMEOUT)
    return "Location request timed out. Try again with a clearer GPS or network signal.";
  return error.message || "Unable to read your location.";
}

function PathPolyline({ points }: { points: LocationPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map || points.length < 2) return;

    const polyline = new google.maps.Polyline({
      path: points.map((point) => ({ lat: point.lat, lng: point.lng })),
      geodesic: true,
      strokeColor: "#2563eb",
      strokeOpacity: 0.95,
      strokeWeight: 4,
    });

    polyline.setMap(map);
    return () => polyline.setMap(null);
  }, [map, points]);

  return null;
}

function TrackerPage() {
  const { user } = useAuth();
  const [mapsKey, setMapsKeyState] = useState<string | null>(getMapsKey());
  const [sharing, setSharing] = useState(false);
  const [lastPos, setLastPos] = useState<LocationPoint | null>(null);
  const [path, setPath] = useState<LocationPoint[]>([]);
  const [updatesSent, setUpdatesSent] = useState(0);
  const [statusText, setStatusText] = useState("Waiting to start");
  const watchRef = useRef<number | null>(null);
  const lastSentRef = useRef<LocationPoint | null>(null);
  const lastSentAtRef = useRef(0);
  const pendingRef = useRef<LocationPoint | null>(null);

  useEffect(() => () => stopSharing(), []);

  const sendLocation = useCallback(
    async (point: LocationPoint) => {
      if (!user) return;

      const { error } = await supabase.from("locations").insert({
        user_id: user.id,
        latitude: point.lat,
        longitude: point.lng,
        accuracy: point.accuracy,
      });

      if (error) {
        toast.error(error.message);
        setStatusText("Supabase insert failed");
        return;
      }

      lastSentRef.current = point;
      lastSentAtRef.current = Date.now();
      setUpdatesSent((count) => count + 1);
      setStatusText("Live update sent");
    },
    [user],
  );

  function handlePosition(position: GeolocationPosition) {
    const point: LocationPoint = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
      at: new Date(),
    };

    setLastPos(point);
    setPath((currentPath) => [...currentPath, point]);

    const lastSent = lastSentRef.current;
    const movedEnough = !lastSent || distanceMeters(lastSent, point) > MIN_DISTANCE_METERS;
    const intervalElapsed = Date.now() - lastSentAtRef.current >= SEND_INTERVAL_MS;

    if (movedEnough && intervalElapsed) {
      pendingRef.current = null;
      void sendLocation(point);
    } else if (movedEnough) {
      pendingRef.current = point;
      setStatusText("Movement captured, waiting to send");
    } else {
      setStatusText("Live, movement below 10 meters");
    }
  }

  function startSharing() {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported in this browser");
      return;
    }

    setSharing(true);
    setStatusText("Requesting location permission");
    lastSentRef.current = null;
    lastSentAtRef.current = 0;
    pendingRef.current = null;
    setPath([]);

    watchRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (error) => {
        const message = locationErrorMessage(error);
        toast.error(message);
        setStatusText(message);
        if (error.code === error.PERMISSION_DENIED) stopSharing();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );

    toast.success("Location sharing started");
  }

  function stopSharing() {
    if (watchRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    pendingRef.current = null;
    setSharing(false);
    setStatusText("Stopped");
  }

  useEffect(() => {
    if (!sharing) return;

    const interval = window.setInterval(() => {
      const pending = pendingRef.current;
      if (pending && Date.now() - lastSentAtRef.current >= SEND_INTERVAL_MS) {
        pendingRef.current = null;
        void sendLocation(pending);
      }
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [sendLocation, sharing]);

  if (!mapsKey) return <MapsKeyPrompt onSaved={() => setMapsKeyState(getMapsKey())} />;

  return (
    <div className="container mx-auto grid gap-4 px-4 py-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Status</span>
              <Badge variant={sharing ? "default" : "secondary"}>
                {sharing ? "LIVE" : "STOPPED"}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Updates sent</span>
              <span className="font-mono">{updatesSent}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Path points</span>
              <span className="font-mono">{path.length}</span>
            </div>
            {lastPos && (
              <div className="rounded-md bg-muted p-2 text-xs">
                <div className="flex items-center gap-1 font-medium">
                  <Crosshair className="h-3 w-3" /> Last fix
                </div>
                <div className="font-mono mt-1">
                  {lastPos.lat.toFixed(5)}, {lastPos.lng.toFixed(5)}
                </div>
                {lastPos.accuracy !== null && (
                  <div className="mt-1">Accuracy: {Math.round(lastPos.accuracy)} m</div>
                )}
                <div className="text-muted-foreground mt-1">{lastPos.at.toLocaleTimeString()}</div>
              </div>
            )}
            {sharing ? (
              <Button variant="destructive" className="w-full" onClick={stopSharing}>
                <Square className="mr-2 h-4 w-4" /> Stop Sharing
              </Button>
            ) : (
              <Button className="w-full" onClick={startSharing}>
                <Play className="mr-2 h-4 w-4" /> Start Sharing
              </Button>
            )}
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {statusText}. Updates are sent every 5-10 seconds only after movement over 10
                meters.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="h-[70vh] overflow-hidden rounded-lg border">
        <APIProvider apiKey={mapsKey}>
          <GMap
            mapId="tracker"
            defaultCenter={lastPos ?? { lat: 37.7749, lng: -122.4194 }}
            center={lastPos ? { lat: lastPos.lat, lng: lastPos.lng } : undefined}
            defaultZoom={lastPos ? 15 : 3}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            <PathPolyline points={path} />
            {lastPos && (
              <AdvancedMarker position={{ lat: lastPos.lat, lng: lastPos.lng }}>
                <Pin background="hsl(var(--primary))" borderColor="white" glyphColor="white" />
              </AdvancedMarker>
            )}
          </GMap>
        </APIProvider>
      </div>
    </div>
  );
}
