import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Clock3,
  Link2,
  ListChecks,
  PanelsTopLeft,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { formatDateTime, formatTimeRange } from "../lib/dates";
import {
  getDashboardMetrics,
  getUnreadAnnouncementCount,
  listUpcomingInterviews,
} from "../lib/data";
import { listOnlineAreaLeads } from "../lib/hub-enhancements";

export function DashboardPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const metricsQuery = useQuery({
    queryKey: ["dashboard-metrics", access?.userId],
    queryFn: getDashboardMetrics,
  });
  const interviewsQuery = useQuery({
    queryKey: ["upcoming-interviews", access?.userId],
    queryFn: listUpcomingInterviews,
  });
  const unreadQuery = useQuery({
    queryKey: ["unread-announcements", access?.userId],
    queryFn: getUnreadAnnouncementCount,
    enabled: Boolean(access),
  });
  const onlineLeadsQuery = useQuery({
    queryKey: ["online-area-leads"],
    queryFn: listOnlineAreaLeads,
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const metrics = metricsQuery.data ?? {
    interviewsToday: 0,
    interviewsThisWeek: 0,
    availableSlots: 0,
    bookedSlots: 0,
    activeAreas: access?.areas.length ?? 0,
  };
  const onlineLeads = onlineLeadsQuery.data ?? [];
  const quickActions = isAdmin
    ? [
        {
          to: "/admin/disponibilita",
          label: "Apri una disponibilità",
          description: "Aula, data e fascia oraria",
          icon: CalendarPlus,
        },
        {
          to: "/admin/account",
          label: "Gestisci account",
          description: "Admin e responsabili area",
          icon: UsersRound,
        },
      ]
    : [
        {
          to: "/area/disponibilita",
          label: "Prendi una fascia",
          description: "Scegli dalle disponibilità libere",
          icon: CalendarCheck,
        },
        {
          to: "/area/sessioni",
          label: "Prepara una sessione",
          description: "Genera slot e link privato",
          icon: Link2,
        },
      ];

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={isAdmin ? "Amministrazione" : access?.areas[0]?.name || "Area"}
        title={`Ciao, ${access?.displayName || ""}`}
        description={
          isAdmin
            ? "Una vista essenziale su disponibilità, slot e prossimi colloqui di tutto il Team."
            : "Qui trovi soltanto sessioni, candidati e appuntamenti delle aree assegnate al tuo account."
        }
      />

      {(metricsQuery.error || interviewsQuery.error || onlineLeadsQuery.error) && (
        <div className="form-error dashboard-error" role="alert">
          Alcuni dati non sono disponibili. Verifica che le migration Supabase siano state applicate.
        </div>
      )}

      {(unreadQuery.data ?? 0) > 0 && (
        <Link className="announcement-alert" to={isAdmin ? "/admin/bacheca" : "/area/bacheca"}>
          <span><strong>{unreadQuery.data} nuove comunicazioni</strong> da Amministrazione</span>
          <span>Apri Bacheca</span>
        </Link>
      )}

      <section className="stats-grid" aria-label="Riepilogo colloqui">
        <StatCard label="Colloqui oggi" value={metrics.interviewsToday} icon={CalendarClock} />
        <StatCard label="Questa settimana" value={metrics.interviewsThisWeek} icon={ListChecks} tone="violet" />
        <StatCard label="Slot disponibili" value={metrics.availableSlots} icon={Clock3} tone="green" />
        <StatCard label="Slot prenotati" value={metrics.bookedSlots} icon={CalendarCheck} tone="amber" />
        <StatCard label={isAdmin ? "Aree attive" : "Aree assegnate"} value={metrics.activeAreas} icon={PanelsTopLeft} />
        {isAdmin && <StatCard label="Capi Area online" value={onlineLeads.length} icon={UsersRound} tone="green" />}
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel__header">
            <div><h2>Prossimi colloqui</h2><p>Aggiornati in tempo reale dal calendario</p></div>
            <Link className="button button--secondary button--small" to={isAdmin ? "/admin/calendario" : "/area/calendario"}>Vedi calendario</Link>
          </div>
          <div className="panel__body panel__body--flush">
            {interviewsQuery.isLoading ? (
              <div className="table-loading">Caricamento appuntamenti…</div>
            ) : interviewsQuery.data?.length ? (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Candidato</th><th>Area</th><th>Quando</th><th>Aula</th><th>Stato</th></tr></thead>
                  <tbody>
                    {interviewsQuery.data.map((interview) => (
                      <tr key={interview.bookingId}>
                        <td><strong>{interview.candidateName}</strong><span className="table-secondary">{interview.candidateEmail}</span></td>
                        <td>{interview.areaName}</td>
                        <td><strong>{formatDateTime(interview.startsAt)}</strong><span className="table-secondary">{formatTimeRange(interview.startsAt, interview.endsAt)}</span></td>
                        <td>{interview.roomName}</td>
                        <td><StatusBadge label="Confermato" tone="success" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={CalendarCheck} title="Nessun colloquio in programma" description="Quando un candidato prenota uno slot, l’appuntamento comparirà qui." />
            )}
          </div>
        </section>

        <aside>
          {isAdmin && (
            <section className="panel online-leads-panel">
              <div className="panel__header">
                <div><h2>Capi Area online</h2><p>Attivi nel gestionale negli ultimi 90 secondi</p></div>
                <StatusBadge label={`${onlineLeads.length} online`} tone={onlineLeads.length ? "success" : "neutral"} />
              </div>
              <div className="panel__body online-leads-list">
                {onlineLeadsQuery.isLoading ? (
                  <div className="table-loading">Verifica presenze…</div>
                ) : onlineLeads.length ? (
                  onlineLeads.map((lead) => (
                    <div className="online-lead-row" key={lead.userId}>
                      <span className="online-dot" aria-label="Online" />
                      <span>
                        <strong>{lead.displayName}</strong>
                        <small>{lead.areas.map((area) => area.name).join(", ")}</small>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="table-secondary">Nessun Capo Area risulta online in questo momento.</p>
                )}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel__header"><div><h2>Azioni rapide</h2><p>Le operazioni più frequenti</p></div></div>
            <div className="panel__body quick-actions">
              {quickActions.map(({ to, label, description, icon: Icon }) => (
                <Link className="quick-action" to={to} key={to}>
                  <span className="quick-action__icon"><Icon size={19} /></span>
                  <span><strong>{label}</strong><small>{description}</small></span>
                </Link>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div><h2>Accesso e dati</h2><p>Protezione attiva</p></div>
              <StatusBadge label="RLS" tone="success" />
            </div>
            <div className="panel__body security-note">
              <p>{isAdmin ? "Il tuo account può amministrare tutte le aree e il calendario generale." : "Il database limita ogni lettura e modifica alle sole aree assegnate al tuo account."}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
