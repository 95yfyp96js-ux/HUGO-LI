import 'dart:io';

import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:web_ledger/db/schema.dart';
import 'package:web_ledger/domain/checks.dart';
import 'package:web_ledger/domain/loans.dart';
import 'package:web_ledger/domain/settlement.dart';

/// 假資料，只為了讓這一頁打開來有東西可看。**不是真實客戶。**
/// 用法：`dart run bin/seed.dart`（會寫進 DB_PATH，預設 ledger.db）
Future<void> main() async {
  final String path = Platform.environment['DB_PATH'] ?? 'ledger.db';
  final db = openDatabase(path: path);
  final loans = LoanService(db);
  final checks = CheckService(db);
  final DateTime today = DateTime.now();

  final a = loans.createCustomer(name: '陳大文', idNumber: 'Z900000001');
  final b = loans.createCustomer(name: '林小美', idNumber: 'Z900000002');

  // 借款 A：30 天前撥款，第 1 期今天到期 → 進格 3、進紅字。
  final loanA = loans.registerLoan(
    customerId: a,
    principalCents: 10000000,
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 100,
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
  );
  loans.confirmDisbursement(
    opId: newId(),
    operatorId: 'seed',
    loanId: loanA,
    disbursedAt: today.subtract(const Duration(days: 30)),
  );

  // 借款 B：70 天前撥款、一期沒繳、罰息開著 → 進格 5。
  final loanB = loans.registerLoan(
    customerId: b,
    principalCents: 5000000,
    method: engine.RepaymentMethod.epp,
    rateType: engine.RateType.monthly,
    rateBps: 120,
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 6,
    penaltyEnabled: true,
  );
  loans.confirmDisbursement(
    opId: newId(),
    operatorId: 'seed',
    loanId: loanB,
    disbursedAt: today.subtract(const Duration(days: 70)),
  );

  // 票 1：未到期 → 格 2「未到期」列。
  checks.receive(
    opId: newId(),
    operatorId: 'seed',
    customerId: a,
    bankCode: '004',
    checkNo: 'AB10001234',
    faceCents: 3000000,
    discountInterestCents: 90000,
    cashPaidCents: 2910000,
    otherFeeCents: 0,
    dueDate: today.add(const Duration(days: 20)),
    receivedDate: today.subtract(const Duration(days: 10)),
  );

  // 票 2：已經到期還沒處理 → 格 2「已到期未處理」列 ＋ 紅字（G1 定案）。
  checks.receive(
    opId: newId(),
    operatorId: 'seed',
    customerId: b,
    bankCode: '822',
    checkNo: 'CD20005678',
    faceCents: 2000000,
    discountInterestCents: 60000,
    cashPaidCents: 1940000,
    otherFeeCents: 0,
    dueDate: today.subtract(const Duration(days: 5)),
    receivedDate: today.subtract(const Duration(days: 35)),
  );

  stdout.writeln('已寫入假資料到 $path（2 位客戶、2 筆借款、2 張票）。');
  db.dispose();
}
