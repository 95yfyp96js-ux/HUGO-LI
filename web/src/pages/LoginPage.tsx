import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { ErrorBanner } from "../components/ui";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@lending.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-brand-700">Small Lending OS</h1>
          <p className="mt-1 text-sm text-slate-500">放款作業系統</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <ErrorBanner error={error} />
          <div>
            <label className="label" htmlFor="email">
              電子郵件
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              密碼
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "登入中…" : "登入"}
          </button>
        </form>
      </div>
    </div>
  );
}
