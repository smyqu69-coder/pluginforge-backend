// ============================================================
// api/user.js — Endpoint do pobierania danych użytkownika
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const PLANS = {
  free:           { tokensPerDay: 100000,  label: 'Free',           price: '0 zł/mies',   color: '#6b7280', badge: '🆓' },
  starter:        { tokensPerDay: 500000,  label: 'Starter',        price: '40 zł/mies',  color: '#7c5aff', badge: '⚡' },
  mini_developer: { tokensPerDay: 1250000, label: 'Mini Developer', price: '80 zł/mies',  color: '#3b82f6', badge: '🔧' },
  developer:      { tokensPerDay: 3000000, label: 'Developer',      price: '160 zł/mies', color: '#10b981', badge: '💻' },
  giga_developer: { tokensPerDay: 7000000, label: 'Giga Developer', price: '350 zł/mies', color: '#f59e0b', badge: '🚀' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Brak autoryzacji' });
  }

  const { data: { user }, error } = await supabase.auth.getUser(authHeader.split(' ')[1]);
  if (error || !user) return res.status(401).json({ error: 'Nieprawidłowy token' });

  const today = new Date().toISOString().split('T')[0];

  let { data: userData } = await supabase
    .from('users')
    .select('plan, tokens_used_today, usage_reset_date, plan_expires_at, stripe_subscription_id')
    .eq('id', user.id)
    .single();

  // Nowy użytkownik — utwórz rekord
  if (!userData) {
    await supabase.from('users').insert({
      id: user.id,
      email: user.email,
      plan: 'free',
      tokens_used_today: 0,
      usage_reset_date: today,
    });
    userData = { plan: 'free', tokens_used_today: 0, usage_reset_date: today };
  }

  // Reset licznika jeśli nowy dzień
  if (userData.usage_reset_date !== today) {
    await supabase
      .from('users')
      .update({ tokens_used_today: 0, usage_reset_date: today })
      .eq('id', user.id);
    userData.tokens_used_today = 0;
  }

  const plan = PLANS[userData.plan] || PLANS.free;
  const tokensUsed = userData.tokens_used_today;
  const tokensLimit = plan.tokensPerDay;
  const tokensLeft = Math.max(0, tokensLimit - tokensUsed);
  const usagePercent = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));

  // Oblicz reset - następna północ
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const msToReset = midnight - now;
  const hoursToReset = Math.floor(msToReset / 3600000);
  const minutesToReset = Math.floor((msToReset % 3600000) / 60000);

  res.json({
    email: user.email,
    plan: userData.plan,
    planLabel: plan.label,
    planPrice: plan.price,
    planColor: plan.color,
    planBadge: plan.badge,
    hasSubscription: !!userData.stripe_subscription_id,
    planExpiresAt: userData.plan_expires_at,
    tokensUsedToday: tokensUsed,
    tokensLimit,
    tokensLeft,
    usagePercent,
    resetsIn: `${hoursToReset}h ${minutesToReset}min`,
    allPlans: Object.entries(PLANS).map(([key, p]) => ({
      id: key,
      label: p.label,
      price: p.price,
      tokensPerDay: p.tokensPerDay,
      color: p.color,
      badge: p.badge,
      isCurrent: key === userData.plan,
    })),
  });
}
