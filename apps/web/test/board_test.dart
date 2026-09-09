// 活盤五格（docs/BOSS-SPEC.md D）。
//
// 這支測試的重點是三條老闆定案的規則：
// * G1：格 2 = 所有「持有」票面（含已到期未處理），格下拆兩列。
// * 格 5 不塞未處理票——同一筆錢只放一格。
// * 部分兌現不轉「已兌現」，剩餘票面留在格 2。
// 另外驗「現況 vs 重放」對不上時真的會打盤不平。
import 'package:test/test.dart';
import 'package:web_ledger/domain/board.dart';
import 'package:web_ledger/domain/settlement.dart';

import 'fixtures.dart';

void main() {
  late Fx fx;
  late BoardService board;
  setUp(() {
    fx = Fx.open();
    board = BoardService(fx.db);
  });
  tearDown(() => fx.db.dispose());

  group('格 2（G1 定案）', () {
    test('未到期票：進格 2 的「未到期」列，不進格 5', () {
      fx.seedLoan();
      fx.seedCheck(faceCents: 5000000, discountCents: 150000, dueInDays: 30);

      final s = board.compute(asOf: Fx.today);
      expect(s.state.heldFaceTotal, 5000000);
      expect(s.state.heldFaceNotDue, 5000000);
      expect(s.state.heldFaceOverdueUnhandled, 0);
      expect(s.state.overdueAndRecourse, 0, reason: '票不進格 5');
      expect(s.isBalanced, isTrue);
    });

    test('已到期未處理的票：仍在格 2（拆到「已到期未處理」列），格 5 不含它', () {
      fx.seedLoan();
      fx.seedCheck(faceCents: 5000000, discountCents: 150000, dueInDays: -10);

      final s = board.compute(asOf: Fx.today);
      expect(s.state.heldFaceTotal, 5000000, reason: '不可以從五格消失');
      expect(s.state.heldFaceNotDue, 0);
      expect(s.state.heldFaceOverdueUnhandled, 5000000);
      expect(
        s.state.overdueAndRecourse,
        0,
        reason: '格 5 只收逾期借款與退票追償，不塞未處理票',
      );
      expect(s.isBalanced, isTrue);
    });

    test('已到期未處理的票一定出現在今日未核銷紅字', () {
      fx.seedLoan();
      fx.seedCheck(faceCents: 5000000, discountCents: 150000, dueInDays: -10);

      final s = board.compute(asOf: Fx.today);
      final checkRows = s.unreconciled.where((i) => i.kind == '票據').toList();
      expect(checkRows, hasLength(1));
      expect(checkRows.single.amountCents, 5000000);
    });

    test('部分兌現：狀態仍持有，剩餘票面留在格 2，不走「已兌現」', () {
      fx.seedLoan();
      final id = fx.seedCheck(
        faceCents: 5000000,
        discountCents: 150000,
        dueInDays: 10,
      );
      fx.checks.cash(
        opId: newId(),
        operatorId: 'staff-1',
        checkId: id,
        receivedCents: 2000000, // 只收到一半多一點
        cashedAt: Fx.today,
        diffReason: '部分兌現',
      );

      final status = fx.db
          .select('SELECT status FROM checks WHERE id = ?', [id])
          .first['status'];
      expect(status, '持有', reason: '部分兌現不改狀態');

      final s = board.compute(asOf: Fx.today);
      expect(s.state.heldFaceTotal, 3000000, reason: '剩餘票面仍在格 2');
      expect(s.state.heldFaceNotDue, 3000000);
      expect(s.state.receivedToday, 2000000);
      expect(s.isBalanced, isTrue);
    });

    test('部分兌現後票到期了：剩餘票面轉到「已到期未處理」並進紅字', () {
      fx.seedLoan();
      final id = fx.seedCheck(
        faceCents: 5000000,
        discountCents: 150000,
        dueInDays: -5,
      );
      fx.checks.cash(
        opId: newId(),
        operatorId: 'staff-1',
        checkId: id,
        receivedCents: 2000000,
        cashedAt: Fx.today,
        diffReason: '部分兌現',
      );

      final s = board.compute(asOf: Fx.today);
      expect(s.state.heldFaceOverdueUnhandled, 3000000);
      expect(s.state.overdueAndRecourse, 0);
      expect(
        s.unreconciled.where((i) => i.kind == '票據').single.amountCents,
        3000000,
      );
    });

    test('全額兌現：轉「已兌現」，格 2 歸零', () {
      fx.seedLoan();
      final id = fx.seedCheck(
        faceCents: 5000000,
        discountCents: 150000,
        dueInDays: 0,
      );
      fx.checks.cash(
        opId: newId(),
        operatorId: 'staff-1',
        checkId: id,
        receivedCents: 5000000,
        cashedAt: Fx.today,
      );
      final s = board.compute(asOf: Fx.today);
      expect(s.state.heldFaceTotal, 0);
      expect(s.state.receivedToday, 5000000);
      expect(s.isBalanced, isTrue);
    });

    test('退票：轉追償，這時候才進格 5，且離開格 2', () {
      fx.seedLoan();
      final id = fx.seedCheck(
        faceCents: 5000000,
        discountCents: 150000,
        dueInDays: -1,
      );
      fx.checks.bounce(
        opId: newId(),
        operatorId: 'staff-1',
        checkId: id,
        recourseCents: 5000000,
        bouncedAt: Fx.today,
      );
      final s = board.compute(asOf: Fx.today);
      expect(s.state.heldFaceTotal, 0);
      expect(s.state.overdueAndRecourse, 5000000);
      expect(s.isBalanced, isTrue);
    });
  });

  group('借款相關的格子', () {
    test('剛撥款：格 1 = 10 萬，格 3、4、5 = 0', () {
      fx.seedLoan();
      final s = board.compute(asOf: Fx.today);
      expect(s.state.outstandingPrincipal, 10000000);
      expect(s.state.dueToday, 0);
      expect(s.state.receivedToday, 0);
      expect(s.state.overdueAndRecourse, 0);
      expect(s.isBalanced, isTrue);
    });

    test('第 1 期今天到期：格 3 = 8,884.88', () {
      fx.seedLoan(daysAgo: 30);
      final s = board.compute(asOf: Fx.today);
      expect(s.state.dueToday, 888488);
      expect(s.state.overdueAndRecourse, 0, reason: '到期當天還在寬限期內');
    });

    test('逾期 40 天：第 1 期進格 5', () {
      fx.seedLoan(daysAgo: 40);
      final s = board.compute(asOf: Fx.today);
      expect(s.state.overdueAndRecourse, 888488);
      expect(s.state.dueToday, 0);
    });

    test('收款後：格 1 減本金、格 4 = 今日已收', () {
      fx.seedLoan(daysAgo: 30);
      fx.settlement.post(
        opId: newId(),
        operatorId: 'staff-1',
        loanId: fx.loanId,
        seqs: const [1],
        amountCents: 888488,
        paidAt: Fx.today,
        overpayAck: false,
      );
      final s = board.compute(asOf: Fx.today);
      expect(s.state.outstandingPrincipal, 10000000 - 788488);
      expect(s.state.receivedToday, 888488);
      expect(s.state.dueToday, 0);
      expect(s.isBalanced, isTrue);
    });
  });

  group('盤不平', () {
    test('有人手改 schedule_items 卻沒留分錄 → 打盤不平，差額算得出來', () {
      fx.seedLoan(daysAgo: 30);
      fx.db.execute(
        'UPDATE schedule_items SET principal_paid_cents = 500000 '
        'WHERE loan_id = ?',
        [fx.loanId],
      );
      // 上一行只是把「已繳」灌進去，沒有任何分錄。
      fx.db.execute(
        'INSERT OR IGNORE INTO schedule_items '
        '(loan_id, seq, due_date, opening_balance_cents, principal_cents, '
        'interest_cents, principal_paid_cents) VALUES (?, 1, ?, 0, 788488, 100000, 500000)',
        [fx.loanId, '2026-05-01'],
      );
      fx.db.execute(
        'UPDATE schedule_items SET principal_paid_cents = 500000 WHERE loan_id = ? AND seq = 1',
        [fx.loanId],
      );

      final s = board.compute(asOf: Fx.today);
      expect(s.isBalanced, isFalse);
      final box1 = s.imbalances.firstWhere((i) => i.box.startsWith('格1'));
      expect(box1.stateCents, 10000000 - 500000);
      expect(box1.replayCents, 10000000);
      expect(box1.diffCents, -500000);
    });

    test('有人刪掉一筆收款分錄 → 打盤不平（格 4 對不上）', () {
      fx.seedLoan(daysAgo: 30);
      fx.settlement.post(
        opId: newId(),
        operatorId: 'staff-1',
        loanId: fx.loanId,
        seqs: const [1],
        amountCents: 888488,
        paidAt: Fx.today,
        overpayAck: false,
      );
      fx.db.execute("DELETE FROM entries WHERE type = 'LOAN_COLLECT_INTEREST'");

      final s = board.compute(asOf: Fx.today);
      expect(s.isBalanced, isFalse);
      final box4 = s.imbalances.firstWhere((i) => i.box.startsWith('格4'));
      expect(box4.stateCents, 888488, reason: '操作紀錄說我們收了這麼多');
      expect(box4.replayCents, 788488, reason: '流水少了利息那筆');
      expect(box4.diffCents, 100000);
    });

    test('差 1 分也算不平，不准被四捨五入抹掉', () {
      fx.seedLoan(daysAgo: 30);
      fx.db.execute(
        'INSERT OR IGNORE INTO schedule_items '
        '(loan_id, seq, due_date, opening_balance_cents, principal_cents, '
        'interest_cents, principal_paid_cents) VALUES (?, 1, ?, 0, 788488, 100000, 1)',
        [fx.loanId, '2026-05-01'],
      );
      final s = board.compute(asOf: Fx.today);
      expect(s.isBalanced, isFalse);
      expect(
        s.imbalances.firstWhere((i) => i.box.startsWith('格1')).diffCents,
        -1,
      );
    });
  });
}
