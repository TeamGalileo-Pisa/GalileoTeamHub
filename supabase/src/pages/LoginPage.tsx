import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../components/Brand";
import { useAuth } from "../hooks/useAuth";
import { appConfig } from "../lib/config";

const loginSchema = z.object({
  username: z.string().trim().min(3, "Inserisci il nome utente"),
  password: z.string().min(8, "Inserisci la password"),
});

type LoginInput = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { access, signIn, error: accessError } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (access) {
    return <Navigate to={access.isAdmin ? "/admin" : "/area"} replace />;
  }

  const onSubmit = async (values: LoginInput) => {
    setSubmitError(null);
    try {
      await signIn(values.username, values.password);
      const requestedPath = (
        location.state as { from?: string } | null
      )?.from;
      navigate(requestedPath || "/", { replace: true });
    } catch (caughtError) {
      setSubmitError(
        caughtError instanceof Error
          ? caughtError.message
          : "Accesso non riuscito.",
      );
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-hero" aria-labelledby="auth-title">
        <div className="auth-hero__inner">
          <Brand />
          <div className="auth-hero__copy">
            <p className="eyebrow">Team Galileo Pisa</p>
            <h1 id="auth-title">Colloqui, finalmente semplici.</h1>
            <p>
              Disponibilità, sessioni e candidati in un unico spazio protetto,
              progettato per far lavorare ogni area senza confusione.
            </p>
          </div>
          <div className="auth-feature">
            <ShieldCheck size={20} />
            <span>
              <strong>Accesso riservato</strong>
              <small>Autorizzazioni verificate direttamente nel database</small>
            </span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card__icon" aria-hidden="true">
            <LockKeyhole size={22} />
          </span>
          <h2>Accedi al gestionale</h2>
          <p className="auth-card__intro">
            Usa le credenziali assegnate al tuo ruolo o alla tua area.
          </p>

          {!appConfig.hasSupabaseConfiguration && (
            <div className="info-callout" role="status">
              Configura le variabili Supabase in Netlify per abilitare
              l’accesso. Nessuna credenziale viene salvata nel repository.
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="form-field">
              <label htmlFor="username">Nome utente</label>
              <input
                className="input"
                id="username"
                autoComplete="username"
                placeholder="es. Software"
                {...register("username")}
              />
              {errors.username && (
                <span className="field-error">{errors.username.message}</span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="password">Password</label>
              <div className="password-input">
                <input
                  className="input"
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  {...register("password")}
                />
                <button
                  type="button"
                  aria-label={
                    showPassword ? "Nascondi password" : "Mostra password"
                  }
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <span className="field-error">{errors.password.message}</span>
              )}
            </div>

            {(submitError || accessError) && (
              <div className="form-error" role="alert">
                {submitError || accessError}
              </div>
            )}

            <button
              className="button button--primary auth-submit"
              type="submit"
              disabled={
                isSubmitting || !appConfig.hasSupabaseConfiguration
              }
            >
              {isSubmitting ? "Accesso in corso…" : "Accedi"}
            </button>
          </form>

          <p className="auth-card__note">
            I candidati non devono accedere: ricevono direttamente il link
            privato per scegliere lo slot.
          </p>
        </div>
      </section>
    </main>
  );
}

