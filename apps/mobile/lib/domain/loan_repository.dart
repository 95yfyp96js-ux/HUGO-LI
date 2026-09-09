import 'package:drift/drift.dart';
import 'package:ledger/ledger.dart' as ledger;
import 'package:lending_engine/lending_engine.dart' as engine;

import '../db/app_database.dart';
import 'enum_mapping.dart';
import 'schedule_item_math.dart';
import 'id_gen.dart';

class IllegalLoanTransitionException implements Exception {
  IllegalLoanTransitionException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// 收款預覽：這筆錢會怎麼分配、會不會溢繳。全部單位為分。
class PaymentPreview {
  const PaymentPreview({
    required this.amountCents,
    required this.penaltyCents,
    required this.interestCents,
    required this.principalCents,
    required this.overpaymentCents,
    required this.periodsTouched,
    required this.futurePeriodsTouched,
    required this.futurePeriodsBeyondCurrent,
  });

  final int amountCents;
  final int penaltyCents;
  final int interestCents;
  final int principalCents;

  /// 沖完所有未繳期別後還剩下的錢。> 0 就是溢繳，入帳前必須先問過使用者。
  final int overpaymentCents;

  /// 這筆錢會碰到幾期。
  final int periodsTouched;

  /// 其中有幾期是「還沒到期」的。
  ///
  /// 注意：這個數字本身**不適合**拿來決定要不要跳提醒。在到期日之前繳掉當期，
  /// 是最常見的正常繳款方式（收款對話框預設帶入的就是這個金額），每次都跳
  /// 「提前還本」只會讓人閉著眼睛點過去，B4 的提醒就失效了。
  final int futurePeriodsTouched;

  /// 碰到「本期以外」的未到期期別數（＝真正的提前還本）。
  ///
  /// 「本期」指最早一期尚未繳清的期別。這筆錢沖完本期還往後吃，才是使用者
  /// 可能沒預期到的事，值得在入帳前先問一次。
  final int futurePeriodsBeyondCurrent;

  bool get isOverpayment => overpaymentCents > 0;

  /// 是否要在入帳前跳出提前還本說明（見 [futurePeriodsBeyondCurrent]）。
  bool get isPrepayment => futurePeriodsBeyondCurrent > 0;
}

/// 收款時可以一鍵帶入的三種金額（分）。
class PaymentSuggestion {
  const PaymentSuggestion({
    required this.currentDueCents,
    required this.overdueCents,
    required this.payoffCents,
  });

  /// 最早一期未繳清的剩餘應繳（本期應繳）。
  final int currentDueCents;

  /// 已逾期期別的剩餘應繳合計。
  final int overdueCents;

  /// 全部未繳清期別的剩餘應繳合計（一次結清金額）。
  final int payoffCents;
}

/// 貸款登記、計畫產生、撥款確認、還款入帳（見 spec §1、§4、§6、§8）。
///
/// - 建約（[registerLoan]）與撥款（[confirmDisbursement]）是分開的動作
///   （spec §6）。
/// - [confirmDisbursement] 前 Schedule 皆可重算；之後才開始寫入
///   `DISBURSEMENT` 分錄並鎖定 `ruleVersion`（不變式 2、4）。
/// - [recordPayment] 依固定瀑布順序（罰息→費用→利息→本金）逐期（由舊到新）
///   沖銷，溢收另計為調整分錄（見 docs/interest-rules.md §6）。
class LoanRepository {
  LoanRepository(this._db);

  final AppDatabase _db;

  Future<List<Loan>> listAll() => (_db.select(
    _db.loans,
  )..orderBy([(t) => OrderingTerm.desc(t.createdAt)])).get();

  Stream<List<Loan>> watchAll() => (_db.select(
    _db.loans,
  )..orderBy([(t) => OrderingTerm.desc(t.createdAt)])).watch();

  Future<Loan?> findById(String id) =>
      (_db.select(_db.loans)..where((t) => t.id.equals(id))).getSingleOrNull();

  Future<List<ScheduleItem>> scheduleFor(String loanId) =>
      (_db.select(_db.scheduleItems)
            ..where((t) => t.loanId.equals(loanId))
            ..orderBy([(t) => OrderingTerm.asc(t.periodNumber)]))
          .get();

  Stream<List<ScheduleItem>> watchScheduleFor(String loanId) =>
      (_db.select(_db.scheduleItems)
            ..where((t) => t.loanId.equals(loanId))
            ..orderBy([(t) => OrderingTerm.asc(t.periodNumber)]))
          .watch();

