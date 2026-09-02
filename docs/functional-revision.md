# Revisione funzionale del 2 settembre 2026

## Ambito e dati esistenti

È stata estesa l’applicazione React/Vite e Supabase esistente, mantenendo la grafica del Team e il deploy Netlify/GitHub. Nessuna vecchia migration è modificata e nessun reset viene eseguito in produzione.

Il controllo preliminare remoto, in sola lettura, ha rilevato 10 profili, 9 aree, 1 campagna, 2 disponibilità, 2 sessioni e 2 prenotazioni. Entrambe le disponibilità sono multi-giorno precedenti: vengono conservate e indicate come legacy, mostrando anche la fine completa. Le due consegne email precedenti sono simulazioni `development`, non prove di ricezione Gmail. Non vengono reinviate automaticamente.

## Funzioni e file principali

- `src/pages/PublicBookingPage.tsx`, `src/lib/booking-validation.ts`, `supabase/functions/_shared/booking-validation.ts`, `public-booking/index.ts`: slot/nome/cognome/email obbligatori, errori visibili, trim e lowercase. Solo nuove prenotazioni richiedono il dominio esatto `studenti.unipi.it`; la stessa regola è nella RPC SQL. Lo storico non cambia.
- `DailyAvailabilityForm.tsx`, `scheduling.ts`, `AvailabilityPage.tsx`: anteprima del periodo, giorni della settimana, una vera finestra per giornata e `series_id` comune. Inserimento atomico, filtri data/aula/posti, selezione con limiti precompilati, nota e capacità. Le righe della serie restano modificabili individualmente; non è prevista una modifica di gruppo che alteri appuntamenti esistenti.
- `SessionManager.tsx`, `SessionsPage.tsx`: creazione atomica sessione+slot; gestione nome, link, chiusura e riapertura sicura; modifica/chiusura/riapertura/eliminazione degli slot non prenotati. Gli slot con storico non si riscrivono o eliminano.
- `CalendarPage.tsx`: lista e griglia settimanale, orari e durate reali, navigazione per settimana/data, etichette area e filtro amministrativo. La lista usa la stessa settimana della griglia. Apertura dettagli, spostamento e annullamento preservano i record. Gli spostamenti restano nella stessa campagna; il Capo Area resta nella propria area.
- `AdminEditors.tsx`, `AreasPage.tsx`, `CampaignsPage.tsx`, `StaffPage.tsx`: modifica e disattivazione/riattivazione, archiviazione campagne e cancellazione con conferma solo quando non esiste storico. Le associazioni storiche degli account non vengono cancellate.
- `staff-admin/index.ts`: username e dominio Auth interno; email sintetiche confermate senza mail all’utente. Operazioni privilegiate tramite Auth Admin API e RPC service-only, controllo dell’ultimo amministratore attivo e lease per account. Reset derivato dallo username salvato più `DEFAULT_PASSWORD_SUFFIX`, letto esclusivamente dai secret server. Il risultato non è restituito né loggato. `must_change_password=true` e controllo database del cambio effettivo.
- `AuthProvider.tsx`: svuota la cache al cambio utente, evitando di mostrare dati del precedente account sullo stesso browser.
- `help-guides.ts`, `HelpPage.tsx`, `EmailDiagnostics.tsx`: guide per ruolo con passi numerati, esempi, avvertenze, ricerca, test email e diagnostica.

## Migration incrementali

Tutte in `supabase/migrations/`:

1. `20260902100000_staff_and_admin_management.sql`: account abilitati, cambio password effettivo, ultimo admin, storico e CRUD amministrativo.
2. `20260902101000_daily_availability_and_sessions.sql`: gruppi giornalieri, sessioni e slot.
3. `20260902102000_booking_validation_and_serialization.sql`: UniPi, controlli campagna/area, serializzazione delle operazioni concorrenti, disponibilità legacy.
4. `20260902103000_automatic_email_queue.sql`: snapshot notifiche, worker, Vault, Cron, backoff, idempotenza e diagnostica.
5. `20260902104000_calendar_queries.sql`: calendario con autorizzazioni e destinazioni ammesse.
6. `20260902105000_account_operation_guards.sql`: operazioni account concorrenti e protezione eliminazione.
7. `20260902106000_readiness_guards.sql`: protezioni aggiuntive delle letture per account sospesi o con password iniziale.

