// Il logo del modulo PDF e' un file pubblico del sito (public/membership-logo.png):
// non va incorporato nella funzione. Se non e' raggiungibile il PDF viene generato senza logo.
// Questo file e' condiviso con il frontend (tsc non conosce Deno): lo si legge da globalThis.
type DenoLike = { env: { get(name: string): string | undefined } };
const appUrl = () => ((globalThis as { Deno?: DenoLike }).Deno?.env.get("PUBLIC_APP_URL") ?? "https://galileohub.info-teamgalileo.workers.dev").replace(/\/$/, "");

export async function membershipLogoBytes(): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`${appUrl()}/membership-logo.png`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Firma PNG: evita di incorporare per errore una pagina HTML.
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? bytes : null;
  } catch {
    return null;
  }
}
