/**
 * Identity numbers are masked by default at every boundary that leaves the
 * domain layer (API responses, audit payloads, logs). The full value stays
 * in the database because KYC and duplicate detection need it.
 */
export function maskIdentityNumber(identityNumber: string): string {
  if (identityNumber.length <= 4) return "*".repeat(identityNumber.length);
  const head = identityNumber.slice(0, 3);
  const tail = identityNumber.slice(-2);
  return `${head}${"*".repeat(Math.max(identityNumber.length - 5, 3))}${tail}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return "*".repeat(phone.length);
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(phone.length - 6, 3))}${phone.slice(-3)}`;
}
