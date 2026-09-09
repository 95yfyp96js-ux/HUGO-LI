import 'dart:convert';
import 'dart:math';

import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import '../db/store.dart';
import '../money.dart';
import 'lock.dart';
import 'model.dart';

/// 收款並核銷（docs/BOSS-SPEC.md B-5、C-0～C-2）。
///
/// 三件事在這裡被強制，缺一不可：
/// 1. **必須選到 loan_id + schedule_seq。** 沒有「未指定用途的收入」這個選項。
/// 2. **金額權威在伺服器。** 瀏覽器只送金額字串與勾選的期別，怎麼分配、
///    分到哪一分，全部在這裡算完，前端不做任何算術。
/// 3. **同一個 op_id 只成立一次。** 雙擊、網路重送、Safari 上一頁再送都一樣。

/// 一期的分配結果。
class PeriodAllocation {
  PeriodAllocation({
    required this.seq,
    required this.dueDate,
    required this.penaltyCents,
    required this.feeCents,
    required this.interestCents,
    required this.principalCents,
    required this.priorPrincipalPaid,
    required this.priorInterestPaid,
    required this.priorFeePaid,
    required this.priorPenaltyPaid,
  });

  final int seq;
  final DateTime dueDate;
  final int penaltyCents;
  final int feeCents;
  final int interestCents;
  final int principalCents;

  // 樂觀鎖用的「我讀到的舊值」，寫入時要一模一樣才准更新。
  final int priorPrincipalPaid;
  final int priorInterestPaid;
  final int priorFeePaid;
  final int priorPenaltyPaid;

  int get totalCents => penaltyCents + feeCents + interestCents + principalCents;
}

/// 預覽結果。`blocked != null` 代表這筆不能存，訊息就是要顯示給員工看的字。
class SettlementPreview {
  SettlementPreview({
    required this.loan,
    required this.amountCents,
    required this.paidAt,
    required this.allocations,
    required this.overpaymentCents,
    required this.selectedDueCents,
    required this.unselectedUnsettledSeqs,
    this.blocked,
  });

  final Loan loan;
  final int amountCents;
  final DateTime paidAt;
  final List<PeriodAllocation> allocations;

  /// 沖完**所有**未清期別後仍有剩（＝真正的溢繳，見 C-2）。
  final int overpaymentCents;

  /// 所勾期別的應繳合計（含罰息）。
  final int selectedDueCents;

  /// 還沒被勾到、但仍未清的期別。
  final List<int> unselectedUnsettledSeqs;

  final String? blocked;

  bool get isOverpayment => overpaymentCents > 0;
  bool get canPost => blocked == null;

  int get penaltyCents => allocations.fold(0, (s, a) => s + a.penaltyCents);
  int get feeCents => allocations.fold(0, (s, a) => s + a.feeCents);
  int get interestCents => allocations.fold(0, (s, a) => s + a.interestCents);
  int get principalCents => allocations.fold(0, (s, a) => s + a.principalCents);
  int get appliedCents => penaltyCents + feeCents + interestCents + principalCents;
}

class SettlementResult {
  SettlementResult({
    required this.opId,
    required this.loanId,
    required this.amountCents,
    required this.penaltyCents,
    required this.interestCents,
    required this.principalCents,
    required this.overpaymentCents,
    required this.seqs,
    required this.replayed,
  });

  final String opId;
  final String loanId;
  final int amountCents;
  final int penaltyCents;
  final int interestCents;
  final int principalCents;
  final int overpaymentCents;
  final List<int> seqs;

  /// true = 這個 op_id 先前已經成立過，這次直接回放先前的結果，沒有再寫入。
  final bool replayed;

  Map<String, dynamic> toJson() => {
    'op_id': opId,
    'loan_id': loanId,
    'amount_cents': amountCents,
    'penalty_cents': penaltyCents,
    'interest_cents': interestCents,
    'principal_cents': principalCents,
    'overpayment_cents': overpaymentCents,
    'seqs': seqs,
  };

  static SettlementResult fromJson(Map<String, dynamic> json, {required bool replayed}) =>
      SettlementResult(
        opId: json['op_id'] as String,
        loanId: json['loan_id'] as String,
        amountCents: json['amount_cents'] as int,
        penaltyCents: json['penalty_cents'] as int,
        interestCents: json['interest_cents'] as int,
        principalCents: json['principal_cents'] as int,
        overpaymentCents: json['overpayment_cents'] as int,
        seqs: (json['seqs'] as List).cast<int>(),
        replayed: replayed,
      );
}

