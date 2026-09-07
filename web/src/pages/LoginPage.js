import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { ErrorBanner } from "../components/ui";
export function LoginPage() {
    const { login } = useAuth();
    const [email, setEmail] = useState("admin@lending.local");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    async function onSubmit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await login(email, password);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center p-4", children: _jsxs("div", { className: "w-full max-w-sm", children: [_jsxs("div", { className: "mb-8 text-center", children: [_jsx("h1", { className: "text-2xl font-bold text-brand-700", children: "Small Lending OS" }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: "\u653E\u6B3E\u4F5C\u696D\u7CFB\u7D71" })] }), _jsxs("form", { onSubmit: onSubmit, className: "card space-y-4 p-6", children: [_jsx(ErrorBanner, { error: error }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "email", children: "\u96FB\u5B50\u90F5\u4EF6" }), _jsx("input", { id: "email", type: "email", className: "input", value: email, onChange: (e) => setEmail(e.target.value), autoComplete: "username", required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "password", children: "\u5BC6\u78BC" }), _jsx("input", { id: "password", type: "password", className: "input", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password", required: true })] }), _jsx("button", { type: "submit", className: "btn-primary w-full", disabled: busy, children: busy ? "登入中…" : "登入" })] })] }) }));
}
