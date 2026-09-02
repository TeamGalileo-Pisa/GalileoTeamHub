export interface DeliveryPayload {
  delivery_id: string;
  attempt_count: number;
  reconcile_only?: boolean;
  kind:
    | "booking_confirmation"
    | "booking_reminder"
    | "booking_cancelled"
    | "booking_changed";
  to_email: string;
  candidate_name: string;
  area_name: string;
  room_name: string;
  starts_at: string;
  ends_at: string;
}
export const OFFICIAL_EMAIL_FROM =
  "Team Galileo Pisa <info.teamgalileo@gmail.com>";
const day = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const time = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
});

export function emailCopy(payload: DeliveryPayload) {
  const details = [
    `Giorno: ${day.format(new Date(payload.starts_at))}`,
    `Orario: ${time.format(new Date(payload.starts_at))} - ${time.format(new Date(payload.ends_at))}`,
    `Aula: ${payload.room_name}`,
    `Area: ${payload.area_name}`,
  ];
  if (payload.kind === "booking_confirmation")
    return {
      subject: "Colloqui Team Galileo",
      text: [
        "Grazie per aver selezionato il tuo slot orario.",
        "",
        "Ti ricordiamo che l’appuntamento che hai preso è:",
        "",
        ...details,
        "",
        "Ricordati di avvisare laddove avessi contrattempi.",
        "La puntualità e la presenza a un impegno preso sono sinonimi di maturità, quindi non mancare.",
        "",
        "Team Galileo",
      ].join("\n"),
    };
  const heading = {
    booking_changed:
      "Il tuo appuntamento è stato modificato. Ecco i nuovi dettagli:",
    booking_cancelled:
      "Il tuo appuntamento è stato annullato. Non è più necessario presentarti per questo colloquio:",
    booking_reminder: "Ti ricordiamo il tuo appuntamento:",
  }[payload.kind];
  return {
    subject:
      payload.kind === "booking_cancelled"
        ? "Colloquio annullato · Team Galileo"
        : payload.kind === "booking_changed"
          ? "Colloquio modificato · Team Galileo"
          : "Promemoria colloquio · Team Galileo",
    text: [
      `Ciao ${payload.candidate_name},`,
      "",
      heading,
      "",
      ...details,
      "",
      "Per comunicazioni rispondi a questa email.",
      "",
      "Team Galileo",
    ].join("\n"),
  };
}
