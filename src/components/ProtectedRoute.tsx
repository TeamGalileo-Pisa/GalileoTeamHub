import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { LoadingScreen } from "./LoadingScreen";

export function ProtectedRoute({ adminOnly = false }: { adminOnly?: boolean }) {
  const { access, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Verifica accesso" />;

  if (!access) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (adminOnly && !access.isAdmin) {
    return <Navigate to="/area" replace />;
  }

  return <Outlet />;
}

