// 收款並核銷（docs/BOSS-SPEC.md B-5、C-0～C-2）。
//
// 這裡驗的是「錢有沒有掉到正確的那一期、掉到分」，以及「同一次送出只會成立
// 一次」。金額全部由伺服器算，測試對的就是伺服器算出來的分。
import 'package:test/test.dart';
import 'package:web_ledger/domain/settlement.dart';

import 'fixtures.dart';

void main() {
  late Fx fx;
  setUp(() => fx = Fx.open());
  tearDown(() => fx.db.dispose());

  test('必須選到期別：沒選就擋下，訊息講得出下一步', () {
    fx.seedLoan();
    final p = fx.settlement.preview(
      loanId: fx.loanId,
      seqs: const [],
      amountCents: 888488,
      paidAt: Fx.today,
    );
    expect(p.canPost, isFalse);
    expect(p.blocked, contains('請先選到要沖銷的期別'));
  });

  test('沖第 1 期：8,884.88 元 → 利息 1,000.00、本金 7,884.88，一分不差', () {
    fx.seedLoan();
    final p = fx.settlement.preview(
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: Fx.today,
    );
    expect(p.canPost, isTrue);
    expect(p.interestCents, 100000);
    expect(p.principalCents, 788488);
    expect(p.overpaymentCents, 0);
    expect(p.appliedCents, 888488);
  });

  test('少繳 88 分：第 1 期變部分繳，尚差就是 88 分', () {
    fx.seedLoan();
    fx.settlement.post(
      opId: newId(),
      operatorId: 'staff-1',
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888400, // 照畫面上的整元 8,884 打
      paidAt: Fx.today,
      overpayAck: false,
    );
    final next = fx.settlement.preview(
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 88,
      paidAt: Fx.today,
    );
    expect(next.selectedDueCents, 88, reason: '尚差 NT\$0.88');
    expect(next.canPost, isTrue);
  });

  test('瀑布順序：有罰息時先沖罰息，再利息，最後本金', () {
    fx.seedLoan(daysAgo: 40, penalty: true); // 第 1 期已逾期 7 天
    final p = fx.settlement.preview(
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: Fx.today,
    );
    expect(p.penaltyCents, greaterThan(0));
    expect(p.interestCents, 100000, reason: '罰息沖完才輪到利息');
    expect(
      p.penaltyCents + p.interestCents + p.principalCents,
      888488,
      reason: '每一分錢都要有去處',
    );
  });

  test('勾錯範圍（金額超過所勾期別、還有未勾的未清期別）→ 擋下，不是溢繳', () {
    fx.seedLoan();
    final p = fx.settlement.preview(
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488 * 2,
      paidAt: Fx.today,
    );
    expect(p.canPost, isFalse);
    expect(p.isOverpayment, isFalse, reason: '這是勾錯範圍，不該用 ack 放行');
    expect(p.blocked, contains('請一起勾選第'));
  });

  test('全部期別都勾了還有剩 → 才是溢繳，且沒有 ack 不准寫', () {
    fx.seedLoan();
    final all = List<int>.generate(12, (i) => i + 1);
    final p = fx.settlement.preview(
      loanId: fx.loanId,
      seqs: all,
      amountCents: 10661853 + 100000,
      paidAt: Fx.today,
    );
    expect(p.canPost, isTrue);
    expect(p.isOverpayment, isTrue);
    expect(p.overpaymentCents, 100000);

    expect(
      () => fx.settlement.post(
        opId: newId(),
        operatorId: 'staff-1',
        loanId: fx.loanId,
        seqs: all,
        amountCents: 10661853 + 100000,
        paidAt: Fx.today,
        overpayAck: false,
      ),
      throwsA(isA<SettlementRejected>()),
    );

    // 沒有 ack 就沒有寫入。
    final rows = fx.db.select('SELECT COUNT(*) AS n FROM entries WHERE type LIKE ?', ['LOAN_COLLECT%']);
    expect(rows.first['n'], 0);
  });

  test('溢繳確認後：寫入一筆負向調整分錄', () {
    fx.seedLoan();
    final all = List<int>.generate(12, (i) => i + 1);
    fx.settlement.post(
      opId: newId(),
      operatorId: 'staff-1',
      loanId: fx.loanId,
      seqs: all,
      amountCents: 10661853 + 100000,
      paidAt: Fx.today,
      overpayAck: true,
    );
    final rows = fx.db.select(
      "SELECT amount_cents FROM entries WHERE type = 'LOAN_OVERPAY_ADJUST'",
    );
    expect(rows, hasLength(1));
    expect(rows.first['amount_cents'], -100000);
  });

  test('同一個 op_id 送兩次：第二次不寫入，回放第一次的結果', () {
    fx.seedLoan();
    final String opId = newId();
    final first = fx.settlement.post(
      opId: opId,
      operatorId: 'staff-1',
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: Fx.today,
      overpayAck: false,
    );
    final second = fx.settlement.post(
      opId: opId,
      operatorId: 'staff-1',
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: Fx.today,
      overpayAck: false,
    );

    expect(first.replayed, isFalse);
    expect(second.replayed, isTrue);
    expect(second.principalCents, first.principalCents);

    final paid = fx.db.select(
      'SELECT principal_paid_cents, interest_paid_cents FROM schedule_items '
      'WHERE loan_id = ? AND seq = 1',
      [fx.loanId],
    ).first;
    expect(paid['principal_paid_cents'], 788488, reason: '只沖了一次');
    expect(paid['interest_paid_cents'], 100000);

    final ops = fx.db.select('SELECT COUNT(*) AS n FROM operations WHERE op_id = ?', [opId]);
    expect(ops.first['n'], 1);
  });

  test('不同 op_id 的兩次收款會各自成立（不是把所有重送都吃掉）', () {
    fx.seedLoan();
    fx.settlement.post(
      opId: newId(),
      operatorId: 'staff-1',
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 400000,
      paidAt: Fx.today,
      overpayAck: false,
    );
    fx.settlement.post(
      opId: newId(),
      operatorId: 'staff-1',
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 488488,
      paidAt: Fx.today,
      overpayAck: false,
    );
    final paid = fx.db.select(
      'SELECT principal_paid_cents + interest_paid_cents AS total '
      'FROM schedule_items WHERE loan_id = ? AND seq = 1',
      [fx.loanId],
    ).first;
    expect(paid['total'], 888488);
  });

  test('預覽不寫入任何東西', () {
    fx.seedLoan();
    fx.settlement.preview(
      loanId: fx.loanId,
      seqs: const [1, 2, 3],
      amountCents: 9999999,
      paidAt: Fx.today,
    );
    expect(fx.db.select('SELECT COUNT(*) AS n FROM operations').first['n'], 1); // 只有撥付那筆
    expect(
      fx.db.select("SELECT COUNT(*) AS n FROM entries WHERE type LIKE 'LOAN_COLLECT%'").first['n'],
      0,
    );
  });
}