  Future<List<LedgerEntryRow>> ledgerFor(String loanId) =>
      (_db.select(_db.ledgerEntries)
            ..where((t) => t.loanId.equals(loanId))
            ..orderBy([(t) => OrderingTerm.asc(t.postedAt)]))
          .get();

  Future<List<LedgerEntryRow>> allLedgerEntries() =>
      _db.select(_db.ledgerEntries).get();

  Future<List<Payment>> paymentsFor(String loanId) =>
      (_db.select(_db.payments)
            ..where((t) => t.loanId.equals(loanId))
            ..orderBy([(t) => OrderingTerm.asc(t.paidAt)]))
          .get();

  /// 登記貸款＋建約＋自動生成計畫（四步上手第 2、3 步）。狀態機驅動至
  /// `ACCEPTED`（撥款前最後一站），尚未寫入任何分錄、尚未開始計息。
  Future<Loan> registerLoan({
    required String borrowerId,
    required int principalCents,
    required engine.RepaymentMethod method,
    required engine.RateType rateType,
    required int rateBps,
    required engine.DayCount dayCount,
    required int tenorPeriods,
    required DateTime plannedDisbursementDate,
    int periodDays = 30,
    int graceDays = 3,
    bool penaltyEnabled = false,
    int penaltyRateBps = 600,
  }) async {
    final String id = newId();
    final DateTime now = DateTime.now();

    await _db
        .into(_db.loans)
        .insert(
          LoansCompanion.insert(
            id: id,
            borrowerId: borrowerId,
            principalCents: principalCents,
            method: method.name,
            rateType: rateType.name,
            rateBps: rateBps,
            dayCount: dayCount.name,
            tenorPeriods: tenorPeriods,
            periodDays: Value(periodDays),
            graceDays: Value(graceDays),
            penaltyEnabled: Value(penaltyEnabled),
            penaltyRateBps: Value(penaltyRateBps),
            status: const Value('draft'),
            disbursedAt: Value(plannedDisbursementDate),
            createdAt: now,
          ),
        );

    // 建約：DRAFT -> PENDING_DECISION -> APPROVED_CONDITIONAL -> OFFERED -> ACCEPTED。
    // 系統永不自動核准，這裡只是把「出借人已決定承作」的既成事實推進狀態機
    // （核貸建議模組若啟用，走 loan_events，不在此流程自動觸發）。
    await _driveStatus(id, engine.LoanStatus.accepted);
    await _generateAndPersistSchedule(id, anchorDate: plannedDisbursementDate);
    await _insertAuditLog('REGISTER_LOAN', 'loan', id, null);

    return (await findById(id))!;
  }

  /// 確認撥款（四步上手第 4 步）。撥款後才寫入 `DISBURSEMENT` 分錄、開始計息、
  /// 鎖定 Schedule 的錨定日期。
  ///
  /// [at] 為實際撥款日，預設為現在。補登歷史撥款（先撥款、事後才登記進系統）
  /// 時傳入當時的日期，計畫表與計息起算日都會以它為錨點；不接受未來日期
  /// （撥款是既成事實，不能預約）。
  Future<void> confirmDisbursement(String loanId, {DateTime? at}) async {
    final Loan? loan = await findById(loanId);
    if (loan == null) throw StateError('找不到貸款 $loanId');
    final currentStatus = parseLoanStatus(loan.status);
    if (currentStatus != engine.LoanStatus.accepted) {
      throw IllegalLoanTransitionException(
        '貸款狀態為 $currentStatus，需為已接受條件（ACCEPTED）才能確認撥款',
      );
    }

    final DateTime now = at ?? DateTime.now();
    if (now.isAfter(DateTime.now())) {
      throw ArgumentError('撥款日不可為未來日期：$now');
    }

    await _db.transaction(() async {
      await _generateAndPersistSchedule(loanId, anchorDate: now);
      await (_db.update(_db.loans)..where((t) => t.id.equals(loanId))).write(
        LoansCompanion(
          disbursedAt: Value(now),
          lastAccrualAt: Value(now),
          status: const Value('disbursed'),
        ),
      );
      await _driveStatus(loanId, engine.LoanStatus.current);

      await _db
          .into(_db.ledgerEntries)
          .insert(
            LedgerEntriesCompanion.insert(
              id: newId(),
              loanId: loanId,
              type: ledger.LedgerEntryType.disbursement.name,
              amountCents: loan.principalCents,
              postedAt: now,
            ),
          );
      await _insertAuditLog(
        'CONFIRM_DISBURSEMENT',
        'loan',
        loanId,
        '撥款 ${loan.principalCents} 分',
      );
    });

    // 補登歷史撥款時，計畫表可能一產生就有好幾期已經逾期——立刻跑一次日結，
    // 不要等到下次開 App（見 spec B6）。
    await runDailyBatch(loanId: loanId);
  }

