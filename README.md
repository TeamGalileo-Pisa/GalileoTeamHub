# Team Galileo · Gestionale Colloqui

Gestionale ufficiale per organizzare i recruitment del Team Galileo Pisa.

Il frontend usa React, TypeScript e Vite ed è pubblicato su Cloudflare Workers Static Assets. Supabase gestisce database, autenticazione, Row Level Security ed Edge Functions.

## Funzionalità incluse

- accesso globale Amministrazione;
- account separati per i Capi Area;
- nove aree iniziali indipendenti dagli utenti;
- campagne recruitment con storico;
- disponibilità delle aule separate dalle fasce prese dalle aree;
- sessioni e generazione slot con durata personalizzata;
- link area stabili e revocabili per la prenotazione candidati;
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
VITE_APP_TIMEZONE=Europe/Rome
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
supabase migration list
supabase db push --dry-run
supabase db push
supabase functions deploy public-booking
supabase functions deploy staff-admin
supabase functions deploy admin-email-test
supabase functions deploy process-email-queue
```

Configurare i secret server-side dal pannello **Edge Functions > Secrets** oppure con la CLI:

```bash
supabase secrets set AUTH_EMAIL_DOMAIN=auth.teamgalileo.local
supabase secrets set APP_ORIGINS=https://galileoteamhub.info-teamgalileo.workers.dev
supabase secrets set EMAIL_PROVIDER=gmail
```

`APP_ORIGINS` è una lista separata da virgole. Deve contenere ogni origine frontend autorizzata a chiamare le Edge Functions dal browser.

Il mittente applicativo di tutte le notifiche è fissato a `Team Galileo Pisa <info.teamgalileo@gmail.com>`. Configurare `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` e `GMAIL_REFRESH_TOKEN` soltanto nei secret Supabase, mai in Git o nelle variabili pubbliche `VITE_*`.

Il reset account richiede anche `DEFAULT_PASSWORD_SUFFIX` nei secret server. Il valore della regola concordata con Amministrazione non va riportato in Git. Lo username usato è quello già salvato, preservandone le maiuscole.

Per attivare il worker usare **Assistenza > Email di prova** dopo la configurazione OAuth. La funzione inizializza URL e token casuale in Vault; la migration installa il job Cron ogni minuto. Nessun token Cron va copiato nel browser. La ricevuta reale deve essere verificata nella casella destinataria. Vedi [setup Gmail e revisione funzionale](docs/functional-revision.md).

### Account iniziali

Dopo le migration, creare il file locale `.env.bootstrap.local` con `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e le dieci variabili `BOOTSTRAP_*_PASSWORD` elencate in `.env.example`, quindi lanciare:

```bash
pnpm bootstrap:accounts
```

Il file locale è escluso da Git. Lo script crea o riconcilia in modo idempotente l'amministratore e i nove Capi Area, usa solo indirizzi Auth sintetici nel dominio `auth.teamgalileo.local`, conferma automaticamente tali indirizzi e non stampa né salva le password. Ogni esecuzione riconcilia profili e autorizzazioni senza duplicati e imposta `must_change_password=true` insieme alle password iniziali fornite nell'ambiente locale. Per compatibilità con progetti meno recenti, `SUPABASE_SERVICE_ROLE_KEY` resta disponibile come fallback locale.

## Cloudflare Workers

`wrangler.jsonc` pubblica `dist` come Static Assets e usa il fallback SPA per le route React.

Configurazione CI/CD Cloudflare:

- branch di produzione: `main`;
- build command: `pnpm run build`;
- deploy command: `npx wrangler deploy`;
- root directory: `/`;
- variabili di build: soltanto `VITE_*`.

I segreti email e le chiavi Supabase server-side restano su Supabase.

## Migrazioni database

Le migration versionate sono in `supabase/migrations`. Una volta adottato questo flusso, le modifiche allo schema di produzione devono essere registrate come migration e non applicate direttamente dal Table Editor/SQL Editor senza poi riallineare la history.

Se Supabase segnala che la migration history locale e remota non coincidono, seguire [Ripristino Supabase e migration history](docs/supabase-recovery.md) prima di eseguire altri `db push`.

## Verifiche

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Per provare la concorrenza su uno slot di test configurare le variabili descritte da `scripts/test-booking-race.mjs`, quindi eseguire:

```bash
pnpm test:booking-race
```

## Documentazione

- [Architettura](docs/architecture.md)
- [Ripristino Supabase e migration history](docs/supabase-recovery.md)
- [Analisi del prototipo](docs/legacy-analysis.md)
- [Sicurezza](SECURITY.md)
