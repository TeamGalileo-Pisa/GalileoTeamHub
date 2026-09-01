# Team Galileo · Gestionale Colloqui

Gestionale ufficiale per organizzare i recruitment del Team Galileo Pisa.

Il progetto usa React, TypeScript e Vite su Netlify, con Supabase per database,
autenticazione, Row Level Security ed Edge Functions.

Supabase production deployment initialized.

## Funzionalità incluse

- accesso globale Amministrazione;
- account separati per i Capi Area;
- nove aree iniziali indipendenti dagli utenti;
- campagne recruitment con storico;
- disponibilità delle aule separate dalle fasce prese dalle aree;
- sessioni e generazione slot con durata personalizzata;
- link candidato privati, revocabili e non prevedibili;
- prenotazione senza account candidato;
- vincolo atomico contro le doppie prenotazioni;
- coda email server-side con adapter development/Resend;
- audit log e policy RLS.

## Avvio frontend

Requisiti: Node.js e pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Impostare in `.env.local` soltanto i valori pubblici:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_AUTH_EMAIL_DOMAIN=...
```

## Supabase

```bash
supabase start
supabase db reset
supabase test db
supabase functions serve
```

Per un progetto remoto:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy public-booking
supabase functions deploy staff-admin
```

Configurare i secret server-side:

```bash
supabase secrets set AUTH_EMAIL_DOMAIN=...
supabase secrets set APP_ORIGINS=https://your-site.netlify.app
supabase secrets set EMAIL_PROVIDER=development
```

Il mittente applicativo di tutte le notifiche è fissato a
`Team Galileo Pisa <info.teamgalileo@gmail.com>`. Quando viene scelto il
provider reale, configurare soltanto la relativa API key nei secret Supabase;
non inserire password Google o token in file tracciati.

### Account iniziali

Dopo le migration, creare il file locale `.env.bootstrap.local` con
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` e le dieci variabili
`BOOTSTRAP_*_PASSWORD` elencate in `.env.example`, quindi lanciare:

```bash
pnpm bootstrap:accounts
```

Il file locale è escluso da Git. Lo script crea o riconcilia in modo idempotente
l'amministratore e i nove Capi Area, usa solo indirizzi Auth sintetici nel
dominio `auth.teamgalileo.local`, conferma automaticamente tali indirizzi e non
stampa né salva le password. Ogni esecuzione riconcilia profili e autorizzazioni
senza duplicati e imposta `must_change_password=true` insieme alle password
iniziali fornite nell'ambiente locale. Per compatibilità con progetti meno
recenti, `SUPABASE_SERVICE_ROLE_KEY` resta disponibile come fallback locale.

## Netlify

Il file `netlify.toml` configura:

- build: `pnpm build`;
- directory pubblicata: `dist`;
- rewrite SPA verso `index.html`.

Su Netlify impostare soltanto le variabili pubbliche `VITE_*`. I segreti email e
la service role restano su Supabase.

## Verifiche

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Per provare la concorrenza su uno slot di test configurare le variabili descritte
da `scripts/test-booking-race.mjs`, quindi eseguire:

```bash
pnpm test:booking-race
```

## Documentazione

- [Architettura](docs/architecture.md)
- [Analisi del prototipo](docs/legacy-analysis.md)
- [Sicurezza](SECURITY.md)
