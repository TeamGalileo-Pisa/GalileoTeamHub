import { Orbit } from "lucide-react";
import { Link } from "react-router-dom";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="Team Galileo Colloqui">
      <span className="brand__mark" aria-hidden="true">
        <Orbit size={compact ? 20 : 24} strokeWidth={1.7} />
      </span>
      <span>
        <strong>Galileo</strong>
        {!compact && <small>Recruitment Hub</small>}
      </span>
    </Link>
  );
}

