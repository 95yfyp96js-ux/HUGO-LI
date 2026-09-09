import 'package:lending_engine/lending_engine.dart' as engine;

import '../domain/borrower_repository.dart';
import '../domain/loan_repository.dart';

/// 目前庫裡已經有多少筆真實資料。設定頁「載入範例資料」在動手前先問這個，
/// 有資料就要二次確認（見 docs/MANUAL-QA.md「載入範例資料」）。
class ExistingDataSummary {
  const ExistingDataSummary({required this.borrowers, required this.loans});

  final int borrowers;
  final int loans;

  bool get isEmpty => borrowers == 0 && loans == 0;

  String get description => '目前已有 $borrowers 位借款人、$loans 筆貸款。';
}

Future<ExistingDataSummary> summarizeExistingData({
  required BorrowerRepository borrowers,
  required LoanRepository loans,
}) async {
  return ExistingDataSummary(
    borrowers: (await borrowers.listAll()).length,
    loans: (await loans.listAll()).length,
  );
}

/// 範例資料（僅供操作示範／測試，非真實貸款）。建立 2 位借款人與 2 筆已撥款
/// 貸款（分別示範 EMI、EPP 兩種還款方式），方便第一次安裝後快速看到看板
/// 有數字、走過完整流程。僅在設定頁「載入範例資料」（debug 模式）觸發。
///
/// 兩個安全性質，缺一不可：
/// 1. **只新增、不刪除**。這裡沒有任何 delete，已有的借款人／貸款／分錄不會
///    被動到。真正的風險是「範例資料混進真帳」，所以呼叫端在庫裡已有資料時
///    必須先做二次確認（[summarizeExistingData]）。
/// 2. 身分證欄位刻意用 Z9 開頭的假號碼，避免與手動驗收（docs/MANUAL-QA.md）或
///    真實使用者輸入的號碼撞號——撞號會讓查重擋下、整個載入中途失敗。
Future<void> seedDemoData({
  required BorrowerRepository borrowers,
  required LoanRepository loans,
}) async {
  final borrowerA = await borrowers.create(
    name: '陳大文',
    idNumber: 'Z900000001',
    phone: '0912-345-678',
  );
  final borrowerB = await borrowers.create(
    name: '林小美',
    idNumber: 'Z900000002',
    phone: '0987-654-321',
  );

  final DateTime now = DateTime.now();

  // 貸款 A：35 天前撥款，第 1 期（到期日＝5 天前）已正常繳清 → 進行中。
  final DateTime disbursedA = now.subtract(const Duration(days: 35));
  final loanA = await loans.registerLoan(
    borrowerId: borrowerA.id,
    principalCents: 20000000, // 20 萬元
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 120, // 1.2%
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
    plannedDisbursementDate: disbursedA,
  );
  await loans.confirmDisbursement(loanA.id, at: disbursedA);
  final scheduleA = await loans.scheduleFor(loanA.id);
  final firstDue =
      scheduleA.first.principalCents + scheduleA.first.interestCents;
  await loans.recordPayment(
    loanId: loanA.id,
    amountCents: firstDue,
    paidAt: now.subtract(const Duration(days: 3)),
    note: '範例：第 1 期正常繳款',
  );

  // 貸款 B：70 天前撥款，刻意不繳款 → 第 1、2 期逾期，示範逾期情境
  // （App 啟動時的日結會自動標記，看板「逾期」欄位才會有數字）。
  final DateTime disbursedB = now.subtract(const Duration(days: 70));
  final loanB = await loans.registerLoan(
    borrowerId: borrowerB.id,
    principalCents: 10000000, // 10 萬元
    method: engine.RepaymentMethod.epp,
    rateType: engine.RateType.annual,
    rateBps: 1500, // 15%
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 6,
    plannedDisbursementDate: disbursedB,
  );
  await loans.confirmDisbursement(loanB.id, at: disbursedB);
  await loans.runDailyBatch(loanId: loanB.id);
}
