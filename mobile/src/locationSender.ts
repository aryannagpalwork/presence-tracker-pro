import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Network from "expo-network";
import * as TaskManager from "expo-task-manager";

import { supabase } from "./supabase";

export const BACKGROUND_LOCATION_TASK = "presence-tracker-background-location";

export const SEND_INTERVAL_MS = 30_000;
const MAX_LOCATION_AGE_MS = 2 * SEND_INTERVAL_MS;
const LAST_SENT_KEY = "presence_tracker_last_sent";
const SHARING_KEY = "presence_tracker_sharing";
const SESSION_ID_KEY = "presence_tracker_session_id";
const DEVICE_ID_KEY = "presence_tracker_device_id";

export type LocationPoint = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  createdAt: number;
  networkType: string | null;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

type SendResult =
  | { sent: true; message: string; point: LocationPoint }
  | { sent: false; message: string; error?: string };

async function getNetworkSnapshot() {
  try {
    const network = await Network.getNetworkStateAsync();
    return {
      networkType: network.type ?? null,
      isConnected: network.isConnected ?? null,
      isInternetReachable: network.isInternetReachable ?? null,
    };
  } catch {
    return {
      networkType: null,
      isConnected: null,
      isInternetReachable: null,
    };
  }
}

async function toLocationPoint(location: Location.LocationObject): Promise<LocationPoint> {
  const network = await getNetworkSnapshot();
  const capturedAt = Number.isFinite(location.timestamp) ? location.timestamp : Date.now();
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: Number.isFinite(location.coords.accuracy ?? NaN) ? location.coords.accuracy : null,
    createdAt: capturedAt,
    ...network,
  };
}

async function getLastSent() {
  const raw = await AsyncStorage.getItem(LAST_SENT_KEY);
  return raw ? (JSON.parse(raw) as LocationPoint) : null;
}

async function setLastSent(point: LocationPoint) {
  await AsyncStorage.setItem(LAST_SENT_KEY, JSON.stringify(point));
}

async function clearLastSent() {
  await AsyncStorage.removeItem(LAST_SENT_KEY);
}

export async function getStoredSessionId() {
  return AsyncStorage.getItem(SESSION_ID_KEY);
}

async function setSessionId(sessionId: string) {
  await AsyncStorage.setItem(SESSION_ID_KEY, sessionId);
}

async function clearSessionId() {
  await AsyncStorage.removeItem(SESSION_ID_KEY);
}

export async function setSharingEnabled(value: boolean) {
  await AsyncStorage.setItem(SHARING_KEY, value ? "true" : "false");
}

export async function isSharingEnabled() {
  return (await AsyncStorage.getItem(SHARING_KEY)) === "true";
}

function makeStableId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function getDeviceId() {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;

  const deviceId = makeStableId("device");
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export async function restoreTrackingState() {
  const [sharingEnabled, sessionId] = await Promise.all([isSharingEnabled(), getStoredSessionId()]);
  return { sharingEnabled, sessionId };
}

export async function resumeTrackingSession(location?: Location.LocationObject) {
  const sessionId = await getStoredSessionId();
  if (!sessionId) return { sessionId: null, error: "No saved session" };

  const point = location ? await toLocationPoint(location) : null;
  const payload = {
    status: "active",
    ended_at: null,
  };
  console.log("Restoring tracking session:", { sessionId, payload });

  const { error } = await supabase.from("tracking_sessions").update(payload).eq("id", sessionId);
  if (error) return { sessionId: null, error: error.message };

  return { sessionId, error: null };
}

export async function startTrackingSession(location?: Location.LocationObject) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { sessionId: null, error: userError?.message ?? "Not signed in" };
  }

  const existingSessionId = await getStoredSessionId();
  if (existingSessionId && (await isSharingEnabled())) {
    return resumeTrackingSession(location);
  }

  const point = location ? await toLocationPoint(location) : null;
  const deviceId = await getDeviceId();
  if (point) console.log("GPS location fetched:", point);
  const payload = {
    user_id: user.id,
    start_latitude: point?.latitude ?? null,
    start_longitude: point?.longitude ?? null,
    start_accuracy: point?.accuracy ?? null,
    status: "active",
    device_label: user.email ?? deviceId,
  };
  console.log("Sending to Supabase:", payload);
  const { data, error } = await supabase
    .from("tracking_sessions")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { sessionId: null, error: error.message };

  await clearLastSent();
  await setSessionId(data.id);
  return { sessionId: data.id as string, error: null };
}

export async function endTrackingSession(location?: Location.LocationObject) {
  const sessionId = await getStoredSessionId();
  if (!sessionId) return;

  const point = location ? await toLocationPoint(location) : null;
  await supabase
    .from("tracking_sessions")
    .update({
      ended_at: new Date().toISOString(),
      end_latitude: point?.latitude ?? null,
      end_longitude: point?.longitude ?? null,
      end_accuracy: point?.accuracy ?? null,
      status: "ended",
    })
    .eq("id", sessionId);

  await clearSessionId();
  await clearLastSent();
}

export async function sendLocationIfNeeded(
  location: Location.LocationObject,
  options: { force?: boolean } = {},
): Promise<SendResult> {
  const point = await toLocationPoint(location);
  const lastSent = await getLastSent();
  const intervalElapsed = !lastSent || point.createdAt - lastSent.createdAt >= SEND_INTERVAL_MS;
  const locationAge = Date.now() - point.createdAt;

  if (locationAge > MAX_LOCATION_AGE_MS) {
    console.log("Ignoring stale coordinates:", point.latitude, point.longitude, {
      capturedAt: new Date(point.createdAt).toISOString(),
      ageMs: locationAge,
    });
    return { sent: false, message: "Ignoring stale GPS fix" };
  }

  if (lastSent && point.createdAt <= lastSent.createdAt) {
    console.log("Ignoring stale coordinates:", point.latitude, point.longitude, {
      capturedAt: new Date(point.createdAt).toISOString(),
      lastSentAt: new Date(lastSent.createdAt).toISOString(),
    });
    return { sent: false, message: "Ignoring stale location timestamp" };
  }

  if (!options.force && !intervalElapsed)
    return { sent: false, message: "Waiting for 30 second interval" };

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { sent: false, message: "Not signed in", error: userError?.message };
  }

  const sessionId = await getStoredSessionId();
  console.log("GPS location fetched:", point);
  const payload = {
    user_id: user.id,
    session_id: sessionId,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    network_type: point.networkType,
    is_connected: point.isConnected,
    is_internet_reachable: point.isInternetReachable,
  };
  console.log("Sending to Supabase:", payload);
  const { error } = await supabase.from("locations").insert(payload);

  if (error)
    return { sent: false, message: "Network or Supabase write failed", error: error.message };

  if (sessionId) {
    await supabase
      .from("tracking_sessions")
      .update({
        status: "active",
      })
      .eq("id", sessionId);
  }

  await setLastSent(point);
  return { sent: true, message: "Location sent", point };
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.log("Background location task error:", error);
    return;
  }
  if (!(await isSharingEnabled())) return;

  const locations =
    (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  console.log("Background location task received:", locations.length);
  for (const location of locations) {
    await sendLocationIfNeeded(location);
  }
});

export async function startBackgroundLocation() {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: SEND_INTERVAL_MS,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Presence Tracker is live",
      notificationBody: "Sharing your location with the dashboard.",
      notificationColor: "#2563eb",
    },
  });
}

export async function stopBackgroundLocation() {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
