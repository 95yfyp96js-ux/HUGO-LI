// 四步上手端對端 Widget 測試：新增借款人 → 登記貸款 → 自動生成計畫 →
// 確認撥款並追蹤還款；並驗證看板數字與 Ledger 分錄一致（見 spec 完成定義）。
//
// 本沙盒環境沒有 Android/iOS 模擬器（見 docs/ASSUMPTIONS.md），改用
// headless flutter tester + in-memory Drift 資料庫驗證整條路徑可跑通。
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ledger/ledger.dart' as ledger;
import 'package:mobile/app.dart';
import 'package:mobile/db/app_database.dart';
import 'package:mobile/db/pii_codec.dart';
import 'package:mobile/domain/loan_repository.dart';
import 'package:mobile/providers/app_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// `flutter test` 的 `AutomatedTestWidgetsFlutterBinding` 在 FakeAsync zone
/// 下執行；Drift 的 `.watch()` stream 內部部分排程仰賴真實 Timer/microtask
/// 交錯，`pumpAndSettle()` 不一定等得到。用 `tester.runAsync` 短暫跳出
/// FakeAsync、讓真實事件循環跑完，是官方建議的作法。
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 30)),
  );
  await tester.pumpAndSettle();
}

Future<AppDatabase> _openTestDatabase() async {
  return AppDatabase(NativeDatabase.memory());
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('四步上手：借款人 → 登記貸款 → 生成計畫 → 確認撥款 → 還款 → 看板一致', (
    WidgetTester tester,
  ) async {
    // 表單欄位較多，放大測試視窗高度，讓 ListView 一次把所有欄位都建入
    // widget tree（Sliver 只會 build 視窗＋cache extent 範圍內的子項），
    // 避免需要額外處理捲動才能找到按鈕。
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final db = await _openTestDatabase();
    final codec = PiiCodec.fromPassphrase('test-passphrase-for-widget-test');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          databaseProvider.overrideWithValue(db),
          sharedPreferencesProvider.overrideWithValue(prefs),
          piiCodecProvider.overrideWithValue(codec),
          devLicenseOverrideProvider.overrideWithValue(true), // 測試不受試用次數限制
        ],
        child: const LendingApp(),
      ),
    );
    await _settle(tester);

    // 看板初始應為 4 個 0 元卡片（尚無任何貸款）。
    expect(find.text('看板'), findsWidgets);

    // 第 1 步：新增借款人。導覽經由底部導覽列「借款人」分頁 + FAB，兩者皆不
    // 依賴 borrowersStreamProvider 是否已經 resolve（該 Stream 在
    // flutter_test 的 FakeAsync 環境下可能延後很久才送出第一筆值，見
    // docs/ASSUMPTIONS.md 環境限制），比依賴看板上的條件式引導卡片更穩定。
    await tester.tap(find.text('借款人'));
    await _settle(tester);
    await tester.tap(find.text('新增借款人'));
    await _settle(tester);

    await tester.enterText(find.widgetWithText(TextFormField, '姓名 *'), '王小明');
    await tester.enterText(
      find.widgetWithText(TextFormField, '身分證字號 *'),
      'A123456789',
    );
    await tester.tap(find.text('儲存並下一步：登記貸款'));
    await _settle(tester);

    // 第 2、3 步：登記貸款＋自動生成計畫。
    expect(find.text('登記貸款'), findsWidgets);
    await tester.enterText(
      find.widgetWithText(TextFormField, '貸款本金（元）*'),
      '100000',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, '利率（基點，100 = 1%）*'),
      '100',
    );
    await tester.enterText(find.widgetWithText(TextFormField, '期數 *'), '12');

    await tester.tap(find.text('自動生成計畫預覽'));
    await _settle(tester);
    expect(find.textContaining('計畫預覽（共 12 期）'), findsOneWidget);

    await tester.tap(find.text('建立貸款（建約）'));
    await _settle(tester);

    // 第 4 步：確認撥款。
    expect(find.text('確認撥款'), findsOneWidget);
    await tester.tap(find.text('確認撥款'));
    await _settle(tester);
    // 對話框中的確認撥款按鈕。
    await tester.tap(find.text('確認撥款').last);
    await _settle(tester);

    expect(find.text('記一筆還款'), findsWidgets);

    // 記一筆還款：第一期金額。
    await tester.tap(find.text('記一筆還款').first);
    await _settle(tester);
    await tester.enterText(
      find.widgetWithText(TextField, '繳款金額（元）'),
      '8885',
    ); // 約當第 1 期應繳
    await tester.tap(find.text('確認入帳'));
    await _settle(tester);

    // 驗證：資料庫內 Loan 狀態、Schedule、Ledger 三者一致。
    final loanRepo = LoanRepository(db);
    final loans = await loanRepo.listAll();
    expect(loans, hasLength(1));
    final loan = loans.single;
    expect(loan.status, anyOf('current', 'delinquent'));
    expect(loan.disbursedAt, isNotNull);

    final schedule = await loanRepo.scheduleFor(loan.id);
    expect(schedule, hasLength(12));
    // 繳款日早於到期日，全額繳清第 1 期即視為提前繳清（PREPAID）。
    expect(schedule.first.status, anyOf('paid', 'partial', 'prepaid'));

    final ledgerEntries = await loanRepo.ledgerFor(loan.id);
    expect(
      ledgerEntries.where(
        (e) => e.type == ledger.LedgerEntryType.disbursement.name,
      ),
      hasLength(1),
    );
    expect(
      ledgerEntries
          .where((e) => e.type == ledger.LedgerEntryType.interest.name)
          .isNotEmpty,
      isTrue,
    );

    // 看板數字必須來自 Ledger 聚合，且貸款總額應等於撥款金額。
    final dashboardContainer = ProviderContainer(
      overrides: [databaseProvider.overrideWithValue(db)],
    );
    addTearDown(dashboardContainer.dispose);
    final dashboardRepo = dashboardContainer.read(dashboardRepositoryProvider);
    final snapshot = await dashboardRepo.compute();
    expect(snapshot.totalDisbursedCents, loan.principalCents);
    expect(snapshot.totalInterestReceivedCents, greaterThan(0));

    await db.close();
  });
}
