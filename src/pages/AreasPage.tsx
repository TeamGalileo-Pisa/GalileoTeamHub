import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelsTopLeft, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { createArea, listAreas } from "../lib/data";

const schema = z.object({
  name: z.string().trim().min(2, "Inserisci il nome dell'area"),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa lettere minuscole e trattini"),
});

export function AreasPage() {
  const queryClient = useQueryClient();
  const areasQuery = useQuery({ queryKey: ["areas"], queryFn: listAreas });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: createArea,
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["areas"] });
    },
  });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Amministrazione"
        title="Aree del Team"
        description="Le aree sono entità stabili: possono cambiare responsabile senza perdere campagne, sessioni o storico."
      />

      <section className="panel form-list-layout">
        <div className="panel__header">
          <div>
            <h2>Nuova area</h2>
            <p>Usa un nome breve e riconoscibile</p>
          </div>
          <PanelsTopLeft size={20} />
        </div>
        <form
          className="panel__body form-grid"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="form-field">
            <label htmlFor="area-name">Nome</label>
            <input
              id="area-name"
              className="input"
              placeholder="es. Scientifico"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <span className="field-error">
                {form.formState.errors.name.message}
              </span>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="area-slug">Identificativo</label>
            <input
              id="area-slug"
              className="input"
              placeholder="es. scientifico"
              {...form.register("slug")}
            />
            {form.formState.errors.slug && (
              <span className="field-error">
                {form.formState.errors.slug.message}
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
              <Plus size={17} /> Crea area
            </button>
          </div>
        </form>
      </section>

      <section className="panel availability-list-panel">
        <div className="panel__header">
          <div>
            <h2>Aree configurate</h2>
            <p>{areasQuery.data?.length ?? 0} aree nel sistema</p>
          </div>
        </div>
        <div className="panel__body panel__body--flush">
          {areasQuery.data?.length ? (
            <div className="area-card-grid">
              {areasQuery.data.map((area) => (
                <article className="area-card" key={area.id}>
                  <span className="area-card__letter">
                    {area.name.slice(0, 1)}
                  </span>
                  <div>
                    <h3>{area.name}</h3>
                    <p>{area.slug}</p>
                  </div>
                  <StatusBadge
                    label={area.active ? "Attiva" : "Disattivata"}
                    tone={area.active ? "success" : "neutral"}
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={PanelsTopLeft}
              title="Nessuna area"
              description="Le nove aree iniziali verranno inserite automaticamente dalla migration di seed."
            />
          )}
        </div>
      </section>
    </div>
  );
}