## Gmail: catena di consegna

La transazione di prenotazione inserisce `bookings` e `email_deliveries` insieme. La Edge Function risponde dopo il salvataggio e tenta l’invio in background. Il worker `process-email-queue` passa ogni minuto grazie a Supabase Cron/pg_net. URL e token casuale del worker sono cifrati in Vault e non sono esposti al browser.

Ogni notifica conserva i dettagli dell’appuntamento al momento dell’evento. Il mittente è sempre **Team Galileo Pisa &lt;info.teamgalileo@gmail.com&gt;**; l’account OAuth viene verificato tramite Gmail. La conferma usa l’oggetto **Colloqui Team Galileo**, il testo richiesto e date/orari `Europe/Rome`. Modifiche, annullamenti e promemoria mantengono testi specifici. I promemoria sono accodati tra 24 e 1 ora prima dell’appuntamento.

La coda applica massimo sei tentativi, attese di 30 secondi, 1, 2, 4 e 8 minuti e recupero delle lavorazioni interrotte dopo 2 minuti. Le risposte dei vecchi tentativi non possono aggiornare quelli nuovi. Prima di inviare viene cercato il Message-ID deterministico. Se l’esito dell’invio è incerto (timeout o risposta ambigua), i tentativi successivi cercano il messaggio ma **non lo reinviano alla cieca**; una consegna non riconciliata richiede controllo manuale nella Posta inviata. Gmail non offre una transazione distribuita exactly-once: il comportamento conservativo privilegia l’assenza di duplicati.

L’obiettivo normale è un tentativo immediato e recupero entro pochi minuti. La ricezione entro 5 minuti non è garantibile in caso di provider indisponibile, quota esaurita o credenziali revocate. La prenotazione resta comunque salvata. `sent` significa accettazione del messaggio da Gmail, non conferma di lettura/ricezione.

## Configurazione manuale residua

Gmail reale **non è ancora configurato o verificato da questa revisione**. Non inserire credenziali in chat o in file tracciati.

Nel pannello Supabase **Edge Functions > Secrets** servono:

- `EMAIL_PROVIDER` impostato a `gmail`;
- `GMAIL_CLIENT_ID` e `GMAIL_CLIENT_SECRET` dal client OAuth Google Cloud;
- `GMAIL_REFRESH_TOKEN` da un consenso offline della casella mittente;
- `APP_ORIGINS` mantenuto a `http://localhost:5173,https://colloquiteam.netlify.app`;
- `DEFAULT_PASSWORD_SUFFIX` per il reset secondo la regola concordata (il valore non viene riportato nel repository);
- `AUTH_EMAIL_DOMAIN` coerente con Vite; il default rimane `auth.teamgalileo.local`.

