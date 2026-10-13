import { BellRing, ChevronDown, LogOut, Menu, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getUnreadAnnouncementCount, getUnreadNotificationCount } from "../lib/data";
import { supabase } from "../lib/supabase";
import { enablePush, supportsPushNotifications, pushIsReady } from "../lib/push";
import { buildNavigation } from "../lib/navigation";
import { Brand } from "./Brand";

export function AppShell() {
  const { access, signOut } = useAuth();
  const location = useLocation();
  const pushSupported = supportsPushNotifications();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unreadQuery = useQuery({
    queryKey: ["unread-announcements", access?.userId],
    queryFn: getUnreadAnnouncementCount,
    enabled: Boolean(access),
  });
  const unreadNotificationQuery = useQuery({
    queryKey: ["unread-notifications", access?.userId],
    queryFn: getUnreadNotificationCount,
    enabled: Boolean(access),
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
    if (!pushSupported) {
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
  }, [access?.userId, pushSupported]);

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

  const navigationGroups = access
    ? buildNavigation(access, { hasOpenApplications: (openApplicationAreas.data?.length ?? 0) > 0 })
    : [];
  const unreadNotifications = unreadNotificationQuery.data ?? 0;
  const unreadAnnouncements = unreadQuery.data ?? 0;
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
  const pushCheckPending = pushSupported && Boolean(access?.userId && pushState?.userId !== access.userId);
  const iosInstalledApp = window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  if (access && pushSupported && !pushReady) {
    return (
      <main className="push-required-page">
        <div className="push-required-brand"><Brand /></div>
        <section className="push-required-card" aria-labelledby="push-required-title">
          <span className="push-required-icon"><BellRing size={24} /></span>
          <p className="eyebrow">Un ultimo passaggio</p>
          <h1 id="push-required-title">Attiva le notifiche</h1>
          <p className="push-required-copy">
            Attiva le notifiche per ricevere aggiornamenti importanti anche quando GalileoHub non è aperto. Vale per questo browser o dispositivo.
          </p>
          <div className="push-required-note">
            <strong>Si attiva una sola volta</strong>
            <span>Dopo aver consentito le notifiche, entrerai direttamente nel sito ai prossimi accessi.</span>
          </div>
          {!Capacitor.isNativePlatform() && /iPhone|iPad|iPod/i.test(navigator.userAgent) && !iosInstalledApp && (
            <p className="push-required-help">Su iPhone e iPad, aggiungi prima GalileoHub alla schermata Home e aprilo da lì.</p>
          )}
          {!Capacitor.isNativePlatform() && !/iPhone|iPad|iPod/i.test(navigator.userAgent) && (
            <p className="push-required-help">Quando il browser lo chiede, consenti le notifiche. Se in precedenza le hai bloccate, riabilitale dalle impostazioni del sito e del sistema operativo.</p>
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
          {navigationGroups.map((group) => (
            <div className="nav-group" role="group" aria-labelledby={`nav-group-${group.id}`} key={group.id}>
              <p className="nav-group__title" id={`nav-group-${group.id}`}>{group.title}</p>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  {label === "Bacheca" && !access?.isMember && unreadAnnouncements > 0 && (
                    <span className="nav-badge" aria-label={`${unreadAnnouncements} comunicazioni non lette`}>
                      {unreadAnnouncements}
                    </span>
                  )}
                  {label === "Notifiche" && unreadNotifications > 0 && (
                    <span className="nav-badge" aria-label={`${unreadNotifications} notifiche non lette`}>
                      {unreadNotifications}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="user-summary">
            <span className="user-summary__avatar">{access?.displayName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{access?.displayName}</strong><small>{areaLabel}</small></span>
          </div>
          {pushSupported && pushReady && <span className="push-ready-label" role="status"><BellRing size={15} /> Notifiche attive</span>}
          {pushSupported && pushStatus && <p className="push-status" role="status">{pushStatus}</p>}
          <button className="icon-button" type="button" aria-label="Esci" title="Esci" onClick={() => void handleSignOut()}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main id="main-content" className="app-content app-main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}


