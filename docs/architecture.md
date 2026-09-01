# Architettura

## Componenti

- **Netlify** ospita esclusivamente la SPA React generata in `dist`.
- **Supabase Auth** gestisce gli account di Amministrazione e Capi Area.
- **PostgreSQL** conserva campagne, aree, aule, fasce, sessioni, slot e booking.
- **Row Level Security** limita ogni Capo Area alle aree assegnate.
- **Supabase Edge Functions** gestiscono account staff, booking pubblico ed email.
- Il candidato non crea un account e accede soltanto tramite token privato.

## Ruoli

- `admin`: accesso globale, rappresentato nell'interfaccia da Amministrazione.
- `area_lead`: accesso a una o più aree tramite `area_memberships`.
- candidato: nessun profilo e nessuna lettura diretta delle tabelle.

Le aree iniziali sono Software, Elettronica, Braccio, Rover, Geologia,
Biologia, Logistica, Business e Comunicazione.

## Prenotazione atomica

`book_public_slot` inserisce il booking in una transazione PostgreSQL. L'indice
univoco parziale `bookings_one_confirmed_per_slot` impedisce che due booking
confermati condividano lo stesso slot. Due richieste contemporanee producono
quindi esattamente un successo e un conflitto.

## Segreti

Le variabili `VITE_*` sono pubbliche. La chiave service role e le credenziali
del provider email sono configurate soltanto tra i secret delle Edge Functions.
Password, token completi e API key non devono essere aggiunti a Git.

