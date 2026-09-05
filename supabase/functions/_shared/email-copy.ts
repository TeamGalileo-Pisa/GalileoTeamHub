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
  custom_message?: string;
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

const meetingRoomNote =
  '(NB: Se hai il colloquio in "Aula Riunioni 5067" attendere al secondo piano del Polo A di ingegneria, davanti all’aula A28 tra Bagno ed Ascensore, un membro del team verrà a prendervi.)';

function needsMeetingRoomNote(roomName: string): boolean {
  return roomName.toLocaleLowerCase("it").includes("riunioni 5067");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function paragraphs(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function detailRows(payload: DeliveryPayload): string {
  const rows = [
    ["Giorno", day.format(new Date(payload.starts_at))],
    [
      "Orario",
      `${time.format(new Date(payload.starts_at))} - ${time.format(new Date(payload.ends_at))}`,
    ],
    ["Aula", payload.room_name],
    ["Area", payload.area_name],
  ];
  return rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;color:#667085;font-size:14px;vertical-align:top;width:92px;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;color:#101828;font-size:15px;font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");
}

function htmlLayout(input: {
  title: string;
  greeting: string;
  intro: string;
  payload: DeliveryPayload;
  message?: string;
  note?: string;
}): string {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#101828;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f7fa;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;border:1px solid #e4e7ec;">
          <tr>
            <td style="padding:28px 24px 12px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475467;">Team Galileo</div>
              <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#101828;">${escapeHtml(input.title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 24px;">
              <p style="margin:0 0 12px;font-size:16px;line-height:1.55;">${escapeHtml(input.greeting)}</p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#344054;">${escapeHtml(input.intro)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f9fafb;border-radius:10px;padding:12px 16px;">
                ${detailRows(input.payload)}
              </table>
              ${
                input.message
                  ? `<div style="margin-top:18px;padding:14px 16px;border-left:4px solid #98a2b3;background:#f9fafb;border-radius:6px;font-size:15px;line-height:1.6;">${paragraphs(input.message)}</div>`
                  : ""
              }
              <p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#344054;">Per eventuali contrattempi, avvisaci appena possibile rispondendo a questa email. La puntualità e il rispetto dell’impegno preso ci aiutano a organizzare al meglio i colloqui.</p>
              ${
                input.note
                  ? `<p style="margin:18px 0 0;padding:12px 14px;background:#fff7ed;border-radius:8px;font-size:13px;line-height:1.55;color:#7c2d12;">${escapeHtml(input.note)}</p>`
                  : ""
              }
              <p style="margin:24px 0 0;font-size:15px;line-height:1.6;">Team Galileo</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function emailCopy(payload: DeliveryPayload) {
  const details = [
    `Giorno: ${day.format(new Date(payload.starts_at))}`,
    `Orario: ${time.format(new Date(payload.starts_at))} - ${time.format(new Date(payload.ends_at))}`,
    `Aula: ${payload.room_name}`,
    `Area: ${payload.area_name}`,
  ];
  const roomNote = needsMeetingRoomNote(payload.room_name)
    ? meetingRoomNote
    : undefined;

  if (payload.kind === "booking_confirmation") {
    const subject = "Conferma colloquio · Team Galileo";
    const intro = "La tua prenotazione è confermata. Ecco i dettagli del colloquio:";
    return {
      subject,
      text: [
        `Ciao ${payload.candidate_name},`,
        "",
        intro,
        "",
        ...details,
        "",
        "Per eventuali contrattempi, avvisaci appena possibile rispondendo a questa email.",
        "La puntualità e il rispetto dell’impegno preso ci aiutano a organizzare al meglio i colloqui.",
        ...(roomNote ? ["", roomNote] : []),
        "",
        "Team Galileo",
      ].join("\n"),
      html: htmlLayout({
        title: "Prenotazione confermata",
        greeting: `Ciao ${payload.candidate_name},`,
        intro,
        payload,
        note: roomNote,
      }),
    };
  }

  const heading = {
    booking_changed:
      "Il tuo appuntamento è stato modificato. Ecco i nuovi dettagli:",
    booking_cancelled:
      "Il tuo appuntamento è stato annullato. Non è più necessario presentarti per questo colloquio:",
    booking_reminder: "Ti ricordiamo il tuo appuntamento:",
  }[payload.kind];
  const subject =
    payload.kind === "booking_cancelled"
      ? "Colloquio annullato · Team Galileo"
      : payload.kind === "booking_changed"
        ? "Colloquio modificato · Team Galileo"
        : "Promemoria colloquio · Team Galileo";
  const customMessage =
    payload.kind === "booking_reminder" && payload.custom_message?.trim()
      ? payload.custom_message.trim()
      : undefined;

  return {
    subject,
    text: [
      `Ciao ${payload.candidate_name},`,
      "",
      heading,
      "",
      ...details,
      ...(customMessage ? ["", "Messaggio del Capo Area:", customMessage] : []),
      ...(roomNote ? ["", roomNote] : []),
      "",
      "Per comunicazioni rispondi a questa email.",
      "",
      "Team Galileo",
    ].join("\n"),
    html: htmlLayout({
      title:
        payload.kind === "booking_cancelled"
          ? "Colloquio annullato"
          : payload.kind === "booking_changed"
            ? "Colloquio modificato"
            : "Promemoria colloquio",
      greeting: `Ciao ${payload.candidate_name},`,
      intro: heading,
      payload,
      message: customMessage,
      note: roomNote,
    }),
  };
}
