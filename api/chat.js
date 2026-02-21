// ============================================================
// api/chat.js — Vercel Serverless Function
// Proxy do AI API z systemem limitów tokenów
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Plany i limity ----
const PLANS = {
  free:            { tokensPerDay: 100000,   label: 'Free',            price: '0 zł',    color: '#6b7280' },
  starter:         { tokensPerDay: 500000,   label: 'Starter',         price: '40 zł',   color: '#7c5aff' },
  mini_developer:  { tokensPerDay: 1250000,  label: 'Mini Developer',  price: '80 zł',   color: '#3b82f6' },
  developer:       { tokensPerDay: 3000000,  label: 'Developer',       price: '160 zł',  color: '#10b981' },
  giga_developer:  { tokensPerDay: 7000000,  label: 'Giga Developer',  price: '350 zł',  color: '#f59e0b' },
};

// ---- Helper: pobierz użytkownika i jego zużycie ----
async function getUserUsage(userId) {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('users')
    .select('plan, tokens_used_today, usage_reset_date')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  // Reset licznika jeśli minęła doba
  if (data.usage_reset_date !== today) {
    await supabase
      .from('users')
      .update({ tokens_used_today: 0, usage_reset_date: today })
      .eq('id', userId);
    data.tokens_used_today = 0;
    data.usage_reset_date = today;
  }

  return data;
}

// ---- Helper: zaktualizuj zużycie tokenów ----
async function updateTokenUsage(userId, tokensUsed) {
  await supabase.rpc('increment_tokens', {
    user_id: userId,
    amount: tokensUsed,
  });
}

// ---- Helper: wywołaj Anthropic API ----
async function callAnthropic(messages, system, model, maxTokens, temperature) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    messages,
  };
  if (system) body.system = system;

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}

// ---- Helper: wywołaj OpenAI API ----
async function callOpenAI(messages, system, model, maxTokens, temperature) {
  const oaiMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      messages: oaiMessages,
    }),
  });
}

// ---- Główny handler ----
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Autoryzacja — pobierz token JWT z nagłówka
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Brak autoryzacji. Zaloguj się.' });
  }
  const jwt = authHeader.split(' ')[1];

  // 2. Zweryfikuj token Supabase i pobierz userId
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return res.status(401).json({ error: 'Nieprawidłowy token. Zaloguj się ponownie.' });
  }

  // 3. Pobierz dane użytkownika i sprawdź limit
  const usage = await getUserUsage(user.id);
  if (!usage) {
    // Nowy użytkownik - utwórz rekord
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('users').insert({
      id: user.id, email: user.email,
      plan: 'free', tokens_used_today: 0, usage_reset_date: today,
    });
    usage = { plan: 'free', tokens_used_today: 0 };
  }

  const plan = PLANS[usage.plan] || PLANS.free;
  const tokensLeft = plan.tokensPerDay - usage.tokens_used_today;

  if (usage.tokens_used_today >= plan.tokensPerDay) {
    return res.status(429).json({
      error: 'limit_exceeded',
      message: `Przekroczyłeś dzienny limit ${plan.tokensPerDay.toLocaleString('pl-PL')} tokenów dla planu ${plan.label}. Limit resetuje się o północy.`,
      plan: usage.plan,
      planLabel: plan.label,
      tokensUsedToday: usage.tokens_used_today,
      tokensLimit: plan.tokensPerDay,
      tokensLeft: 0,
      upgradeUrl: '/pricing',
    });
  }

  // 4. Parsuj body zapytania
  const { provider, model, messages, system, maxTokens = 2048, temperature = 0.7 } = req.body;

  if (!provider || !model || !messages?.length) {
    return res.status(400).json({ error: 'Brakujące parametry: provider, model, messages.' });
  }

  // 5. Wywołaj AI API (streaming)
  let aiResponse;
  try {
    if (provider === 'openai') {
      aiResponse = await callOpenAI(messages, system, model, maxTokens, temperature);
    } else {
      aiResponse = await callAnthropic(messages, system, model, maxTokens, temperature);
    }
  } catch (err) {
    return res.status(502).json({ error: 'Błąd połączenia z AI API: ' + err.message });
  }

  if (!aiResponse.ok) {
    const errData = await aiResponse.json();
    return res.status(aiResponse.status).json({
      error: errData.error?.message || 'Błąd AI API',
    });
  }

  // 6. Streamuj odpowiedź do klienta i zliczaj tokeny
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Plan', usage.plan);
  res.setHeader('X-Plan-Label', plan.label);
  res.setHeader('X-Tokens-Used', usage.tokens_used_today);
  res.setHeader('X-Tokens-Limit', plan.tokensPerDay);
  res.setHeader('X-Tokens-Left', tokensLeft);

  const reader = aiResponse.body.getReader();
  const decoder = new TextDecoder();
  let totalTokensUsed = 0;
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          // Dokładne liczenie z Anthropic usage
          if (parsed.usage?.output_tokens) {
            totalTokensUsed = (parsed.usage.input_tokens || 0) + parsed.usage.output_tokens;
          }
          // Dokładne liczenie z OpenAI usage
          if (parsed.usage?.total_tokens) {
            totalTokensUsed = parsed.usage.total_tokens;
          }
          // Przybliżone liczenie z chunków (gdy usage nie ma w streamie)
          const chunk = parsed.delta?.text || parsed.choices?.[0]?.delta?.content || '';
          if (chunk && totalTokensUsed === 0) {
            totalTokensUsed += Math.ceil(chunk.length / 4);
          }
        } catch {}

        res.write(line + '\n');
      }
    }
  } finally {
    if (totalTokensUsed > 0) {
      await updateTokenUsage(user.id, totalTokensUsed);
    }
    // Wyślij meta-event z podsumowaniem
    res.write(`data: ${JSON.stringify({
      type: 'usage_update',
      tokensUsed: totalTokensUsed,
      tokensUsedToday: usage.tokens_used_today + totalTokensUsed,
      tokensLimit: plan.tokensPerDay,
      tokensLeft: Math.max(0, tokensLeft - totalTokensUsed),
    })}\n\n`);
    res.end();
  }
}
