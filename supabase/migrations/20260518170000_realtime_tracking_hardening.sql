ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS connection_type TEXT,
  ADD COLUMN IF NOT EXISTS battery_level DOUBLE PRECISION;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS connection_type TEXT,
  ADD COLUMN IF NOT EXISTS battery_level DOUBLE PRECISION;

UPDATE public.tracking_sessions
SET
  is_active = status = 'active' AND ended_at IS NULL,
  last_seen = COALESCE(ended_at, started_at, created_at, now())
WHERE last_seen IS NULL OR is_active IS NULL;

UPDATE public.locations
SET connection_type = COALESCE(connection_type, network_type)
WHERE connection_type IS NULL AND network_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_locations_session_created_desc
  ON public.locations (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_locations_device_created_desc
  ON public.locations (device_id, created_at DESC)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_locations_created_at_desc
  ON public.locations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_active_last_seen
  ON public.tracking_sessions (is_active, last_seen DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_device_active
  ON public.tracking_sessions (device_id, is_active, last_seen DESC)
  WHERE device_id IS NOT NULL;

CREATE OR REPLACE VIEW public.latest_session_locations
WITH (security_invoker = true) AS
SELECT DISTINCT ON (COALESCE(session_id::text, device_id, user_id::text))
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
  created_at
FROM public.locations
ORDER BY COALESCE(session_id::text, device_id, user_id::text), created_at DESC;

DROP POLICY IF EXISTS "Users view own locations" ON public.locations;

CREATE POLICY "Users view own locations"
  ON public.locations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users insert own location" ON public.locations;

CREATE POLICY "Users insert own location"
  ON public.locations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER TABLE public.tracking_sessions REPLICA IDENTITY FULL;

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
END $$;
