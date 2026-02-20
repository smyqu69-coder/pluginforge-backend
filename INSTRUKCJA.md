# PluginForge AI — Kompletna instrukcja wdrożenia
## Wersja z: Email/hasło + Google + GitHub + 5 planów + Stripe + BLIK

---

## Twoje plany cenowe

| Plan           | Tokeny/dzień | Cena/mies | Stripe trial |
|----------------|-------------|-----------|-------------|
| Free           | 100 000     | 0 zł      | —           |
| Starter        | 500 000     | 40 zł     | 7 dni free  |
| Mini Developer | 1 250 000   | 80 zł     | —           |
| Developer      | 3 000 000   | 160 zł    | —           |
| Giga Developer | 7 000 000   | 350 zł    | —           |

---

## KROK 1 — Supabase (baza danych + logowanie)

### 1.1 Utwórz projekt
1. Wejdź na **supabase.com** → Sign Up → New Project
2. Podaj nazwę projektu, hasło do bazy, region: **Central EU (Frankfurt)**
3. Poczekaj ~2 minuty na uruchomienie

### 1.2 Wgraj schemat bazy
1. Przejdź do **SQL Editor** (lewa boczna nawigacja)
2. Kliknij **New Query**
3. Wklej całą zawartość pliku `supabase-schema.sql`
4. Kliknij **Run** (lub Ctrl+Enter)
5. Sprawdź w **Table Editor** → powinna pojawić się tabela `users`

### 1.3 Włącz logowanie przez Google
1. Przejdź do **Authentication → Providers → Google**
2. Włącz toggle "Enable Google provider"
3. Wejdź na **console.cloud.google.com**
4. Utwórz projekt → **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
5. Application type: **Web application**
6. Authorized redirect URIs dodaj: `https://TWOJ_PROJEKT.supabase.co/auth/v1/callback`
7. Skopiuj **Client ID** i **Client Secret** → wklej w Supabase

### 1.4 Włącz logowanie przez GitHub
1. Przejdź do **Authentication → Providers → GitHub**
2. Wejdź na **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**
3. Homepage URL: `https://twojadomena.vercel.app`
4. Authorization callback URL: `https://TWOJ_PROJEKT.supabase.co/auth/v1/callback`
5. Skopiuj **Client ID** i **Client Secret** → wklej w Supabase

### 1.5 Skopiuj klucze API
Przejdź do **Settings → API**:
- `Project URL` → `SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_URL`
- `anon/public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_KEY` (**TAJNY — tylko na serwerze!**)

---

## KROK 2 — Stripe (płatności BLIK, Przelewy24, karta)

### 2.1 Utwórz konto i produkty
1. Wejdź na **stripe.com** → utwórz konto (wybierz Polska)
2. Przejdź do **Products → Add product** — utwórz **4 produkty**:

   **Produkt 1: Starter**
   - Name: `Starter`
   - Price: `40.00 PLN` — Recurring — Monthly
   - Skopiuj Price ID → `STRIPE_PRICE_STARTER`

   **Produkt 2: Mini Developer**
   - Name: `Mini Developer`
   - Price: `80.00 PLN` — Recurring — Monthly
   - Skopiuj Price ID → `STRIPE_PRICE_MINI_DEVELOPER`

   **Produkt 3: Developer**
   - Name: `Developer`
   - Price: `160.00 PLN` — Recurring — Monthly
   - Skopiuj Price ID → `STRIPE_PRICE_DEVELOPER`

   **Produkt 4: Giga Developer**
   - Name: `Giga Developer`
   - Price: `350.00 PLN` — Recurring — Monthly
   - Skopiuj Price ID → `STRIPE_PRICE_GIGA_DEVELOPER`

### 2.2 Włącz BLIK i Przelewy24
1. Przejdź do **Settings → Payment methods**
2. Włącz: **BLIK**, **Przelewy24**, **Cards**

### 2.3 Pobierz klucze
1. Przejdź do **Developers → API keys**
2. Skopiuj **Secret key** → `STRIPE_SECRET_KEY`

