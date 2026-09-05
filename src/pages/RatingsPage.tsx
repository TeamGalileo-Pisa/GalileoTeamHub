import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import {
  archiveCandidateRating,
  createCandidateRating,
  deleteCandidateRating,
  listCandidateRatings,
  resetAllCandidateRatings,
  resetCandidateRatings,
  updateCandidateRating,
  type CandidateRating,
} from "../lib/hub-enhancements";

const ratingSchema = z.object({
  areaId: z.string().uuid("Seleziona un'area"),
  firstName: z.string().trim().min(1, "Inserisci il nome").max(80),
  lastName: z.string().trim().min(1, "Inserisci il cognome").max(80),
  email: z.string().trim().email("Inserisci una mail valida").max(254),
  courseOfStudy: z.string().trim().min(2, "Inserisci il corso di studi").max(160),
  interviewDate: z.string().min(1, "Inserisci la data del colloquio"),
  score: z.number().int().min(1).max(30),
  comment: z.string().trim().max(5000, "Il commento è troppo lungo"),
});

type RatingInput = z.infer<typeof ratingSchema>;
type SortMode = "created" | "score-desc" | "score-asc";

function sortRatings(rows: CandidateRating[], mode: SortMode) {
  return [...rows].sort((a, b) => {
    if (mode === "score-desc") return b.score - a.score || b.createdAt.localeCompare(a.createdAt);
    if (mode === "score-asc") return a.score - b.score || b.createdAt.localeCompare(a.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function RatingFields({
  form,
  areas,
  singleArea,
}: {
  form: ReturnType<typeof useForm<RatingInput>>;
  areas: Array<{ id: string; name: string }>;
  singleArea: boolean;
}) {
  return (
    <>
      <label className="form-field">
        Area
        {singleArea ? (
          <>
            <input type="hidden" {...form.register("areaId")} />
            <input className="input" readOnly value={areas[0]?.name ?? ""} />
          </>
        ) : (
          <select className="select" {...form.register("areaId")}>
            <option value="">Seleziona area</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>{area.name}</option>
            ))}
          </select>
        )}
        {form.formState.errors.areaId && <span className="field-error">{form.formState.errors.areaId.message}</span>}
      </label>
      <label className="form-field">
        Nome
        <input className="input" {...form.register("firstName")} />
        {form.formState.errors.firstName && <span className="field-error">{form.formState.errors.firstName.message}</span>}
      </label>
      <label className="form-field">
        Cognome
        <input className="input" {...form.register("lastName")} />
        {form.formState.errors.lastName && <span className="field-error">{form.formState.errors.lastName.message}</span>}
      </label>
      <label className="form-field">
        Mail
        <input className="input" type="email" {...form.register("email")} />
        {form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}
      </label>
      <label className="form-field form-field--full">
        Corso di Studi
        <input className="input" {...form.register("courseOfStudy")} />
        {form.formState.errors.courseOfStudy && <span className="field-error">{form.formState.errors.courseOfStudy.message}</span>}
      </label>
      <label className="form-field">
        Data del colloquio
        <input className="input" type="date" {...form.register("interviewDate")} />
        {form.formState.errors.interviewDate && <span className="field-error">{form.formState.errors.interviewDate.message}</span>}
      </label>
      <label className="form-field">
        Votazione
        <select className="select" {...form.register("score", { valueAsNumber: true })}>
          {Array.from({ length: 30 }, (_, index) => index + 1).map((score) => (
            <option key={score} value={score}>{score}</option>
          ))}
        </select>
      </label>
      <label className="form-field form-field--full">
        Commento
        <textarea className="textarea" rows={5} placeholder="Facoltativo" {...form.register("comment")} />
        {form.formState.errors.comment && <span className="field-error">{form.formState.errors.comment.message}</span>}
      </label>
    </>
  );
}

export function RatingsPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ["candidate-ratings", access?.userId], queryFn: listCandidateRatings });
  const [sort, setSort] = useState<SortMode>("created");
  const [areaFilter, setAreaFilter] = useState(access?.areas[0]?.id ?? "");
  const [editing, setEditing] = useState<CandidateRating | null>(null);
  const effectiveAreaFilter = areaFilter || access?.areas[0]?.id || "";

  const form = useForm<RatingInput>({
    resolver: zodResolver(ratingSchema),
    defaultValues: {
      areaId: access?.areas[0]?.id ?? "",
      firstName: "",
      lastName: "",
      email: "",
      courseOfStudy: "",
      interviewDate: "",
      score: 1,
      comment: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: RatingInput) => createCandidateRating(values),
    onSuccess: async () => {
      const areaId = form.getValues("areaId");
      form.reset({ areaId, firstName: "", lastName: "", email: "", courseOfStudy: "", interviewDate: "", score: 1, comment: "" });
      await cache.invalidateQueries({ queryKey: ["candidate-ratings"] });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: archiveCandidateRating,
    onSuccess: async () => cache.invalidateQueries({ queryKey: ["candidate-ratings"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCandidateRating,
    onSuccess: async () => cache.invalidateQueries({ queryKey: ["candidate-ratings"] }),
  });
  const resetMutation = useMutation({
    mutationFn: (areaId: string) => resetCandidateRatings(areaId),
    onSuccess: async () => cache.invalidateQueries({ queryKey: ["candidate-ratings"] }),
  });
  const resetAllMutation = useMutation({
    mutationFn: resetAllCandidateRatings,
    onSuccess: async () => cache.invalidateQueries({ queryKey: ["candidate-ratings"] }),
  });

  const allRows = useMemo(() => query.data ?? [], [query.data]);
  const visibleRows = useMemo(
    () => sortRatings(isAdmin || !effectiveAreaFilter ? allRows : allRows.filter((row) => row.areaId === effectiveAreaFilter), sort),
    [allRows, effectiveAreaFilter, isAdmin, sort],
  );

  if (isAdmin) {
    const grouped = visibleRows.reduce<Record<string, CandidateRating[]>>((acc, row) => {
      (acc[row.areaName] ??= []).push(row);
      return acc;
    }, {});
    return (
      <div className="page-container">
        <PageHeader
          eyebrow="Amministrazione"
          title="Votazioni"
          description="Consulta le valutazioni inserite dai Capi Area. Amministrazione ha accesso in sola lettura; l'unica operazione disponibile è il reset generale."
        />
        <section className="panel filter-bar">
          <label>
            Ordinamento
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
              <option value="created">Ordine di inserimento</option>
              <option value="score-desc">Voto decrescente</option>
              <option value="score-asc">Voto crescente</option>
            </select>
          </label>
          <button
            className="button button--danger"
            disabled={resetAllMutation.isPending || !allRows.length}
            onClick={() => {
              if (window.confirm("Reset generale: eliminare definitivamente tutte le votazioni di tutte le aree, comprese quelle archiviate? L'operazione non è recuperabile.")) {
                resetAllMutation.mutate();
              }
            }}
          >
            <RotateCcw size={16} /> Reset generale
          </button>
        </section>
        {resetAllMutation.error && <p className="form-error" role="alert">{resetAllMutation.error.message}</p>}
        {query.isLoading && <p>Caricamento votazioni…</p>}
        {query.error && <p className="form-error" role="alert">{query.error.message}</p>}
        {!query.isLoading && !allRows.length && (
          <EmptyState icon={Archive} title="Nessuna votazione" description="I giudizi inseriti dai Capi Area compariranno qui, divisi per area." />
        )}
        {Object.entries(grouped).map(([areaName, rows]) => (
          <RatingsTable key={areaName} title={areaName} rows={rows} readOnly />
        ))}
      </div>
    );
  }

  const activeRows = visibleRows.filter((row) => !row.archivedAt);
  const archivedRows = visibleRows.filter((row) => row.archivedAt);
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Area"
        title="Votazioni"
        description="Inserisci e gestisci i giudizi dei candidati incontrati a colloquio."
      />

      <section className="panel">
        <div className="panel__header"><div><h2>Nuova valutazione</h2><p>Voto selezionabile da 1 a 30</p></div><Plus size={20} /></div>
        <form className="panel__body form-grid" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
          <RatingFields form={form} areas={access?.areas ?? []} singleArea={(access?.areas.length ?? 0) === 1} />
          {createMutation.error && <p className="form-error form-field--full" role="alert">{createMutation.error.message}</p>}
          <div className="form-actions"><button className="button button--primary" disabled={createMutation.isPending}><Plus size={16} /> Salva valutazione</button></div>
        </form>
      </section>

      <section className="panel filter-bar">
        {(access?.areas.length ?? 0) > 1 && (
          <label>
            Area visualizzata
            <select className="select" value={effectiveAreaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
              {access?.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
        )}
        <label>
          Ordinamento
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="created">Ordine di inserimento</option>
            <option value="score-desc">Voto decrescente</option>
            <option value="score-asc">Voto crescente</option>
          </select>
        </label>
        <button
          className="button button--danger"
          disabled={!effectiveAreaFilter || resetMutation.isPending || !visibleRows.length}
          onClick={() => {
            if (window.confirm("Reset della lista: eliminare definitivamente tutte le votazioni dell'area selezionata, comprese quelle archiviate?")) {
              resetMutation.mutate(effectiveAreaFilter);
            }
          }}
        >
          <RotateCcw size={16} /> Reset lista
        </button>
      </section>

      {(archiveMutation.error || deleteMutation.error || resetMutation.error || query.error) && (
        <p className="form-error" role="alert">{(archiveMutation.error || deleteMutation.error || resetMutation.error || query.error)?.message}</p>
      )}
      {query.isLoading && <p>Caricamento votazioni…</p>}
      {!query.isLoading && !visibleRows.length && (
        <EmptyState icon={Archive} title="Nessuna votazione" description="Inserisci il primo giudizio per iniziare la lista dell'area." />
      )}
      {activeRows.length > 0 && (
        <RatingsTable
          title="Valutazioni attive"
          rows={activeRows}
          onEdit={setEditing}
          onArchive={(row) => {
            if (window.confirm(`Archiviare la valutazione di ${row.firstName} ${row.lastName}?`)) archiveMutation.mutate(row.id);
          }}
          onDelete={(row) => {
            if (window.confirm(`Eliminare definitivamente la valutazione di ${row.firstName} ${row.lastName}?`)) deleteMutation.mutate(row.id);
          }}
        />
      )}
      {archivedRows.length > 0 && (
        <RatingsTable
          title="Archiviate"
          rows={archivedRows}
          onEdit={setEditing}
          onDelete={(row) => {
            if (window.confirm(`Eliminare definitivamente la valutazione archiviata di ${row.firstName} ${row.lastName}?`)) deleteMutation.mutate(row.id);
          }}
        />
      )}
      {editing && <RatingEditor rating={editing} areas={access?.areas ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RatingsTable({
  title,
  rows,
  readOnly = false,
  onEdit,
  onArchive,
  onDelete,
}: {
  title: string;
  rows: CandidateRating[];
  readOnly?: boolean;
  onEdit?: (row: CandidateRating) => void;
  onArchive?: (row: CandidateRating) => void;
  onDelete?: (row: CandidateRating) => void;
}) {
  return (
    <section className="panel availability-list-panel">
      <div className="panel__header"><div><h2>{title}</h2><p>{rows.length} elementi</p></div></div>
      <div className="panel__body panel__body--flush">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>Candidato</th><th>Mail</th><th>Corso</th><th>Colloquio</th><th>Voto</th><th>Commento</th><th>Stato</th>{!readOnly && <th>Azioni</th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.firstName} {row.lastName}</strong><span className="table-secondary">{row.areaName}</span></td>
                  <td>{row.email}</td>
                  <td>{row.courseOfStudy}</td>
                  <td>{new Date(`${row.interviewDate}T12:00:00`).toLocaleDateString("it-IT")}</td>
                  <td><strong>{row.score}/30</strong></td>
                  <td>{row.comment || "—"}</td>
                  <td><StatusBadge label={row.archivedAt ? "Archiviata" : "Attiva"} tone={row.archivedAt ? "neutral" : "success"} /></td>
                  {!readOnly && (
                    <td><div className="table-actions">
                      {onEdit && <button className="button button--secondary button--small" onClick={() => onEdit(row)}><Pencil size={14} /> Modifica</button>}
                      {onArchive && !row.archivedAt && <button className="button button--secondary button--small" onClick={() => onArchive(row)}><Archive size={14} /> Archivia</button>}
                      {onDelete && <button className="button button--danger button--small" onClick={() => onDelete(row)}><Trash2 size={14} /> Elimina</button>}
                    </div></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function RatingEditor({ rating, areas, onClose }: { rating: CandidateRating; areas: Array<{ id: string; name: string }>; onClose: () => void }) {
  const cache = useQueryClient();
  const form = useForm<RatingInput>({
    resolver: zodResolver(ratingSchema),
    defaultValues: {
      areaId: rating.areaId,
      firstName: rating.firstName,
      lastName: rating.lastName,
      email: rating.email,
      courseOfStudy: rating.courseOfStudy,
      interviewDate: rating.interviewDate,
      score: rating.score,
      comment: rating.comment,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: RatingInput) => updateCandidateRating({ id: rating.id, ...values }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["candidate-ratings"] });
      onClose();
    },
  });
  return (
    <Modal title={`Modifica · ${rating.firstName} ${rating.lastName}`} onClose={() => { if (!mutation.isPending) onClose(); }}>
      <form className="form-grid" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <RatingFields form={form} areas={areas} singleArea={areas.length === 1} />
        {mutation.error && <p className="form-error form-field--full" role="alert">{mutation.error.message}</p>}
        <div className="form-actions"><button className="button button--primary" disabled={mutation.isPending}>Salva modifiche</button></div>
      </form>
    </Modal>
  );
}
