# GalileoHub: correzioni, attivazione e verifiche

Il 4 ottobre 2026 sono state applicate le migrazioni al progetto Supabase zxxgbemmzriysswaybnv e distribuite sei Edge Functions. Il ruolo globale dell'account TeamLeader è attivo e sono stati creati dieci account membri, uno per divisione. Le password degli account preesistenti restano invariate. Il frontend è nella PR 27: questo documento non attesta la sua pubblicazione sul dominio di produzione. Non sono state inviate email di prova né riavviati gli invii storici.

## Cosa cambia

- Account: autenticazione del chiamante verificata con Supabase Auth anche con chiavi JWT asimmetriche; reset con password temporanea scelta dall'amministratore; rimozione effettiva dei privilegi globali alla retrocessione; disattivazione e cancellazione protette. La cancellazione conserva le protezioni sullo storico e sull'ultimo amministratore, e non cancella ruoli prima che la cancellazione Auth riesca.
- Gmail: ripristinati numero del tentativo, snapshot del messaggio e riconciliazione degli invii incerti. Distinti errori di consenso OAuth, permessi insufficienti e mittente errato. Allegati PDF in MIME multipart.
- `/candidature`: domande del PDF fornito, scelta divisione, campi comuni, competenze, disponibilità e consenso. Candidature chiuse per impostazione iniziale, con interruttore globale e interruttori per area. La candidatura è distinta dalla prenotazione del colloquio: l'email di prenotazione continua a riportare data, ora, aula e link di gestione.
- `/admin/candidature`: controlli del form, candidature ricevute, inviti personali all'adesione, stato delle email e creazione degli account membri per area. Disponibile al Team Leader e all'Amministrazione. Le votazioni restano nel menu amministrativo condiviso dai due ruoli.
- `/adesione/:token`: invito monouso valido 14 giorni; nome, cognome, matricola, corso e dipartimento; PDF A4 generato sul server e inviato al destinatario dell'invito. I testi formali provengono dallo ZIP. Il logo originale nel flusso era un riferimento OneDrive e non era incluso nell'archivio: il PDF usa una testata testuale.
- Account `membri.<slug>`: uno per area, con bacheca della propria area e password temporanea casuale visualizzata una volta. Nessun accesso alle candidature, alle votazioni dei colloqui o ai poteri dei Capi Area. Gestione/reset/disattivazione disponibili nella pagina Account. Le password preesistenti non sono recuperabili in chiaro: serve un reset autorizzato per sostituirle.
- Notifiche: dispositivi registrati, coda server, Web Push/VAPID, FCM Android e APNs iOS. Contenuto generico nella schermata di blocco. Il logout deregistra il dispositivo quando la rete è disponibile. I banner in primo piano dipendono dalla piattaforma; Android mostra anche un messaggio nell'app.
- Progetti Capacitor Android e iOS universale (iPhone/iPad), package `it.teamgalileo.hub` ricavato dall'APK fornito; menu scorrevole anche su schermi bassi.
- Riparati il manifest JSON e le icone PNG corrotte; gli asset web e nativi utilizzano il logo recuperato dall'APK originale.

## Attivazione Supabase

Per nuove installazioni eseguire prima le migrazioni su staging. Per questo rilascio tutte le migrazioni di ottobre sono state validate su PGlite usando una copia del catalogo reale (con sostituti locali delle estensioni provider); i test funzionali usano fixture PostgreSQL. Le migrazioni antecedenti non sono state rieseguite integralmente in un'istanza Supabase locale. Due file del 4 ottobre sono marcatori del deploy atomico tramite API: le versioni SQL originali risultano registrate.

1. Collegare il progetto Supabase corretto con la CLI e controllare `supabase migration list`. La migrazione `20261003110000_commit_staff_role_values.sql` deve precedere `20261003120000`: gli enum devono essere confermati prima dell'uso. Se versioni successive risultano già applicate, usare `supabase db push --include-all --dry-run` per esaminare l'ordine, poi applicare le migrazioni mancanti nello stesso ordine.
2. Distribuire `staff-admin`, `admin-email-test`, `community`, `push-device`, `process-email-queue` e `public-booking`. La configurazione disattiva la verifica JWT legacy del gateway per le funzioni che verificano esplicitamente il token con `auth.getUser`; non rimuovere la verifica nel codice.
3. Per domini personalizzati impostare `PUBLIC_APP_URL`; il valore predefinito è `https://galileohub.info-teamgalileo.workers.dev` e includere in `APP_ORIGINS` il dominio reale, `https://localhost` (Android) e `capacitor://localhost` (iOS). Non esporre segreti in variabili VITE.
4. Configurare Gmail e push con i segreti elencati sotto. Il worker periodico già presente nel progetto elabora anche le nuove code; la prima operazione sui nuovi flussi configura il suo URL tramite `configure_email_worker`. Controllare il job pg_cron esistente e i log di `process-email-queue`.
5. Distribuire il frontend, accedere con il Team Leader, provare gli account su utenti di test, aprire le aree desiderate e creare gli account condivisi. Salvare le password mostrate una sola volta. Nessuna password reale viene inclusa nel repository.