Gli identificativi Google si ottengono creando/selezionando un progetto nella [Google Cloud Console](https://console.cloud.google.com/), abilitando Gmail API e configurando Google Auth Platform. Per il token offline si può usare [OAuth Playground](https://developers.google.com/oauthplayground/) con **credenziali OAuth proprie**, client Web e redirect `https://developers.google.com/oauthplayground`. Gli scope necessari sono `gmail.send` e `gmail.readonly` (quest’ultimo per la ricerca Message-ID e verifica mittente). Nessun access token va salvato: viene ottenuto dal refresh token a runtime. Un’app OAuth esterna in Testing può avere refresh token con scadenza breve; verificare pubblicazione, eventuale verifica Google e rinnovo prima dell’uso continuativo.

Con i secret configurati, aprire **Assistenza > Email di prova** con un account amministrativo che abbia cambiato la password. L’operazione inizializza in modo idempotente anche il worker. Indicare una vera casella destinataria e verificare ricezione e mittente, inclusa Spam. Poi provare una prenotazione controllata con email UniPi e controllare `pending/sending/sent/failed` in Diagnostica email. Non usare candidati reali come destinatari di prova senza autorizzazione.

Fonti operative: [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Secrets](https://supabase.com/docs/guides/functions/secrets), [Gmail OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Google OAuth](https://developers.google.com/identity/protocols/oauth2).

## Verifiche

Esito locale prima del commit: typecheck e lint superati; **49 test applicativi** in 6 file superati; build produzione riuscita. Rimane un avviso non bloccante di Vite sulla dimensione del chunk principale (>500 kB).

Tutte le 17 migration, comprese le 7 nuove, applicate con reset esclusivamente locale; **164 controlli SQL** in 4 file superati. Superati anche i test concorrenti e HTTP locali (prenotazione realmente persistita; endpoint amministrativi e worker protetti). I quattro entry point Edge superano `deno check`. Il controllo dei 105 file candidati al commit non ha rilevato i secret locali né pattern di token privati. Nessun test automatico ha spedito email a caselle reali.

Il reset password è coperto dai controlli SQL sul flag, sul cambio dell’hash Auth e sul nonce di reset; la regola server richiede ancora il secret dedicato. Non è dichiarato un reset di un account di produzione né un test Gmail reale. Nessuna verifica visuale automatizzata in un browser: le verifiche UI sono test React con DOM simulato.

Frontend e test: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Database **solo locale**: `supabase db reset --local`, `supabase test db`.

Concorrenza **solo locale**: `pnpm test:supabase-races`, con `ALLOW_LOCAL_SUPABASE_TESTS=true` e URL/chiavi della sola istanza locale. Copre capacità, doppia prenotazione, due spostamenti nello stesso slot, acquisizione esclusiva di una consegna e chiusura sessione.

Edge Functions: controllo statico Deno dei quattro entry point; test automatici con provider Gmail simulato (nessuna rete reale). Questi controlli non sostituiscono l’email reale finale.

Il report della task riporta SHA e stato dei check GitHub dopo il push; questo file non dichiara preventivamente riuscito un deploy.

## Inventario dei file modificati o aggiunti

Percorsi relativi alla radice del repository; le sette migration sono elencate sopra.

```text
.env.example
README.md
docs/functional-revision.md
scripts/test-supabase-races.mjs
src/components/AdminEditors.tsx
src/components/DailyAvailabilityForm.tsx
src/components/EmailDiagnostics.tsx
src/components/Modal.tsx
src/components/SessionManager.tsx
src/lib/booking-validation.ts
src/lib/data.ts
src/lib/dates.ts
src/lib/errors.ts
src/lib/functional-revision.test.ts
src/lib/help-guides.ts
src/lib/operations.ts
src/lib/scheduling.ts
src/pages/AreasPage.tsx
src/pages/AvailabilityPage.tsx
src/pages/CalendarPage.tsx
src/pages/CampaignsPage.tsx
src/pages/HelpPage.tsx
src/pages/PublicBookingPage.tsx
src/pages/SessionsPage.tsx
src/pages/StaffPage.tsx
src/pages/functional-ui.test.tsx
src/providers/AuthProvider.tsx
src/styles/global.css
src/types/domain.ts
supabase/config.toml
supabase/functions/_shared/booking-validation.ts
supabase/functions/_shared/email-copy.ts
supabase/functions/_shared/email.test.ts
supabase/functions/_shared/email.ts
supabase/functions/_shared/runtime.d.ts
supabase/functions/admin-email-test/index.ts
supabase/functions/process-email-queue/index.ts
supabase/functions/public-booking/index.ts
supabase/functions/staff-admin/index.ts
supabase/tests/database/announcements_rls.test.sql
supabase/tests/database/booking_and_capacity.test.sql
supabase/tests/database/functional_revision.test.sql
```
