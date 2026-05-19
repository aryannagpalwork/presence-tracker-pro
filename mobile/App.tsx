import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import type { Session } from "@supabase/supabase-js";

import {
  endTrackingSession,
  SEND_INTERVAL_MS,
  setSharingEnabled,
  sendLocationIfNeeded,
  restoreTrackingState,
  resumeTrackingSession,
  startTrackingSession,
  startBackgroundLocation,
  stopBackgroundLocation,
  type LocationPoint,
} from "./src/locationSender";
import { supabase } from "./src/supabase";

const FRESH_LOCATION_OPTIONS = {
  accuracy: Location.Accuracy.High,
  maximumAge: 0,
} as Location.LocationOptions & { maximumAge: 0 };

function locationErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unable to access GPS location.";
}

export default function App() {
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const foregroundPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("STOPPED");
  const [lastPoint, setLastPoint] = useState<LocationPoint | null>(null);
  const [updatesSent, setUpdatesSent] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      watchRef.current?.remove();
      if (foregroundPollRef.current) clearInterval(foregroundPollRef.current);
    };
  }, []);

  const sendFreshLocation = useCallback(async (options: { force?: boolean } = {}) => {
    const location = await Location.getCurrentPositionAsync(FRESH_LOCATION_OPTIONS);
    console.log("GPS location fetched:", {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
      timestamp: location.timestamp,
    });
    const result = await sendLocationIfNeeded(location, options);

    if (result.sent) {
      setLastPoint(result.point);
      setUpdatesSent((count) => count + 1);
    }

    setStatus(result.sent ? "LIVE" : result.message);
    if (!result.sent && result.error) Alert.alert("Location send failed", result.error);

    return { location, result };
  }, []);

  const startForegroundTracking = useCallback(async () => {
    watchRef.current?.remove();
    if (foregroundPollRef.current) clearInterval(foregroundPollRef.current);

    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: SEND_INTERVAL_MS,
        distanceInterval: 0,
      },
      async (location) => {
        console.log("GPS location fetched:", {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          timestamp: location.timestamp,
        });
        const point = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: Number.isFinite(location.coords.accuracy ?? NaN)
            ? location.coords.accuracy
            : null,
          createdAt: Date.now(),
          networkType: null,
          isConnected: null,
          isInternetReachable: null,
        };
        setLastPoint(point);

        const result = await sendLocationIfNeeded(location);
        setStatus(result.sent ? "LIVE" : result.message);
        if (result.sent) setUpdatesSent((count) => count + 1);
        if (!result.sent && result.error) Alert.alert("Location send failed", result.error);
      },
    );

    foregroundPollRef.current = setInterval(() => {
      void sendFreshLocation();
    }, SEND_INTERVAL_MS);
  }, [sendFreshLocation]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    restoreTrackingState().then(async ({ sharingEnabled, sessionId: storedSessionId }) => {
      if (cancelled) return;
      setSessionId(storedSessionId);

      if (!sharingEnabled || !storedSessionId) return;

      setSharing(true);
      setStatus("Restoring live tracking");
      try {
        const location = await Location.getCurrentPositionAsync(FRESH_LOCATION_OPTIONS);
        console.log("GPS location fetched:", {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
        });
        const restored = await resumeTrackingSession(location);
        if (!restored.sessionId) {
          setStatus("Session restore failed");
          Alert.alert("Tracking restore failed", restored.error ?? "Could not restore session.");
          return;
        }

        setSessionId(restored.sessionId);
        await sendFreshLocation({ force: true });
        await startForegroundTracking();
        setStatus("LIVE");
      } catch (error) {
        setStatus("Restore failed");
        Alert.alert("Tracking restore failed", locationErrorMessage(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sendFreshLocation, session, startForegroundTracking]);

  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);

    if (error) Alert.alert("Sign in failed", error.message);
  }

  async function signUp() {
    const trimmedEmail = email.trim();
    const displayName = name.trim() || trimmedEmail.split("@")[0] || "Tracked user";

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: { name: displayName },
      },
    });
    setBusy(false);

    if (error) {
      Alert.alert("Sign up failed", error.message);
      return;
    }

    if (!data.session) {
      Alert.alert(
        "Account created",
        "Check your email if Supabase asks for confirmation, then sign in.",
      );
      setAuthMode("signin");
      return;
    }

    Alert.alert("Account created", "You are signed in and ready to share when you choose.");
  }

  async function signOut() {
    await stopSharing();
    await supabase.auth.signOut();
  }

  async function startSharing() {
    setBusy(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        setStatus("Permission denied");
        Alert.alert("Permission denied", "Location permission is required before sharing.");
        return;
      }

      let backgroundGranted = false;
      try {
        const background = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = background.status === "granted";
      } catch {
        backgroundGranted = false;
      }

      if (!backgroundGranted) {
        Alert.alert(
          "Background tracking limited",
          "Foreground sharing will work, but the OS may pause tracking when the app is minimized.",
        );
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setStatus("GPS unavailable");
        Alert.alert("GPS unavailable", "Turn on location services and try again.");
        return;
      }

      await setSharingEnabled(true);
      const initialLocation = await Location.getCurrentPositionAsync(FRESH_LOCATION_OPTIONS);
      console.log("GPS location fetched:", {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        accuracy: initialLocation.coords.accuracy,
        timestamp: initialLocation.timestamp,
      });
      const session = await startTrackingSession(initialLocation);
      if (!session.sessionId) {
        await setSharingEnabled(false);
        setStatus("Session failed");
        Alert.alert("Tracking session failed", session.error ?? "Could not create session.");
        return;
      }
      setSessionId(session.sessionId);

      await sendFreshLocation({ force: true });

      if (backgroundGranted) await startBackgroundLocation();
      await startForegroundTracking();

      setSharing(true);
      setStatus("LIVE");
    } catch (error) {
      setStatus("Location error");
      Alert.alert("Location error", locationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    let finalLocation: Location.LocationObject | undefined;
    try {
      finalLocation = await Location.getCurrentPositionAsync(FRESH_LOCATION_OPTIONS);
      await sendLocationIfNeeded(finalLocation, { force: true });
    } catch {
      finalLocation = undefined;
    }

    watchRef.current?.remove();
    watchRef.current = null;
    if (foregroundPollRef.current) {
      clearInterval(foregroundPollRef.current);
      foregroundPollRef.current = null;
    }
    await setSharingEnabled(false);
    await stopBackgroundLocation();
    await endTrackingSession(finalLocation);
    setSharing(false);
    setSessionId(null);
    setStatus("STOPPED");
  }

  if (authLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading session...</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.authCard}
        >
          <Text style={styles.title}>Presence Tracker</Text>
          <Text style={styles.subtitle}>
            {authMode === "signin"
              ? "Sign in to send live location to Supabase."
              : "Create your tracker account. Sharing starts only when you tap Start."}
          </Text>
          {authMode === "signup" && (
            <TextInput
              autoCapitalize="words"
              onChangeText={setName}
              placeholder="Name"
              style={styles.input}
              value={name}
            />
          )}
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            style={styles.input}
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable
            disabled={busy}
            onPress={authMode === "signin" ? signIn : signUp}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              {busy
                ? authMode === "signin"
                  ? "Signing in..."
                  : "Creating..."
                : authMode === "signin"
                  ? "Sign In"
                  : "Create Account"}
            </Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => setAuthMode((mode) => (mode === "signin" ? "signup" : "signin"))}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              {authMode === "signin" ? "Create a new account" : "I already have an account"}
            </Text>
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Location Sender</Text>
          <Text style={styles.subtitle}>{session.user.email}</Text>
        </View>
        <Pressable onPress={signOut} style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Status</Text>
          <View style={[styles.badge, sharing ? styles.liveBadge : styles.stoppedBadge]}>
            <Text style={[styles.badgeText, sharing ? styles.liveText : styles.stoppedText]}>
              {sharing ? "LIVE" : "STOPPED"}
            </Text>
          </View>
        </View>
        <Text style={styles.statusText}>{status}</Text>

        <View style={styles.metricRow}>
          <Text style={styles.label}>Updates sent</Text>
          <Text style={styles.mono}>{updatesSent}</Text>
        </View>

        {sessionId && (
          <View style={styles.metricRow}>
            <Text style={styles.label}>Session</Text>
            <Text style={styles.mono}>{sessionId.slice(0, 8)}</Text>
          </View>
        )}

        {lastPoint ? (
          <View style={styles.coords}>
            <Text style={styles.label}>Last known coordinates</Text>
            <Text style={styles.mono}>
              {lastPoint.latitude.toFixed(6)}, {lastPoint.longitude.toFixed(6)}
            </Text>
            <Text style={styles.muted}>
              Accuracy:{" "}
              {lastPoint.accuracy === null ? "unknown" : `${Math.round(lastPoint.accuracy)} m`}
            </Text>
            {lastPoint.networkType && (
              <Text style={styles.muted}>
                Network: {lastPoint.networkType}
                {lastPoint.isInternetReachable === false ? " (offline)" : ""}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.muted}>No GPS fix yet.</Text>
        )}

        {sharing ? (
          <Pressable disabled={busy} onPress={stopSharing} style={styles.dangerButton}>
            <Text style={styles.primaryButtonText}>Stop Sharing</Text>
          </Pressable>
        ) : (
          <Pressable disabled={busy} onPress={startSharing} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{busy ? "Starting..." : "Start Sharing"}</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.footer}>
        Sends a start point, a point every 30 seconds while sharing, and an end point when stopped.
        Background tracking requires OS permission and a development or production build.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8fafc",
    padding: 20,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  authCard: {
    flex: 1,
    justifyContent: "center",
    gap: 14,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    color: "#0f172a",
    fontSize: 26,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 4,
  },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 16,
    borderWidth: 1,
    gap: 18,
    padding: 18,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricRow: {
    alignItems: "center",
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 16,
  },
  label: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
  },
  muted: {
    color: "#64748b",
    fontSize: 13,
  },
  mono: {
    color: "#0f172a",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 14,
  },
  statusText: {
    color: "#475569",
    fontSize: 14,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveBadge: {
    backgroundColor: "#dcfce7",
  },
  stoppedBadge: {
    backgroundColor: "#e2e8f0",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
  },
  liveText: {
    color: "#166534",
  },
  stoppedText: {
    color: "#475569",
  },
  coords: {
    gap: 6,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 14,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#dc2626",
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  linkButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  linkButtonText: {
    color: "#2563eb",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButtonText: {
    color: "#2563eb",
    fontSize: 14,
    fontWeight: "700",
  },
  footer: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 18,
  },
});