class SettlementRejected implements Exception {
  SettlementRejected(this.message);
  final String message;
  @override
  String toString() => message;
}

class SettlementService {
  SettlementService(this.db)
    : _store = Store(db),
      _lock = LockGuard(db);

  final Database db;
  final Store _store;
  final LockGuard _lock;

  // ------------------------------------------------------------ 罰息

  /// 該期尚未入帳的罰息。罰息未啟用或還在寬限期內一律 0。
  int penaltyOwedCents({
    required Loan loan,
    required PeriodState item,
    required DateTime asOf,
  }) {
    if (!loan.penaltyEnabled) return 0;
    if (!item.isOverdue(asOf: asOf, graceDays: loan.graceDays)) return 0;
    final int base = item.shortfallCents;
    if (base <= 0) return 0;
    final int accrued = engine.accrueInterestCents(
      balanceCents: base,
      rateSpec: loan.penaltySpec(),
      from: item.dueDate.add(Duration(days: loan.graceDays)),
      to: asOf,
    );
    final int owed = accrued - _store.billedPenaltyCents(loan.id, item.seq);
    return owed > 0 ? owed : 0;
  }

  // ------------------------------------------------------------ 預覽

  /// 算這筆錢會怎麼分配。**完全不寫入。**
  SettlementPreview preview({
    required String loanId,
    required List<int> seqs,
    required int amountCents,
    required DateTime paidAt,
  }) {
    final Loan? loan = _store.loanById(loanId);
    if (loan == null || !loan.isDisbursed) {
      throw SettlementRejected('找不到這筆已撥付的借款。');
    }
    if (dateOnly(paidAt).isAfter(dateOnly(DateTime.now()))) {
      throw SettlementRejected('收款日不可以是未來日期。');
    }
    _lock.assertOpen(paidAt);
    final schedule = _store.scheduleFor(loan);
    final unsettled = schedule.where((p) => !p.isSettled).toList();

    if (seqs.isEmpty) {
      return SettlementPreview(
        loan: loan,
        amountCents: amountCents,
        paidAt: paidAt,
        allocations: const [],
        overpaymentCents: 0,
        selectedDueCents: 0,
        unselectedUnsettledSeqs: unsettled.map((p) => p.seq).toList(),
        blocked: '請先選到要沖銷的期別，沒有選期別的收款不能存。',
      );
    }
    if (amountCents <= 0) {
      return SettlementPreview(
        loan: loan,
        amountCents: amountCents,
        paidAt: paidAt,
        allocations: const [],
        overpaymentCents: 0,
        selectedDueCents: 0,
        unselectedUnsettledSeqs: unsettled.map((p) => p.seq).toList(),
        blocked: '金額必須大於 0，最多兩位小數。',
      );
    }

    final selectedSet = seqs.toSet();
    final selected = unsettled.where((p) => selectedSet.contains(p.seq)).toList()
      ..sort((a, b) => a.seq.compareTo(b.seq));

    final missing = selectedSet.difference(selected.map((p) => p.seq).toSet());
    if (missing.isNotEmpty) {
      final list = (missing.toList()..sort()).join('、');
      return SettlementPreview(
        loan: loan,
        amountCents: amountCents,
        paidAt: paidAt,
        allocations: const [],
        overpaymentCents: 0,
        selectedDueCents: 0,
        unselectedUnsettledSeqs: unsettled.map((p) => p.seq).toList(),
        blocked: '第 $list 期已經結清或不存在，請重新整理畫面再選一次。',
      );
    }

    // 逐期沖銷，期內走固定瀑布：罰息 → 費用 → 利息 → 本金。
    int remaining = amountCents;
    int selectedDue = 0;
    final allocations = <PeriodAllocation>[];
    for (final item in selected) {
      final int penaltyOwed = penaltyOwedCents(
        loan: loan,
        item: item,
        asOf: paidAt,
      );
      final buckets = engine.OutstandingBuckets(
        penaltyCents: penaltyOwed,
        feeCents: item.feeCents - item.feePaidCents,
        interestCents: item.interestCents - item.interestPaidCents,
        principalCents: item.principalCents - item.principalPaidCents,
      );
      selectedDue += penaltyOwed +
          (item.feeCents - item.feePaidCents) +
          (item.interestCents - item.interestPaidCents) +
          (item.principalCents - item.principalPaidCents);

      final allocation = engine.applyWaterfall(
        paymentCents: remaining,
        outstanding: buckets,
      );
      remaining = allocation.overpaymentCents;
      allocations.add(
        PeriodAllocation(
          seq: item.seq,
          dueDate: item.dueDate,
          penaltyCents: allocation.penaltyCents,
          feeCents: allocation.feeCents,
          interestCents: allocation.interestCents,
          principalCents: allocation.principalCents,
          priorPrincipalPaid: item.principalPaidCents,
          priorInterestPaid: item.interestPaidCents,
          priorFeePaid: item.feePaidCents,
          priorPenaltyPaid: item.penaltyPaidCents,
        ),
      );
      if (remaining <= 0) break;
    }

    final unselected = unsettled
        .where((p) => !selectedSet.contains(p.seq))
        .map((p) => p.seq)
        .toList();

    String? blocked;
    int overpayment = 0;
    if (remaining > 0) {
      if (unselected.isNotEmpty) {
        // G2 定案（docs/BOSS-SPEC.md C-2b）：勾錯範圍，不是溢繳。擋下叫他補勾，
        // 不給 overpay_ack 放行——系統不替員工決定這筆錢要沖到哪幾期。
        blocked =
            '這筆錢超過你勾選的期別應繳 ${formatMoney(selectedDue)}，'
            '多出 ${formatMoney(remaining)}。'
            '請一起勾選第 ${unselected.join('、')} 期，'
            '或把金額改成 ${formatMoney(selectedDue)}。';
      } else {
        overpayment = remaining;
      }
    }

    return SettlementPreview(
      loan: loan,
      amountCents: amountCents,
      paidAt: paidAt,
      allocations: allocations,
      overpaymentCents: overpayment,
      selectedDueCents: selectedDue,
      unselectedUnsettledSeqs: unselected,
      blocked: blocked,
    );
  }

