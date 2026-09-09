// 溢繳／提前還本的入帳前確認（spec B4：禁止默默寫分錄）。
//
// 驗的是「使用者按下確認入帳之後、分錄寫進去之前」這一段：多收的錢必須先被
// 講清楚，而且在確認對話框按「回去改金額」時，資料庫要一筆都沒動。
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/domain/loan_repository.dart';
import 'package:mobile/domain/schedule_item_math.dart';
import 'package:mobile/providers/app_providers.dart';
import 'package:mobile/widgets/record_payment_dialog.dart';

final DateTime disbursedAt = DateTime(2026, 1, 1);

Future<(AppDatabase, LoanRepository, Loan)> _seedLoan() async {
  final db = AppDatabase(NativeDatabase.memory());
  final repo = LoanRepository(db);
  await db
      .into(db.borrowers)
      .insert(
        BorrowersCompanion.insert(
          id: 'b1',
          name: '測試借款人',
          idNumberCipher: 'x',
          idHash: 'x',
          createdAt: DateTime.now(),
        ),
      );
  final loan = await repo.registerLoan(
    borrowerId: 'b1',
    principalCents: 10000000,
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 100,
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
    plannedDisbursementDate: disbursedAt,
  );
  await repo.confirmDisbursement(loan.id, at: disbursedAt);
  return (db, repo, loan);
}

/// 讓 FakeAsync 下的 Drift 非同步查詢跑完（同 golden_path_test）。
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 30)),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpHost(
  WidgetTester tester,
  AppDatabase db,
  String loanId,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [databaseProvider.overrideWithValue(db)],
      child: MaterialApp(
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('zh', 'TW')],
        home: Consumer(
          builder: (context, ref, _) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => showRecordPaymentDialog(context, ref, loanId),
                child: const Text('開啟收款'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await _settle(tester);
  await tester.tap(find.text('開啟收款'));
  await _settle(tester);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('溢繳：先跳說明對話框，按「回去改金額」則一毛都不入帳', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final (db, repo, loan) = await _seedLoan();
    final schedule = await repo.scheduleFor(loan.id);
    final int payoff = schedule.fold<int>(0, (s, i) => s + i.totalDueCents);
    final int ledgerBefore = (await repo.ledgerFor(loan.id)).length;

    await _pumpHost(tester, db, loan.id);

    // 全部結清再多繳 1,000 元。
    await tester.enterText(
      find.widgetWithText(TextField, '繳款金額（元，可到小數兩位）'),
      '${payoff ~/ 100 + 1000}',
    );
    await tester.tap(find.text('確認入帳'));
    await _settle(tester);

    // 說明對話框出現，而且講出多收多少、去哪裡。
    expect(find.text('這筆錢超過應繳金額'), findsOneWidget);
    expect(find.textContaining('沖完全部未繳期別後仍多出'), findsOneWidget);
    expect(find.textContaining('沒有自動退款流程'), findsOneWidget);

    await tester.tap(find.text('回去改金額'));
    await _settle(tester);

    // 沒有寫入任何東西。
    expect((await repo.ledgerFor(loan.id)).length, ledgerBefore);
    expect((await repo.paymentsFor(loan.id)), isEmpty);
    final after = await repo.scheduleFor(loan.id);
    expect(after.every((i) => i.paidCents == 0), isTrue);

    await db.close();
  });

  testWidgets('溢繳：按「了解，確認入帳」才真的寫入', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final (db, repo, loan) = await _seedLoan();
    final schedule = await repo.scheduleFor(loan.id);
    final int payoff = schedule.fold<int>(0, (s, i) => s + i.totalDueCents);

    await _pumpHost(tester, db, loan.id);

    await tester.enterText(
      find.widgetWithText(TextField, '繳款金額（元，可到小數兩位）'),
      '${payoff ~/ 100 + 1000}',
    );
    await tester.tap(find.text('確認入帳'));
    await _settle(tester);
    await tester.tap(find.text('了解，確認入帳'));
    await _settle(tester);

    expect((await repo.paymentsFor(loan.id)), hasLength(1));
    final after = await repo.scheduleFor(loan.id);
    expect(after.every((i) => i.shortfallCents == 0), isTrue, reason: '全部結清');

    await db.close();
  });

  testWidgets('剛好繳本期：不跳額外對話框，直接入帳', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final (db, repo, loan) = await _seedLoan();

    await _pumpHost(tester, db, loan.id);

    // 金額欄已帶入本期應繳的精確分值（NT$8,884.88）。
    final field = tester.widget<TextField>(
      find.widgetWithText(TextField, '繳款金額（元，可到小數兩位）'),
    );
    expect(field.controller!.text, '8884.88');

    await tester.tap(find.text('確認入帳'));
    await _settle(tester);

    expect(find.text('這筆錢超過應繳金額'), findsNothing);
    expect(find.text('這筆錢會提前還本'), findsNothing);
    expect((await repo.paymentsFor(loan.id)), hasLength(1));

    await db.close();
  });
}
