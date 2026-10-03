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
import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getUnreadAnnouncementCount, getUnreadNotificationCount, listNotifications } from "../lib/data";
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

  const notificationQuery = useQuery({
    queryKey: ["system-notifications", access?.userId],
    queryFn: listNotifications,
    enabled: Boolean(access),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const unreadNotificationQuery = useQuery({
    queryKey: ["unread-notifications", access?.userId],
    queryFn: getUnreadNotificationCount,
    enabled: Boolean(access),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const previousNotificationCount = useRef<number | null>(null);

  const reportPresence = useCallback(async () => {
    if (!access?.userId || document.visibilityState === "hidden") return;
    await supabase.rpc("touch_user_presence", { p_path: location.pathname });
  }, [access?.userId, location.pathname]);

  useEffect(() => {
    const notifications = notificationQuery.data ?? [];
    const latestUnread = notifications.filter((item) => !item.readAt);
    if (
      previousNotificationCount.current !== null &&
      latestUnread.length > previousNotificationCount.current &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      document.visibilityState !== "visible"
    ) {
      const item = latestUnread[0];
      new Notification(item.title, { body: item.body, icon: "/icons/galileohub-192-v2.png" });
    }
    previousNotificationCount.current = latestUnread.length;
  }, [notificationQuery.data]);

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
  const notificationCount = (unreadNotificationQuery.data ?? 0) + (unreadQuery.data ?? 0);
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
              {label === "Bacheca" && notificationCount > 0 && (
                <span className="nav-badge" aria-label={`${notificationCount} notifiche non lette`}>
                  {notificationCount}
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
          {"Notification" in window && Notification.permission !== "granted" && (
            <button
              className="icon-button"
              type="button"
              aria-label="Attiva notifiche"
              title="Attiva notifiche"
              onClick={() => void Notification.requestPermission()}
            >
              <Megaphone size={18} />
            </button>
          )}
          <button className="icon-button" type="button" aria-label="Esci" title="Esci" onClick={() => void handleSignOut()}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="app-content"><Outlet /></main>
    </div>
  );
}
