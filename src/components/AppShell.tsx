import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelsTopLeft,
  UsersRound,
  Warehouse,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Brand } from "./Brand";

const adminNavigation = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/disponibilita", label: "Disponibilità", icon: Warehouse },
  { to: "/admin/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/admin/aree", label: "Aree", icon: PanelsTopLeft },
  { to: "/admin/recruitment", label: "Recruitment", icon: CalendarRange },
  { to: "/admin/account", label: "Account", icon: UsersRound },
];

const areaNavigation = [
  { to: "/area", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/area/disponibilita", label: "Disponibilità", icon: Warehouse },
  { to: "/area/sessioni", label: "Sessioni e slot", icon: ClipboardList },
  { to: "/area/calendario", label: "Calendario", icon: CalendarDays },
];

export function AppShell() {
  const { access, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigation = access?.isAdmin ? adminNavigation : areaNavigation;
  const areaLabel = access?.isAdmin
    ? "Amministrazione"
    : access?.areas.map((area) => area.name).join(", ") || "Area";

  return (
    <div className="app-shell">
      <button
        className="mobile-menu-button"
        type="button"
        aria-label={mobileOpen ? "Chiudi menu" : "Apri menu"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((value) => !value)}
      >
        {mobileOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Chiudi menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar__brand">
          <Brand />
        </div>

        <div className="workspace-chip">
          <span>Spazio di lavoro</span>
          <strong>{areaLabel}</strong>
          <ChevronDown size={16} aria-hidden="true" />
        </div>

        <nav className="sidebar__nav" aria-label="Navigazione principale">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive ? "nav-item--active" : ""}`
              }
            >
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="user-summary">
            <span className="user-summary__avatar">
              {access?.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{access?.displayName}</strong>
              <small>{areaLabel}</small>
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Esci"
            title="Esci"
            onClick={() => void signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}