  /// 還款金額建議（分）。收款對話框用它預先帶入**精確到分**的金額，
  /// 使用者不必、也不應該照畫面上被截去分的數字自己輸入。
  Future<PaymentSuggestion> paymentSuggestion(String loanId) async {
    final items = await scheduleFor(loanId);
    int currentDue = 0; // 最早一期未繳清的剩餘應繳
    int overdue = 0; // 所有已逾期期別的剩餘應繳
    int total = 0; // 全部未繳清期別的剩餘應繳（＝結清金額）

    final Loan loan = (await findById(loanId))!;
    final DateTime now = DateTime.now();

    for (final item in items) {
      if (item.isSettledPeriod) continue;
      final int penalty = await _penaltyOwedCents(
        loan: loan,
        item: item,
        asOf: now,
        overdue: engine.isPastGrace(
          dueDate: item.dueDate,
          graceDays: loan.graceDays,
          asOf: now,
        ),
      );
      final int remaining = item.shortfallCents + penalty;
      if (remaining <= 0) continue;

      total += remaining;
      if (currentDue == 0) currentDue = remaining;
      if (item.status == 'overdue') overdue += remaining;
    }

    return PaymentSuggestion(
      currentDueCents: currentDue,
      overdueCents: overdue,
      payoffCents: total,
    );
  }

  /// 收款預覽：算出這筆錢會怎麼分配、會不會溢繳，**完全不寫入**。
  ///
  /// 對話框用它在入帳前把「多出多少、去哪裡」講清楚（見 spec B4：禁止默默
  /// 寫分錄）。分配邏輯與 [recordPayment] 同一套規則：由舊到新逐期沖銷，
  /// 期內依瀑布罰息→利息→本金。
  Future<PaymentPreview> previewPayment({
    required String loanId,
    required int amountCents,
    required DateTime paidAt,
  }) async {
    final Loan loan = (await findById(loanId))!;
    final items = await scheduleFor(loanId);

    int remaining = amountCents;
    int appliedPeriods = 0;
    int toPenalty = 0;
    int toInterest = 0;
    int toPrincipal = 0;
    int futurePeriods = 0;
    int futureBeyondCurrent = 0;

    for (final item in items) {
      if (remaining <= 0) break;
      if (item.isSettledPeriod) continue;

      final int interestOwed = item.interestCents - item.interestPaidCents;
      final int principalOwed = item.principalCents - item.principalPaidCents;
      if (interestOwed <= 0 && principalOwed <= 0) continue;

      final bool overdue = engine.isPastGrace(
        dueDate: item.dueDate,
        graceDays: loan.graceDays,
        asOf: paidAt,
      );
      final int penaltyOwed = await _penaltyOwedCents(
        loan: loan,
        item: item,
        asOf: paidAt,
        overdue: overdue,
      );

      final int payPenalty = remaining < penaltyOwed ? remaining : penaltyOwed;
      remaining -= payPenalty;
      final int payInterest = remaining < interestOwed
          ? remaining
          : interestOwed;
      remaining -= payInterest;
      final int payPrincipal = remaining < principalOwed
          ? remaining
          : principalOwed;
      remaining -= payPrincipal;

      toPenalty += payPenalty;
      toInterest += payInterest;
      toPrincipal += payPrincipal;
      appliedPeriods++;
      if (item.dueDate.isAfter(paidAt)) {
        futurePeriods++;
        // 第一個被沖銷的期別＝「本期」，提前繳本期不算提前還本。
        if (appliedPeriods > 1) futureBeyondCurrent++;
      }
    }

    return PaymentPreview(
      amountCents: amountCents,
      penaltyCents: toPenalty,
      interestCents: toInterest,
      principalCents: toPrincipal,
      overpaymentCents: remaining,
      periodsTouched: appliedPeriods,
      futurePeriodsTouched: futurePeriods,
      futurePeriodsBeyondCurrent: futureBeyondCurrent,
    );
  }

