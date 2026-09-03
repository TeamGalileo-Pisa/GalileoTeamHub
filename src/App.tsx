import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PublicBookingPage } from './pages/PublicBookingPage';
import { AreasPage } from './pages/AreasPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rotta pubblica per il calendario unico dell'Area */}
        <Route path="/prenota/:areaSlug" element={<PublicBookingPage />} />
        
        {/* Rotte Protette / Admin */}
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppShell>
                <Routes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/aree" element={<AreasPage />} />
                  <Route path="/disponibilita" element={<AvailabilityPage />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </AppShell>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;