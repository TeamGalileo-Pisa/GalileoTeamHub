import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { appConfig } from "../lib/config";
import { usernameToAuthEmail } from "../lib/auth-identifiers";
import { supabase } from "../lib/supabase";
import type { AccessContext, AreaSummary } from "../types/domain";
import { AuthContext } from "./auth-context";

interface ProfileRow {
  username: string;
  display_name: string;
  status: "active" | "disabled";
  must_change_password: boolean;
}

interface MembershipRow {
  area: AreaSummary | AreaSummary[] | null;
}

async function fetchAccessContext(session: Session): Promise<AccessContext> {
  const userId = session.user.id;

  const [profileResult, roleResult, membershipsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, display_name, status, must_change_password")
      .eq("id", userId)
      .single(),
    supabase
      .from("system_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle(),
    supabase
      .from("area_memberships")
      .select("area:areas(id, name, slug)")
      .eq("user_id", userId)
      .eq("role", "area_lead")
      .is("ended_at", null),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (roleResult.error) throw roleResult.error;
  if (membershipsResult.error) throw membershipsResult.error;

  const profile = profileResult.data as ProfileRow;

  if (profile.status !== "active") {
    throw new Error("Questo account è stato disattivato.");
  }

  const areas = (membershipsResult.data as unknown as MembershipRow[])
    .flatMap((membership) => {
      if (!membership.area) return [];
      return Array.isArray(membership.area)
        ? membership.area
        : [membership.area];
    })
    .map((area) => ({ id: area.id, name: area.name, slug: area.slug }));

  return {
    userId,
    username: profile.username,
    displayName: profile.display_name,
    isAdmin: Boolean(roleResult.data),
    mustChangePassword: profile.must_change_password,
    areas,
  };
}

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Nome utente o password non corretti.";
  }

  if (/email not confirmed/i.test(message)) {
    return "L'account non è ancora stato attivato.";
  }

  return "Accesso non riuscito. Riprova tra poco.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const previousUser = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [loading, setLoading] = useState(appConfig.hasSupabaseConfiguration);
  const [error, setError] = useState<string | null>(null);

  const loadAccess = useCallback(
    async (nextSession: Session | null) => {
      const sequence = ++loadSequence.current;
      const nextUser = nextSession?.user.id ?? null;
      if (previousUser.current !== nextUser) {
        queryClient.clear();
        setAccess(null);
        previousUser.current = nextUser;
      }
      setSession(nextSession);
      setError(null);

      if (!nextSession) {
        setAccess(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const nextAccess = await fetchAccessContext(nextSession);
        if (sequence === loadSequence.current) setAccess(nextAccess);
      } catch (caughtError) {
        if (sequence !== loadSequence.current) return;
        setAccess(null);
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Impossibile caricare i permessi dell'account.",
        );
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    let active = true;

    if (!appConfig.hasSupabaseConfiguration) {
      return () => {
        active = false;
      };
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (active) void loadAccess(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active && nextSession?.access_token !== session?.access_token) {
        void loadAccess(nextSession);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadAccess, session?.access_token]);

  const signIn = useCallback(async (username: string, password: string) => {
    if (!appConfig.hasSupabaseConfiguration) {
      throw new Error("Supabase non è ancora configurato per questo ambiente.");
    }

    const email = usernameToAuthEmail(username, appConfig.authEmailDomain);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) throw new Error(friendlyAuthError(authError.message));
  }, []);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
  }, []);

  const refreshAccess = useCallback(async () => {
    await loadAccess(session);
  }, [loadAccess, session]);

  const value = useMemo(
    () => ({ access, loading, error, signIn, signOut, refreshAccess }),
    [access, loading, error, signIn, signOut, refreshAccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
