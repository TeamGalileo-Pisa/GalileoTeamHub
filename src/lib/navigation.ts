import {
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Handshake,
  HelpCircle,
  LayoutDashboard,
  Megaphone,
  PanelsTopLeft,
  ShoppingBag,
  ShoppingCart,
  UsersRound,
  Wallet,
  Warehouse,
  Bell,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

export interface NavAccess {
  isAdmin?: boolean;
  isTeamLeader?: boolean;
  isMember?: boolean;
  areas: { slug: string }[];
}

const item = (to: string, label: string, icon: LucideIcon, end = false): NavItem => ({ to, label, icon, end });

const notifications = item("/notifiche", "Notifiche", Bell);
const merchandising = item("/merchandising", "Merchandising", ShoppingBag);
const inventory = item("/magazzino", "Magazzino", Warehouse);
const sponsors = item("/sponsor", "Sponsor", Handshake);
const orders = item("/ordini", "Ordini", ShoppingCart);
const budget = item("/budget", "Budget", Wallet);

/**
 * Menu laterale organizzato per sezioni. Ogni account vede solo le funzioni a cui ha accesso:
 * - Team Leader: tutto (Merchandising, Magazzino, Ordini, Budget e Sponsor stanno in Amministrazione)
 * - Amministrazione: gestione colloqui e team (più Merchandising)
 * - Capo Logistica e membri Logistica: Merchandising, Magazzino, Sponsor, Ordini
 * - Capo Business e membri Business: Budget e Ordini
 */
export function buildNavigation(access: NavAccess, options: { hasOpenApplications?: boolean } = {}): NavGroup[] {
  const hasArea = (slug: string) => access.areas.some((area) => area.slug === slug);
  const groups: NavGroup[] = [];

  if (access.isAdmin) {
    groups.push(
      {
        id: "panoramica",
        title: "Panoramica",
        items: [item("/admin", "Dashboard", LayoutDashboard, true), item("/admin/bacheca", "Bacheca", Megaphone), notifications],
      },
      {
        id: "colloqui",
        title: "Colloqui",
        items: [
          item("/admin/disponibilita", "Disponibilità", Warehouse),
          item("/admin/calendario", "Calendario", CalendarDays),
          item("/admin/sessioni", "Sessioni e slot", ClipboardList),
          item("/admin/votazioni", "Votazioni", ClipboardList),
        ],
      },
      {
        id: "recruitment",
        title: "Recruitment e adesioni",
        items: [
          item("/admin/recruitment", "Recruitment", CalendarRange),
          item("/admin/candidature", "Candidature e adesioni", FileText),
        ],
      },
      {
        id: "amministrazione",
        title: "Amministrazione",
        items: [
          merchandising,
          inventory,
          orders,
          budget,
          sponsors,
          item("/admin/aree", "Aree", PanelsTopLeft),
          item("/admin/account", "Account", UsersRound),
          item("/admin/legal", "Termini e Privacy", FileText),
          item("/admin/assistenza", "Assistenza", HelpCircle),
        ],
      },
    );
  } else if (access.isMember) {
    const logistics = hasArea("logistica");
    groups.push(
      {
        id: "spazio",
        title: "Il tuo spazio",
        items: [
          item("/membri", "Bacheca", Megaphone, true),
          item("/membri/adesione", "Modulo di adesione", FileText),
          ...(logistics ? [] : [merchandising]),
          notifications,
        ],
      },
      { id: "logistica", title: "Logistica", items: logistics ? [merchandising, inventory, sponsors, orders] : [] },
      { id: "business", title: "Business", items: hasArea("business") ? [budget, orders] : [] },
    );
  } else {
    groups.push(
      {
        id: "panoramica",
        title: "Panoramica",
        items: [item("/area", "Dashboard", LayoutDashboard, true), item("/area/bacheca", "Bacheca", Megaphone), notifications],
      },
      {
        id: "colloqui",
        title: "Colloqui",
        items: [
          item("/area/disponibilita", "Disponibilità", Warehouse),
          item("/area/sessioni", "Sessioni e slot", ClipboardList),
          item("/area/calendario", "Calendario", CalendarDays),
          item("/area/votazioni", "Votazioni", ClipboardList),
        ],
      },
      {
        id: "candidature",
        title: "Candidature",
        items: options.hasOpenApplications ? [item("/area/candidature", "Candidature", FileText)] : [],
      },
      { id: "logistica", title: "Logistica", items: hasArea("logistica") ? [merchandising, inventory, sponsors, orders] : [] },
      { id: "business", title: "Business", items: hasArea("business") ? [budget, orders] : [] },
      { id: "aiuto", title: "Aiuto", items: [item("/area/assistenza", "Assistenza", HelpCircle)] },
    );
  }

  // Una voce compare una sola volta (es. Ordini), nella prima sezione che la contiene.
  const seen = new Set<string>();
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((entry) => (seen.has(entry.to) ? false : (seen.add(entry.to), true))),
    }))
    .filter((group) => group.items.length > 0);
}