  /// 該期目前尚未入帳的罰息（分）。罰息未啟用或未逾期一律 0。
  Future<int> _penaltyOwedCents({
    required Loan loan,
    required ScheduleItem item,
    required DateTime asOf,
    required bool overdue,
  }) async {
    if (!loan.penaltyEnabled || !overdue) return 0;
    final int interestOwed = item.interestCents - item.interestPaidCents;
    final int principalOwed = item.principalCents - item.principalPaidCents;
    final penaltySpec = engine.RateSpec(
      rateType: engine.RateType.annual,
      rateBps: loan.penaltyRateBps,
      dayCount: engine.DayCount.act365,
    );
    final int accruedTotal = engine.accrueInterestCents(
      balanceCents: interestOwed + principalOwed,
      rateSpec: penaltySpec,
      from: item.dueDate.add(Duration(days: loan.graceDays)),
      to: asOf,
    );
    final int alreadyBilled = await _sumLedger(
      loan.id,
      ledger.LedgerEntryType.penalty,
      item.periodNumber,
    );
    final int owed = accruedTotal - alreadyBilled;
    return owed > 0 ? owed : 0;
  }

  /// 目前整筆貸款已累積、尚未入帳的罰息合計（分）。罰息未啟用時恆為 0。
  Future<int> accruedPenaltyCents(String loanId, {DateTime? asOf}) async {
    final Loan loan = (await findById(loanId))!;
    if (!loan.penaltyEnabled) return 0;
    final DateTime now = asOf ?? DateTime.now();
    final items = await scheduleFor(loanId);
    int total = 0;
    for (final item in items) {
      if (item.isSettledPeriod) continue;
      final bool overdue = engine.isPastGrace(
        dueDate: item.dueDate,
        graceDays: loan.graceDays,
        asOf: now,
      );
      total += await _penaltyOwedCents(
        loan: loan,
        item: item,
        asOf: now,
        overdue: overdue,
      );
    }
    return total;
  }

  /// 記一筆還款：依瀑布順序、由舊到新沖銷各期，溢收記為調整分錄
  /// （見 docs/interest-rules.md §6）。
  Future<void> recordPayment({
    required String loanId,
    required int amountCents,
    required DateTime paidAt,
    String? note,
  }) async {
    if (amountCents <= 0) throw ArgumentError('繳款金額必須大於 0');

    await runDailyBatch(loanId: loanId, asOf: paidAt);

    final Loan loan = (await findById(loanId))!;
    final items = await scheduleFor(loanId);

    int remaining = amountCents;
    final List<(String itemId, ScheduleItemsCompanion companion)> itemUpdates =
        [];
    final List<LedgerEntriesCompanion> newEntries = [];

    for (final item in items) {
      if (remaining <= 0) break;
      if (item.status == 'paid' ||
          item.status == 'prepaid' ||
          item.status == 'waived') {
        continue;
      }

      final int interestOwed = item.interestCents - item.interestPaidCents;
      final int principalOwed = item.principalCents - item.principalPaidCents;
      if (interestOwed <= 0 && principalOwed <= 0) continue;

      final bool overdue = engine.isPastGrace(
        dueDate: item.dueDate,
        graceDays: loan.graceDays,
        asOf: paidAt,
      );

      final int penaltyOwed = await _penaltyOwedCents(
        loan: loan,
        item: item,
        asOf: paidAt,
        overdue: overdue,
      );

      final int payPenalty = remaining < penaltyOwed ? remaining : penaltyOwed;
      remaining -= payPenalty;
      final int payInterest = remaining < interestOwed
          ? remaining
          : interestOwed;
      remaining -= payInterest;
      final int payPrincipal = remaining < principalOwed
          ? remaining
          : principalOwed;
      remaining -= payPrincipal;

      if (payPenalty > 0) {
        newEntries.add(
          _ledgerCompanion(
            loanId,
            ledger.LedgerEntryType.penalty,
            payPenalty,
            paidAt,
            item.periodNumber,
          ),
        );
      }
      if (payInterest > 0) {
        newEntries.add(
          _ledgerCompanion(
            loanId,
            ledger.LedgerEntryType.interest,
            payInterest,
            paidAt,
            item.periodNumber,
          ),
        );
      }
      if (payPrincipal > 0) {
        newEntries.add(
          _ledgerCompanion(
            loanId,
            ledger.LedgerEntryType.principal,
            payPrincipal,
            paidAt,
            item.periodNumber,
          ),
        );
      }

      final int newInterestPaid = item.interestPaidCents + payInterest;
      final int newPrincipalPaid = item.principalPaidCents + payPrincipal;
      final bool fullyPaid =
          newInterestPaid >= item.interestCents &&
          newPrincipalPaid >= item.principalCents;

      final String newStatus;
      if (fullyPaid) {
        newStatus = paidAt.isBefore(item.dueDate) ? 'prepaid' : 'paid';
      } else if (newInterestPaid > 0 || newPrincipalPaid > 0) {
        newStatus = overdue ? 'overdue' : 'partial';
      } else {
        newStatus = overdue ? 'overdue' : 'due';
      }

      itemUpdates.add((
        item.id,
        ScheduleItemsCompanion(
          interestPaidCents: Value(newInterestPaid),
          principalPaidCents: Value(newPrincipalPaid),
          status: Value(newStatus),
        ),
      ));
    }

    await _db.transaction(() async {
      for (final entry in newEntries) {
        await _db.into(_db.ledgerEntries).insert(entry);
      }
      for (final (itemId, companion) in itemUpdates) {
        await (_db.update(
          _db.scheduleItems,
        )..where((t) => t.id.equals(itemId))).write(companion);
      }
      if (remaining > 0) {
        // 溢收：超過全部應繳金額，記為調整分錄，供人工核對（見 §6 第 5 點）。
        await _db
            .into(_db.ledgerEntries)
            .insert(
              LedgerEntriesCompanion.insert(
                id: newId(),
                loanId: loanId,
                type: ledger.LedgerEntryType.adjustment.name,
                amountCents: -remaining,
                postedAt: paidAt,
                note: const Value('溢繳（超過全部應繳金額），已記為負向調整分錄待人工核對'),
              ),
            );
      }
      await _db
          .into(_db.payments)
          .insert(
            PaymentsCompanion.insert(
              id: newId(),
              loanId: loanId,
              amountCents: amountCents,
              paidAt: paidAt,
              note: Value(note),
            ),
          );
      await _recomputeLoanStatusAfterPayment(loanId);
      await _insertAuditLog(
        'RECORD_PAYMENT',
        'loan',
        loanId,
        '收款 $amountCents 分',
      );
    });
  }

