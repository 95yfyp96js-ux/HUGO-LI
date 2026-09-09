import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:sqlite3/sqlite3.dart';
import 'package:web_ledger/db/schema.dart';
import 'package:web_ledger/domain/checks.dart';
import 'package:web_ledger/domain/loans.dart';
import 'package:web_ledger/domain/settlement.dart';

/// 固定情境：本金 100,000 元、EMI、月息 1%、12 期、每期 30 天、寬限 3 天。
/// 第 1 期應繳 NT$8,884.88（＝本 7,884.88 ＋ 息 1,000.00），由
/// packages/lending_engine 的黃金案例鎖住。
class Fx {
  Fx(this.db)
    : loans = LoanService(db),
      checks = CheckService(db),
      settlement = SettlementService(db);

  factory Fx.open() => Fx(openDatabase());

  final Database db;
  final LoanService loans;
  final CheckService checks;
  final SettlementService settlement;

  late String customerId;
  late String loanId;

  static final DateTime today = DateTime(2026, 5, 1);

  /// 撥款日 = today − [daysAgo]。daysAgo = 0 表示今天剛撥。
  String seedLoan({int daysAgo = 0, bool penalty = false}) {
    customerId = loans.createCustomer(name: '王小明', idNumber: 'A123456789');
    loanId = loans.registerLoan(
      customerId: customerId,
      principalCents: 10000000,
      method: engine.RepaymentMethod.emi,
      rateType: engine.RateType.monthly,
      rateBps: 100,
      dayCount: engine.DayCount.thirty360,
      tenorPeriods: 12,
      penaltyEnabled: penalty,
    );
    loans.confirmDisbursement(
      opId: newId(),
      operatorId: 'staff-1',
      loanId: loanId,
      disbursedAt: today.subtract(Duration(days: daysAgo)),
      now: today,
    );
    return loanId;
  }

  String seedCheck({
    required int faceCents,
    required int discountCents,
    required int dueInDays,
  }) => checks.receive(
    opId: newId(),
    operatorId: 'staff-1',
    customerId: customerId,
    bankCode: '004',
    checkNo: 'AB12345678',
    faceCents: faceCents,
    discountInterestCents: discountCents,
    cashPaidCents: faceCents - discountCents,
    otherFeeCents: 0,
    dueDate: today.add(Duration(days: dueInDays)),
    receivedDate: today,
  );
}
