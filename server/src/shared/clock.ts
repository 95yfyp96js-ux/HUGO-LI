/**
 * All domain code that needs "now" must take a Clock, never call `new Date()`
 * directly. This is what makes overdue/renewal/interest-accrual logic
 * deterministically testable (see MockClock).
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class MockClock implements Clock {
  private current: Date;

  constructor(initial: Date = new Date()) {
    this.current = initial;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = date;
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
