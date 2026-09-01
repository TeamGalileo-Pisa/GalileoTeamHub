import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { formatBookingDay, formatTimeRange, groupByDay } from "../lib/dates";
import { listUpcomingInterviews } from "../lib/data";

export function CalendarPage() {
  const { access } = useAuth();
  const query = useQuery({
    queryKey: ["calendar-interviews", access?.userId],
    queryFn: listUpcomingInterviews,
  });
  const days = groupByDay(query.data ?? []);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={access?.isAdmin ? "Calendario generale" : "Calendario area"}
        title="Prossimi colloqui"
        description={
          access?.isAdmin
            ? "Tutte le aree, le aule e gli appuntamenti confermati in ordine cronologico."
            : "Sono visibili esclusivamente candidati e appuntamenti delle aree assegnate."
        }
      />

      {query.isLoading ? (
        <section className="panel table-loading">Caricamento calendario…</section>
      ) : days.length ? (
        <div className="calendar-days">
          {days.map((day) => (
            <section className="panel calendar-day" key={day.date.toISOString()}>
              <div className="calendar-day__date">
                <CalendarDays size={20} />
                <h2>{formatBookingDay(day.items[0].startsAt)}</h2>
                <span>{day.items.length} colloqui</span>
              </div>
              <div className="calendar-day__appointments">
                {day.items.map((interview) => (
                  <article className="appointment-row" key={interview.bookingId}>
                    <time>{formatTimeRange(interview.startsAt, interview.endsAt)}</time>
                    <span className="appointment-row__line" />
                    <div>
                      <strong>{interview.candidateName}</strong>
                      <small>{interview.candidateEmail}</small>
                    </div>
                    <div>
                      <strong>{interview.areaName}</strong>
                      <small>{interview.roomName}</small>
                    </div>
                    <StatusBadge label="Confermato" tone="success" />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            icon={CalendarDays}
            title="Calendario libero"
            description="Non ci sono colloqui confermati nelle prossime giornate."
          />
        </section>
      )}
    </div>
  );
}

