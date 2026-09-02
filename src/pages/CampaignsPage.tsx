import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Play, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { formatDateOnly } from "../lib/dates";
import { activateCampaign, createCampaign, listCampaigns } from "../lib/data";
import { useState } from "react";
import { CampaignEditor } from "../components/AdminEditors";
import type { RecruitmentCampaign } from "../types/domain";

const schema = z
  .object({
    name: z.string().trim().min(4, "Inserisci il nome del recruitment"),
    startsOn: z.string().optional(),
    endsOn: z.string().optional(),
  })
  .refine(
    (value) =>
      !value.startsOn ||
      !value.endsOn ||
      new Date(value.endsOn) >= new Date(value.startsOn),
    { message: "La data finale precede quella iniziale", path: ["endsOn"] },
  );

export function CampaignsPage() {
  const [editing, setEditing] = useState<RecruitmentCampaign | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["campaigns"], queryFn: listCampaigns });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });
  const mutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
  const activateMutation = useMutation({
    mutationFn: activateCampaign,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Amministrazione"
        title="Campagne recruitment"
        description="Ogni recruitment resta consultabile nello storico. Le aree e gli appuntamenti non vengono sovrascritti dalla campagna successiva."
      />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Nuova campagna</h2>
            <p>Verrà creata in stato bozza</p>
          </div>
          <CalendarRange size={20} />
        </div>
        <form
          className="panel__body form-grid"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="form-field form-field--full">
            <label htmlFor="campaign-name">Nome recruitment</label>
            <input
              id="campaign-name"
              className="input"
              placeholder="es. Recruitment Autunno 2026"
              {...form.register("name")}
            />
          </div>
          <div className="form-field">
            <label htmlFor="campaign-start">Data iniziale</label>
            <input
              id="campaign-start"
              className="input"
              type="date"
              {...form.register("startsOn")}
            />
          </div>
          <div className="form-field">
            <label htmlFor="campaign-end">Data finale</label>
            <input
              id="campaign-end"
              className="input"
              type="date"
              {...form.register("endsOn")}
            />
            {form.formState.errors.endsOn && (
              <span className="field-error">
                {form.formState.errors.endsOn.message}
              </span>
            )}
          </div>
          {mutation.error && (
            <div className="form-error form-field--full" role="alert">
              {mutation.error.message}
            </div>
          )}
          <div className="form-actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={mutation.isPending}
            >
              <Plus size={17} /> Crea bozza
            </button>
          </div>
        </form>
      </section>

      <section className="panel availability-list-panel">
        <div className="panel__header">
          <div>
            <h2>Storico recruitment</h2>
            <p>Bozze, campagne attive e archiviate</p>
          </div>
        </div>
        <div className="panel__body panel__body--flush">
          {query.data?.length ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Campagna</th>
                    <th>Inizio</th>
                    <th>Fine</th>
                    <th>Stato</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <strong>{campaign.name}</strong>
                      </td>
                      <td>{formatDateOnly(campaign.startsOn)}</td>
                      <td>{formatDateOnly(campaign.endsOn)}</td>
                      <td>
                        <StatusBadge
                          label={
                            campaign.status === "active"
                              ? "Attiva"
                              : campaign.status === "archived"
                                ? "Archiviata"
                                : "Bozza"
                          }
                          tone={
                            campaign.status === "active"
                              ? "success"
                              : campaign.status === "draft"
                                ? "warning"
                                : "neutral"
                          }
                        />
                      </td>
                      <td>
                        {campaign.status === "draft" ? (
                          <button
                            className="button button--secondary button--small"
                            type="button"
                            disabled={activateMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Attivare questa campagna e collegare tutte le aree attive?",
                                )
                              ) {
                                activateMutation.mutate(campaign.id);
                              }
                            }}
                          >
                            <Play size={14} /> Attiva
                          </button>
                        ) : (
                          "—"
                        )}
                        <button
                          className="button button--secondary button--small"
                          onClick={() => setEditing(campaign)}
                        >
                          Modifica / Gestisci
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={CalendarRange}
              title="Nessuna campagna"
              description="Crea il primo recruitment per collegare aree, disponibilità e sessioni."
            />
          )}
        </div>
      </section>
      {query.isLoading && <p>Caricamento campagne…</p>}
      {(query.error || activateMutation.error) && (
        <p className="form-error" role="alert">
          {(query.error || activateMutation.error)?.message}
        </p>
      )}
      {editing && (
        <CampaignEditor campaign={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
