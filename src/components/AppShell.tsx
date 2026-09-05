import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  HelpCircle,
  LogOut,
  Menu,
  PanelsTopLeft,
  Megaphone,
  UsersRound,
  Warehouse,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getUnreadAnnouncementCount } from "../lib/data";
import { supabase } from "../lib/supabase";
import { Brand } from "./Brand";

const adminNavigation = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/disponibilita", label: "Disponibilità", icon: Warehouse },
  { to: "/admin/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/admin/sessioni", label: "Sessioni e slot", icon: ClipboardList },
  { to: "/admin/votazioni", label: "Votazioni", icon: ClipboardList },
  { to: "/admin/bacheca", label: "Bacheca", icon: Megaphone },
  { to: "/admin/aree", label: "Aree", icon: PanelsTopLeft },
  { to: "/admin/recruitment", label: "Recruitment", icon: CalendarRange },
  { to: "/admin/account", label: "Account", icon: UsersRound },
  { to: "/admin/legal", label: "Termini e Privacy", icon: FileText },
  { to: "/admin/assistenza", label: "Assistenza", icon: HelpCircle },
];

const areaNavigation = [
  { to: "/area", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/area/disponibilita", label: "Disponibilità", icon: Warehouse },
  { to: "/area/sessioni", label: "Sessioni e slot", icon: ClipboardList },
  { to: "/area/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/area/votazioni", label: "Votazioni", icon: ClipboardList },
  { to: "/area/bacheca", label: "Bacheca", icon: Megaphone },
  { to: "/area/assistenza", label: "Assistenza", icon: HelpCircle },
];

export function AppShell() {
  const { access, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unreadQuery = useQuery({
    queryKey: ["unread-announcements", access?.userId],
    queryFn: getUnreadAnnouncementCount,
    enabled: Boolean(access),
  });

  const reportPresence = useCallback(async () => {
    if (!access?.userId || document.visibilityState === "hidden") return;
    await supabase.rpc("touch_user_presence", { p_path: location.pathname });
  }, [access?.userId, location.pathname]);

  useEffect(() => {
    if (!access?.userId) return;
    void reportPresence();
    const timer = window.setInterval(() => void reportPresence(), 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reportPresence();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [access?.userId, reportPresence]);

  const navigation = access?.isAdmin ? adminNavigation : areaNavigation;
  const areaLabel = access?.isAdmin
    ? "Amministrazione"
    : access?.areas.map((area) => area.name).join(", ") || "Area";

  const handleSignOut = async () => {
    try {
      await supabase.rpc("mark_user_offline");
    } finally {
      await signOut();
    }
  };

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
        <div className="sidebar__brand"><Brand /></div>

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
              className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Bacheca" && (unreadQuery.data ?? 0) > 0 && (
                <span className="nav-badge" aria-label={`${unreadQuery.data} comunicazioni non lette`}>
                  {unreadQuery.data}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="user-summary">
            <span className="user-summary__avatar">{access?.displayName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{access?.displayName}</strong><small>{areaLabel}</small></span>
          </div>
          <button className="icon-button" type="button" aria-label="Esci" title="Esci" onClick={() => void handleSignOut()}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="app-content"><Outlet /></main>
    </div>
  );
}
