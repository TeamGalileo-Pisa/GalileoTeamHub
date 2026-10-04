import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { community } from "../lib/community";

export function MemberAdhesionPage() {
  const link = useQuery({
    queryKey: ["membership-public-link"],
    queryFn: () => community<{ url: string }>({ action: "get_membership_public_link" }),
  });

  return <div className="page-container">
    <PageHeader title="Modulo di adesione" eyebrow="Area membri" description="Apri il link pubblico condiviso. Compila il tuo modulo: la bozza si salva automaticamente e il PDF personale ti verrà inviato via email al termine." />
    {link.isPending && <p role="status">Caricamento del link…</p>}
    {link.error && <p role="alert" className="form-error">{link.error.message}</p>}
    {link.data && <a className="button button--primary" href={link.data.url}>Apri modulo di adesione</a>}
  </div>;
}

