import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStore } from "./api";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!tokenStore.get()) {
            setLoading(false);
            return;
        }
        api("/api/auth/me")
            .then(setUser)
            .catch(() => tokenStore.clear())
            .finally(() => setLoading(false));
    }, []);
    const login = useCallback(async (email, password) => {
        const result = await api("/api/auth/login", {
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
    const can = useCallback((permission) => user?.permissions.includes(permission) ?? false, [user]);
    const value = useMemo(() => ({ user, loading, login, logout, can }), [user, loading, login, logout, can]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context)
        throw new Error("useAuth must be used inside AuthProvider");
    return context;
}
