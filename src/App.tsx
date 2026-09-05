import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { LoadingScreen } from "./components/LoadingScreen";
import { PasswordGate } from "./components/PasswordGate";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./hooks/useAuth";

const AreasPage = lazy(() =>
  import("./pages/AreasPage").then((module) => ({ default: module.AreasPage })),
);
const AnnouncementsPage = lazy(() =>
  import("./pages/AnnouncementsPage").then((module) => ({ default: module.AnnouncementsPage })),
);
const AvailabilityPage = lazy(() =>
  import("./pages/AvailabilityPage").then((module) => ({ default: module.AvailabilityPage })),
);
const CalendarPage = lazy(() =>
  import("./pages/CalendarPage").then((module) => ({ default: module.CalendarPage })),
);
const CampaignsPage = lazy(() =>
  import("./pages/CampaignsPage").then((module) => ({ default: module.CampaignsPage })),
);
const ChangePasswordPage = lazy(() =>
  import("./pages/ChangePasswordPage").then((module) => ({ default: module.ChangePasswordPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const HelpPage = lazy(() =>
  import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })),
);
const LegalDocumentsPage = lazy(() =>
  import("./pages/LegalDocumentsPage").then((module) => ({ default: module.LegalDocumentsPage })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);
const PublicBookingPage = lazy(() =>
  import("./pages/PublicBookingPage").then((module) => ({ default: module.PublicBookingPage })),
);
const SessionsPage = lazy(() =>
  import("./pages/SessionsPage").then((module) => ({ default: module.SessionsPage })),
);
const AreaSessionsPage = lazy(() =>
  import("./pages/AreaSessionsPage").then((module) => ({ default: module.AreaSessionsPage })),
);
const RatingsPage = lazy(() =>
  import("./pages/RatingsPage").then((module) => ({ default: module.RatingsPage })),
);
const StaffPage = lazy(() =>
  import("./pages/StaffPage").then((module) => ({ default: module.StaffPage })),
);

function HomeRedirect() {
  const { access } = useAuth();
  return <Navigate to={access?.isAdmin ? "/admin" : "/area"} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/book/:token" element={<PublicBookingPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<PasswordGate />}>
            <Route element={<AppShell />}>
              <Route index element={<HomeRedirect />} />

              <Route path="/area" element={<DashboardPage />} />
              <Route path="/area/disponibilita" element={<AvailabilityPage />} />
              <Route path="/area/sessioni" element={<AreaSessionsPage />} />
              <Route path="/area/calendario" element={<CalendarPage />} />
              <Route path="/area/votazioni" element={<RatingsPage />} />
              <Route path="/area/bacheca" element={<AnnouncementsPage />} />
              <Route path="/area/assistenza" element={<HelpPage />} />

              <Route element={<ProtectedRoute adminOnly />}>
                <Route path="/admin" element={<DashboardPage />} />
                <Route path="/admin/disponibilita" element={<AvailabilityPage />} />
                <Route path="/admin/calendario" element={<CalendarPage />} />
                <Route path="/admin/sessioni" element={<SessionsPage />} />
                <Route path="/admin/votazioni" element={<RatingsPage />} />
                <Route path="/admin/bacheca" element={<AnnouncementsPage />} />
                <Route path="/admin/assistenza" element={<HelpPage />} />
                <Route path="/admin/aree" element={<AreasPage />} />
                <Route path="/admin/recruitment" element={<CampaignsPage />} />
                <Route path="/admin/account" element={<StaffPage />} />
                <Route path="/admin/legal" element={<LegalDocumentsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
