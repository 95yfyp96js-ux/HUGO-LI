import 'package:lending_engine/lending_engine.dart' as engine;

import '../domain/borrower_repository.dart';
import '../domain/loan_repository.dart';

/// 範例資料（僅供操作示範／測試，非真實貸款）。建立 2 位借款人與 2 筆已撥款
/// 貸款（分別示範 EMI、EPP 兩種還款方式），方便第一次安裝後快速看到看板
/// 有數字、走過完整流程。僅在設定頁「載入範例資料」（debug 模式）觸發。
Future<void> seedDemoData({
  required BorrowerRepository borrowers,
  required LoanRepository loans,
}) async {
  final borrowerA = await borrowers.create(
    name: '陳大文',
    idNumber: 'A123456789',
    phone: '0912-345-678',
  );
  final borrowerB = await borrowers.create(
    name: '林小美',
    idNumber: 'B223456789',
    phone: '0987-654-321',
  );

  final loanA = await loans.registerLoan(
    borrowerId: borrowerA.id,
    principalCents: 20000000, // 20 萬元
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 120, // 1.2%
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
    plannedDisbursementDate: DateTime.now().subtract(const Duration(days: 35)),
  );
  await loans.confirmDisbursement(loanA.id);
  final scheduleA = await loans.scheduleFor(loanA.id);
  final firstDue =
      scheduleA.first.principalCents + scheduleA.first.interestCents;
  await loans.recordPayment(
    loanId: loanA.id,
    amountCents: firstDue,
    paidAt: DateTime.now().subtract(const Duration(days: 5)),
    note: '範例：第 1 期正常繳款',
  );

  final loanB = await loans.registerLoan(
    borrowerId: borrowerB.id,
    principalCents: 10000000, // 10 萬元
    method: engine.RepaymentMethod.epp,
    rateType: engine.RateType.annual,
    rateBps: 1500, // 15%
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 6,
    plannedDisbursementDate: DateTime.now().subtract(const Duration(days: 70)),
  );
  await loans.confirmDisbursement(loanB.id);
  // 刻意不繳款，示範逾期情境（App 啟動時的日結會自動標記逾期）。
}
