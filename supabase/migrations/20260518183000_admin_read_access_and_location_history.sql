ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS connection_type TEXT,
  ADD COLUMN IF NOT EXISTS battery_level DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS connection_type TEXT,
  ADD COLUMN IF NOT EXISTS battery_level DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.location_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE SET NULL,
  device_id TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  network_type TEXT,
  connection_type TEXT,
  is_connected BOOLEAN,
  is_internet_reachable BOOLEAN,
  battery_level DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.location_history (
  id,
  user_id,
  session_id,
  device_id,
  latitude,
  longitude,
  accuracy,
  network_type,
  connection_type,
  is_connected,
  is_internet_reachable,
  battery_level,
  status,
  is_active,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  session_id,
  device_id,
  latitude,
  longitude,
  accuracy,
  network_type,
  COALESCE(connection_type, network_type),
  is_connected,
  is_internet_reachable,
  battery_level,
  status,
  is_active,
  created_at,
  updated_at
FROM public.locations
ON CONFLICT (id) DO UPDATE
SET
  session_id = EXCLUDED.session_id,
  device_id = EXCLUDED.device_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  accuracy = EXCLUDED.accuracy,
  network_type = EXCLUDED.network_type,
  connection_type = EXCLUDED.connection_type,
  is_connected = EXCLUDED.is_connected,
  is_internet_reachable = EXCLUDED.is_internet_reachable,
  battery_level = EXCLUDED.battery_level,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.set_tracking_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS locations_set_updated_at ON public.locations;
CREATE TRIGGER locations_set_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_tracking_updated_at();

DROP TRIGGER IF EXISTS tracking_sessions_set_updated_at ON public.tracking_sessions;
CREATE TRIGGER tracking_sessions_set_updated_at
  BEFORE UPDATE ON public.tracking_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_tracking_updated_at();

CREATE OR REPLACE FUNCTION public.sync_location_history_from_locations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.location_history (
    id,
    user_id,
    session_id,
    device_id,
    latitude,
    longitude,
    accuracy,
    network_type,
    connection_type,
    is_connected,
    is_internet_reachable,
    battery_level,
    status,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.user_id,
    NEW.session_id,
    NEW.device_id,
    NEW.latitude,
    NEW.longitude,
    NEW.accuracy,
    NEW.network_type,
    COALESCE(NEW.connection_type, NEW.network_type),
    NEW.is_connected,
    NEW.is_internet_reachable,
    NEW.battery_level,
    NEW.status,
    NEW.is_active,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE
  SET
    session_id = EXCLUDED.session_id,
    device_id = EXCLUDED.device_id,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    accuracy = EXCLUDED.accuracy,
    network_type = EXCLUDED.network_type,
    connection_type = EXCLUDED.connection_type,
    is_connected = EXCLUDED.is_connected,
    is_internet_reachable = EXCLUDED.is_internet_reachable,
    battery_level = EXCLUDED.battery_level,
    status = EXCLUDED.status,
    is_active = EXCLUDED.is_active,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS locations_sync_location_history ON public.locations;
CREATE TRIGGER locations_sync_location_history
  AFTER INSERT OR UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.sync_location_history_from_locations();

CREATE INDEX IF NOT EXISTS idx_location_history_session_created_desc
  ON public.location_history (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_location_history_device_created_desc
  ON public.location_history (device_id, created_at DESC)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_location_history_created_at_desc
  ON public.location_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_history_active_created_desc
  ON public.location_history (is_active, created_at DESC)
  WHERE is_active = true;

ALTER TABLE public.location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own locations" ON public.locations;
DROP POLICY IF EXISTS "Authenticated read locations" ON public.locations;
CREATE POLICY "Authenticated read locations"
  ON public.locations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users insert own location" ON public.locations;
CREATE POLICY "Users insert own location"
  ON public.locations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own locations" ON public.locations;
DROP POLICY IF EXISTS "Authenticated update locations" ON public.locations;
CREATE POLICY "Authenticated update locations"
  ON public.locations FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users view own tracking sessions" ON public.tracking_sessions;
DROP POLICY IF EXISTS "Authenticated read tracking sessions" ON public.tracking_sessions;
CREATE POLICY "Authenticated read tracking sessions"
  ON public.tracking_sessions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users insert own tracking sessions" ON public.tracking_sessions;
CREATE POLICY "Users insert own tracking sessions"
  ON public.tracking_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own tracking sessions" ON public.tracking_sessions;
DROP POLICY IF EXISTS "Authenticated update tracking sessions" ON public.tracking_sessions;
CREATE POLICY "Authenticated update tracking sessions"
  ON public.tracking_sessions FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read location history" ON public.location_history;
CREATE POLICY "Authenticated read location history"
  ON public.location_history FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated insert location history" ON public.location_history;
CREATE POLICY "Authenticated insert location history"
  ON public.location_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated update location history" ON public.location_history;
CREATE POLICY "Authenticated update location history"
  ON public.location_history FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER TABLE public.tracking_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.location_history REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.locations;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tracking_sessions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.location_history;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
