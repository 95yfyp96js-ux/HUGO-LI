// 這一頁本身（左收款核銷 ／ 右活盤）。
//
// 重點：op_id 是**開表單就發**（GET 回來的 HTML 裡就有），連按兩次送出時
// 帶的是同一個 op_id，所以只會成立一次。溢繳一定先經過一次伺服器來回。
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';
import 'package:web_ledger/web/handlers.dart';

import 'fixtures.dart';

void main() {
  late Fx fx;
  late AppHandlers app;
  setUp(() {
    fx = Fx.open();
    app = AppHandlers(fx.db);
  });
  tearDown(() => fx.db.dispose());

  Future<String> get(String url) async {
    final res = await app.handler(Request('GET', Uri.parse(url)));
    return res.readAsString();
  }

  Future<String> post(String body) async {
    final res = await app.handler(
      Request(
        'POST',
        Uri.parse('http://x/settle'),
        body: body,
        headers: {'content-type': 'application/x-www-form-urlencoded'},
      ),
    );
    return res.readAsString();
  }

  String opIdFrom(String html) =>
      RegExp(r'name="op_id" value="([0-9a-f]+)"').firstMatch(html)!.group(1)!;

  test('GET /：一頁同時有左邊收款表單與右邊活盤五格', () async {
    fx.seedLoan();
    final html = await get('http://x/');
    expect(html, contains('收款並核銷'));
    expect(html, contains('活盤'));
    expect(html, contains('1 在外借款本金'));
    expect(html, contains('2 持有票面合計'));
    expect(html, contains('3 今日應收'));
    expect(html, contains('4 今日已收'));
    expect(html, contains('5 逾期＋追償'));
    expect(html, contains('今日未核銷的到期項'));
  });

  test('op_id 開表單就發：GET 回來的 HTML 裡已經有了', () async {
    fx.seedLoan();
    final html = await get('http://x/');
    expect(html, matches(RegExp(r'name="op_id" value="[0-9a-f]{32}"')));
  });

  test('選了借款後列出未清期別，金額顯示到分', () async {
    fx.seedLoan();
    final html = await get('http://x/?loan_id=${fx.loanId}');
    expect(html, contains('NT\$8,884.88'));
    expect(html, contains('第 1 期'));
    expect(html, contains('第 12 期'));
  });

  test('沒選期別就送出：擋下並顯示原因', () async {
    fx.seedLoan();
    final page = await get('http://x/?loan_id=${fx.loanId}');
    final op = opIdFrom(page);
    final html = await post(
      'op_id=$op&loan_id=${fx.loanId}&amount=8884.88&paid_at=2026-05-01',
    );
    expect(html, contains('請先選到要沖銷的期別'));
  });

  test('正常入帳：成功訊息寫出沖到哪裡，右邊活盤跟著動', () async {
    fx.seedLoan(daysAgo: 30);
    final page = await get('http://x/?loan_id=${fx.loanId}');
    final op = opIdFrom(page);
    final html = await post(
      'op_id=$op&loan_id=${fx.loanId}&seq=1&amount=8884.88&paid_at=2026-05-01',
    );
    expect(html, contains('已入帳 NT\$8,884.88'));
    expect(html, contains('沖利息 NT\$1,000.00'));
    expect(html, contains('沖本金 NT\$7,884.88'));
  });

  test('同一個 op_id 連送兩次：第二次不重複入帳', () async {
    fx.seedLoan(daysAgo: 30);
    final page = await get('http://x/?loan_id=${fx.loanId}');
    final op = opIdFrom(page);
    const String body0 = 'seq=1&amount=8884.88&paid_at=2026-05-01';
    await post('op_id=$op&loan_id=${fx.loanId}&$body0');
    final second = await post('op_id=$op&loan_id=${fx.loanId}&$body0');

    expect(second, contains('這筆已經入過帳了'));
    final paid = fx.db.select(
      'SELECT principal_paid_cents + interest_paid_cents AS total '
      'FROM schedule_items WHERE loan_id = ? AND seq = 1',
      [fx.loanId],
    ).first;
    expect(paid['total'], 888488, reason: '只入了一次');
  });

  test('溢繳：先跳說明，按「回去改金額」則一毛都沒入帳', () async {
    fx.seedLoan();
    final page = await get('http://x/?loan_id=${fx.loanId}');
    final op = opIdFrom(page);
    final seqs = List.generate(12, (i) => 'seq=${i + 1}').join('&');
    final html = await post(
      'op_id=$op&loan_id=${fx.loanId}&$seqs&amount=107618.53&paid_at=2026-05-01',
    );

    expect(html, contains('這筆錢超過應繳金額'));
    expect(html, contains('沖完全部未繳期別後仍多出'));
    expect(html, contains('NT\$1,000.00'));
    expect(html, contains('沒有自動退款流程'));
    expect(html, contains('回去改金額'));

    final n = fx.db.select(
      "SELECT COUNT(*) AS n FROM entries WHERE type LIKE 'LOAN_COLLECT%'",
    ).first['n'];
    expect(n, 0, reason: '只是預覽，還沒入帳');
  });

  test('溢繳確認後才入帳，且成功訊息講出溢繳金額', () async {
    fx.seedLoan();
    final page = await get('http://x/?loan_id=${fx.loanId}');
    final op = opIdFrom(page);
    final seqs = List.generate(12, (i) => 'seq=${i + 1}').join('&');
    final html = await post(
      'op_id=$op&loan_id=${fx.loanId}&$seqs&amount=107618.53'
      '&paid_at=2026-05-01&overpay_ack=1',
    );
    expect(html, contains('溢繳 NT\$1,000.00 已記為負向調整分錄'));
  });

  test('勾錯範圍：訊息叫他去勾後面的期別，不給 ack 放行', () async {
    fx.seedLoan();
    final page = await get('http://x/?loan_id=${fx.loanId}');
    final op = opIdFrom(page);
    final html = await post(
      'op_id=$op&loan_id=${fx.loanId}&seq=1&amount=17769.76&paid_at=2026-05-01',
    );
    expect(html, contains('請一起勾選第'));
    expect(html, isNot(contains('了解，確認入帳')));
  });

  test('盤不平時，右邊直接打「盤不平」並列出差額', () async {
    fx.seedLoan(daysAgo: 30);
    fx.db.execute(
      'INSERT OR IGNORE INTO schedule_items '
      '(loan_id, seq, due_date, opening_balance_cents, principal_cents, '
      'interest_cents, principal_paid_cents) VALUES (?, 1, ?, 0, 788488, 100000, 500000)',
      [fx.loanId, '2026-05-01'],
    );
    final html = await get('http://x/');
    expect(html, contains('盤不平'));
    expect(html, contains('現況與流水重放對不起來'));
  });

  test('這一頁沒有任何 JavaScript 算術（沒有 script 標籤）', () async {
    fx.seedLoan();
    final html = await get('http://x/?loan_id=${fx.loanId}');
    expect(html.toLowerCase(), isNot(contains('<script')));
  });
}
