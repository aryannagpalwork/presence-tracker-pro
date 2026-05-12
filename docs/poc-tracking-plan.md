# Presence Tracker POC Plan

## Supabase Tables

### profiles

Stores the human identity for each authenticated user.

- `id uuid primary key` - same as `auth.users.id`
- `name text`
- `email text`
- `created_at timestamptz`
- `updated_at timestamptz`

### user_roles

Controls admin access.

- `id uuid primary key`
- `user_id uuid`
- `role app_role` - `admin` or `user`
- `created_at timestamptz`

### tracking_sessions

One row per start/stop tracking session.

- `id uuid primary key`
- `user_id uuid`
- `started_at timestamptz`
- `ended_at timestamptz`
- `start_latitude double precision`
- `start_longitude double precision`
- `start_accuracy double precision`
- `end_latitude double precision`
- `end_longitude double precision`
- `end_accuracy double precision`
- `status text` - `active` or `ended`
- `device_label text`
- `created_at timestamptz`

### locations

Many rows per tracking session. This is the full coordinate trail.

- `id uuid primary key`
- `user_id uuid`
- `session_id uuid`
- `latitude double precision`
- `longitude double precision`
- `accuracy double precision`
- `network_type text`
- `is_connected boolean`
- `is_internet_reachable boolean`
- `created_at timestamptz`

## POC Upgrade Ideas

- Add an admin session detail page with export to CSV.
- Add geofences and alerts when a user enters/leaves a zone.
- Add device labels so admins can name phones like `Driver 1`, `Warehouse Phone`, etc.
- Add battery level metadata to help explain missing updates.
- Add a last-heartbeat table for fast dashboard loading.
- Add retention rules so raw location points are deleted after a chosen period.
- Add audit logs for who viewed/exported location history.
