import 'methods/bullet.dart';
import 'methods/emi.dart';
import 'methods/epp.dart';
import 'methods/io.dart';
import 'schedule.dart';

/// 依 [LoanTerms.method] 產生對應的還款計畫。純函式、無副作用、可重算
/// （見 docs/interest-rules.md §7.3）。
ScheduleResult generateSchedule(LoanTerms terms) {
  switch (terms.method) {
    case RepaymentMethod.emi:
      return generateEmiSchedule(terms);
    case RepaymentMethod.epp:
      return generateEppSchedule(terms);
    case RepaymentMethod.io:
      return generateIoSchedule(terms);
    case RepaymentMethod.bullet:
      return generateBulletSchedule(terms);
  }
}
