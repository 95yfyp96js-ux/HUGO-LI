// 其餘 7 個按鈕的畫面（docs/BOSS-SPEC.md B）。
//
// 每一頁只驗三件事：必填擋得住、失敗訊息說得出下一步、成功後資料真的進去了。
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';
import 'package:web_ledger/money.dart';
import 'package:web_ledger/web/handlers.dart';

import 'fixtures.dart';

String todayStr() => formatDate(dateOnly(DateTime.now()));

void main() {
  late Fx fx;
  late AppHandlers app;
  setUp(() {
    fx = Fx.open();
    fx.seedUsers();
    app = AppHandlers(fx.db);
  });
  tearDown(() => fx.db.dispose());

  Future<String> get(String url) async => (await app.handler(
    Request(
      'GET',
      Uri.parse(url),
      headers: {'cookie': 'sid=${fx.staffToken}'},
    ),
  )).readAsString();

  Future<String> post(String url, String body) async => (await app.handler(
    Request(
      'POST',
      Uri.parse(url),
      body: body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': 'sid=${fx.staffToken}',
      },
    ),
  )).readAsString();

  String opIdFrom(String html) =>
      RegExp(r'name="op_id" value="([0-9a-f]+)"').firstMatch(html)!.group(1)!;

  test('首頁：8 個按鈕，沒有第 9 個', () async {
    final html = await get('http://x/');
    for (final label in [
      '新增客戶',
      '新增借款',
      '確認撥付',
      '收票（貼現）',
      '收款並核銷',
      '票兌現並核銷',
      '票退票並轉追償',
      '看今日流水',
    ]) {
      expect(html, contains(label));
    }
    expect(html, contains('就這 8 個。沒有第 9 個按鈕。'));
    expect(
      RegExp(r'<a href="/[^"]*"><span class="n">').allMatches(html).length,
      8,
    );
  });

  group('1 新增客戶', () {
    test('必填擋得住', () async {
      final html = await post('http://x/customers/new', 'name=&id_number=');
      expect(html, contains('姓名與身分證字號都要填'));
    });

    test('存進去了，而且畫面上看不到完整證號', () async {
      final html = await post(
        'http://x/customers/new',
        'name=%E7%8E%8B%E5%B0%8F%E6%98%8E&id_number=A123456789',
      );
      expect(html, contains('已新增客戶'));
      expect(html, isNot(contains('A123456789')));
      final rows = fx.db.select('SELECT * FROM customers');
      expect(rows, hasLength(1));
      expect(rows.first['id_number_last4'], '6789');
    });

    test('同一個證號再登一次：擋下並指出是哪一位', () async {
      await post(
        'http://x/customers/new',
        'name=%E7%8E%8B%E5%B0%8F%E6%98%8E&id_number=A123456789',
      );
      final html = await post(
        'http://x/customers/new',
        'name=%E5%86%92%E5%90%8D&id_number=A123456789',
      );
      expect(html, contains('這個證號已經有客戶了'));
      expect(html, contains('****6789'));
      expect(fx.db.select('SELECT * FROM customers'), hasLength(1));
    });
  });

  group('2 新增借款 / 3 確認撥付', () {
    Future<String> makeCustomer() async {
      await post(
        'http://x/customers/new',
        'name=%E7%8E%8B%E5%B0%8F%E6%98%8E&id_number=A123456789',
      );
      return fx.db.select('SELECT id FROM customers').first['id'] as String;
    }

    test('建約不寫分錄、活盤不動（不變式 2）', () async {
      final cid = await makeCustomer();
      final html = await post(
        'http://x/loans/new',
        'customer_id=$cid&principal=100000&method=emi&rate_type=monthly'
        '&rate_bps=100&day_count=thirty360&tenor=12',
      );
      expect(html, contains('已建約（尚未撥付，活盤不會動）'));
      expect(fx.db.select('SELECT * FROM entries'), isEmpty);
      expect(
        fx.db.select('SELECT disbursed_at FROM loans').first['disbursed_at'],
        isNull,
      );
    });

    test('金額或期數不合就擋下，已填的內容不會被清掉', () async {
      final cid = await makeCustomer();
      final html = await post(
        'http://x/loans/new',
        'customer_id=$cid&principal=abc&method=emi&rate_type=monthly'
        '&rate_bps=100&day_count=thirty360&tenor=12',
      );
      expect(html, contains('金額必須大於 0，最多兩位小數'));
      expect(html, contains('value="abc"'), reason: '不清空使用者填過的東西');
    });

    test('撥付日不可以是未來', () async {
      final cid = await makeCustomer();
      await post(
        'http://x/loans/new',
        'customer_id=$cid&principal=100000&method=emi&rate_type=monthly'
        '&rate_bps=100&day_count=thirty360&tenor=12',
      );
      final loanId =
          fx.db.select('SELECT id FROM loans').first['id'] as String;
      final page = await get('http://x/loans/disburse');
      final future = formatDate(
        dateOnly(DateTime.now().add(const Duration(days: 3))),
      );
      final html = await post(
        'http://x/loans/disburse',
        'op_id=${opIdFrom(page)}&loan_id=$loanId&disbursed_at=$future',
      );
      expect(html, contains('撥付日不可以是未來日期'));
    });

    test('撥付後才有分錄，第 1 期開始能收款', () async {
      final cid = await makeCustomer();
      await post(
        'http://x/loans/new',
        'customer_id=$cid&principal=100000&method=emi&rate_type=monthly'
        '&rate_bps=100&day_count=thirty360&tenor=12',
      );
      final loanId =
          fx.db.select('SELECT id FROM loans').first['id'] as String;
      final page = await get('http://x/loans/disburse');
      final html = await post(
        'http://x/loans/disburse',
        'op_id=${opIdFrom(page)}&loan_id=$loanId&disbursed_at=${todayStr()}',
      );
      expect(html, contains('已確認撥付'));
      final entries = fx.db.select(
        "SELECT * FROM entries WHERE type = 'LOAN_DISBURSE'",
      );
      expect(entries, hasLength(1));
      expect(entries.first['amount_cents'], 10000000);

      final settle = await get('http://x/settle?loan_id=$loanId');
      expect(settle, contains('NT\$8,884.88'));
    });
  });

  group('4 收票', () {
    Future<String> customer() async {
      await post(
        'http://x/customers/new',
        'name=%E7%8E%8B%E5%B0%8F%E6%98%8E&id_number=A123456789',
      );
      return fx.db.select('SELECT id FROM customers').first['id'] as String;
    }

    String body(String cid, {String cash = '97000', String no = 'AB12345678'}) =>
        'customer_id=$cid&bank_code=004&check_no=$no&face=100000'
        '&discount=3000&other_fee=0&cash_paid=$cash'
        '&due_date=2099-01-01&received_date=${todayStr()}';

    test('實付對不上恆等式：擋下並寫出差多少', () async {
      final cid = await customer();
      final page = await get('http://x/checks/new');
      final html = await post(
        'http://x/checks/new',
        'op_id=${opIdFrom(page)}&${body(cid, cash: '100000')}',
      );
      expect(html, contains('實付 ≠ 票面 − 貼現息 − 其他費用'));
      expect(html, contains('NT\$3,000.00'));
      expect(fx.db.select('SELECT * FROM checks'), isEmpty);
    });

    test('恆等式相符就收得進去，票號只顯示末四碼', () async {
      final cid = await customer();
      final page = await get('http://x/checks/new');
      final html = await post(
        'http://x/checks/new',
        'op_id=${opIdFrom(page)}&${body(cid)}',
      );
      expect(html, contains('已收票'));
      expect(html, contains('票面 NT\$100,000.00'));
      expect(html, contains('實付 NT\$97,000.00'));
      final rows = fx.db.select('SELECT * FROM checks');
      expect(rows, hasLength(1));
      expect(rows.first['face_cents'], 10000000);
      expect(rows.first['cash_paid_cents'], 9700000);

      final cash = await get('http://x/checks/cash');
      expect(cash, contains('****5678'));
      expect(cash, isNot(contains('AB12345678')));
    });

    test('同一行庫同一票號收兩次：第二次擋下', () async {
      final cid = await customer();
      final p1 = await get('http://x/checks/new');
      await post('http://x/checks/new', 'op_id=${opIdFrom(p1)}&${body(cid)}');
      final p2 = await get('http://x/checks/new');
      final html = await post(
        'http://x/checks/new',
        'op_id=${opIdFrom(p2)}&${body(cid)}',
      );
      expect(html, contains('這張票已經收過了'));
      expect(fx.db.select('SELECT * FROM checks'), hasLength(1));
    });
  });

  group('5 兌現 / 6 退票', () {
    Future<String> heldCheck() async {
      await post(
        'http://x/customers/new',
        'name=%E7%8E%8B%E5%B0%8F%E6%98%8E&id_number=A123456789',
      );
      final cid =
          fx.db.select('SELECT id FROM customers').first['id'] as String;
      final page = await get('http://x/checks/new');
      await post(
        'http://x/checks/new',
        'op_id=${opIdFrom(page)}&customer_id=$cid&bank_code=004'
        '&check_no=AB12345678&face=100000&discount=3000&other_fee=0'
        '&cash_paid=97000&due_date=2099-01-01&received_date=${todayStr()}',
      );
      return fx.db.select('SELECT id FROM checks').first['id'] as String;
    }

    test('沒選票就送出：擋下', () async {
      await heldCheck();
      final page = await get('http://x/checks/cash');
      final html = await post(
        'http://x/checks/cash',
        'op_id=${opIdFrom(page)}&check_id=&received=1000&cashed_at=${todayStr()}',
      );
      expect(html, contains('請先選到要兌現的票'));
    });

    test('實收不等於票面又沒選原因：擋下', () async {
      final id = await heldCheck();
      final page = await get('http://x/checks/cash');
      final html = await post(
        'http://x/checks/cash',
        'op_id=${opIdFrom(page)}&check_id=$id&received=40000&cashed_at=${todayStr()}',
      );
      expect(html, contains('請選差額原因'));
    });

    test('部分兌現：狀態仍是持有，剩餘票面還在', () async {
      final id = await heldCheck();
      final page = await get('http://x/checks/cash');
      final html = await post(
        'http://x/checks/cash',
        'op_id=${opIdFrom(page)}&check_id=$id&received=40000'
        '&cashed_at=${todayStr()}&diff_reason=%E9%83%A8%E5%88%86%E5%85%8C%E7%8F%BE',
      );
      expect(html, contains('已兌現 NT\$40,000.00'));
      final row = fx.db.select('SELECT * FROM checks').first;
      expect(row['status'], '持有');
      expect(row['cashed_amount_cents'], 4000000);
      expect(row['settled_at'], isNull);
      // 下拉裡還看得到它，未收票面剩 60,000。
      expect(await get('http://x/checks/cash'), contains('未收 NT\$60,000.00'));
    });

    test('全額兌現：轉已兌現，下拉裡不再出現', () async {
      final id = await heldCheck();
      final page = await get('http://x/checks/cash');
      await post(
        'http://x/checks/cash',
        'op_id=${opIdFrom(page)}&check_id=$id&received=100000&cashed_at=${todayStr()}',
      );
      expect(fx.db.select('SELECT status FROM checks').first['status'], '已兌現');
      expect(await get('http://x/checks/cash'), isNot(contains('****5678')));
    });

    test('退票轉追償：狀態變追償中，金額進格 5', () async {
      final id = await heldCheck();
      final page = await get('http://x/checks/bounce');
      final html = await post(
        'http://x/checks/bounce',
        'op_id=${opIdFrom(page)}&check_id=$id&recourse=100000&bounced_at=${todayStr()}',
      );
      expect(html, contains('已轉追償 NT\$100,000.00'));
      final row = fx.db.select('SELECT * FROM checks').first;
      expect(row['status'], '退票追償中');
      expect(row['recourse_amount_cents'], 10000000);
      // 收票紀錄沒有被刪掉。
      expect(
        fx.db.select("SELECT * FROM entries WHERE type = 'CHECK_RECEIVE'"),
        hasLength(1),
      );
    });

    test('追償金額改掉又沒填原因：擋下', () async {
      final id = await heldCheck();
      final page = await get('http://x/checks/bounce');
      final html = await post(
        'http://x/checks/bounce',
        'op_id=${opIdFrom(page)}&check_id=$id&recourse=50000&bounced_at=${todayStr()}',
      );
      expect(html, contains('請填原因'));
      expect(fx.db.select('SELECT status FROM checks').first['status'], '持有');
    });
  });

  test('8 今日流水：列出動作、對象、金額', () async {
    fx.seedLoan(daysAgo: 30, anchor: DateTime.now());
    final page = await get('http://x/settle?loan_id=${fx.loanId}');
    await post(
      'http://x/settle',
      'op_id=${opIdFrom(page)}&loan_id=${fx.loanId}&seq=1'
      '&amount=8884.88&paid_at=${todayStr()}',
    );
    final html = await get('http://x/today');
    expect(html, contains('收款·利息'));
    expect(html, contains('收款·本金'));
    expect(html, contains('第 1 期'));
    expect(html, contains('NT\$7,884.88'));
  });
}
