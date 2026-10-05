import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  BellRing,
  FileText,
  LayoutDashboard,
  ShoppingBag,
  HelpCircle,
  LogOut,
  Menu,
  PanelsTopLeft,
  Megaphone,
  UsersRound,
  Warehouse,
  X,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getUnreadAnnouncementCount, getUnreadNotificationCount, listNotifications } from "../lib/data";
import { supabase } from "../lib/supabase";
import { enablePush, isMobileNotificationDevice, pushIsReady } from "../lib/push";
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
  { to: "/admin/candidature", label: "Candidature e adesioni", icon: FileText },
  { to: "/merchandising", label: "Merchandising", icon: ShoppingBag },
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
  { to: "/merchandising", label: "Merchandising", icon: ShoppingBag },
];
const inventoryNavigation = { to: "/magazzino", label: "Magazzino", icon: Warehouse, end: false };

export function AppShell() {
  const { access, signOut } = useAuth();
  const location = useLocation();
  const mobileNotificationsEnabled = isMobileNotificationDevice();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unreadQuery = useQuery({
    queryKey: ["unread-announcements", access?.userId],
    queryFn: getUnreadAnnouncementCount,
    enabled: Boolean(access && mobileNotificationsEnabled),
  });

  useQuery({
    queryKey: ["system-notifications", access?.userId],
    queryFn: listNotifications,
    enabled: Boolean(access && mobileNotificationsEnabled),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const unreadNotificationQuery = useQuery({
    queryKey: ["unread-notifications", access?.userId],
    queryFn: getUnreadNotificationCount,
    enabled: Boolean(access && mobileNotificationsEnabled),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const openApplicationAreas = useQuery({
    queryKey: ["my-open-application-areas", access?.userId],
    enabled: Boolean(access && !access.isAdmin && !access.isMember),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_open_application_areas");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [pushStatus,setPushStatus] = useState("");
  const [pushState,setPushState] = useState<{ userId: string; ready: boolean } | null>(null);
  const [pushBusy,setPushBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!access?.userId) return () => { active = false; };
    if (!mobileNotificationsEnabled) {
      queueMicrotask(() => {
        if (active) setPushState({ userId: access.userId, ready: true });
      });
      return () => { active = false; };
    }
    const refresh = () => {
      void pushIsReady().then((ready) => {
        if (active) setPushState({ userId: access.userId, ready });
      }).catch(() => {
        if (active) setPushState({ userId: access.userId, ready: false });
      });
    };
    refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [access?.userId, mobileNotificationsEnabled]);

  useEffect(() => {
    const notify=(event:Event)=>setPushStatus((event as CustomEvent<string>).detail);
    window.addEventListener('galileo-native-notice',notify);
    return ()=>window.removeEventListener('galileo-native-notice',notify);
  },[]);
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

  const isLogisticsLead = Boolean(access?.areas.some((area) => area.slug === "logistica"));
  const navigation = access?.isAdmin ? access.isTeamLeader ? [...adminNavigation, inventoryNavigation] : adminNavigation : access?.isMember ? [
    {to:"/membri",label:"Bacheca",icon:Megaphone,end:true},
    {to:"/membri/adesione",label:"Modulo di adesione",icon:FileText},
    {to:"/merchandising",label:"Merchandising",icon:ShoppingBag},
    ...(access.areas.some((area) => area.slug === "logistica") ? [inventoryNavigation] : []),
  ] : (() => {
    const items = isLogisticsLead ? [...areaNavigation] : areaNavigation.filter((item) => item.to !== "/merchandising");
    if (isLogisticsLead) items.push(inventoryNavigation);
    if ((openApplicationAreas.data?.length ?? 0) > 0) {
      const merchIndex = items.findIndex((item) => item.to === "/merchandising");
      items.splice(merchIndex < 0 ? items.length : merchIndex, 0,
        { to: "/area/candidature", label: "Candidature", icon: FileText });
    }
    return items;
  })();
  const notificationCount = mobileNotificationsEnabled
    ? (unreadNotificationQuery.data ?? 0) + (unreadQuery.data ?? 0)
    : 0;
  const areaLabel = access?.isAdmin
    ? access.isTeamLeader ? "Team Leader" : "Amministrazione"
    : access?.areas.map((area) => area.name).join(", ") || "Area";

  const handleSignOut = async () => {
    try {
      await supabase.rpc("mark_user_offline");
    } finally {
      await signOut();
    }
  };

  const handleEnablePush = async () => {
    const userId = access?.userId;
    if (!userId) return;
    setPushBusy(true);
    setPushStatus("");
    try {
      await enablePush();
      setPushState({ userId, ready: true });
      setPushStatus("Notifiche attive su questo dispositivo.");
    } catch (error) {
      setPushStatus(error instanceof Error ? error.message : "Attivazione notifiche non riuscita.");
      if (access?.userId) setPushState({ userId: access.userId, ready: false });
    } finally {
      setPushBusy(false);
    }
  };

  const pushReady = Boolean(access?.userId && pushState?.userId === access.userId && pushState.ready);
  const pushCheckPending = mobileNotificationsEnabled && Boolean(access?.userId && pushState?.userId !== access.userId);
  const iosInstalledApp = window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  if (access && mobileNotificationsEnabled && !pushReady) {
    return (
      <main className="push-required-page">
        <div className="push-required-brand"><Brand /></div>
        <section className="push-required-card" aria-labelledby="push-required-title">
          <span className="push-required-icon"><BellRing size={24} /></span>
          <p className="eyebrow">Un ultimo passaggio</p>
          <h1 id="push-required-title">Attiva le notifiche</h1>
          <p className="push-required-copy">
            Le notifiche sono necessarie per usare GalileoHub da questo dispositivo. Ti avviseranno quando ci sono comunicazioni e aggiornamenti importanti.
          </p>
          <div className="push-required-note">
            <strong>Si attiva una sola volta</strong>
            <span>Dopo aver consentito le notifiche, entrerai direttamente nel sito ai prossimi accessi.</span>
          </div>
          {!Capacitor.isNativePlatform() && /iPhone|iPad|iPod/i.test(navigator.userAgent) && !iosInstalledApp && (
            <p className="push-required-help">Su iPhone e iPad, aggiungi prima GalileoHub alla schermata Home e aprilo da lì.</p>
          )}
          {pushCheckPending && <p className="push-required-status" role="status">Controllo delle notifiche in corso…</p>}
          {pushStatus && <p className="push-required-error" role="alert">{pushStatus}</p>}
          <button className="button button--primary push-required-action" type="button" disabled={pushBusy || pushCheckPending} onClick={() => void handleEnablePush()}>
            <BellRing size={17} /> {pushBusy ? "Attivazione in corso…" : pushCheckPending ? "Verifica in corso…" : "Attiva e continua"}
          </button>
          <button className="push-required-signout" type="button" onClick={() => void handleSignOut()}>Esci dall’account</button>
        </section>
      </main>
    );
  }

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
          {mobileNotificationsEnabled && pushReady && <span className="push-ready-label" role="status"><BellRing size={15} /> Notifiche attive</span>}
          {mobileNotificationsEnabled && pushStatus && <p className="push-status" role="status">{pushStatus}</p>}
          <button className="icon-button" type="button" aria-label="Esci" title="Esci" onClick={() => void handleSignOut()}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main id="main-content" className="app-content app-main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
