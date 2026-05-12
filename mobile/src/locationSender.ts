import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Network from "expo-network";
import * as TaskManager from "expo-task-manager";

import { supabase } from "./supabase";

export const BACKGROUND_LOCATION_TASK = "presence-tracker-background-location";

export const SEND_INTERVAL_MS = 30_000;
const LAST_SENT_KEY = "presence_tracker_last_sent";
const SHARING_KEY = "presence_tracker_sharing";
const SESSION_ID_KEY = "presence_tracker_session_id";

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
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: Number.isFinite(location.coords.accuracy ?? NaN) ? location.coords.accuracy : null,
    createdAt: Date.now(),
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

async function getSessionId() {
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

export async function startTrackingSession(location?: Location.LocationObject) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { sessionId: null, error: userError?.message ?? "Not signed in" };
  }

  const point = location ? await toLocationPoint(location) : null;
  const { data, error } = await supabase
    .from("tracking_sessions")
    .insert({
      user_id: user.id,
      start_latitude: point?.latitude ?? null,
      start_longitude: point?.longitude ?? null,
      start_accuracy: point?.accuracy ?? null,
      status: "active",
      device_label: user.email ?? null,
    })
    .select("id")
    .single();

  if (error) return { sessionId: null, error: error.message };

  await clearLastSent();
  await setSessionId(data.id);
  return { sessionId: data.id as string, error: null };
}

export async function endTrackingSession(location?: Location.LocationObject) {
  const sessionId = await getSessionId();
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

  if (!options.force && !intervalElapsed)
    return { sent: false, message: "Waiting for 30 second interval" };

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { sent: false, message: "Not signed in", error: userError?.message };
  }

  const sessionId = await getSessionId();
  const { error } = await supabase.from("locations").insert({
    user_id: user.id,
    session_id: sessionId,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    network_type: point.networkType,
    is_connected: point.isConnected,
    is_internet_reachable: point.isInternetReachable,
  });

  if (error)
    return { sent: false, message: "Network or Supabase write failed", error: error.message };

  await setLastSent(point);
  return { sent: true, message: "Location sent", point };
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  if (!(await isSharingEnabled())) return;

  const locations =
    (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
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
