import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../components/Brand";
import { useAuth } from "../hooks/useAuth";
import { completePasswordChange } from "../lib/data";
import { supabase } from "../lib/supabase";

const schema = z
  .object({
    password: z
      .string()
      .min(12, "Usa almeno 12 caratteri")
      .regex(/[A-Z]/, "Aggiungi una lettera maiuscola")
      .regex(/[a-z]/, "Aggiungi una lettera minuscola")
      .regex(/[0-9]/, "Aggiungi un numero")
      .regex(/[^A-Za-z0-9]/, "Aggiungi un simbolo"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Le password non coincidono",
    path: ["confirmPassword"],
  });

export function ChangePasswordPage() {
  const { access, refreshAccess } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setSubmitError(null);
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });
    if (error) {
      setSubmitError("Non è stato possibile aggiornare la password.");
      return;
    }

    try {
      await completePasswordChange();
      await refreshAccess();
      navigate(access?.isAdmin ? "/admin" : "/area", { replace: true });
    } catch {
      setSubmitError(
        "Password aggiornata, ma il profilo non è stato sincronizzato. Esci e accedi di nuovo.",
      );
    }
  };

  return (
    <main className="password-page">
      <div className="password-page__brand">
        <Brand />
      </div>
      <section className="password-card">
        <span className="password-card__icon">
          <KeyRound size={24} />
        </span>
        <p className="eyebrow">Primo accesso</p>
        <h1>Scegli una nuova password</h1>
        <p>
          La password iniziale è temporanea. Sostituiscila prima di accedere ai
          dati del recruitment.
        </p>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="form-field">
            <label htmlFor="new-password">Nuova password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <span className="field-error">
                {form.formState.errors.password.message}
              </span>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="confirm-password">Ripeti la password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              {...form.register("confirmPassword")}
            />
            {form.formState.errors.confirmPassword && (
              <span className="field-error">
                {form.formState.errors.confirmPassword.message}
              </span>
            )}
          </div>
          {submitError && (
            <div className="form-error" role="alert">
              {submitError}
            </div>
          )}
          <button
            className="button button--primary"
            type="submit"
            disabled={form.formState.isSubmitting}
          >
            <ShieldCheck size={17} /> Salva e continua
          </button>
        </form>
      </section>
    </main>
  );
}
