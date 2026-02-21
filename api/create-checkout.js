// ============================================================
// api/create-checkout.js — Tworzenie sesji płatności Stripe
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Mapowanie plan ID → Stripe Price ID (z .env)
const PRICE_IDS = {
  starter:        process.env.STRIPE_PRICE_STARTER,        // 40 zł/mies
  mini_developer: process.env.STRIPE_PRICE_MINI_DEVELOPER,  // 80 zł/mies
  developer:      process.env.STRIPE_PRICE_DEVELOPER,       // 160 zł/mies
  giga_developer: process.env.STRIPE_PRICE_GIGA_DEVELOPER,  // 350 zł/mies
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Autoryzacja
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Brak autoryzacji' });
  }
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.split(' ')[1]);
  if (error || !user) return res.status(401).json({ error: 'Nieprawidłowy token' });

  const { plan } = req.body;
  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return res.status(400).json({ error: `Nieprawidłowy plan: "${plan}". Dostępne: ${Object.keys(PRICE_IDS).join(', ')}` });
  }

  // Sprawdź czy użytkownik ma już Stripe Customer ID
  const { data: userData } = await supabase
    .from('users')
    .select('stripe_customer_id, stripe_subscription_id, plan')
    .eq('id', user.id)
    .single();

  let customerId = userData?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  // Jeśli użytkownik ma już aktywną subskrypcję → portal zarządzania
  if (userData?.stripe_subscription_id) {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}?portal=returned`,
    });
    return res.json({ url: portalSession.url, type: 'portal' });
  }

  // Utwórz nową sesję checkout
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card', 'p24', 'blik'],   // BLIK + Przelewy24 + karta
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}?payment=success&plan=${plan}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}?payment=cancelled`,
    locale: 'pl',
    allow_promotion_codes: true,   // obsługa kodów rabatowych
    metadata: { userId: user.id, plan },
    subscription_data: {
      metadata: { userId: user.id, plan },
      trial_period_days: plan === 'starter' ? 7 : 0,  // 7 dni trial dla Starter
    },
  });

  res.json({ url: session.url, type: 'checkout' });
}
