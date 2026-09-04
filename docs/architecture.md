# Architettura GalileoHub

## Visione

GalileoHub è il gestionale centrale del Team Galileo Pisa. Il recruitment è il primo modulo operativo, non il confine del prodotto. Nuove funzioni dovranno integrarsi nello stesso sistema riutilizzando autenticazione, ruoli, aree, audit, navigazione e componenti condivisi.

## Componenti

- **Cloudflare Workers Static Assets** ospita la SPA React generata in `dist`.
- **Supabase Auth** gestisce gli account di Amministrazione e Capi Area.
- **PostgreSQL** conserva dati trasversali e dati dei singoli moduli.
- **Row Level Security** limita ogni Capo Area alle aree assegnate.
- **Supabase Edge Functions** gestiscono operazioni server-side privilegiate, booking pubblico ed email.
- Le pagine pubbliche, come la prenotazione recruitment, non richiedono un account interno.

Il frontend comunica direttamente con Supabase usando soltanto `VITE_SUPABASE_URL` e la publishable key. Le operazioni privilegiate restano nelle Edge Functions e nel database.

## Struttura modulare

I moduli verticali, come recruitment, calendario o futuri strumenti organizzativi, devono dipendere dai servizi condivisi ma non duplicarli. In particolare restano comuni:

- autenticazione e sessione;
- profilo utente e ruoli;
- aree del Team;
- bacheca e notifiche;
- audit log;
- layout responsive;
- gestione degli errori;
- policy RLS.

## Ruoli

- `admin`: accesso globale, rappresentato nell'interfaccia da Amministrazione.
- `area_lead`: accesso a una o più aree tramite `area_memberships`.
- utente pubblico/candidato: nessun profilo interno e nessuna lettura diretta delle tabelle protette.

Le aree iniziali sono Software, Elettronica, Braccio, Rover, Geologia, Biologia, Logistica, Business e Comunicazione.

## Responsive design

La SPA deve essere utilizzabile da desktop, notebook, tablet e smartphone. Il layout principale usa breakpoint progressivi; sotto 820 px la sidebar diventa un drawer mobile. Le superfici dati che non possono essere compresse senza perdere leggibilità usano scrolling orizzontale controllato. `responsive.css` aggiunge safe-area, touch target, adattamenti per schermi molto piccoli e landscape.

## Modulo recruitment: prenotazione pubblica

Il frontend genera URL stabili del tipo `/book/area-<slug>`. La pagina pubblica invoca la Edge Function `public-booking`, che usa un client server-side per interrogare le RPC di prenotazione.

L'Edge Function applica una allowlist CORS basata sul secret `APP_ORIGINS`. Ogni dominio di produzione o preview che deve usare la prenotazione pubblica deve essere incluso esplicitamente nella lista.

`book_public_slot` inserisce il booking in una transazione PostgreSQL. L'indice univoco parziale `bookings_one_confirmed_per_slot` impedisce che due booking confermati condividano lo stesso slot. Due richieste contemporanee producono quindi esattamente un successo e un conflitto.

## Deploy

Cloudflare costruisce il frontend con `pnpm run build` e pubblica `dist` tramite `npx wrangler deploy`. `wrangler.jsonc` abilita il comportamento SPA con `not_found_handling = single-page-application` e identifica il Worker come `galileohub`.

Il branch `main` è la produzione. Le modifiche vanno sviluppate su branch separati, validate dalla CI e unite tramite pull request.

## Supabase e migration history

Le migration sono versionate esclusivamente in `supabase/migrations`. La history remota è tracciata da Supabase nella tabella `supabase_migrations.schema_migrations`; repository e database devono rimanere allineati.

Le modifiche allo schema remoto fatte direttamente dal Dashboard devono essere catturate in una migration prima di proseguire con altri deploy. In caso di divergenza usare `supabase migration list`, quindi `db pull` o `migration repair` solo dopo aver verificato lo stato effettivo del database.

## Segreti

Le variabili `VITE_*` sono pubbliche. La secret key Supabase, le credenziali Gmail e gli altri secret server-side sono configurati soltanto nelle Edge Functions. Password, token completi e secret API key non devono essere aggiunti a Git o a Cloudflare come variabili pubbliche.
