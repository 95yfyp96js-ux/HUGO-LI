export const PERMISSIONS = [
  "CUSTOMER_READ",
  "CUSTOMER_CREATE",
  "CUSTOMER_UPDATE",
  "APPLICATION_READ",
  "APPLICATION_CREATE",
  "APPLICATION_UPDATE",
  "APPLICATION_APPROVE",
  "APPLICATION_REJECT",
  "LOAN_READ",
  "LOAN_CREATE",
  "LOAN_APPROVE",
  "LOAN_DISBURSE",
  "LOAN_RENEW",
  "LOAN_EXTEND",
  "LOAN_SETTLE",
  "PAYMENT_READ",
  "PAYMENT_CREATE",
  "PAYMENT_REVERSE",
  "COLLECTION_READ",
  "COLLECTION_UPDATE",
  "PRODUCT_READ",
  "PRODUCT_UPDATE",
  "USER_MANAGE",
  "AUDIT_READ",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["ADMIN", "MANAGER", "LOAN_OFFICER", "COLLECTOR", "AUDITOR"] as const;
export type RoleCode = (typeof ROLES)[number];

const READ_ONLY: Permission[] = [
  "CUSTOMER_READ",
  "APPLICATION_READ",
  "LOAN_READ",
  "PAYMENT_READ",
  "COLLECTION_READ",
  "PRODUCT_READ",
];

/**
 * Role -> permission matrix. Deliberately explicit rather than hierarchical:
 * with money at stake, "what can a collector actually do" should be readable
 * at a glance, not inferred from role inheritance.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [...PERMISSIONS],

  MANAGER: [
    ...READ_ONLY,
    "CUSTOMER_CREATE",
    "CUSTOMER_UPDATE",
    "APPLICATION_CREATE",
    "APPLICATION_UPDATE",
    "APPLICATION_APPROVE",
    "APPLICATION_REJECT",
    "LOAN_CREATE",
    "LOAN_APPROVE",
    "LOAN_DISBURSE",
    "LOAN_RENEW",
    "LOAN_EXTEND",
    "LOAN_SETTLE",
    "PAYMENT_CREATE",
    "PAYMENT_REVERSE",
    "COLLECTION_UPDATE",
    // Product design (new products, repricing existing ones) is a branch
    // decision, not a system-administration one, so it sits with MANAGER
    // rather than only ADMIN. Every change still versions rather than
    // editing a live product in place (see productService.update).
    "PRODUCT_UPDATE",
    "AUDIT_READ",
  ],

  // Originates business but cannot approve its own deals, move product
  // pricing, or reverse money already taken.
  LOAN_OFFICER: [
    ...READ_ONLY,
    "CUSTOMER_CREATE",
    "CUSTOMER_UPDATE",
    "APPLICATION_CREATE",
    "APPLICATION_UPDATE",
    "LOAN_CREATE",
    "PAYMENT_CREATE",
  ],

  COLLECTOR: [...READ_ONLY, "COLLECTION_UPDATE", "PAYMENT_CREATE"],

  // Sees everything, changes nothing.
  AUDITOR: [...READ_ONLY, "AUDIT_READ"],
};

export function permissionsForRoles(roleCodes: string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const code of roleCodes) {
    const perms = ROLE_PERMISSIONS[code as RoleCode];
    if (perms) perms.forEach((p) => result.add(p));
  }
  return result;
}
