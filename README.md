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

Quando viene scelto il provider reale, configurare anche `EMAIL_FROM` e la sua
API key. Non inserire questi valori in file tracciati.

### Primo account Amministrazione

Dopo le migration, configurare localmente le variabili indicate in
`.env.example` e lanciare:

```bash
pnpm bootstrap:admin
```

Lo script legge la password da `BOOTSTRAP_ADMIN_PASSWORD`, non la stampa e non
la salva nel repository. Gli altri account vengono creati dalla pagina
**Account** del gestionale.

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
