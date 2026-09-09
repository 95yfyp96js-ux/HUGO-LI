// 日結與認證鎖帳（docs/BOSS-SPEC.md E、F）。
//
// 這裡驗的是「認證之後真的改不動」——不是把按鈕藏起來，是後端每一條寫入
// 路徑都被擋。另外驗四關的順序與「不平就不准認證」。
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:test/test.dart';
import 'package:web_ledger/domain/daily_close.dart';
import 'package:web_ledger/domain/settlement.dart';

import 'fixtures.dart';

/// 用「今天」跑，因為寫入路徑本來就不准未來日期。
DateTime today() => DateTime.now();

void main() {
  late Fx fx;
  late DailyCloseService close;
  setUp(() {
    fx = Fx.open();
    fx.seedUsers();
    close = DailyCloseService(fx.db);
  });
  tearDown(() => fx.db.dispose());


  test('四關要照順序：沒核定不能確認，沒確認不能認證', () {
    fx.seedLoan(anchor: today());
    expect(() => close.confirm(today(), fx.bossId), throwsA(isA<SettlementRejected>()));
    expect(() => close.certify(today(), fx.bossId), throwsA(isA<SettlementRejected>()));

    close.review(today(), fx.bossId);
    expect(() => close.certify(today(), fx.bossId), throwsA(isA<SettlementRejected>()));

    close.confirm(today(), fx.bossId);
    close.certify(today(), fx.bossId);
    expect(close.sheet(today()).isCertified, isTrue);
  });

  test('盤不平就不准認證，理由講得出差在哪一格', () {
    fx.seedLoan(anchor: today());
    // 手改計畫表、不留分錄。
    fx.db.execute(
      'INSERT OR IGNORE INTO schedule_items '
      '(loan_id, seq, due_date, opening_balance_cents, principal_cents, '
      'interest_cents, principal_paid_cents) VALUES (?, 1, ?, 0, 788488, 100000, 500000)',
      [fx.loanId, '2026-01-01'],
    );

    final sheet = close.sheet(today());
    expect(sheet.blockers, isNotEmpty);
    expect(sheet.blockers.map((b) => b.reason).join(), contains('盤不平'));

    close.review(today(), fx.bossId);
    close.confirm(today(), fx.bossId);
    expect(() => close.certify(today(), fx.bossId), throwsA(isA<SettlementRejected>()));
    expect(close.sheet(today()).isCertified, isFalse);
  });

  test('未核銷的到期項：可以核定，但會列出來（認證畫面要紅字）', () {
    fx.seedLoan(daysAgo: 30, anchor: today());
    final sheet = close.sheet(today());
    expect(sheet.unreconciled, isNotEmpty, reason: '第 1 期今天到期還沒收');
    close.review(today(), fx.bossId);
    expect(close.sheet(today()).isReviewed, isTrue, reason: '未核銷不擋核定');
  });

  test('本期進出：放款與收款都算得出來', () {
    fx.seedLoan(anchor: today()); // 今天撥款 10 萬
    fx.settlement.post(
      opId: newId(),
      operatorId: fx.bossId,
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: today(),
      overpayAck: false,
    );
    final m = close.sheet(today()).movements;
    expect(m.disbursed, 10000000);
    expect(m.loanCollected, 888488);
  });

  test('格 1 存量恆等式：期初 + 放款 − 收本金 = 期末', () {
    fx.seedLoan(anchor: today());
    fx.settlement.post(
      opId: newId(),
      operatorId: fx.bossId,
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: today(),
      overpayAck: false,
    );
    final s = close.sheet(today());
    expect(s.opening.outstandingPrincipal, 0);
    expect(s.closing.outstandingPrincipal, 10000000 - 788488);
    expect(
      s.blockers.where((b) => b.reason.startsWith('格 1')),
      isEmpty,
      reason: '恆等式成立就不該有這條 blocker',
    );
  });

  test('格 2 存量恆等式：收票加票面、部分兌現只減已收', () {
    fx.seedLoan(anchor: today());
    final id = fx.checks.receive(
      opId: newId(),
      operatorId: fx.bossId,
      customerId: fx.customerId,
      bankCode: '004',
      checkNo: 'AB99990001',
      faceCents: 5000000,
      discountInterestCents: 150000,
      cashPaidCents: 4850000,
      otherFeeCents: 0,
      dueDate: today().add(const Duration(days: 30)),
      receivedDate: today(),
    );
    fx.checks.cash(
      opId: newId(),
      operatorId: fx.bossId,
      checkId: id,
      receivedCents: 2000000,
      cashedAt: today(),
      diffReason: '部分兌現',
    );
    final s = close.sheet(today());
    expect(s.movements.heldFaceIn, 5000000);
    expect(s.movements.heldFaceOut, 2000000);
    expect(s.closing.heldFaceTotal, 3000000);
    expect(s.blockers.where((b) => b.reason.startsWith('格 2')), isEmpty);
  });

  group('認證鎖帳', () {
    void certifyToday() {
      close.review(today(), fx.bossId);
      close.confirm(today(), fx.bossId);
      close.certify(today(), fx.bossId);
    }

    test('認證後不能再收款', () {
      fx.seedLoan(daysAgo: 30, anchor: today());
      certifyToday();
      expect(
        () => fx.settlement.post(
          opId: newId(),
          operatorId: fx.bossId,
          loanId: fx.loanId,
          seqs: const [1],
          amountCents: 888488,
          paidAt: today(),
          overpayAck: false,
        ),
        throwsA(
          isA<SettlementRejected>().having(
            (e) => e.message,
            'message',
            contains('已經由老闆認證鎖帳'),
          ),
        ),
      );
    });

    test('認證後不能收票、兌現、退票', () {
      fx.seedLoan(anchor: today());
      final id = fx.seedCheckOn(today(), faceCents: 1000000, dueInDays: 10);
      certifyToday();

      expect(
        () => fx.checks.receive(
          opId: newId(),
          operatorId: fx.bossId,
          customerId: fx.customerId,
          bankCode: '004',
          checkNo: 'ZZ00000001',
          faceCents: 100000,
          discountInterestCents: 0,
          cashPaidCents: 100000,
          otherFeeCents: 0,
          dueDate: today().add(const Duration(days: 10)),
          receivedDate: today(),
        ),
        throwsA(isA<SettlementRejected>()),
      );
      expect(
        () => fx.checks.cash(
          opId: newId(),
          operatorId: fx.bossId,
          checkId: id,
          receivedCents: 1000000,
          cashedAt: today(),
        ),
        throwsA(isA<SettlementRejected>()),
      );
      expect(
        () => fx.checks.bounce(
          opId: newId(),
          operatorId: fx.bossId,
          checkId: id,
          recourseCents: 1000000,
          bouncedAt: today(),
        ),
        throwsA(isA<SettlementRejected>()),
      );
    });

    test('認證後也不能往回補登到更早的日子（那會改到已認證那天的期初）', () {
      fx.seedLoan(anchor: today());
      certifyToday();
      final loanId = fx.loans.registerLoan(
        customerId: fx.customerId,
        principalCents: 100000,
        method: engine.RepaymentMethod.emi,
        rateType: engine.RateType.monthly,
        rateBps: 100,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 3,
      );
      expect(
        () => fx.loans.confirmDisbursement(
          opId: newId(),
          operatorId: fx.bossId,
          loanId: loanId,
          disbursedAt: today().subtract(const Duration(days: 5)),
        ),
        throwsA(isA<SettlementRejected>()),
      );
    });

    test('已認證的日結不能再改（連老闆也不行）', () {
      fx.seedLoan(anchor: today());
      certifyToday();
      expect(() => close.review(today(), fx.bossId), throwsA(isA<SettlementRejected>()));
      expect(() => close.certify(today(), fx.bossId), throwsA(isA<SettlementRejected>()));
    });
  });
}
