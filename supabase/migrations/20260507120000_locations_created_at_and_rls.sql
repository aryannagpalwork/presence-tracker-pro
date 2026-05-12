DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'timestamp'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.locations RENAME COLUMN timestamp TO created_at;
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated view locations" ON public.locations;
DROP POLICY IF EXISTS "Users view own locations" ON public.locations;

CREATE POLICY "Users view own locations"
  ON public.locations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_locations_user_created_at
  ON public.locations (user_id, created_at DESC);

CREATE OR REPLACE VIEW public.latest_locations
WITH (security_invoker = true) AS
SELECT DISTINCT ON (user_id)
  id,
  user_id,
  latitude,
  longitude,
  accuracy,
  created_at
FROM public.locations
ORDER BY user_id, created_at DESC;
