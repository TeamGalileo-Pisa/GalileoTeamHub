import { describe, expect, it } from "vitest";
import { buildNavigation, type NavAccess } from "./navigation";

const links = (access: NavAccess, options?: { hasOpenApplications?: boolean }) =>
  buildNavigation(access, options).flatMap((group) => group.items.map((entry) => entry.to));
const titles = (access: NavAccess) => buildNavigation(access).map((group) => group.title);

describe("buildNavigation", () => {
  it("Team Leader vede tutte le funzioni, divise in sezioni", () => {
    const access = { isAdmin: true, isTeamLeader: true, isMember: false, areas: [] };
    expect(titles(access)).toEqual([
      "Panoramica",
      "Colloqui",
      "Recruitment e adesioni",
      "Amministrazione",
    ]);
    expect(links(access)).toEqual(
      expect.arrayContaining([
        "/admin", "/admin/bacheca", "/notifiche", "/admin/disponibilita", "/admin/calendario", "/admin/sessioni",
        "/admin/votazioni", "/admin/recruitment", "/admin/candidature", "/merchandising", "/magazzino", "/sponsor",
        "/ordini", "/budget", "/admin/aree", "/admin/account", "/admin/legal", "/admin/assistenza",
      ]),
    );
  });

  it("Amministrazione (senza Team Leader) vede anche Merchandising, Magazzino, Ordini, Budget e Sponsor", () => {
    const all = links({ isAdmin: true, isTeamLeader: false, isMember: false, areas: [] });
    for (const shown of ["/merchandising", "/magazzino", "/sponsor", "/ordini", "/budget"]) expect(all).toContain(shown);
  });

  it.each([
    ["Capo Logistica", { isAdmin: false, isMember: false, areas: [{ slug: "logistica" }] }],
    ["membro Logistica", { isAdmin: false, isMember: true, areas: [{ slug: "logistica" }] }],
  ])("%s ha Merchandising, Magazzino, Sponsor e Ordini ma non il Budget", (_name, access) => {
    const all = links(access);
    for (const wanted of ["/merchandising", "/magazzino", "/sponsor", "/ordini"]) expect(all).toContain(wanted);
    expect(all).not.toContain("/budget");
  });

  it.each([
    ["Capo Business", { isAdmin: false, isMember: false, areas: [{ slug: "business" }] }],
    ["membro Business", { isAdmin: false, isMember: true, areas: [{ slug: "business" }] }],
  ])("%s ha Budget e Ordini ma non Magazzino e Sponsor", (_name, access) => {
    const all = links(access);
    expect(all).toContain("/budget");
    expect(all).toContain("/ordini");
    expect(all).not.toContain("/magazzino");
    expect(all).not.toContain("/sponsor");
  });

  it("un capo area di un'altra area non vede Logistica né Business", () => {
    const all = links({ isAdmin: false, isMember: false, areas: [{ slug: "software" }] });
    for (const hidden of ["/merchandising", "/magazzino", "/sponsor", "/ordini", "/budget"]) expect(all).not.toContain(hidden);
  });

  it("un membro semplice vede Bacheca, Modulo di adesione e Merchandising", () => {
    expect(links({ isAdmin: false, isMember: true, areas: [{ slug: "software" }] })).toEqual([
      "/membri", "/membri/adesione", "/merchandising", "/notifiche",
    ]);
  });

  it("le voci non sono mai duplicate e non ci sono sezioni vuote", () => {
    for (const access of [
      { isAdmin: true, isTeamLeader: true, isMember: false, areas: [] },
      { isAdmin: false, isMember: false, areas: [{ slug: "logistica" }, { slug: "business" }] },
    ]) {
      const all = links(access);
      expect(new Set(all).size).toBe(all.length);
      expect(buildNavigation(access).every((group) => group.items.length > 0)).toBe(true);
    }
  });

  it("mostra Candidature solo se ci sono aree con candidature aperte", () => {
    const lead = { isAdmin: false, isMember: false, areas: [{ slug: "software" }] };
    expect(links(lead)).not.toContain("/area/candidature");
    expect(links(lead, { hasOpenApplications: true })).toContain("/area/candidature");
  });
});
