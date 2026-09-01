import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { createStaffMember, listAreas, listStaff } from "../lib/data";

const schema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Inserisci almeno tre caratteri")
      .regex(/^[A-Za-z0-9._ -]+$/, "Nome utente non valido"),
    displayName: z.string().trim().min(2, "Inserisci il nome visualizzato"),
    temporaryPassword: z
      .string()
      .min(12, "La password temporanea deve avere almeno 12 caratteri")
      .regex(/[A-Z]/, "Aggiungi una lettera maiuscola")
      .regex(/[a-z]/, "Aggiungi una lettera minuscola")
      .regex(/[0-9]/, "Aggiungi un numero")
      .regex(/[^A-Za-z0-9]/, "Aggiungi un simbolo"),
    role: z.enum(["admin", "area_lead"]),
    areaId: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.role === "area_lead" && !value.areaId) {
      context.addIssue({
        code: "custom",
        message: "Seleziona l'area assegnata",
        path: ["areaId"],
      });
    }
  });

export function StaffPage() {
  const queryClient = useQueryClient();
  const staffQuery = useQuery({ queryKey: ["staff"], queryFn: listStaff });
  const areasQuery = useQuery({ queryKey: ["areas"], queryFn: listAreas });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { role: "area_lead" },
  });
  const selectedRole = useWatch({ control: form.control, name: "role" });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      createStaffMember({
        username: values.username,
        displayName: values.displayName,
        temporaryPassword: values.temporaryPassword,
        isAdmin: values.role === "admin",
        areaId: values.role === "area_lead" ? values.areaId : undefined,
      }),
    onSuccess: async () => {
      form.reset({ role: "area_lead" });
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
  });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Amministrazione"
        title="Account e ruoli"
        description="Gli account sono distinti dalle aree. Un cambio di responsabile non modifica lo storico dell’area."
      />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Crea account</h2>
            <p>La password è inviata solo alla funzione server e non viene salvata</p>
          </div>
          <UserPlus size={20} />
        </div>
        <form
          className="panel__body form-grid"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="form-field">
            <label htmlFor="staff-username">Nome utente</label>
            <input
              id="staff-username"
              className="input"
              autoComplete="off"
              placeholder="es. Software"
              {...form.register("username")}
            />
            {form.formState.errors.username && (
              <span className="field-error">
                {form.formState.errors.username.message}
              </span>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="staff-display-name">Nome visualizzato</label>
            <input
              id="staff-display-name"
              className="input"
              placeholder="es. Responsabile Software"
              {...form.register("displayName")}
            />
          </div>
          <div className="form-field">
            <label htmlFor="staff-role">Livello di accesso</label>
            <select
              id="staff-role"
              className="select"
              {...form.register("role")}
            >
              <option value="area_lead">Capo Area</option>
              <option value="admin">Amministrazione</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="staff-area">Area</label>
            <select
              id="staff-area"
              className="select"
              disabled={selectedRole === "admin"}
              defaultValue=""
              {...form.register("areaId")}
            >
              <option value="">
                {selectedRole === "admin"
                  ? "Non richiesta per Amministrazione"
                  : "Seleziona area"}
              </option>
              {areasQuery.data?.filter((area) => area.active).map((area) => (
                <option value={area.id} key={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
            {form.formState.errors.areaId && (
              <span className="field-error">
                {form.formState.errors.areaId.message}
              </span>
            )}
          </div>
          <div className="form-field form-field--full">
            <label htmlFor="staff-password">Password temporanea</label>
            <input
              id="staff-password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Almeno 12 caratteri, maiuscole, minuscole, numero e simbolo"
              {...form.register("temporaryPassword")}
            />
            {form.formState.errors.temporaryPassword && (
              <span className="field-error">
                {form.formState.errors.temporaryPassword.message}
              </span>
            )}
          </div>
          {mutation.error && (
            <div className="form-error form-field--full" role="alert">
              {mutation.error.message}
            </div>
          )}
          {mutation.isSuccess && (
            <div className="form-success form-field--full" role="status">
              Account creato. Comunica la password temporanea tramite un canale
              sicuro e chiedi di sostituirla al primo accesso.
            </div>
          )}
          <div className="form-actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={mutation.isPending}
            >
              <UserPlus size={17} /> Crea account
            </button>
          </div>
        </form>
      </section>

      <section className="panel availability-list-panel">
        <div className="panel__header">
          <div>
            <h2>Account configurati</h2>
            <p>Ruoli globali e assegnazioni alle aree</p>
          </div>
        </div>
        <div className="panel__body panel__body--flush">
          {staffQuery.data?.length ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Ruolo</th>
                    <th>Aree assegnate</th>
                    <th>Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {staffQuery.data.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.displayName}</strong>
                        <span className="table-secondary">
                          {member.username}
                        </span>
                      </td>
                      <td>
                        {member.isAdmin ? (
                          <span className="role-label">
                            <ShieldCheck size={15} /> Amministrazione
                          </span>
                        ) : (
                          "Capo Area"
                        )}
                      </td>
                      <td>
                        {member.areas.map((area) => area.name).join(", ") || "—"}
                      </td>
                      <td>
                        <StatusBadge
                          label={member.status === "active" ? "Attivo" : "Disattivato"}
                          tone={member.status === "active" ? "success" : "neutral"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={UsersRound}
              title="Nessun account visibile"
              description="Dopo il bootstrap dell'Amministrazione, crea qui gli account dei Capi Area."
            />
          )}
        </div>
      </section>
    </div>
  );
}
