import { LoaderCircle } from "lucide-react";

export function LoadingScreen({ label = "Caricamento" }: { label?: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={28} />
      <span>{label}…</span>
    </div>
  );
}