La migrazione di riparazione ripristina anche `list_room_availabilities()` se era stata rimossa dalla migrazione precedente; il DROP errato è stato eliminato per le nuove installazioni.

## Gmail

Segreti server: `EMAIL_PROVIDER=gmail`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. L'account autorizzato deve essere `info.teamgalileo@gmail.com`; il trasporto verifica il profilo e ricerca il Message-ID prima dell'invio. Servono `gmail.send` e `gmail.readonly` (o un insieme equivalente già autorizzato).

Un refresh token emesso con consenso esterno in modalità Testing può scadere dopo 7 giorni. Pubblicare il consenso OAuth In produzione e riautorizzare il mittente, quindi aggiornare il secret. Un access token settimanale inserito manualmente non risolve questo problema. Fonte: https://developers.google.com/identity/protocols/oauth2

Gli invii rimasti incerti vengono riconciliati anziché reinviati alla cieca. Lo stato delle adesioni/candidature è visibile nella pagina dedicata; controllare anche i log se il job periodico non parte.

## Push e app native

- Web: le chiavi VAPID sono generate automaticamente e conservate cifrate in Supabase Vault. Le RPC che le leggono sono accessibili solo al service role; al browser viene restituita soltanto la chiave pubblica. In alternativa sono supportati i secrets `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. In produzione le chiavi Vault sono già presenti. Ogni utente deve premere Attiva notifiche push sul proprio dispositivo. Su iPhone/iPad le Web Push richiedono la web app aggiunta alla schermata Home (iOS/iPadOS 16.4+). Fonte: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Android: configurare un'app Firebase con package `it.teamgalileo.hub`; il client richiede `android/app/google-services.json`, il server `FIREBASE_SERVICE_ACCOUNT` come JSON. Le credenziali di servizio restano solo sul server. Per aggiornare l'APK esistente usare la stessa chiave di firma e un versionCode superiore a quello installato; il progetto usa 2 e va aumentato se necessario.
- iPhone/iPad: aprire il progetto Xcode su macOS, selezionare l'Apple Developer Team, abilitare Push Notifications, verificare App ID e provisioning. Configurare `APNS_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=it.teamgalileo.hub`, `APNS_ENVIRONMENT`. Per TestFlight/App Store impostare l'entitlement di build `APNS_ENVIRONMENT=production` e lo stesso ambiente sul server; per sviluppo usare development in Xcode e sandbox sul server.
- `pnpm mobile:sync` aggiorna gli asset nativi. Il workflow manuale Mobile builds produce Android debug e app per simulatore iPhone/iPad; questi artefatti non sono una release firmata installabile su ogni dispositivo. Android richiede il secret GitHub `GOOGLE_SERVICES_JSON`.
- Prima della compilazione configurare le variabili pubbliche GitHub `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, oppure i corrispondenti valori nel file locale `.env.local`. Il workflow interrompe la build se mancano, per evitare un'app scollegata dal backend.
- Prova push indispensabile su ogni piattaforma: app aperta, in background, chiusa, permesso negato, cambio utente e logout. Le push possono essere ritardate o bloccate dalle impostazioni del sistema operativo.

## Verifiche riproducibili

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `node scripts/test-community-database.mjs`.

Per le Edge Functions: `deno check --config supabase/functions/deno.json supabase/functions/staff-admin/index.ts supabase/functions/community/index.ts supabase/functions/push-device/index.ts supabase/functions/process-email-queue/index.ts supabase/functions/admin-email-test/index.ts`.

Verificato sul backend remoto: TeamLeader riconosciuto come amministratore, 21 account visibili, dieci account condivisi attivi con cambio password obbligatorio, candidature inizialmente chiuse, chiavi Web Push presenti e inaccessibili al ruolo authenticated. Gmail restituisce `GMAIL_OAUTH_FAILED:invalid_grant`: il mittente deve essere riautorizzato. Mancano Firebase e APNs; il titolare ha confermato di non avere ancora questi account/chiavi. Non ancora verificati: reset/modifica/disattivazione/cancellazione tramite sessione Auth amministrativa reale, consegna Gmail, push su dispositivi reali, compilazione nativa firmata, pubblicazione frontend.

## Compatibilità con i dati presenti

La pre-verifica ha rilevato tre candidati con più prenotazioni confermate. Non sono state cancellate prenotazioni. Il controllo serializza le nuove conferme e impedisce ulteriori duplicati; permette di gestire e annullare quelle preesistenti.

Il worker accetta, con il token server custodito in Vault, le azioni esplicite `diagnostics` (nessun invio email) e `provision_members` (crea solo account membri mancanti delle dieci divisioni note; non modifica password già esistenti). Il normale cron invia un oggetto vuoto e non esegue queste operazioni.
