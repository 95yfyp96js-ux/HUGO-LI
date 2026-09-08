import 'package:decimal/decimal.dart';
import 'package:rational/rational.dart';

/// Working precision used whenever a division does not terminate in decimal
/// (e.g. 1/12, x/365, x/360, x/30). High enough that truncation error is far
/// below one hundred-thousandth of a cent, so it never affects the final
/// ROUND_HALF_UP-to-cent result.
const int kWorkingScale = 28;

/// Converts a [Rational] (the result of any [Decimal] division) back into a
/// [Decimal] at [kWorkingScale] precision.
Decimal toWorkingDecimal(Rational value) =>
    value.toDecimal(scaleOnInfinitePrecision: kWorkingScale);

/// Exact [Decimal] division at working precision.
Decimal divD(Decimal a, Decimal b) => toWorkingDecimal(a / b);

/// Rounds an exact [Decimal] amount expressed in whole cents to the nearest
/// integer cent using ROUND_HALF_UP. [Decimal.round] already rounds ties
/// away from zero, which is ROUND_HALF_UP for the non-negative amounts this
/// domain produces.
int roundHalfUpToCents(Decimal exactCents) =>
    exactCents.round().toBigInt().toInt();

/// Converts an integer cent amount into a [Decimal] for exact arithmetic.
Decimal centsToDecimal(int cents) => Decimal.fromInt(cents);
