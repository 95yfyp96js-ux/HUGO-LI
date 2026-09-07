export class DomainError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = code;
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

export class CustomerNotFoundError extends DomainError {
  constructor(customerId: string) {
    super("CUSTOMER_NOT_FOUND", `Customer ${customerId} not found`, 404, { customerId });
  }
}

export class ApplicationNotFoundError extends DomainError {
  constructor(applicationId: string) {
    super("APPLICATION_NOT_FOUND", `Application ${applicationId} not found`, 404, { applicationId });
  }
}

export class LoanNotFoundError extends DomainError {
  constructor(loanId: string) {
    super("LOAN_NOT_FOUND", `Loan ${loanId} not found`, 404, { loanId });
  }
}

export class ProductNotFoundError extends DomainError {
  constructor(productId: string) {
    super("PRODUCT_NOT_FOUND", `Product ${productId} not found`, 404, { productId });
  }
}

export class CollectionCaseNotFoundError extends DomainError {
  constructor(collectionCaseId: string) {
    super("COLLECTION_CASE_NOT_FOUND", `Collection case ${collectionCaseId} not found`, 404, { collectionCaseId });
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super("INVALID_STATE_TRANSITION", `Cannot transition ${entity} from ${from} to ${to}`, 409, {
      entity,
      from,
      to,
    });
  }
}

export class InvalidLoanStateError extends DomainError {
  constructor(loanId: string, currentStatus: string, action: string) {
    super("INVALID_LOAN_STATE", `Loan ${loanId} in status ${currentStatus} cannot perform ${action}`, 409, {
      loanId,
      currentStatus,
      action,
    });
  }
}

export class InvalidPaymentError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_PAYMENT", message, 400, details);
  }
}

export class InsufficientPermissionError extends DomainError {
  constructor(permission: string) {
    super("INSUFFICIENT_PERMISSION", `Missing required permission: ${permission}`, 403, { permission });
  }
}

export class RiskReviewRequiredError extends DomainError {
  constructor(applicationId: string) {
    super("RISK_REVIEW_REQUIRED", `Application ${applicationId} requires manual risk review`, 409, {
      applicationId,
    });
  }
}

export class PricingUnavailableError extends DomainError {
  constructor(reason: string) {
    super("PRICING_UNAVAILABLE", `Pricing unavailable: ${reason}`, 422, { reason });
  }
}

export class ScheduleCalculationFailedError extends DomainError {
  constructor(reason: string) {
    super("SCHEDULE_CALCULATION_FAILED", `Schedule calculation failed: ${reason}`, 422, { reason });
  }
}

export class DuplicatePaymentError extends DomainError {
  constructor(idempotencyKey: string) {
    super("DUPLICATE_PAYMENT", `Payment already processed for idempotency key ${idempotencyKey}`, 409, {
      idempotencyKey,
    });
  }
}

/**
 * Raised at startup when the process is misconfigured. It never carries the
 * offending value — only the variable and the reason.
 */
export class ConfigurationError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CONFIGURATION_ERROR", message, 500, details);
  }
}

/** A renewal that cannot be underwritten on today's position. */
export class RenewalNotPermittedError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("RENEWAL_NOT_PERMITTED", message, 422, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class LoanLimitExceededError extends DomainError {
  constructor(requested: string, max: string) {
    super("LOAN_LIMIT_EXCEEDED", `Loan amount ${requested} exceeds configured limit ${max}`, 422, {
      requested,
      max,
    });
  }
}
