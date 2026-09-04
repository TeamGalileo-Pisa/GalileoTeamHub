import { createContext } from "react";
import type { AccessContext } from "../types/domain";

export interface AuthContextValue {
  access: AccessContext | null;
  loading: boolean;
  error: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

