# PLAN.md — Aplicație de programări pentru frizerie (PWA)

> Document pentru Claude Code. Citește-l complet înainte de a scrie cod. Lucrează fază cu fază (secțiunea 10), fă commit la finalul fiecărei faze și oprește-te să raportezi ce ai făcut și ce ai verificat. Dacă ceva din plan e ambiguu sau lipsește o informație din secțiunea 12, întreabă, nu inventa.

## 1. Scop

O aplicație web instalabilă (PWA) prin care clienții unei frizerii își fac singuri programări, iar frizerul le gestionează dintr-un panou de administrare. Clientul nu are nevoie de cont și nu instalează nimic obligatoriu: deschide un link, alege serviciul și ora, lasă numele și telefonul, primește SMS de confirmare și, înainte de oră, un reminder.

Obiectiv principal: mai puține programări uitate (no-show) și mai puțin timp pierdut de frizer pe telefon.

**Public țintă:** un singur salon, un frizer în MVP (modelul de date trebuie să permită extinderea la mai mulți). Limba interfeței: **română**. Codul, numele de variabile, tabele și commit-urile: **engleză**.

## 2. Decizii tehnice (fixe, nu le schimba fără să întrebi)

| Zonă | Alegere |
|---|---|
| Client | React Native cu **Expo** (SDK curent stabil), **Expo Router**, **TypeScript** strict |
| Țintă | **Web** exportat ca PWA (`npx expo export --platform web`). Fără build-uri iOS/Android native în MVP |
| UI | Componente proprii simple cu `StyleSheet` sau o bibliotecă mică (ex. Tamagui sau NativeWind, alege una și rămâi la ea). Mobile-first, funcțional și pe desktop (panoul de admin) |
| Backend | **Supabase**: Postgres, Auth, Row Level Security, Edge Functions (Deno/TypeScript), Cron (pg_cron + pg_net) |
| SMS | Furnizor ascuns în spatele unei interfețe `SmsProvider` (`send(to, text)`). Implementare inițială cu **Twilio**; trebuie să fie ușor de înlocuit cu un furnizor local |
| Hosting web | **Vercel** sau Cloudflare Pages (static, cu rewrite SPA către `index.html`) |
| Teste | **Vitest** pentru logica pură (calcul sloturi), plus checklist manual de QA |
| Fus orar | `Europe/Bucharest` peste tot (salvat în `settings`), stocare în DB în `timestamptz` (UTC) |

## 3. Roluri

- **Client (anonim):** vede serviciile și orele libere, creează o programare, vede/anulează programarea printr-un link cu token secret. Nu are acces direct la tabele.
- **Admin (frizerul):** autentificat prin Supabase Auth (email + parolă, un singur cont în MVP). Acces complet prin RLS.

## 4. Funcționalități

### MVP
1. Pagina de start: numele salonului, adresă, telefon, buton „Programează-te", lista de servicii cu prețuri.
2. Flux de programare în pași: serviciu → zi → oră liberă → nume + telefon (+ bifă acord prelucrare date) → confirmare.
3. Pagina programării (`/booking/[token]`): detalii, buton „Anulează" (respectând un termen minim de anulare configurabil).
4. SMS de confirmare imediat după programare.
5. SMS reminder cu 24 h înainte (configurabil) și link de anulare.
6. Panou admin: agenda zilei, calendar pe săptămână, detalii programare, marcare `completed` / `no_show` / `cancelled`, creare manuală de programare (pentru clienții care sună).
7. Admin: administrare servicii (nume, durată, preț, activ/inactiv), program de lucru pe zile ale săptămânii (cu pauză), zile libere / concedii.
8. PWA: manifest, iconițe, service worker, funcționare cu fallback offline simplu, instrucțiuni de instalare pentru iPhone (Safari → Share → Add to Home Screen).

### Mai târziu (nu implementa acum)
Plăți online, mai mulți frizeri, notificări push, sincronizare Google Calendar, program de fidelitate, statistici, listă de așteptare.

## 5. Model de date (Postgres)

Toate tabelele au `id uuid primary key default gen_random_uuid()` și `created_at timestamptz default now()`.

