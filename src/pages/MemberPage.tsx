import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/PageHeader";
export function MemberPage() {
  const query = useQuery({
    queryKey: ["member-announcements"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("member_announcements");
      if (error) throw error;
      return data as { id: string; title: string; body: string }[];
    },
  });
  return (
    <div className="page-container">
      <PageHeader
        title="Bacheca membri"
        eyebrow="La tua area"
        description="Comunicazioni del Team Galileo per i membri dell'area."
      />
      {query.error && <p role="alert">Impossibile caricare la bacheca.</p>}
      {query.data?.map((n) => (
        <article className="panel panel__body" key={n.id}>
          <h2>{n.title}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
        </article>
      ))}
      {query.data?.length === 0 && <p>Nessuna comunicazione.</p>}
    </div>
  );
}
