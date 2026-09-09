import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:sqlite3/sqlite3.dart';
import 'package:web_ledger/db/schema.dart';
import 'package:web_ledger/domain/auth.dart';
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
      settlement = SettlementService(db),
      auth = AuthService(db);

  factory Fx.open() => Fx(openDatabase());

  final Database db;
  final LoanService loans;
  final CheckService checks;
  final SettlementService settlement;
  final AuthService auth;

  late String bossToken;
  late String staffToken;
  late String bossId;
  late String staffId;

  /// 建一位老闆與一位員工並登入，回傳兩張 session cookie。
  void seedUsers() {
    bossId = auth.createUser(
      username: 'boss',
      displayName: '老闆',
      role: Role.boss,
      password: 'boss-password',
    );
    staffId = auth.createUser(
      username: 'staff',
      displayName: '阿明',
      role: Role.staff,
      password: 'staff-password',
    );
    bossToken = auth.login('boss', 'boss-password');
    staffToken = auth.login('staff', 'staff-password');
  }

  late String customerId;
  late String loanId;

  static final DateTime today = DateTime(2026, 5, 1);

  /// 撥款日 = [anchor]（預設固定的 [today]）− [daysAgo]。
  /// 日結測試要用真正的今天，就傳 `anchor: DateTime.now()`。
  String seedLoan({
    int daysAgo = 0,
    bool penalty = false,
    DateTime? anchor,
  }) {
    final DateTime base = anchor ?? today;
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
      disbursedAt: base.subtract(Duration(days: daysAgo)),
      now: base,
    );
    return loanId;
  }

  /// 用指定日期收一張票（日結測試要用「今天」）。
  String seedCheckOn(
    DateTime on, {
    required int faceCents,
    required int dueInDays,
    int discountCents = 0,
    String checkNo = 'AB77770001',
  }) => checks.receive(
    opId: newId(),
    operatorId: 'staff-1',
    customerId: customerId,
    bankCode: '004',
    checkNo: checkNo,
    faceCents: faceCents,
    discountInterestCents: discountCents,
    cashPaidCents: faceCents - discountCents,
    otherFeeCents: 0,
    dueDate: on.add(Duration(days: dueInDays)),
    receivedDate: on,
  );

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
