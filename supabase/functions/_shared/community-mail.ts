import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";
import { sendGmailMessage } from "./email.ts";
import { membershipPdf } from "./membership-pdf.ts";
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
function applicationConfirmationHtml(firstName: string) {
  const bodyStyle = 'font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#242424';
  const paragraphStyle = 'margin:0 0 18px 0';
  const linkStyle = 'color:#0563c1;text-decoration:underline';
  return `<div style="${bodyStyle}">
    <p style="${paragraphStyle}">Ciao ${escape(firstName)},</p>
    <p style="${paragraphStyle}">Grazie mille per aver compilato il nostro form e per aver manifestato il tuo interesse verso il Team Galileo. Siamo davvero felici di vedere così tanto entusiasmo per questo progetto fin dalla sua fase iniziale di nascita e costruzione!</p>
    <p style="${paragraphStyle}">Che tu abbia un background ingegneristico, scientifico o gestionale, il tuo contributo sarà fondamentale per dare vita al team e iniziare a progettare da zero il nostro rover per la <em>European Rover Challenge (ERC)</em>.</p>
    <p style="${paragraphStyle}">I colloqui stanno già iniziando: i responsabili delle divisioni ti contatteranno per concordare una data per il colloquio. Questa email conferma la candidatura; riceverai una comunicazione separata con i dettagli del colloquio dopo aver prenotato uno slot.</p>
    <p style="${paragraphStyle}">Nel frattempo, per rimanere sintonizzati e avere tutte le informazioni e gli aggiornamenti sul Team e sulle nostre attività, ti invitiamo a seguire la nostra pagina ufficiale su Instagram <a href="https://www.instagram.com/team_galileo_pisa" style="${linkStyle}">@team_galileo_pisa</a> e su LinkedIn <a href="https://www.linkedin.com/company/team-galileo/" style="${linkStyle}">Team Galileo</a>.</p>
    <p style="margin:0 0 2px 0">Cordiali saluti,</p>
    <p style="font-size:14pt;font-weight:bold;margin:0 0 4px 0">Team Galileo</p>
    <p style="font-weight:bold;margin:0 0 8px 0">Contatti del Team:</p>
    <p style="margin:0 0 6px 0">✉️ <a href="mailto:info.teamgalileo@gmail.com" style="${linkStyle}">info.teamgalileo@gmail.com</a></p>
    <p style="margin:0">🌐 <a href="https://info-teamgalileo.netlify.app" style="${linkStyle}">info-teamgalileo.netlify.app</a></p>
  </div>`;
}
function textToHtml(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((block) =>
    `<p style="margin:0 0 16px 0">${escape(block).replace(/\n/g, "<br>")}</p>`
  ).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#242424">${paragraphs}</div>`;
}
export async function processCommunityMail(client: SupabaseClient) {
  if (Deno.env.get("EMAIL_PROVIDER") !== "gmail") return;
  const { data: rows, error } = await client.rpc("claim_community_mail");
  if (error) throw error;
  for (const row of rows ?? []) {
    try {
      let subject: string;
      let text: string;
      let html: string | undefined;
      let cc: string | undefined;
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
          ",\n\nin allegato trovi il Modulo di adesione compilato con i tuoi dati.\n\nCosa devi fare:\n1. stampa il modulo;\n2. firmalo;\n3. consegnalo al Team Leader.\n\nCordiali saluti,\nMario De Lumé\nTeam Leader | Team Galileo\nUniversità di Pisa";
        attachments = [{
          name: "Modulo-adesione-Team-Galileo.pdf",
          content: await membershipPdf(row.payload),
        }];
      } else if (row.kind === "merch_order") {
        const lines = Array.isArray(row.payload.items) ? row.payload.items : [];
        const total = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" })
          .format(Number(row.payload.totalCents) / 100);
        const itemText = lines.map((item: Record<string, unknown>) =>
          `• ${String(item.productName)} · ${String(item.variantLabel)} × ${Number(item.quantity)} — ${new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(item.lineTotalCents) / 100)}`
        ).join("\n");
        const itemHtml = lines.map((item: Record<string, unknown>) =>
          `<li style="margin:0 0 8px 0">${escape(String(item.productName))} · ${escape(String(item.variantLabel))} × ${Number(item.quantity)} — ${new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(item.lineTotalCents) / 100)}</li>`
        ).join("");
        subject = "Richiesta ordine merchandising · Team Galileo";
        text = `Ciao ${row.payload.firstName},\n\nAbbiamo ricevuto la tua richiesta di ordine merchandising.\nNumero richiesta: ${row.payload.orderId}\n\n${itemText}\n\nTotale: ${total}\n\nLa logistica è in copia e ti confermerà la disponibilità e le modalità di ritiro.\n\nTeam Galileo`;
        html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#242424"><p>Ciao ${escape(String(row.payload.firstName))},</p><p>Abbiamo ricevuto la tua richiesta di ordine merchandising.</p><p><strong>Numero richiesta:</strong> ${escape(String(row.payload.orderId))}</p><ul style="padding-left:22px">${itemHtml}</ul><p><strong>Totale:</strong> ${total}</p><p>La logistica è in copia e ti confermerà la disponibilità e le modalità di ritiro.</p><p>Team Galileo</p></div>`;
        cc = "logistica.teamgalileo@gmail.com";
      } else {
        subject = "[Team Galileo] - Grazie per il tuo interesse!";
        text = "Ciao " + row.payload.firstName +
          ",\n\nGrazie mille per aver compilato il nostro form e per aver manifestato il tuo interesse verso il Team Galileo. Siamo davvero felici di vedere così tanto entusiasmo per questo progetto fin dalla sua fase iniziale di nascita e costruzione!\n\nChe tu abbia un background ingegneristico, scientifico o gestionale, il tuo contributo sarà fondamentale per dare vita al team e iniziare a progettare da zero il nostro rover per la European Rover Challenge (ERC).\n\nI responsabili delle divisioni ti contatteranno per concordare il colloquio. Questa email conferma la candidatura: la conferma della prenotazione riporterà data, ora e aula.\n\nSeguici su Instagram https://www.instagram.com/team_galileo_pisa e LinkedIn https://www.linkedin.com/company/team-galileo/\n\nCordiali saluti,\nTeam Galileo\ninfo.teamgalileo@gmail.com\nhttps://info-teamgalileo.netlify.app";
      }
      if (row.kind === "application") html = applicationConfirmationHtml(row.payload.firstName);
      await sendGmailMessage({
        to: row.recipient,
        cc,
        subject,
        text,
        html: html ?? textToHtml(text),
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

