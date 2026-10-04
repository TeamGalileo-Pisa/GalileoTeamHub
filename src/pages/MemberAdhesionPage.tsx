import { useCallback, useState } from "react";
import { MembershipQuestionnaire } from "../components/MembershipQuestionnaire";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { community } from "../lib/community";
import type { MembershipAnswers } from "../lib/membership-form";

const draftStorageKey = "galileo-membership-draft-id";

function getDraftId() {
  const existing = localStorage.getItem(draftStorageKey);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const draftId = crypto.randomUUID();
  localStorage.setItem(draftStorageKey, draftId);
  return draftId;
}

export function MemberAdhesionPage() {
  const { access } = useAuth();
  const [draftId, setDraftId] = useState(getDraftId);
  const loadDraft = useCallback(() => community<{ answers?: MembershipAnswers; submitted?: boolean }>({
    action: "get_member_adhesion_draft",
    draftId,
  }), [draftId]);
  const saveDraft = useCallback((answers: MembershipAnswers) => community({
    action: "save_member_adhesion_draft",
    draftId,
    data: answers,
  }), [draftId]);
  const submit = useCallback((answers: MembershipAnswers) => community({
    action: "submit_member_adhesion",
    draftId,
    data: answers,
  }), [draftId]);
  const startNew = () => {
    const nextId = crypto.randomUUID();
    localStorage.setItem(draftStorageKey, nextId);
    setDraftId(nextId);
  };

  return <div className="page-container">
    <PageHeader title="Modulo di adesione" eyebrow="Area membri" description="Compila il modulo ufficiale. La bozza si salva automaticamente; al termine riceverai il PDF da stampare, firmare e consegnare." />
    <p className="muted">Area dell'account: {access?.areas.map((a) => a.name).join(", ")}</p>
    <MembershipQuestionnaire key={draftId} loadDraft={loadDraft} saveDraft={saveDraft} submit={submit} onNewDraft={startNew} />
  </div>;
}

