# Architettura

## Componenti

- **Cloudflare Workers Static Assets** ospita la SPA React generata in `dist`.
- **Supabase Auth** gestisce gli account di Amministrazione e Capi Area.
- **PostgreSQL** conserva campagne, aree, aule, fasce, sessioni, slot e booking.
- **Row Level Security** limita ogni Capo Area alle aree assegnate.
- **Supabase Edge Functions** gestiscono account staff, booking pubblico ed email.
- Il candidato non crea un account e accede soltanto tramite il link pubblico della propria area.

Il frontend comunica direttamente con Supabase usando soltanto `VITE_SUPABASE_URL` e la publishable key. Le operazioni privilegiate restano nelle Edge Functions e nel database.

## Ruoli

- `admin`: accesso globale, rappresentato nell'interfaccia da Amministrazione.
- `area_lead`: accesso a una o più aree tramite `area_memberships`.
- candidato: nessun profilo e nessuna lettura diretta delle tabelle.

Le aree iniziali sono Software, Elettronica, Braccio, Rover, Geologia, Biologia, Logistica, Business e Comunicazione.

## Prenotazione pubblica

Il frontend genera URL stabili del tipo `/book/area-<slug>`. La pagina pubblica invoca la Edge Function `public-booking`, che usa un client server-side per interrogare le RPC di prenotazione.

L'Edge Function applica una allowlist CORS basata sul secret `APP_ORIGINS`. Ogni dominio di produzione o preview che deve usare la prenotazione pubblica deve essere incluso esplicitamente nella lista.

`book_public_slot` inserisce il booking in una transazione PostgreSQL. L'indice univoco parziale `bookings_one_confirmed_per_slot` impedisce che due booking confermati condividano lo stesso slot. Due richieste contemporanee producono quindi esattamente un successo e un conflitto.

## Deploy

Cloudflare costruisce il frontend con `pnpm run build` e pubblica `dist` tramite `npx wrangler deploy`. `wrangler.jsonc` abilita il comportamento SPA con `not_found_handling = single-page-application`.

Il branch `main` è la produzione. Le modifiche vanno sviluppate su branch separati, validate dalla CI e unite tramite pull request.

## Supabase e migration history

Le migration sono versionate esclusivamente in `supabase/migrations`. La history remota è tracciata da Supabase nella tabella `supabase_migrations.schema_migrations`; repository e database devono rimanere allineati.

Le modifiche allo schema remoto fatte direttamente dal Dashboard devono essere catturate in una migration prima di proseguire con altri deploy. In caso di divergenza usare `supabase migration list`, quindi `db pull` o `migration repair` solo dopo aver verificato lo stato effettivo del database.

## Segreti

Le variabili `VITE_*` sono pubbliche. La secret key Supabase, le credenziali Gmail e gli altri secret server-side sono configurati soltanto nelle Edge Functions. Password, token completi e secret API key non devono essere aggiunti a Git o a Cloudflare come variabili pubbliche.
