import { useEffect, useId, useRef, type ReactNode } from "react";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="management-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="panel__header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="button button--secondary button--small"
          onClick={onClose}
          aria-label="Chiudi finestra"
        >
          Chiudi
        </button>
      </div>
      <div className="panel__body">{children}</div>
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <p>{description}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          className="button button--secondary"
          disabled={pending}
          onClick={onClose}
        >
          Indietro
        </button>
        <button
          className="button button--danger"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Operazione…" : "Conferma"}
        </button>
      </div>
    </Modal>
  );
}
