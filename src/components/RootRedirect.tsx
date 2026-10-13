import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { LoadingScreen } from "./LoadingScreen";

/** "/" never shows a landing page: it sends people to the app or to the login. */
export function RootRedirect() {
  const { access, loading } = useAuth();
  if (loading) return <LoadingScreen label="Apertura GalileoHub" />;
  const destination = access?.isAdmin
    ? "/admin"
    : access?.isMember
      ? "/membri"
      : access
        ? "/area"
        : "/login";
  return <Navigate to={destination} replace />;
}
