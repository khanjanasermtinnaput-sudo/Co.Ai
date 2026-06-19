-- ── Coagentix Referral System ─────────────────────────────────────────────────
-- Tracks referral codes, conversions, and rewards.
-- Each user gets one referral code; they can refer unlimited invitees.
-- Rewards are tracked separately so billing can grant plan upgrades.

-- Table: referral_codes
-- One code per user. Created on-demand when the user first visits their
-- referral link or requests it from the API.
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code          text         NOT NULL UNIQUE,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  -- Soft usage stats (cache; source of truth is referral_conversions)
  total_clicks  integer      NOT NULL DEFAULT 0,
  total_signups integer      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS referral_codes_owner_idx  ON public.referral_codes (owner_id);
CREATE INDEX IF NOT EXISTS referral_codes_code_idx   ON public.referral_codes (code);

-- Table: referral_conversions
-- One row per completed signup that used a referral code.
CREATE TABLE IF NOT EXISTS public.referral_conversions (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code  text         NOT NULL REFERENCES public.referral_codes(code) ON DELETE CASCADE,
  referrer_id    uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id     uuid         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  converted_at   timestamptz  NOT NULL DEFAULT now(),
  -- reward_granted: true once the referrer has received their plan-upgrade credit
  reward_granted boolean      NOT NULL DEFAULT false,
  reward_at      timestamptz
);

CREATE INDEX IF NOT EXISTS referral_conversions_referrer_idx ON public.referral_conversions (referrer_id);
CREATE INDEX IF NOT EXISTS referral_conversions_code_idx     ON public.referral_conversions (referral_code);

-- Table: referral_clicks
-- Lightweight click-tracking (one row per anonymous click, pruned after 90 days).
CREATE TABLE IF NOT EXISTS public.referral_clicks (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code text         NOT NULL,
  clicked_at    timestamptz  NOT NULL DEFAULT now(),
  -- Hashed IP for dedup — never store the raw IP
  ip_hash       text,
  user_agent    text
);

CREATE INDEX IF NOT EXISTS referral_clicks_code_idx ON public.referral_clicks (referral_code);
CREATE INDEX IF NOT EXISTS referral_clicks_at_idx   ON public.referral_clicks (clicked_at);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.referral_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_conversions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_clicks       ENABLE ROW LEVEL SECURITY;

-- referral_codes: users see only their own code; service role can see all
CREATE POLICY "owner_select_code"   ON public.referral_codes
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "owner_insert_code"   ON public.referral_codes
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- referral_conversions: referrer sees their own conversions
CREATE POLICY "referrer_select_conv" ON public.referral_conversions
  FOR SELECT USING (auth.uid() = referrer_id);

-- referral_clicks: no direct user access — only service role
-- (no policy = service-role only via anon key restriction)

-- ── Stored procedure: increment click counter ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_referral_click(
  p_code      text,
  p_ip_hash   text DEFAULT NULL,
  p_ua        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.referral_clicks (referral_code, ip_hash, user_agent)
  VALUES (p_code, p_ip_hash, p_ua);

  UPDATE public.referral_codes
  SET total_clicks = total_clicks + 1
  WHERE code = p_code;
END;
$$;

-- ── Stored procedure: record a conversion ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_referral_conversion(
  p_code      text,
  p_invitee   uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_referrer uuid;
BEGIN
  SELECT owner_id INTO v_referrer
  FROM public.referral_codes WHERE code = p_code;

  IF v_referrer IS NULL THEN RETURN; END IF;
  -- Prevent self-referral
  IF v_referrer = p_invitee THEN RETURN; END IF;

  INSERT INTO public.referral_conversions (referral_code, referrer_id, invitee_id)
  VALUES (p_code, v_referrer, p_invitee)
  ON CONFLICT (invitee_id) DO NOTHING;

  UPDATE public.referral_codes
  SET total_signups = total_signups + 1
  WHERE code = p_code;
END;
$$;
