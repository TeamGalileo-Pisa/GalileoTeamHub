# Ripristino Supabase e migration history

Questa procedura serve quando il check GitHub di Supabase segnala errori come `Remote migration versions not found in local migrations directory`.

## Regola di sicurezza

Non eseguire `migration repair`, `db push --include-all`, cancellazioni di migration o reset del database di produzione finché non è stato confrontato lo stato locale/remoto. `migration repair` modifica soltanto la tabella di history: usarlo con un timestamp sbagliato può rendere la history incoerente rispetto allo schema reale.

## 1. Collegare una copia locale del repository

```bash
git checkout main
git pull
supabase login
supabase link --project-ref zxxgbemmzriysswaybnv
```

## 2. Fotografare lo stato prima di modificarlo

```bash
supabase migration list
supabase db push --dry-run
```

Salvare l'output. Le colonne LOCAL e REMOTE devono essere confrontate timestamp per timestamp.

## 3. Se esistono versioni REMOTE senza corrispondente file LOCAL

Prima verificare se quelle versioni provengono da vecchie migration eliminate dal repository. Se il database è stato modificato direttamente dal Dashboard o la history non è ricostruibile con certezza, catturare lo schema remoto:

```bash
supabase db pull --linked
```

Revisionare il file generato prima di committarlo. Non applicarlo automaticamente alla produzione: descrive lo stato remoto già esistente.

## 4. Usare `migration repair` solo dopo la verifica

Se una versione è registrata come applicata nel remoto ma la relativa modifica non deve più essere trattata come migration valida, Supabase può marcarla come reverted:

```bash
supabase migration repair <TIMESTAMP> --status reverted
```

Se invece lo schema contiene già una modifica e manca soltanto la riga di history:

```bash
supabase migration repair <TIMESTAMP> --status applied
```

Dopo ogni repair rieseguire:

```bash
supabase migration list
supabase db push --dry-run
```

L'obiettivo è arrivare a una lista coerente prima di qualsiasi `db push` reale.

## 5. Edge Functions

Le modifiche ai file in `supabase/functions` non diventano automaticamente codice di produzione soltanto perché sono presenti su GitHub. Quando una funzione cambia, deployarla esplicitamente:

```bash
supabase functions deploy public-booking
supabase functions deploy staff-admin
supabase functions deploy admin-email-test
supabase functions deploy process-email-queue
```

## 6. CORS del frontend Cloudflare

La Edge Function pubblica legge `APP_ORIGINS`. Per la produzione attuale deve contenere almeno:

```text
https://galileoteamhub.info-teamgalileo.workers.dev
```

Nel Dashboard: **Edge Functions → Secrets**. Modificare `APP_ORIGINS` senza slash finale. Per più origini usare valori separati da virgole.

Dopo il salvataggio dei secret non è necessario ridistribuire le funzioni: i nuovi valori sono disponibili immediatamente.

## 7. Regola di lavoro di squadra

- una modifica di schema = un nuovo file in `supabase/migrations`;
- niente modifiche strutturali dirette alla produzione senza catturarle in migration;
- un solo responsabile esegue il `db push` verso produzione;
- branch → CI → pull request → merge su `main`;
- prima di ogni push remoto: `supabase migration list` e `supabase db push --dry-run`.
