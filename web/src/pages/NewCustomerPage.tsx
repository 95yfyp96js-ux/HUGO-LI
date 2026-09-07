import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { ErrorBanner, PageHeader } from "../components/ui";

interface ScanResult {
  scan: {
    name: string;
    identityNumber: string;
    dateOfBirth: string;
    address: string | null;
    confidence: number;
  };
  requiresConfirmation: boolean;
  matchedCustomer: { id: string; name: string; customerNumber: string } | null;
}

const EMPTY = {
  name: "",
  identityNumber: "",
  dateOfBirth: "",
  phone: "",
  email: "",
  address: "",
  employmentStatus: "EMPLOYED",
  employer: "",
  monthlyIncome: "",
};

export function NewCustomerPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [scan, setScan] = useState<ScanResult | null>(null);

  const scanMutation = useMutation({
    mutationFn: () => api<ScanResult>("/api/customers/identity-scan", { method: "POST", body: {} }),
    onSuccess: setScan,
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof EMPTY) =>
      api<{ id: string }>("/api/customers", {
        method: "POST",
        body: { ...body, monthlyIncome: body.monthlyIncome || null },
      }),
    onSuccess: (customer) => navigate(`/customers/${customer.id}`),
  });

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  /** Scan only pre-fills the form — a human still confirms and submits (§45). */
  function applyScan() {
    if (!scan) return;
    setForm((current) => ({
      ...current,
      name: scan.scan.name,
      identityNumber: scan.scan.identityNumber,
      dateOfBirth: scan.scan.dateOfBirth,
      address: scan.scan.address ?? current.address,
    }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate(form);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="新增客戶" subtitle="可使用證件掃描預填，仍須人工確認後才會建檔" />

      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">證件掃描（Mock）</h2>
            <p className="mt-1 text-xs text-slate-500">
              掃描結果不會自動建立客戶，必須由承辦人員確認後送出。
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? "掃描中…" : "掃描證件"}
          </button>
        </div>

        {scan && (
          <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
            <div className="text-sm font-medium text-brand-900">
              辨識結果（信心度 {(scan.scan.confidence * 100).toFixed(0)}%）
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-700">
              <div>姓名：{scan.scan.name}</div>
              <div>身分證字號：{scan.scan.identityNumber}</div>
              <div>出生日期：{scan.scan.dateOfBirth}</div>
              <div className="col-span-2">地址：{scan.scan.address}</div>
            </dl>
            {scan.matchedCustomer ? (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                此證件已有客戶資料：{scan.matchedCustomer.customerNumber} {scan.matchedCustomer.name}
              </div>
            ) : (
              <button type="button" className="btn-primary mt-3 text-xs" onClick={applyScan}>
                確認並帶入表單
              </button>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="card space-y-4 p-5">
        <ErrorBanner error={createMutation.error} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="newc-f1">姓名 *</label>
            <input id="newc-f1" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="newc-f2">身分證字號 *</label>
            <input id="newc-f2"
              className="input"
              value={form.identityNumber}
              onChange={(e) => set("identityNumber", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="newc-f3">出生日期 *</label>
            <input id="newc-f3"
              type="date"
              className="input"
              value={form.dateOfBirth}
              onChange={(e) => set("dateOfBirth", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="newc-f4">手機 *</label>
            <input id="newc-f4"
              className="input"
              inputMode="numeric"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="newc-f5">電子郵件</label>
            <input id="newc-f5" type="email" className="input" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="newc-f6">月收入</label>
            <input id="newc-f6"
              className="input tabular"
              inputMode="decimal"
              value={form.monthlyIncome}
              onChange={(e) => set("monthlyIncome", e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="newc-f7">就業狀態</label>
            <select id="newc-f7"
              className="input"
              value={form.employmentStatus}
              onChange={(e) => set("employmentStatus", e.target.value)}
            >
              <option value="EMPLOYED">受僱</option>
              <option value="SELF_EMPLOYED">自營</option>
              <option value="UNEMPLOYED">無業</option>
              <option value="RETIRED">退休</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="newc-f8">任職公司</label>
            <input id="newc-f8" className="input" value={form.employer} onChange={(e) => set("employer", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="newc-f9">地址</label>
            <input id="newc-f9" className="input" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" className="btn-secondary" onClick={() => navigate("/customers")}>
            取消
          </button>
          <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? "建立中…" : "建立客戶"}
          </button>
        </div>
      </form>
    </div>
  );
}
