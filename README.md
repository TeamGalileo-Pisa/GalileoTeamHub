# Team Galileo · Gestionale

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
- coda email Gmail API con worker automatico, retry e diagnostica;
- disponibilità giornaliere create in gruppo con anteprima;
- gestione sessioni/slot, calendario settimanale e spostamenti;
- gestione sicura di aree, campagne e account;
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
supabase db reset --local
supabase test db
supabase functions serve
```

Per un progetto remoto:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy public-booking
supabase functions deploy staff-admin
supabase functions deploy admin-email-test
supabase functions deploy process-email-queue
```

Configurare i secret server-side:

```bash
supabase secrets set AUTH_EMAIL_DOMAIN=...
supabase secrets set APP_ORIGINS=https://your-site.netlify.app
supabase secrets set EMAIL_PROVIDER=gmail
```

Il mittente applicativo di tutte le notifiche è fissato a
`Team Galileo Pisa <info.teamgalileo@gmail.com>`. Configurare `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET` e `GMAIL_REFRESH_TOKEN` nel pannello **Edge Functions >
Secrets**, non nei comandi conservati nella cronologia e mai in Netlify/Vite.
Il token deve autorizzare proprio la casella mittente. Senza configurazione,
le consegne restano fallite/in coda e non sono dichiarate inviate.

Il reset account richiede anche `DEFAULT_PASSWORD_SUFFIX` nei secret server:
il valore della regola concordata con Amministrazione non va riportato in Git.
Lo username usato è quello già salvato, preservandone le maiuscole.

Per attivare il worker usare **Assistenza > Email di prova** dopo la
configurazione OAuth. La funzione inizializza URL e token casuale in Vault;
la migration installa il job Cron ogni minuto. Nessun token Cron va copiato
nel browser. La ricevuta reale deve essere verificata nella casella destinataria.
Vedi [setup Gmail e revisione funzionale](docs/functional-revision.md).

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
