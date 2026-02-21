// ============================================================
// api/webhook-stripe.js — Obsługa płatności Stripe
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Mapowanie Stripe Price ID → plan ID
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_STARTER]:        'starter',
  [process.env.STRIPE_PRICE_MINI_DEVELOPER]: 'mini_developer',
  [process.env.STRIPE_PRICE_DEVELOPER]:      'developer',
  [process.env.STRIPE_PRICE_GIGA_DEVELOPER]: 'giga_developer',
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`Stripe event: ${event.type}`);

  switch (event.type) {

    // Nowa subskrypcja lub zmiana planu
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const priceId = sub.items.data[0]?.price.id;
      const plan = PRICE_TO_PLAN[priceId] || 'free';
      const customerId = sub.customer;

      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) break;

      const { error } = await supabase
        .from('users')
        .update({
          plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          plan_expires_at: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('email', customer.email);

      if (error) console.error('Supabase update error:', error);
      else console.log(`Plan zmieniony: ${customer.email} → ${plan}`);
      break;
    }

    // Anulowanie subskrypcji
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.deleted) break;

      await supabase
        .from('users')
        .update({
          plan: 'free',
          stripe_subscription_id: null,
          plan_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('email', customer.email);

      console.log(`Subskrypcja anulowana: ${customer.email} → free`);
      break;
    }

    // Udana płatność
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customer = await stripe.customers.retrieve(invoice.customer);
      if (customer.deleted) break;
      console.log(`Płatność udana: ${customer.email} — ${(invoice.amount_paid / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`);
      break;
    }

    // Nieudana płatność
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customer = await stripe.customers.retrieve(invoice.customer);
      if (customer.deleted) break;
      console.warn(`Nieudana płatność: ${customer.email}`);
      // Tu możesz wysłać e-mail z przypomnieniem przez np. Resend.com
      break;
    }

    // Zakończenie okresu próbnego
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.deleted) break;
      console.log(`Trial kończy się za 3 dni: ${customer.email}`);
      // Tu możesz wysłać email z przypomnieniem
      break;
    }
  }

  res.json({ received: true });
}
