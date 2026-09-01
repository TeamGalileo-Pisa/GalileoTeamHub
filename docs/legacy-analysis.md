# Analisi del prototipo PHP/JSON

Il materiale ricevuto nello ZIP è stato analizzato integralmente, ma non è stato
copiato nel progetto definitivo perché contiene un'architettura incompatibile
con Netlify e diversi meccanismi non sicuri.

## Flussi recuperati

- creazione di aule e disponibilità;
- generazione automatica degli slot;
- vista calendario per area;
- selezione dello slot da parte del candidato;
- raccolta di nome, cognome ed email;
- conferma con area, aula, data e orario;
- notifica email.

## Elementi sostituiti

- I file JSON sono sostituiti da PostgreSQL e vincoli transazionali.
- L'area nell'URL non concede più accesso ai dati.
- Le aule non vengono assegnate permanentemente a un Capo Area.
- Le password e i fallback non vengono salvati nel codice.
- I link pubblici usano segreti casuali; nel database resta soltanto l'hash.
- Il filtro sulle sole email universitarie è stato rimosso.
- La cancellazione di una disponibilità viene bloccata in presenza di booking.
- L'invio email avviene server-side tramite coda e adapter.

## Problemi rilevati nel prototipo

- pagine amministrative prive di controllo sessione effettivo;
- account/area/aula accoppiati nella stessa struttura;
- possibilità di selezionare altri Capi Area tramite parametro `capo_id`;
- password di fallback in chiaro;
- link di prenotazione prevedibili basati sul nome area;
- scritture su più file JSON non atomiche;
- possibile doppia prenotazione durante richieste concorrenti;
- cancellazione di slot senza protezione dei booking associati;
- invio email con `mail()` e soppressione degli errori;
- sanitizzazione e validazione non uniformi.

