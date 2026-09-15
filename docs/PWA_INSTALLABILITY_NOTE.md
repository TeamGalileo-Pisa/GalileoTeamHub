# GalileoHub PWA installability hardening

Questa correzione interviene esclusivamente sul livello PWA/static assets.

## Problema osservato
Su Chrome/Android il menu di installazione poteva mostrare la WebApp come non installabile e continuare a visualizzare metadati/icona precedenti subito dopo un deploy.

## Interventi
- manifest con icone PNG 192x192 e 512x512 su URL versionati;
- Apple touch icon su URL versionato;
- `manifest.webmanifest` e `sw.js` serviti con `Cache-Control: no-store` tramite `_headers` di Cloudflare Workers Static Assets;
- registrazione del Service Worker immediata, con `updateViaCache: none`;
- nessuna cache applicativa di prenotazioni, autenticazione o dati Supabase.

## Sicurezza operativa
Nessuna modifica a Supabase, tabelle, RLS, Edge Functions, slot o prenotazioni.
