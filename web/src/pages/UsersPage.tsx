import { useQuery } from "@tanstack/react-query";
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

export function UsersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ items: UserRow[] }>("/api/settings/users"),
  });

  return (
    <div>
      <PageHeader title="使用者" subtitle="使用者權限由角色決定，後端每次請求都會重新驗證" />
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
          ]}
        />
      )}
    </div>
  );
}
