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
