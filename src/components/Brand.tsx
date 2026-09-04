import { Orbit } from "lucide-react";
import { Link } from "react-router-dom";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="GalileoHub · Team Galileo Pisa">
      <span className="brand__mark" aria-hidden="true">
        <Orbit size={compact ? 20 : 24} strokeWidth={1.7} />
      </span>
      <span>
        <strong>GalileoHub</strong>
        {!compact && <small>Team Galileo Pisa</small>}
      </span>
    </Link>
  );
}

