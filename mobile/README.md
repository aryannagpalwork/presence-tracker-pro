# Presence Tracker Mobile

Expo React Native app that signs in with Supabase and sends the authenticated user's location to the shared `locations` table.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

For this repo, use the same Supabase project as the web dashboard.

## Run

```bash
npm install
npm start
```

Use `npm run ios` or `npm run android` for a development build. Background location is limited in Expo Go and depends on OS permissions, battery settings, and platform policy.

## Build a Downloadable Android APK

This app has an EAS `preview` profile that produces an installable `.apk` for direct sharing outside the Play Store:

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

When EAS finishes, download the APK from the build link and host/share that file internally.

## Behavior

- Email/password Supabase auth with sign in and sign up.
- Explicit Start Sharing / Stop Sharing controls.
- Foreground tracking via `Location.watchPositionAsync`.
- Background tracking via `expo-task-manager` and `Location.startLocationUpdatesAsync`.
- Creates a `tracking_sessions` row when sharing starts.
- Writes a first coordinate immediately, then writes to `locations` every 30 seconds while sharing.
- Writes a final coordinate and closes the session when sharing stops.
- Stores `user_id`, `session_id`, `latitude`, `longitude`, `accuracy`, `network_type`, `is_connected`, and `is_internet_reachable`; `created_at` is filled by Supabase.
- Uses the OS high-accuracy location provider, which can combine GPS, Wi-Fi positioning, cellular, and sensor signals where the platform allows it.