- **settings** (un singur rând): `shop_name`, `address`, `phone`, `timezone` (default `Europe/Bucharest`), `slot_step_min` (default 15), `min_notice_min` (default 60), `max_advance_days` (default 30), `cancel_deadline_min` (default 120), `reminder_before_min` (default 1440).
- **services**: `name`, `duration_min`, `price_ron numeric(8,2)`, `active bool`, `sort_order int`.
- **working_hours**: `weekday smallint` (0–6), `start_time time`, `end_time time`. Mai multe rânduri pe zi sunt permise (permit pauză de prânz). Zi fără rânduri = închis.
- **time_off**: `starts_at timestamptz`, `ends_at timestamptz`, `reason text`.
- **bookings**: `service_id`, `starts_at timestamptz`, `ends_at timestamptz`, `customer_name`, `customer_phone` (format E.164, ex. `+407...`), `status` (`confirmed` | `cancelled` | `completed` | `no_show`), `cancel_token text unique` (aleator, minim 32 de caractere), `notes`, `source` (`online` | `admin`), `reminder_sent_at timestamptz null`, `confirmation_sent_at timestamptz null`.
- **sms_log** (opțional, recomandat): `booking_id`, `type`, `to`, `provider_message_id`, `status`, `error`.

**Fără dubluri de programări, garantat de baza de date:** activează extensia `btree_gist` și adaugă pe `bookings` un exclusion constraint:
`EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'confirmed')`.
Când se extinde la mai mulți frizeri, constraint-ul include și `staff_id`. Orice conflict la inserare trebuie transformat într-un mesaj clar în UI („Ora tocmai a fost ocupată, alege alta").

### RLS
- RLS activat pe toate tabelele.
- `anon` nu citește și nu scrie nimic direct.
- Admin (utilizatorul autentificat) are acces complet (politică bazată pe `auth.uid()` aflat într-un tabel `admins` sau pe un claim; alege varianta simplă și documenteaz-o).
- Clientul interacționează doar prin Edge Functions (secțiunea 6), care folosesc `service_role` pe server. **Cheia `service_role` nu apare niciodată în codul clientului.**

## 6. API public (Edge Functions)

Toate validează input-ul (ex. cu Zod), returnează erori clare și au rate limiting simplu pe IP.

- `get-services` → servicii active + datele publice din `settings`.
- `get-slots?service_id=&date=YYYY-MM-DD` → listă de ore libere (ISO) pentru ziua respectivă.
- `create-booking` `{ service_id, starts_at, customer_name, customer_phone, consent }` → creează programarea, recalculează disponibilitatea pe server (nu te baza pe ce zice clientul), trimite SMS de confirmare, returnează `cancel_token`.
- `get-booking?token=` → detaliile programării (fără date despre alți clienți).
- `cancel-booking` `{ token }` → anulează dacă mai e în termenul permis.
- `send-reminders` → apelată de Cron la fiecare 10 minute; trimite reminder pentru programările `confirmed` din fereastra configurată, unde `reminder_sent_at is null`, apoi setează `reminder_sent_at` (idempotent: nu trimite de două ori).

### Calculul sloturilor
Funcție **pură**, fără dependențe de Deno sau de Supabase, într-un modul separat (ex. `supabase/functions/_shared/slots.ts` sau un pachet `packages/core`), ca să poată fi testată cu Vitest. Intrări: setări, serviciu, program de lucru, zile libere, programări existente, „acum". Reguli:
- Sloturi la intervalul `slot_step_min`; un slot e valid dacă `[start, start + duration)` încape complet într-un interval de lucru și nu se suprapune cu o programare `confirmed` sau cu `time_off`.
- Respectă `min_notice_min` și `max_advance_days`.
- Ziua se interpretează în `Europe/Bucharest`, inclusiv la trecerea la ora de vară/iarnă.

## 7. Ecrane și rute (Expo Router)

```
app/
  index.tsx                 # pagina de start
  book/index.tsx            # flux de programare (pași)
  booking/[token].tsx       # vezi / anulează programarea
  admin/login.tsx
  admin/index.tsx           # agenda zilei
  admin/calendar.tsx        # vedere pe săptămână
  admin/bookings/[id].tsx   # detalii + schimbare status
  admin/bookings/new.tsx    # programare manuală
  admin/services.tsx
  admin/hours.tsx           # program + zile libere
  admin/settings.tsx
```
Rutele `/admin/*` sunt protejate: fără sesiune se redirecționează la `/admin/login`. UI-ul administrativ este optimizat și pentru telefon, fiindcă frizerul îl va folosi des de pe mobil.

## 8. PWA

- `public/manifest.json`: `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `theme_color`, `background_color`, iconițe 192×192 și 512×512 (plus `maskable`).
- Tag-uri în `<head>` pentru iOS: `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `theme-color`.
- Service worker: cache pentru fișierele statice și o pagină de fallback offline („Nu ai conexiune la internet"). **Nu** pune în cache răspunsurile API pentru disponibilitate.
- Verifică cu Lighthouse (categoria PWA / installable) și testează instalarea pe un iPhone real (Safari) și pe Android (Chrome).
- Fii atent la configurarea `web.output` din `app.json` și la rewrite-ul SPA din `vercel.json` ca să funcționeze reîncărcarea pe orice rută.

## 9. Securitate, abuz și GDPR

- Validare strictă a telefonului (format românesc, normalizat la E.164), nume cu lungime limitată.
- Rate limiting pe `create-booking` (ex. maximum 3 programări active per număr de telefon, maximum N cereri/minut per IP) și un câmp-capcană (honeypot). Opțional, Cloudflare Turnstile.
- Token de anulare aleator, lung, nu ghicibil; nu expune niciodată `id`-uri secvențiale.
- Variabilele secrete (cheia `service_role`, credențialele SMS) doar în secretele Supabase / variabilele de mediu din hosting, niciodată în repo. Fișier `.env.example` fără valori reale.
- GDPR: bifă explicită de acord la programare, pagină „Politica de confidențialitate", ștergere/anonimizare automată a datelor clienților la X luni după programare (job Cron), posibilitatea ca adminul să șteargă un client.
- Mesajele SMS includ numele salonului și nu conțin date sensibile.

## 10. Faze de lucru

Fiecare fază se încheie cu commit, rularea testelor și un scurt raport.

**Faza 0 — Setup**
- Inițializează repo-ul (Expo + TypeScript + Expo Router), ESLint, Prettier, Vitest.
- Proiect Supabase cu CLI (`supabase init`, migrații în `supabase/migrations`), `.env.example`, `README.md` cu pașii de rulare.
- *Criteriu:* `npx expo start --web` pornește o pagină goală; `npm test` rulează.

**Faza 1 — Baza de date și logica de sloturi**
- Migrații pentru toate tabelele, constraint-ul anti-suprapunere, RLS, date de test (seed).
- Modulul pur de calcul al sloturilor + teste Vitest care acoperă: zi închisă, pauză de prânz, serviciu care nu încape înainte de pauză/închidere, suprapunere cu programare existentă, `time_off`, `min_notice`, `max_advance`, tranziția ora de vară/iarnă, programări „lipite" una de alta.
- *Criteriu:* toate testele trec; un test demonstrează că două inserări concurente pe același interval produc o eroare de constraint.

**Faza 2 — API (Edge Functions)**
- `get-services`, `get-slots`, `create-booking`, `get-booking`, `cancel-booking` cu validare și rate limiting.
- *Criteriu:* scenariu complet rulat cu `curl` sau teste: listare → sloturi → creare → ocuparea slotului → anulare → slotul devine liber.

**Faza 3 — Fluxul clientului**
- Pagina de start, pașii de programare, pagina `/booking/[token]`. Stări de încărcare, erori și „slot ocupat" tratate.
- *Criteriu:* o programare completă poate fi făcută de pe un telefon, în mai puțin de un minut.

**Faza 4 — SMS și remindere**
- Interfața `SmsProvider` + implementarea Twilio, SMS de confirmare, `send-reminders` programat cu Cron, `sms_log`.
- *Criteriu:* reminderul se trimite o singură dată; un mod `SMS_DRY_RUN=true` doar loghează mesajele, pentru dezvoltare.

**Faza 5 — Panoul de admin**
- Autentificare, agenda zilei, calendar săptămânal, detalii și schimbare de status, programare manuală, administrare servicii, program, zile libere, setări.
- *Criteriu:* frizerul poate face singur toate operațiunile din secțiunea 4 (MVP, punctele 6–7).

**Faza 6 — PWA, securitate, lansare**
- Manifest, iconițe, service worker, fallback offline, meta tag-uri iOS; rate limiting, honeypot, GDPR (acord, politică, ștergere automată).
- Deploy pe hosting, domeniu, variabile de mediu de producție, migrații pe proiectul Supabase de producție.
- *Criteriu:* Lighthouse „installable"; instalare confirmată pe iPhone și Android; checklist-ul de mai jos bifat.

## 11. Checklist de QA (manual, înainte de lansare)

- [ ] Programare completă pe iPhone (Safari) și pe Android (Chrome).
- [ ] Două persoane încearcă aceeași oră simultan: doar una reușește, a doua primește mesaj clar.
- [ ] Ora de vară/iarnă: sloturile din ziua schimbării orei sunt corecte.
- [ ] Anulare în termen și după termen.
- [ ] SMS-ul de confirmare și reminderul ajung; reminderul nu se dublează.
- [ ] Reîncărcarea paginii pe `/booking/<token>` și pe `/admin` nu dă 404.
- [ ] Un utilizator neautentificat nu poate accesa `/admin` și nu poate citi tabelele direct cu cheia `anon`.
- [ ] Aplicația instalată pe ecranul principal se deschide fără bara browserului.
- [ ] Textele sunt în română, fără erori de diacritice.

## 12. Informații de la proprietar (completează înainte de Faza 0; dacă lipsesc, folosește valorile de test și marchează-le cu `TODO`)

- Numele salonului, adresa, telefonul: `____`
- Servicii, durate și prețuri (ex. Tuns 30 min / 50 RON): `____`
- Programul de lucru pe zile și pauza: `____`
- Un singur frizer sau mai mulți? (MVP presupune unul): `____`
- Furnizor SMS ales și numele afișat ca expeditor: `____`
- Domeniul dorit: `____`
- Culori / logo (dacă există): `____`

## 13. Reguli de lucru pentru Claude Code

1. Respectă stack-ul din secțiunea 2; propune alternative doar dacă ceva e blocat, explicând de ce.
2. Logica de business (sloturi, reguli de anulare) se testează automat; nu o scrie direct în componentele UI.
3. Nu pune secrete în repo și nu folosi `service_role` în client.
4. Commit-uri mici, mesaje în engleză, câte unul pe fază cel puțin.
5. La finalul fiecărei faze: ce ai făcut, ce ai testat și cum, ce a rămas. Nu declara o fază gata dacă testele nu trec.
6. Textele din interfață sunt în română și se țin într-un singur loc (fișier de texte), nu împrăștiate prin componente.

## 14. Decizii ulterioare (2026-11-16) — au prioritate față de secțiunile de mai sus

**Fără SMS în MVP.** Dispar Twilio, `SmsProvider`, `sms_log`, `SMS_DRY_RUN`, `confirmation_sent_at` și tot ce ține de SMS din secțiunile 2, 4, 5, 6, 9, 10 și 11. În loc:

1. **„Adaugă în calendar"** pe pagina de confirmare: fișier `.ics` și link Google Calendar, cu alarmă și cu linkul de anulare în eveniment.
2. **Web push opțional pentru client** (confirmare + reminder cu `reminder_before_min` înainte), doar pentru cine acceptă notificările.
3. **Programarea salvată în browser** (`localStorage`), ca la redeschiderea site-ului clientul să-și vadă programarea și butonul de anulare.
4. **Web push pentru frizer** la fiecare programare nouă sau anulată.

Nu există interfață generică de notificare; codul de push se scrie direct. Telefonul clientului rămâne în formular (frizerul poate suna). Cloudflare Turnstile rămâne opțional.

**Completări la model și API**

- Tabel **`staff`** (un singur rând în MVP) și `staff_id` pe `bookings`, `working_hours`, `time_off`; exclusion constraint-ul include `staff_id`.
- Tabel **`push_subscriptions`**: `endpoint` (unic), `p256dh`, `auth`, `booking_id` (client) sau `admin_user_id` (frizer). Chei VAPID în secretele Supabase.
- Tabel **`rate_limits`** în Postgres pentru rate limiting pe IP în Edge Functions.
- `send-reminders` cere un secret în header (`CRON_SECRET`), trimis de `pg_cron`.
- Reminderul se marchează întâi atomic (`UPDATE ... SET reminder_sent_at = now() ... RETURNING`), apoi se trimite; nu se trimite dacă programarea a fost creată în interiorul ferestrei de reminder.
- GDPR: anonimizare automată la **12 luni** după programare; se șterg și abonamentele push asociate.

**Faza 4** devine „Notificări și remindere": `.ics` / Google Calendar, salvare în browser, web push (client și frizer), `send-reminders` cu Cron. *Criteriu:* reminderul se trimite o singură dată.

**Alte precizări:** `web.output` este `"single"` (SPA); service worker-ul se scrie manual, Expo nu generează unul.

**Faza 4, stare:** implementată. Push-ul pentru frizer se trimite deja de pe server; abonarea dispozitivului de admin se face din panoul de admin (Faza 5).
