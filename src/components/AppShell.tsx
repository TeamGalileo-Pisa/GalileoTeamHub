import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardList,
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
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getUnreadAnnouncementCount, getUnreadNotificationCount, listNotifications } from "../lib/data";
import { supabase } from "../lib/supabase";
import { enablePush, disablePush, pushIsReady } from "../lib/push";
import { Brand } from "./Brand";
import { Capacitor } from "@capacitor/core";

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

export function AppShell() {
  const { access, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unreadQuery = useQuery({
    queryKey: ["unread-announcements", access?.userId],
    queryFn: getUnreadAnnouncementCount,
    enabled: Boolean(access),
  });

  useQuery({
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
  const [pushStatus,setPushStatus] = useState("");
  const [pushState,setPushState] = useState<{ userId: string; ready: boolean } | null>(null);
  const [pushBusy,setPushBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!access?.userId) return () => { active = false; };
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
  }, [access?.userId]);

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
  const navigation = access?.isAdmin ? adminNavigation : access?.isMember ? [
    {to:"/membri",label:"Bacheca",icon:Megaphone,end:true},
    {to:"/membri/adesione",label:"Modulo di adesione",icon:FileText},
    {to:"/merchandising",label:"Merchandising",icon:ShoppingBag},
  ] : isLogisticsLead ? areaNavigation : areaNavigation.filter((item) => item.to !== "/merchandising");
  const notificationCount = (unreadNotificationQuery.data ?? 0) + (unreadQuery.data ?? 0);
  const areaLabel = access?.isAdmin
    ? access.isTeamLeader ? "Team Leader" : "Amministrazione"
    : access?.areas.map((area) => area.name).join(", ") || "Area";

  const handleSignOut = async () => {
    try {
      await disablePush();
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
      setPushState({ userId, ready: await pushIsReady() });
      setPushStatus("Notifiche attive su questo dispositivo.");
    } catch (error) {
      setPushStatus(error instanceof Error ? error.message : "Attivazione notifiche non riuscita.");
      if (access?.userId) setPushState({ userId: access.userId, ready: false });
    } finally {
      setPushBusy(false);
    }
  };

  const pushReady = Boolean(access?.userId && pushState?.userId === access.userId && pushState.ready);
  const pushCheckPending = Boolean(access?.userId && pushState?.userId !== access.userId);
  if (!pushReady) {
    const ua = navigator.userAgent;
    const isAppleTouch = /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installInstructions = Capacitor.isNativePlatform()
      ? "Consenti GalileoHub nelle impostazioni Notifiche del dispositivo, poi tocca Riprova."
      : isAppleTouch
      ? "Apri questo sito in Safari, usa Condividi → Aggiungi alla schermata Home e avvia GalileoHub dalla nuova icona. Le notifiche web richiedono iOS/iPadOS 16.4 o successivo."
      : /Macintosh|Mac OS X/.test(ua)
      ? "Installa GalileoHub dal menu del browser (in Safari: File → Aggiungi al Dock), poi riaprilo dall’icona installata."
      : "Installa GalileoHub dal menu o dall’icona di installazione del browser, poi riaprilo dall’icona dell’app.";

    return <main className="page-container" style={{ maxWidth: 680, margin: "auto", padding: 24 }}>
      <Brand />
      <section className="panel" aria-labelledby="required-push-title" style={{ marginTop: 32 }}>
        <h1 id="required-push-title">Attiva le notifiche per continuare</h1>
        <p>Le notifiche push sono obbligatorie per usare GalileoHub su questo dispositivo. Riceverai avvisi su comunicazioni, ordini e attività assegnate.</p>
        <p>{installInstructions}</p>
        {pushCheckPending && <p role="status">Verifica delle notifiche in corso…</p>}
        {pushStatus && <p role="alert">{pushStatus}</p>}
        <button className="button button--primary" type="button" disabled={pushBusy} onClick={() => void handleEnablePush()}>
          {pushBusy ? "Attivazione…" : "Attiva notifiche e continua"}
        </button>
        <button className="button button--secondary" type="button" style={{ marginLeft: 8 }} onClick={() => void handleSignOut()}>
          Esci
        </button>
      </section>
    </main>;
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
          <button className="icon-button" type="button" aria-label="Verifica notifiche push" title="Notifiche push attive" onClick={() => { if(access?.userId) void pushIsReady().then((ready)=>setPushState({userId:access.userId,ready})); }}><Megaphone size={18}/></button>
          {pushStatus && <p role="status" style={{fontSize:12}}>{pushStatus}</p>}
          <button className="icon-button" type="button" aria-label="Esci" title="Esci" onClick={() => void handleSignOut()}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="app-content"><Outlet /></main>
    </div>
  );
}

