import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { LoadingScreen } from "./LoadingScreen";

export function ProtectedRoute({ adminOnly = false, staffOnly = false }: { adminOnly?: boolean; staffOnly?: boolean }) {
  const { access, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Verifica accesso" />;

  if (!access) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (staffOnly && access.isMember) return <Navigate to="/membri" replace />;

  if (adminOnly && !access.isAdmin) {
    return <Navigate to={access.isMember ? "/membri" : "/area"} replace />;
  }

  return <Outlet />;
}

