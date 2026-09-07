import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api<CurrentUser>("/api/auth/me")
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api<{ token: string; user: CurrentUser }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    tokenStore.set(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    window.location.href = "/login";
  }, []);

  /**
   * Hiding a control the user cannot use is a courtesy, not a security
   * boundary — the server re-checks every permission independently.
   */
  const can = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user]
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, can }),
    [user, loading, login, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
