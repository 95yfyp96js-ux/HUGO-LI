import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader, StatusBadge } from "../components/ui";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  createdAt: string;
}

interface RoleRow {
  code: string;
  name: string;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", password: "", roleCodes: [] as string[] });
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ items: UserRow[] }>("/api/settings/users"),
  });

  const { data: rolesData } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ items: RoleRow[] }>("/api/settings/roles"),
  });

  const createMutation = useMutation({
    mutationFn: () => api("/api/settings/users", { method: "POST", body: form }),
    onSuccess: () => {
      setCreating(false);
      setForm({ email: "", displayName: "", password: "", roleCodes: [] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { userId: string; status: "ACTIVE" | "DISABLED" }) =>
      api(`/api/settings/users/${input.userId}/status`, {
        method: "PATCH",
        body: { status: input.status },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  function openCreate() {
    setForm({ email: "", displayName: "", password: "", roleCodes: [] });
    setValidationError(null);
    setCreating(true);
  }

  function toggleRole(code: string) {
    setForm((f) => ({
      ...f,
      roleCodes: f.roleCodes.includes(code)
        ? f.roleCodes.filter((r) => r !== code)
        : [...f.roleCodes, code],
    }));
  }

  function submitCreate() {
    if (!form.email.trim() || !form.displayName.trim()) {
      setValidationError("請填寫電子郵件與姓名");
      return;
    }
    if (form.password.length < 10) {
      setValidationError("密碼至少需要 10 碼");
      return;
    }
    if (form.roleCodes.length === 0) {
      setValidationError("請至少選擇一個角色");
      return;
    }
    setValidationError(null);
    createMutation.mutate();
  }

  return (
    <div>
      <PageHeader
        title="使用者"
        subtitle="使用者權限由角色決定，後端每次請求都會重新驗證"
        actions={
          <button className="btn-primary" onClick={openCreate}>
            新增使用者
          </button>
        }
      />
      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="尚無使用者"
          columns={[
            { header: "姓名", cell: (row) => <span className="font-medium">{row.displayName}</span> },
            { header: "電子郵件", cell: (row) => row.email },
            {
              header: "角色",
              cell: (row) => (
                <div className="flex flex-wrap gap-1">
                  {row.roles.map((role) => (
                    <span
                      key={role}
                      className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              ),
            },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
            { header: "建立日期", cell: (row) => date(row.createdAt) },
            {
              header: "",
              cell: (row) => (
                <button
                  className="btn-secondary"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      userId: row.id,
                      status: row.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                    })
                  }
                >
                  {row.status === "ACTIVE" ? "停用" : "啟用"}
                </button>
              ),
            },
          ]}
        />
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold">新增使用者</h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="user-email">電子郵件</label>
                <input
                  id="user-email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="user-name">姓名</label>
                <input
                  id="user-name"
                  className="input"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="user-password">初始密碼（至少 10 碼）</label>
                <input
                  id="user-password"
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <span className="label">角色</span>
                <div className="flex flex-wrap gap-3">
                  {(rolesData?.items ?? []).map((role) => (
                    <label key={role.code} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.roleCodes.includes(role.code)}
                        onChange={() => toggleRole(role.code)}
                      />
                      {role.code}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {validationError && <p className="mt-3 text-sm text-rose-600">{validationError}</p>}
            <ErrorBanner error={createMutation.error} />

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                取消
              </button>
              <button
                className="btn-primary"
                disabled={createMutation.isPending}
                onClick={submitCreate}
              >
                {createMutation.isPending ? "建立中…" : "建立使用者"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
