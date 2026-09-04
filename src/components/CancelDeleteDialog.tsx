import { ArchiveX, Trash2 } from "lucide-react";
import { Modal } from "./Modal";

export function CancelDeleteDialog({
  title,
  description,
  itemLabel,
  pending,
  error,
  onClose,
  onCancelOnly,
  onCancelAndDelete,
}: {
  title: string;
  description: string;
  itemLabel: string;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onCancelOnly: () => void;
  onCancelAndDelete: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <p>{description}</p>
      <div className="cancel-delete-choices">
        <button
          type="button"
          className="lifecycle-choice lifecycle-choice--archive"
          disabled={pending}
          onClick={onCancelOnly}
        >
          <ArchiveX size={22} />
          <span>
            <strong>Annulla e conserva</strong>
            <small>
              {itemLabel} viene annullato ma rimane nello storico del gestionale e continua a essere visibile come annullato.
            </small>
          </span>
        </button>
        <button
          type="button"
          className="lifecycle-choice lifecycle-choice--delete"
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                `Confermi l'eliminazione definitiva? ${itemLabel} e i dati collegati previsti da questa operazione non saranno recuperabili.`,
              )
            ) {
              onCancelAndDelete();
            }
          }}
        >
          <Trash2 size={22} />
          <span>
            <strong>Annulla ed elimina definitivamente</strong>
            <small>
              Rimuove definitivamente {itemLabel.toLowerCase()} e i relativi dati collegati gestiti da questa operazione. Non è previsto recupero.
            </small>
          </span>
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button button--secondary" disabled={pending} onClick={onClose}>
          Indietro
        </button>
      </div>
    </Modal>
  );
}
