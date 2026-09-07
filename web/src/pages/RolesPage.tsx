import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorBanner, Loading, PageHeader } from "../components/ui";

interface Role {
  id: string;
  code: string;
  name: string;
  permissions: string[];
}

const PERMISSION_LABELS: Record<string, string> = {
  CUSTOMER_READ: "查看客戶",
  CUSTOMER_CREATE: "建立客戶",
  CUSTOMER_UPDATE: "修改客戶",
  APPLICATION_READ: "查看申請",
  APPLICATION_CREATE: "建立申請",
  APPLICATION_UPDATE: "修改申請",
  APPLICATION_APPROVE: "核准申請",
  APPLICATION_REJECT: "婉拒申請",
  LOAN_READ: "查看放款",
  LOAN_CREATE: "建立放款",
  LOAN_APPROVE: "核准放款",
  LOAN_DISBURSE: "撥款",
  LOAN_RENEW: "續借",
  LOAN_EXTEND: "展期",
  LOAN_SETTLE: "結清",
  PAYMENT_READ: "查看收款",
  PAYMENT_CREATE: "建立收款",
  PAYMENT_REVERSE: "沖銷收款",
  COLLECTION_READ: "查看催收",
  COLLECTION_UPDATE: "催收作業",
  PRODUCT_READ: "查看產品",
  PRODUCT_UPDATE: "修改產品",
  USER_MANAGE: "管理使用者",
  AUDIT_READ: "查看稽核紀錄",
};

export function RolesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ items: Role[] }>("/api/settings/roles"),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <PageHeader title="角色權限" subtitle="前端僅隱藏無權限的操作，實際權限由後端強制驗證" />

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.items.map((role) => (
          <div key={role.id} className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">{role.name}</h2>
                <p className="font-mono text-xs text-slate-400">{role.code}</p>
              </div>
              <span className="text-xs text-slate-500">{role.permissions.length} 項權限</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {role.permissions.map((permission) => (
                <span
                  key={permission}
                  className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                  title={permission}
                >
                  {PERMISSION_LABELS[permission] ?? permission}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
