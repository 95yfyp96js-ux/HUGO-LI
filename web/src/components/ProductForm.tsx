import { useState } from "react";
import { RATE_UNIT_LABEL } from "../lib/format";

export interface ProductFormValues {
  productCode: string;
  name: string;
  description: string;
  minAmount: string;
  maxAmount: string;
  termUnit: "DAY" | "MONTH";
  minTermCount: string;
  maxTermCount: string;
  ratePercent: string;
  rateUnit: "DAILY" | "MONTHLY" | "ANNUAL";
  repaymentMethod: string;
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  productCode: "",
  name: "",
  description: "",
  minAmount: "",
  maxAmount: "",
  termUnit: "MONTH",
  minTermCount: "",
  maxTermCount: "",
  ratePercent: "",
  rateUnit: "MONTHLY",
  repaymentMethod: "INTEREST_ONLY",
};

// CUSTOM is a recognised value on the domain but has no schedule
// implementation (RepaymentEngine refuses it), so it is left off this list —
// choosing it here would create a product that can never be applied against.
const REPAYMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "INTEREST_ONLY", label: "按期付息、到期還本" },
  { value: "PRINCIPAL_AND_INTEREST", label: "本息分期攤還" },
  { value: "PRINCIPAL_ONLY", label: "僅還本金" },
  { value: "BULLET", label: "到期一次清償" },
];

/**
 * Fields shared by "新增產品" and "編輯產品". Every field here is a versioned
 * term on the backend (productService.VERSIONED_FIELDS): saving a change to
 * any of them creates a new product version rather than editing one in
 * place, so an existing loan's frozen snapshot is never touched.
 *
 * Calculation method is not a field — every product is SIMPLE_INTEREST, the
 * only method the business offers, enforced server-side too.
 */
export function ProductForm(props: {
  values: ProductFormValues;
  onChange: (values: ProductFormValues) => void;
  /** Locked once a product exists: it is the family identity across versions. */
  codeEditable: boolean;
  idPrefix: string;
}) {
  const { values: v, onChange, codeEditable, idPrefix } = props;
  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    onChange({ ...v, [key]: value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={`${idPrefix}-code`}>產品代碼 *</label>
        <input
          id={`${idPrefix}-code`}
          className="input"
          value={v.productCode}
          onChange={(e) => set("productCode", e.target.value)}
          disabled={!codeEditable}
        />
        {!codeEditable && (
          <p className="mt-1 text-xs text-slate-400">代碼是產品版本間的識別依據，建立後不可更改</p>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-name`}>產品名稱 *</label>
        <input
          id={`${idPrefix}-name`}
          className="input"
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${idPrefix}-desc`}>說明</label>
        <input
          id={`${idPrefix}-desc`}
          className="input"
          value={v.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-min-amount`}>最低金額 *</label>
        <input
          id={`${idPrefix}-min-amount`}
          className="input tabular"
          inputMode="decimal"
          value={v.minAmount}
          onChange={(e) => set("minAmount", e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-max-amount`}>最高金額 *</label>
        <input
          id={`${idPrefix}-max-amount`}
          className="input tabular"
          inputMode="decimal"
          value={v.maxAmount}
          onChange={(e) => set("maxAmount", e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-term-unit`}>期數單位 *</label>
        <select
          id={`${idPrefix}-term-unit`}
          className="input"
          value={v.termUnit}
          onChange={(e) => set("termUnit", e.target.value as ProductFormValues["termUnit"])}
        >
          <option value="MONTH">月</option>
          <option value="DAY">天</option>
        </select>
      </div>
      <div />

      <div>
        <label className="label" htmlFor={`${idPrefix}-min-term`}>
          最短{v.termUnit === "DAY" ? "天數" : "期數"} *
        </label>
        <input
          id={`${idPrefix}-min-term`}
          className="input tabular"
          inputMode="numeric"
          value={v.minTermCount}
          onChange={(e) => set("minTermCount", e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-max-term`}>
          最長{v.termUnit === "DAY" ? "天數" : "期數"} *
        </label>
        <input
          id={`${idPrefix}-max-term`}
          className="input tabular"
          inputMode="numeric"
          value={v.maxTermCount}
          onChange={(e) => set("maxTermCount", e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-rate`}>利率（%）*</label>
        <input
          id={`${idPrefix}-rate`}
          className="input tabular"
          inputMode="decimal"
          value={v.ratePercent}
          onChange={(e) => set("ratePercent", e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-rate-unit`}>利率單位 *</label>
        <select
          id={`${idPrefix}-rate-unit`}
          className="input"
          value={v.rateUnit}
          onChange={(e) => set("rateUnit", e.target.value as ProductFormValues["rateUnit"])}
        >
          {Object.entries(RATE_UNIT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${idPrefix}-repayment`}>還款方式 *</label>
        <select
          id={`${idPrefix}-repayment`}
          className="input"
          value={v.repaymentMethod}
          onChange={(e) => set("repaymentMethod", e.target.value)}
        >
          {REPAYMENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <p className="text-xs text-slate-400">計息方式固定為單利（SIMPLE_INTEREST），本系統不提供其他計息方式</p>
      </div>
    </div>
  );
}

/** Validates the shared numeric/required fields before either form submits. */
export function validateProductForm(v: ProductFormValues): string | null {
  if (!v.name.trim()) return "請輸入產品名稱";
  if (!v.productCode.trim()) return "請輸入產品代碼";
  const min = Number(v.minAmount);
  const max = Number(v.maxAmount);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return "請輸入正確的金額範圍";
  if (max < min) return "最高金額不可低於最低金額";
  const minTerm = Number(v.minTermCount);
  const maxTerm = Number(v.maxTermCount);
  if (!Number.isInteger(minTerm) || minTerm < 1) return "最短期數／天數需為正整數";
  if (!Number.isInteger(maxTerm) || maxTerm < minTerm) return "最長期數／天數不可低於最短";
  const rate = Number(v.ratePercent);
  if (!Number.isFinite(rate) || rate < 0) return "請輸入正確的利率";
  return null;
}

export function productFormToPayload(v: ProductFormValues) {
  return {
    productCode: v.productCode.trim(),
    name: v.name.trim(),
    description: v.description.trim() || null,
    minAmount: v.minAmount,
    maxAmount: v.maxAmount,
    termUnit: v.termUnit,
    minTermCount: Number(v.minTermCount),
    maxTermCount: Number(v.maxTermCount),
    ratePercent: Number(v.ratePercent),
    rateUnit: v.rateUnit,
    repaymentMethod: v.repaymentMethod,
  };
}

export function useProductForm(initial: ProductFormValues = EMPTY_PRODUCT_FORM) {
  return useState<ProductFormValues>(initial);
}