### 2.4 Ustaw Webhook (po deploy na Vercel)
1. Przejdź do **Developers → Webhooks → Add endpoint**
2. URL: `https://TWOJA_DOMENA.vercel.app/api/webhook-stripe`
3. Events — zaznacz wszystkie z listy:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Kliknij **Add endpoint** → skopiuj **Signing secret** → `STRIPE_WEBHOOK_SECRET`

---

## KROK 3 — Vercel (hosting, darmowy)

### 3.1 Deploy
1. Wrzuć pliki backendu na GitHub (utwórz nowe repo)
2. Wejdź na **vercel.com** → Log in with GitHub
3. Kliknij **Add New Project** → Import twoje repo
4. Framework Preset: **Other** (nie Next.js)
5. Kliknij **Deploy** (najpierw bez zmiennych środowiskowych)

### 3.2 Dodaj zmienne środowiskowe
1. W projekcie Vercel → **Settings → Environment Variables**
2. Dodaj wszystkie zmienne z `.env.example` (uzupełnione prawdziwymi wartościami)
3. Kliknij **Save** → **Redeploy** (Settings → Deployments → Redeploy)

### 3.3 Skopiuj URL
Skopiuj URL projektu np. `https://pluginforge-api.vercel.app`
Dodaj go jako `NEXT_PUBLIC_APP_URL` w zmiennych środowiskowych.

---

## KROK 4 — Aktualizacja frontendu (index.html)

Dodaj na początku `<head>`:
```html
<!-- Supabase SDK -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

Dodaj w sekcji JavaScript:
```js
// Konfiguracja Supabase (anon key — bezpieczny w przeglądarce)
const SUPABASE_URL  = 'https://TWOJ_PROJEKT.supabase.co';
const SUPABASE_ANON = 'eyJhbGci...'; // anon/public key
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Adres twojego backendu na Vercel
const BACKEND_URL = 'https://pluginforge-api.vercel.app';

// Zamiast bezpośredniego wywołania AI, używaj:
async function callAIStream(messages, system, maxTokens) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('Nie jesteś zalogowany');

  return fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      provider: CFG.provider,
      model: getActiveModel(),
      messages,
      system,
      maxTokens,
      temperature: CFG.temp,
    })
  });
}
```

---

## Struktura plików backendu

```
backend/
├── api/
│   ├── chat.js              ← Proxy AI + limit tokenów
│   ├── user.js              ← Info o koncie i zużyciu
│   ├── create-checkout.js   ← Stripe checkout/portal
│   └── webhook-stripe.js    ← Stripe events (zmiana planów)
├── supabase-schema.sql      ← Schemat bazy danych
├── .env.example             ← Zmienne środowiskowe (szablon)
├── package.json
└── vercel.json
```

---

## Jak działają limity dzienne

Limit resetuje się automatycznie każdego dnia o **północy (00:00)** czasu serwera.
Reset jest realizowany przez porównanie daty w bazie z datą dzisiejszą — przy pierwszym zapytaniu danego dnia licznik zeruje się.

Użytkownik otrzymuje komunikat gdy przekroczy limit:
```json
{
  "error": "limit_exceeded",
  "message": "Przekroczyłeś dzienny limit 100 000 tokenów dla planu Free.",
  "tokensLeft": 0,
  "resetsIn": "8h 23min"
}
```

---

## Testowanie lokalnie

```bash
# W folderze backend/
npm install
cp .env.example .env.local
# Uzupełnij .env.local

# Uruchom Vercel Dev
npx vercel dev
# Backend dostępny na: http://localhost:3000
```

### Testowanie Stripe webhooków lokalnie:
```bash
# Zainstaluj Stripe CLI
# https://stripe.com/docs/stripe-cli

stripe login
stripe listen --forward-to localhost:3000/api/webhook-stripe
# Skopiuj "webhook signing secret" → wklej do .env.local jako STRIPE_WEBHOOK_SECRET
```
