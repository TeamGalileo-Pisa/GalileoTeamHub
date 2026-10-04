import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";
import { sendGmailMessage } from "./email.ts";
import { membershipPdf } from "../../../src/lib/membership-pdf.ts";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!),
  );
export async function processCommunityMail(client: SupabaseClient) {
  if (Deno.env.get("EMAIL_PROVIDER") !== "gmail") return;
  const { data: rows, error } = await client.rpc("claim_community_mail");
  if (error) throw error;
  for (const row of rows ?? []) {
    try {
      let subject: string;
      let text: string;
      let attachments: { name: string; content: Uint8Array }[] | undefined;
      if (row.kind === "invitation") {
        subject = "Team Galileo - Compila il modulo di adesione";
        text =
          "Ciao,\n\ncompila il modulo personale di adesione al Team Galileo usando questo link, valido per 14 giorni:\n" +
          row.payload.url +
          "\n\nRiceverai il PDF da stampare, firmare e consegnare.\n\nTeam Leader | Team Galileo";
      } else if (row.kind === "membership") {
        subject = "Modulo di Adesione Team Galileo - Da stampare e firmare";
        text = "Ciao " + row.payload.firstName +
          ",\n\nin allegato trovi il Modulo di adesione compilato con i tuoi dati.\nTi chiediamo di stamparlo, apporre la tua firma e consegnarlo.\n\nCordiali saluti,\nMario De Lumé\nTeam Leader | Team Galileo\nUniversità di Pisa";
        attachments = [{
          name: "Modulo-adesione-Team-Galileo.pdf",
          content: await membershipPdf(row.payload),
        }];
      } else {
        subject = "[Team Galileo] - Grazie per il tuo interesse!";
        text = "Ciao " + row.payload.firstName +
          ",\n\nGrazie mille per aver compilato il nostro form e per aver manifestato il tuo interesse verso il Team Galileo. Siamo davvero felici di vedere così tanto entusiasmo per questo progetto fin dalla sua fase iniziale di nascita e costruzione!\n\nChe tu abbia un background ingegneristico, scientifico o gestionale, il tuo contributo sarà fondamentale per dare vita al team e iniziare a progettare da zero il nostro rover per la European Rover Challenge (ERC).\n\nI responsabili delle divisioni ti contatteranno per concordare il colloquio. Questa email conferma la candidatura: la conferma della prenotazione riporterà data, ora e aula.\n\nSeguici su Instagram https://www.instagram.com/team_galileo_pisa e LinkedIn https://www.linkedin.com/company/team-galileo/\n\nCordiali saluti,\nMario De Lumé\nTeam Leader | Team Galileo\nUniversità di Pisa\ninfo.teamgalileo@gmail.com\nhttps://info-teamgalileo.netlify.app";
      }
      await sendGmailMessage({
        to: row.recipient,
        subject,
        text,
        html:
          '<div style="font-family:Verdana,sans-serif;white-space:pre-wrap">' +
          escape(text) + "</div>",
        attachments,
        idempotencyId: row.id,
        reconcileOnly: row.uncertain,
      });
      const { error: ack } = await client.from("community_outbox").update({
        state: "sent",
        last_error: null,
      }).eq("id", row.id).eq("attempts", row.attempts).eq("state", "sending");
      if (ack) throw new Error("EMAIL_ACK_FAILED");
    } catch (error) {
      const message = error instanceof Error ? error.message : "EMAIL_FAILED";
      await client.from("community_outbox").update({
        state: "failed",
        uncertain: row.uncertain ||
          ["GMAIL_SEND_UNCERTAIN", "EMAIL_ACK_FAILED"].includes(message),
        last_error: message,
        next_attempt_at: new Date(
          Date.now() + Math.pow(2, row.attempts) * 60000,
        ).toISOString(),
      }).eq("id", row.id).eq("attempts", row.attempts).eq("state", "sending");
    }
  }
}