  /// 這個 op_id 先前是否已經成立過。**呼叫端要在做任何驗證之前先問這個**：
  /// 重送一個已經入過帳的動作，該回放原結果，而不是回一句「這期已經結清了」
  /// ——後者會讓員工以為出事，然後再按一次。
  SettlementResult? findResult(String opId) {
    final rows = db.select(
      'SELECT result_json FROM operations WHERE op_id = ?',
      [opId],
    );
    if (rows.isEmpty) return null;
    return SettlementResult.fromJson(
      jsonDecode(rows.first['result_json'] as String) as Map<String, dynamic>,
      replayed: true,
    );
  }

  // ------------------------------------------------------------ 入帳

  /// 寫入。`overpayAck` 只有在預覽算出真正的溢繳時才會被要求。
  SettlementResult post({
    required String opId,
    required String operatorId,
    required String loanId,
    required List<int> seqs,
    required int amountCents,
    required DateTime paidAt,
    required bool overpayAck,
  }) {
    // 1. 這個 op_id 已經成立過？直接回放，不再寫入（C-0 冪等鍵）。
    final replayed = findResult(opId);
    if (replayed != null) return replayed;

    final SettlementPreview p = preview(
      loanId: loanId,
      seqs: seqs,
      amountCents: amountCents,
      paidAt: paidAt,
    );
    if (p.blocked != null) throw SettlementRejected(p.blocked!);
    if (p.isOverpayment && !overpayAck) {
      throw SettlementRejected(
        '這筆錢超過應繳，多出 ${formatMoney(p.overpaymentCents)}，請先確認去向。',
      );
    }

    final DateTime entryDate = dateOnly(paidAt);
    final String postedAt = DateTime.now().toIso8601String();
    final result = SettlementResult(
      opId: opId,
      loanId: loanId,
      amountCents: amountCents,
      penaltyCents: p.penaltyCents,
      interestCents: p.interestCents,
      principalCents: p.principalCents,
      overpaymentCents: p.overpaymentCents,
      seqs: p.allocations.map((a) => a.seq).toList(),
      replayed: false,
    );

    db.execute('BEGIN IMMEDIATE');
    try {
      // 2. 佔住 op_id。並行的第二次送出會在這裡撞上 PRIMARY KEY。
      db.execute(
        'INSERT INTO operations '
        '(op_id, kind, operator_id, entry_date, created_at, result_json) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        [
          opId,
          'SETTLE_LOAN',
          operatorId,
          formatDate(entryDate),
          postedAt,
          jsonEncode(result.toJson()),
        ],
      );

      for (final a in p.allocations) {
        _applyPeriod(loanId, a);
        _insertEntry(
          opId: opId,
          entryDate: entryDate,
          postedAt: postedAt,
          type: EntryType.collectPenalty,
          amount: a.penaltyCents,
          loanId: loanId,
          seq: a.seq,
          operatorId: operatorId,
        );
        _insertEntry(
          opId: opId,
          entryDate: entryDate,
          postedAt: postedAt,
          type: EntryType.collectFee,
          amount: a.feeCents,
          loanId: loanId,
          seq: a.seq,
          operatorId: operatorId,
        );
        _insertEntry(
          opId: opId,
          entryDate: entryDate,
          postedAt: postedAt,
          type: EntryType.collectInterest,
          amount: a.interestCents,
          loanId: loanId,
          seq: a.seq,
          operatorId: operatorId,
        );
        _insertEntry(
          opId: opId,
          entryDate: entryDate,
          postedAt: postedAt,
          type: EntryType.collectPrincipal,
          amount: a.principalCents,
          loanId: loanId,
          seq: a.seq,
          operatorId: operatorId,
        );
      }

      if (p.overpaymentCents > 0) {
        _insertEntry(
          opId: opId,
          entryDate: entryDate,
          postedAt: postedAt,
          type: EntryType.overpayAdjust,
          amount: -p.overpaymentCents,
          loanId: loanId,
          seq: null,
          operatorId: operatorId,
          note: '溢繳（超過全部應繳金額），已記為負向調整分錄待人工核對',
        );
      }

      db.execute('COMMIT');
    } catch (e) {
      db.execute('ROLLBACK');
      rethrow;
    }
    return result;
  }

  /// 條件更新（compare-and-set）：舊值要一模一樣、且加上去不能超過應繳，
  /// 才准寫。影響列數 ≠ 1 就整筆回滾（C-0）。
  void _applyPeriod(String loanId, PeriodAllocation a) {
    db.execute(
      'INSERT OR IGNORE INTO schedule_items '
      '(loan_id, seq, due_date, opening_balance_cents, principal_cents, interest_cents) '
      'VALUES (?, ?, ?, 0, ?, ?)',
      [
        loanId,
        a.seq,
        formatDate(a.dueDate),
        a.principalCents + a.priorPrincipalPaid,
        a.interestCents + a.priorInterestPaid,
      ],
    );
    db.execute(
      'UPDATE schedule_items SET '
      '  principal_paid_cents = principal_paid_cents + ?, '
      '  interest_paid_cents  = interest_paid_cents  + ?, '
      '  fee_paid_cents       = fee_paid_cents       + ?, '
      '  penalty_paid_cents   = penalty_paid_cents   + ? '
      'WHERE loan_id = ? AND seq = ? '
      '  AND principal_paid_cents = ? AND interest_paid_cents = ? '
      '  AND fee_paid_cents = ? AND penalty_paid_cents = ?',
      [
        a.principalCents,
        a.interestCents,
        a.feeCents,
        a.penaltyCents,
        loanId,
        a.seq,
        a.priorPrincipalPaid,
        a.priorInterestPaid,
        a.priorFeePaid,
        a.priorPenaltyPaid,
      ],
    );
    if (db.updatedRows != 1) {
      throw SettlementRejected(
        '第 ${a.seq} 期在你送出的這段時間內被別人動過了，這筆沒有入帳。'
        '請重新整理畫面，確認目前的應繳金額後再送一次。',
      );
    }
  }

  void _insertEntry({
    required String opId,
    required DateTime entryDate,
    required String postedAt,
    required String type,
    required int amount,
    required String? loanId,
    required int? seq,
    required String operatorId,
    String? note,
  }) {
    if (amount == 0) return; // 0 元不留分錄，免得流水被噪音塞滿
    db.execute(
      'INSERT INTO entries '
      '(id, op_id, entry_date, posted_at, type, amount_cents, loan_id, schedule_seq, operator_id, note) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newId(),
        opId,
        formatDate(entryDate),
        postedAt,
        type,
        amount,
        loanId,
        seq,
        operatorId,
        note,
      ],
    );
  }
}

final Random _random = Random.secure();

/// op_id 與分錄 id。op_id **在表單被送出去給瀏覽器的那一刻就產生**，
/// 不是等使用者按下送出（後者擋不住雙擊）。
String newId() {
  final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}
