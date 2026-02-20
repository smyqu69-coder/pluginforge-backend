-- ============================================================
-- SUPABASE SQL SCHEMA v2
-- Obsługa: Email/hasło + Google + GitHub
-- Plany: Free, Starter, Mini Developer, Developer, Giga Developer
-- Wklej do: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- 1. Tabela użytkowników
CREATE TABLE IF NOT EXISTS public.users (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL,
  display_name            TEXT,
  avatar_url              TEXT,

  -- Plan
  plan                    TEXT NOT NULL DEFAULT 'free'
                          CHECK (plan IN ('free','starter','mini_developer','developer','giga_developer')),

  -- Zużycie tokenów
  tokens_used_today       BIGINT NOT NULL DEFAULT 0,
  tokens_used_total       BIGINT NOT NULL DEFAULT 0,
  usage_reset_date        DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Stripe
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  plan_expires_at         TIMESTAMPTZ,

  -- Meta
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indeksy
CREATE INDEX IF NOT EXISTS idx_users_email            ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer  ON public.users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_plan             ON public.users(plan);

-- 3. Trigger: automatycznie twórz rekord przy rejestracji
--    Obsługuje Email, Google i GitHub (wszystkie przez auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    display_name,
    avatar_url,
    plan,
    tokens_used_today,
    usage_reset_date
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email', ''),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'user_name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    'free',
    0,
    CURRENT_DATE
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    display_name = COALESCE(EXCLUDED.display_name, public.users.display_name),
    avatar_url   = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    updated_at   = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Trigger: update updated_at automatycznie
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON public.users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Funkcja atomowego inkrementowania tokenów (bezpieczna przy równoległych requestach)
CREATE OR REPLACE FUNCTION public.increment_tokens(user_id UUID, amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users
  SET
    tokens_used_today = tokens_used_today + amount,
    tokens_used_total = tokens_used_total + amount,
    updated_at        = NOW()
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RLS (Row Level Security)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Użytkownik widzi tylko swój rekord
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Użytkownik może aktualizować tylko swoje dane (nie plan i nie tokeny!)
CREATE POLICY "users_update_own_safe"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    plan = (SELECT plan FROM public.users WHERE id = auth.uid()) AND
    tokens_used_today = (SELECT tokens_used_today FROM public.users WHERE id = auth.uid())
  );

-- Service role (backend) ma pełny dostęp, nie jest ograniczany przez RLS

-- ============================================================
-- GOTOWE!
-- Sprawdź w Table Editor → public → users
-- ============================================================
