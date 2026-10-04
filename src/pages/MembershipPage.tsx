import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { MembershipQuestionnaire } from "../components/MembershipQuestionnaire";
import { Brand } from "../components/Brand";
import { community } from "../lib/community";
import type { MembershipAnswers } from "../lib/membership-form";

export function MembershipPage() {
  const { token } = useParams();
  const loadDraft = useCallback(() => community<{ answers?: MembershipAnswers; submitted?: boolean }>({
    action: "get_membership_draft",
    token,
  }), [token]);
  const saveDraft = useCallback((answers: MembershipAnswers) => community({
    action: "save_membership_draft",
    token,
    data: answers,
  }), [token]);
  const submit = useCallback((answers: MembershipAnswers) => community({
    action: "submit_membership",
    token,
    data: answers,
  }), [token]);

  return <main className="page-container" style={{ maxWidth: 900, margin: "auto", padding: 24 }}>
    <Brand />
    <h1>Team Galileo - Modulo di adesione</h1>
    <p>a.a. 2026/2027</p>
    <p>La bozza viene salvata automaticamente. Dopo l'invio riceverai il PDF da stampare, firmare e consegnare.</p>
    <MembershipQuestionnaire key={token} loadDraft={loadDraft} saveDraft={saveDraft} submit={submit} />
  </main>;
}

