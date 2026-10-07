import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { MembershipQuestionnaire } from "../components/MembershipQuestionnaire";
import { Brand } from "../components/Brand";
import { community } from "../lib/community";
import type { MembershipAnswers } from "../lib/membership-form";

function draftKey(token: string | undefined) {
  return `galileo-public-membership-draft:${token ?? "invalid"}`;
}

function loadDraftId(token: string | undefined) {
  const key = draftKey(token);
  const existing = localStorage.getItem(key);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

export function MembershipPage() {
  const { token } = useParams();
  const [draftId, setDraftId] = useState(() => loadDraftId(token));
  const [submitted, setSubmitted] = useState(false);
  const loadDraft = useCallback(() => community<{ answers?: MembershipAnswers; submitted?: boolean }>({
    action: "get_membership_shared_draft",
    token,
    draftId,
  }), [token, draftId]);
  const saveDraft = useCallback((answers: MembershipAnswers) => community({
    action: "save_membership_shared_draft",
    token,
    draftId,
    data: answers,
  }), [token, draftId]);
  const submit = useCallback((answers: MembershipAnswers) => community({
    action: "submit_membership_shared_form",
    token,
    draftId,
    data: answers,
  }), [token, draftId]);
  const startNew = () => {
    const next = crypto.randomUUID();
    localStorage.setItem(draftKey(token), next);
    setDraftId(next);
  };

  return <main className="page-container" style={{ maxWidth: 900, margin: "auto", padding: 24 }}>
    <Brand />
    <h1>Team Galileo - Modulo di adesione</h1>
    <p>a.a. 2026/2027</p>
    {!submitted && <p>Questo link è condiviso con tutti i membri. Scegli la tua area e compila il modulo: le risposte vengono salvate automaticamente. La sezione Direzione tecnica compare solo se selezioni “Direzione tecnica/Responsabile”. Dopo l’invio riceverai il PDF personale via email, da stampare, firmare e consegnare.</p>}
    <MembershipQuestionnaire key={draftId} loadDraft={loadDraft} saveDraft={saveDraft} submit={submit} onNewDraft={startNew} onSubmittedChange={setSubmitted} />
  </main>;
}

