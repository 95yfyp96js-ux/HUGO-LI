import { Decimal } from "decimal.js";

/**
 * Money is always represented internally as an integer count of minor units
 * (e.g. cents). Never construct Money from a raw JS float you computed with
 * `*` or `/` — route all arithmetic through this class (backed by
 * decimal.js) so rounding is explicit and consistent everywhere.
 */
export class Money {
  private readonly minorUnits: bigint;

  private constructor(minorUnits: bigint) {
    this.minorUnits = minorUnits;
  }

  static zero(): Money {
    return new Money(0n);
  }

  static fromMinorUnits(minorUnits: number | bigint): Money {
    return new Money(BigInt(minorUnits));
  }

  /** Parse a major-unit decimal string/number, e.g. "1234.56" -> 123456 cents. */
  static fromMajorUnits(value: string | number): Money {
    const d = new Decimal(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return new Money(BigInt(d.toFixed(0)));
  }

  toMinorUnits(): number {
    if (this.minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Money value exceeds safe integer range");
    }
    return Number(this.minorUnits);
  }

  toMajorUnitsString(): string {
    return new Decimal(this.minorUnits.toString()).dividedBy(100).toFixed(2);
  }

  toMajorUnitsNumber(): number {
    return Number(this.toMajorUnitsString());
  }

  add(other: Money): Money {
    return new Money(this.minorUnits + other.minorUnits);
  }

  subtract(other: Money): Money {
    return new Money(this.minorUnits - other.minorUnits);
  }

  /** Multiply by an arbitrary-precision rate/factor, rounding to the nearest minor unit. */
  multiply(factor: Decimal.Value, rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP): Money {
    const result = new Decimal(this.minorUnits.toString()).times(factor).toDecimalPlaces(0, rounding);
    return new Money(BigInt(result.toFixed(0)));
  }

  negate(): Money {
    return new Money(-this.minorUnits);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.minorUnits >= other.minorUnits;
  }

  greaterThan(other: Money): boolean {
    return this.minorUnits > other.minorUnits;
  }

  lessThan(other: Money): boolean {
    return this.minorUnits < other.minorUnits;
  }

  equals(other: Money): boolean {
    return this.minorUnits === other.minorUnits;
  }

  static min(a: Money, b: Money): Money {
    return a.lessThan(b) ? a : b;
  }

  static max(a: Money, b: Money): Money {
    return a.greaterThan(b) ? a : b;
  }

  static sum(values: Money[]): Money {
    return values.reduce((acc, v) => acc.add(v), Money.zero());
  }

  toJSON(): string {
    return this.toMajorUnitsString();
  }
}
