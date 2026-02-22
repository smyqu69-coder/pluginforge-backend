// ============================================================
// api/create-checkout.js — Płatności HotPay
// ============================================================

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Plany i ceny ----
const PLANS = {
  starter:        { price: '40.00', label: 'Starter — 500k tokenów/dzień' },
  mini_developer: { price: '80.00', label: 'Mini Developer — 1.25M tokenów/dzień' },
  developer:      { price: '160.00', label: 'Developer — 3M tokenów/dzień' },
  giga_developer: { price: '350.00', label: 'Giga Developer — 7M tokenów/dzień' },
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
  const planData = PLANS[plan];
  if (!planData) {
    return res.status(400).json({ error: `Nieprawidłowy plan: ${plan}` });
  }

  // Unikalny identyfikator zamówienia
  const orderId = `${user.id.slice(0, 8)}-${plan}-${Date.now()}`;

  // HotPay wymaga HASH — generujemy go z SECRET
  const secret = process.env.HOTPAY_SECRET;
  const amount = planData.price;
  const currency = 'PLN';
  const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}?payment=success&plan=${plan}`;
  const failureUrl = `${process.env.NEXT_PUBLIC_APP_URL}?payment=failed`;
  const notificationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook-hotpay`;

  // Generowanie HASH dla HotPay
  // Format: SECRET;KWOTA;WALUTA;ID_ZAMOWIENIA;URL_POWROTU_OK;URL_POWROTU_BLAD;URL_NOTYFIKACJI
  const hashString = `${secret};${amount};${currency};${orderId};${successUrl};${failureUrl};${notificationUrl}`;
  const hash = crypto.createHash('sha256').update(hashString).digest('hex');

  // Zapisz zamówienie w Supabase (żeby webhook wiedział co robić)
  await supabase.from('orders').insert({
    order_id: orderId,
    user_id: user.id,
    email: user.email,
    plan,
    amount,
    status: 'pending',
    created_at: new Date().toISOString(),
  }).select();

  // Zwróć dane do frontendu — frontend przekieruje do HotPay
  const hotpayUrl = `https://hotpay.pl/pay`;
  const params = new URLSearchParams({
    SEKRET: secret,
    KWOTA: amount,
    WALUTA: currency,
    ID_ZAMOWIENIA: orderId,
    ADRES_WWW: successUrl,
    ADRES_WWW_BLAD: failureUrl,
    ADRES_NOTYFIKACJA: notificationUrl,
    NAZWA_USLUGI: planData.label,
    EMAIL: user.email,
    HASH: hash,
  });

  res.json({
    url: `${hotpayUrl}?${params.toString()}`,
    orderId,
  });
}
