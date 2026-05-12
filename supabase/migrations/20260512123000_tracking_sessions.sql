CREATE TABLE IF NOT EXISTS public.tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  start_latitude DOUBLE PRECISION,
  start_longitude DOUBLE PRECISION,
  start_accuracy DOUBLE PRECISION,
  end_latitude DOUBLE PRECISION,
  end_longitude DOUBLE PRECISION,
  end_accuracy DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS network_type TEXT,
  ADD COLUMN IF NOT EXISTS is_connected BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_internet_reachable BOOLEAN;

ALTER TABLE public.locations
  ALTER COLUMN user_id DROP DEFAULT,
  ALTER COLUMN created_at SET DEFAULT now();

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;

CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_user_started
  ON public.tracking_sessions (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_status_started
  ON public.tracking_sessions (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_locations_session_created_at
  ON public.locations (session_id, created_at ASC);

ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own tracking sessions" ON public.tracking_sessions;
DROP POLICY IF EXISTS "Users view own tracking sessions" ON public.tracking_sessions;
DROP POLICY IF EXISTS "Users update own tracking sessions" ON public.tracking_sessions;

CREATE POLICY "Users insert own tracking sessions"
  ON public.tracking_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own tracking sessions"
  ON public.tracking_sessions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users update own tracking sessions"
  ON public.tracking_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.tracking_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tracking_sessions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
