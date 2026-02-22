// ============================================================
// api/webhook-hotpay.js — Obsługa powiadomień HotPay
// ============================================================

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Ile dni dostaje użytkownik po płatności
const PLAN_DAYS = 30;

const PLAN_TOKENS = {
  starter:        500000,
  mini_developer: 1250000,
  developer:      3000000,
  giga_developer: 7000000,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    ID_ZAMOWIENIA,
    KWOTA,
    WALUTA,
    STATUS,
    HASH,
    SEKRET,
  } = req.body;

  // Weryfikacja HASH od HotPay
  const secret = process.env.HOTPAY_SECRET;
  const expectedHash = crypto
    .createHash('sha256')
    .update(`${secret};${KWOTA};${WALUTA};${ID_ZAMOWIENIA};${STATUS}`)
    .digest('hex');

  if (HASH !== expectedHash) {
    console.error('HotPay webhook: nieprawidłowy HASH!');
    return res.status(400).json({ error: 'Invalid HASH' });
  }

  // Sprawdź czy płatność zakończona sukcesem
  if (STATUS !== 'SUCCESS') {
    console.log(`HotPay: płatność ${ID_ZAMOWIENIA} — status: ${STATUS}`);
    await supabase.from('orders')
      .update({ status: STATUS.toLowerCase() })
      .eq('order_id', ID_ZAMOWIENIA);
    return res.json({ received: true });
  }

  // Pobierz zamówienie z bazy
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('order_id', ID_ZAMOWIENIA)
    .single();

  if (!order) {
    console.error(`HotPay: nie znaleziono zamówienia ${ID_ZAMOWIENIA}`);
    return res.status(404).json({ error: 'Order not found' });
  }

  // Ustaw plan użytkownika — 30 dni od teraz
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PLAN_DAYS);

  await supabase
    .from('users')
    .update({
      plan: order.plan,
      plan_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.user_id);

  // Zaktualizuj status zamówienia
  await supabase
    .from('orders')
    .update({ status: 'success' })
    .eq('order_id', ID_ZAMOWIENIA);

  console.log(`HotPay: plan ${order.plan} aktywowany dla ${order.email} do ${expiresAt.toLocaleDateString('pl-PL')}`);

  res.json({ received: true });
}