  /// 日結：對 DISBURSED/CURRENT/DELINQUENT 的貸款補逾期判定
  /// （見 docs/interest-rules.md §5）。
  Future<void> runDailyBatch({String? loanId, DateTime? asOf}) async {
    final DateTime now = asOf ?? DateTime.now();
    final List<Loan> loans;
    if (loanId != null) {
      final loan = await findById(loanId);
      loans = loan == null ? const [] : [loan];
    } else {
      loans = await listAll();
    }

    for (final loan in loans) {
      final status = parseLoanStatus(loan.status);
      if (!status.isDisbursed || status.isTerminal) continue;

      final items = await scheduleFor(loan.id);
      bool anyOverdue = false;
      for (final item in items) {
        if (item.status == 'paid' ||
            item.status == 'prepaid' ||
            item.status == 'waived') {
          continue;
        }
        final bool overdue = engine.isPastGrace(
          dueDate: item.dueDate,
          graceDays: loan.graceDays,
          asOf: now,
        );
        if (overdue) {
          anyOverdue = true;
          if (item.status != 'overdue') {
            await (_db.update(_db.scheduleItems)
                  ..where((t) => t.id.equals(item.id)))
                .write(const ScheduleItemsCompanion(status: Value('overdue')));
          }
        }
      }

      final engine.LoanStatus target = anyOverdue
          ? engine.LoanStatus.delinquent
          : engine.LoanStatus.current;
      if (status != target && status.canTransitionTo(target)) {
        await _driveStatus(loan.id, target);
      }

      await (_db.update(_db.loans)..where((t) => t.id.equals(loan.id))).write(
        LoansCompanion(lastAccrualAt: Value(now)),
      );
    }
  }

  Future<void> _recomputeLoanStatusAfterPayment(String loanId) async {
    final Loan loan = (await findById(loanId))!;
    final status = parseLoanStatus(loan.status);
    if (status.isTerminal) return;

    final items = await scheduleFor(loanId);
    final bool allSettled = items.every(
      (i) =>
          i.status == 'paid' || i.status == 'prepaid' || i.status == 'waived',
    );
    if (allSettled) {
      if (status.canTransitionTo(engine.LoanStatus.settled)) {
        await _driveStatus(loanId, engine.LoanStatus.settled);
      }
      return;
    }

    final bool anyOverdue = items.any((i) => i.status == 'overdue');
    final engine.LoanStatus target = anyOverdue
        ? engine.LoanStatus.delinquent
        : engine.LoanStatus.current;
    if (status != target && status.canTransitionTo(target)) {
      await _driveStatus(loanId, target);
    }
  }

