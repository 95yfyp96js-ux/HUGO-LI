import { Money } from "../../../shared/money.js";

export interface DisbursementRequest {
  loanNumber: string;
  amount: Money;
  method: string;
}

export interface DisbursementResult {
  success: boolean;
  reference: string;
  failureReason?: string;
}

/**
 * The seam between our ledger and whoever actually moves the money. v1 ships
 * a mock; a real bank/payment adapter implements this same interface without
 * any change to LoanService.
 */
export interface DisbursementProvider {
  send(request: DisbursementRequest): Promise<DisbursementResult>;
}

export class MockDisbursementProvider implements DisbursementProvider {
  async send(request: DisbursementRequest): Promise<DisbursementResult> {
    return {
      success: true,
      reference: `MOCK-${request.loanNumber}-${Date.now().toString(36).toUpperCase()}`,
    };
  }
}
