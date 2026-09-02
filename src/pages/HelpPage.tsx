import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, MailCheck, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { sendAdminTestEmail } from "../lib/data";

import { guideSections } from "../lib/help-guides";
import { EmailDiagnostics } from "../components/EmailDiagnostics";

const emailSchema = z.object({
  toEmail: z
    .string()
    .trim()
    .email("Inserisci un indirizzo email valido")
    .max(254),
});

export function HelpPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const [search, setSearch] = useState("");
  const [emailSuccess, setEmailSuccess] = useState(false);
  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
  });
  const emailMutation = useMutation({
    mutationFn: ({ toEmail }: z.infer<typeof emailSchema>) =>
      sendAdminTestEmail(toEmail),
    onMutate: () => setEmailSuccess(false),
    onSuccess: () => {
      setEmailSuccess(true);
      emailForm.reset();
    },
  });
  const visibleSections = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("it");
    return guideSections.filter(
      (section) =>
        (!section.adminOnly || isAdmin) &&
        (!normalized ||
          `${section.title} ${section.text} ${section.steps.join(" ")} ${section.warning ?? ""}`
            .toLocaleLowerCase("it")
            .includes(normalized)),
    );
  }, [isAdmin, search]);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Guida interna"
        title="Assistenza"
        description="Istruzioni pratiche per usare il gestionale e risolvere i problemi più comuni."
      />

      <div className="help-layout">
        <aside className="panel help-index">
          <div className="panel__header">
            <div>
              <h2>Indice</h2>
              <p>Cerca o scegli una sezione</p>
            </div>
            <BookOpen size={20} />
          </div>
          <div className="panel__body">
            <label className="search-field" htmlFor="help-search">
              <Search size={17} />
              <input
                id="help-search"
                className="input"
                type="search"
                placeholder="Cerca nella guida"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <nav className="help-links" aria-label="Indice assistenza">
              {visibleSections.map((section) => (
                <a href={`#${section.id}`} key={section.id}>
                  {section.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="help-sections">
          {visibleSections.map((section) => (
            <section
              className={`panel help-section ${section.adminOnly ? "help-section--admin" : ""}`}
              id={section.id}
              key={section.id}
            >
              <div className="panel__header">
                <div>
                  <h2>{section.title}</h2>
                  {section.adminOnly && <p>Visibile solo ad Amministrazione</p>}
                </div>
                {section.adminOnly && <ShieldCheck size={20} />}
              </div>
              <div className="panel__body">
                <p>{section.text}</p>
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {section.warning && (
                  <aside className="admin-note">
                    <strong>Attenzione</strong>
                    <p>{section.warning}</p>
                  </aside>
                )}
              </div>
            </section>
          ))}
          {!visibleSections.length && (
            <div className="panel panel__body">
              Nessun argomento corrisponde alla ricerca.
            </div>
          )}

          {isAdmin && (
            <section className="panel help-section help-section--admin">
              <div className="panel__header">
                <div>
                  <h2>Email di prova</h2>
                  <p>
                    Invio diretto riservato ad Amministrazione, senza creare
                    prenotazioni.
                  </p>
                </div>
                <MailCheck size={20} />
              </div>
              <form
                className="panel__body form-grid"
                onSubmit={emailForm.handleSubmit((values) =>
                  emailMutation.mutate(values),
                )}
              >
                <div className="form-field form-field--full">
                  <label htmlFor="test-email">Destinatario di prova</label>
                  <input
                    id="test-email"
                    className="input"
                    type="email"
                    placeholder="nome@esempio.it"
                    {...emailForm.register("toEmail")}
                  />
                  {emailForm.formState.errors.toEmail && (
                    <span className="field-error">
                      {emailForm.formState.errors.toEmail.message}
                    </span>
                  )}
                </div>
                {emailMutation.error && (
                  <div className="form-error form-field--full" role="alert">
                    {emailMutation.error.message}
                  </div>
                )}
                {emailSuccess && (
                  <div className="form-success form-field--full" role="status">
                    Email di prova accettata da Gmail.
                  </div>
                )}
                <div className="form-actions">
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={emailMutation.isPending}
                  >
                    <MailCheck size={17} />{" "}
                    {emailMutation.isPending
                      ? "Invio…"
                      : "Invia email di prova"}
                  </button>
                </div>
              </form>
            </section>
          )}
          {isAdmin && <EmailDiagnostics />}
        </div>
      </div>
    </div>
  );
}