  /// 依狀態機逐步推進到 [target]（每一步都檢查合法性，不合法立即拋出）。
  Future<void> _driveStatus(String loanId, engine.LoanStatus target) async {
    final Loan loan = (await findById(loanId))!;
    engine.LoanStatus current = parseLoanStatus(loan.status);
    final List<engine.LoanStatus> path = _pathTo(current, target);
    for (final step in path) {
      if (!current.canTransitionTo(step)) {
        throw IllegalLoanTransitionException('不合法的狀態轉移：$current -> $step');
      }
      current = step;
    }
    await (_db.update(_db.loans)..where((t) => t.id.equals(loanId))).write(
      LoansCompanion(status: Value(current.name)),
    );
  }

  /// 產生 [from] 到 [to] 的標準路徑（僅覆蓋本 App 會用到的幾條固定路徑）。
  List<engine.LoanStatus> _pathTo(
    engine.LoanStatus from,
    engine.LoanStatus to,
  ) {
    const List<engine.LoanStatus> fullForward = [
      engine.LoanStatus.draft,
      engine.LoanStatus.pendingDecision,
      engine.LoanStatus.approvedConditional,
      engine.LoanStatus.offered,
      engine.LoanStatus.accepted,
      engine.LoanStatus.disbursed,
      engine.LoanStatus.current,
    ];
    final fromIndex = fullForward.indexOf(from);
    final toIndex = fullForward.indexOf(to);
    if (fromIndex != -1 && toIndex != -1 && toIndex > fromIndex) {
      return fullForward.sublist(fromIndex + 1, toIndex + 1);
    }
    // current <-> delinquent、-> settled 等單步轉移。
    return [to];
  }

  Future<void> _generateAndPersistSchedule(
    String loanId, {
    required DateTime anchorDate,
  }) async {
    final Loan loan = (await findById(loanId))!;
    final terms = engine.LoanTerms(
      principalCents: loan.principalCents,
      method: parseRepaymentMethod(loan.method),
      rateSpec: engine.RateSpec(
        rateType: parseRateType(loan.rateType),
        rateBps: loan.rateBps,
        dayCount: parseDayCount(loan.dayCount),
        periodDays: loan.periodDays,
      ),
      tenorPeriods: loan.tenorPeriods,
      disbursedAt: anchorDate,
      ruleVersion: loan.ruleVersion,
      graceDays: loan.graceDays,
    );
    final result = engine.generateSchedule(terms);

    await _db.transaction(() async {
      await (_db.delete(
        _db.scheduleItems,
      )..where((t) => t.loanId.equals(loanId))).go();
      for (final item in result.items) {
        await _db
            .into(_db.scheduleItems)
            .insert(
              ScheduleItemsCompanion.insert(
                id: newId(),
                loanId: loanId,
                periodNumber: item.periodNumber,
                dueDate: item.dueDate,
                openingBalanceCents: item.openingBalanceCents,
                principalCents: item.principalCents,
                interestCents: item.interestCents,
                closingBalanceCents: item.closingBalanceCents,
              ),
            );
      }
    });
  }

  Future<int> _sumLedger(
    String loanId,
    ledger.LedgerEntryType type,
    int periodNumber,
  ) async {
    final rows =
        await (_db.select(_db.ledgerEntries)..where(
              (t) =>
                  t.loanId.equals(loanId) &
                  t.type.equals(type.name) &
                  t.relatedPeriodNumber.equals(periodNumber),
            ))
            .get();
    return rows.fold<int>(0, (sum, r) => sum + r.amountCents);
  }

  LedgerEntriesCompanion _ledgerCompanion(
    String loanId,
    ledger.LedgerEntryType type,
    int amountCents,
    DateTime postedAt,
    int periodNumber,
  ) => LedgerEntriesCompanion.insert(
    id: newId(),
    loanId: loanId,
    type: type.name,
    amountCents: amountCents,
    postedAt: postedAt,
    relatedPeriodNumber: Value(periodNumber),
  );

  Future<void> _insertAuditLog(
    String action,
    String entityType,
    String entityId,
    String? detail,
  ) {
    return _db
        .into(_db.auditLogs)
        .insert(
          AuditLogsCompanion.insert(
            id: newId(),
            action: action,
            entityType: entityType,
            entityId: entityId,
            detail: Value(detail),
            createdAt: DateTime.now(),
          ),
        );
  }
}
