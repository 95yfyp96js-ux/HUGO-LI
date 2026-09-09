// 登入與權限（docs/BOSS-SPEC.md A、docs/THREAT-REVIEW.md 第 8、11 條）。
//
// 重點三條：沒登入什麼都看不到；員工看不到五格與日結；停用帳號後手上開著的
// 分頁下一個動作就失效（不是等他自己登出）。
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';
import 'package:web_ledger/domain/settlement.dart';
import 'package:web_ledger/web/handlers.dart';

import 'fixtures.dart';

void main() {
  late Fx fx;
  late AppHandlers app;
  setUp(() {
    fx = Fx.open();
    fx.seedUsers();
    app = AppHandlers(fx.db);
  });
  tearDown(() => fx.db.dispose());

  Future<Response> req(
    String method,
    String url, {
    String? token,
    String body = '',
  }) async => await app.handler(
    Request(
      method,
      Uri.parse(url),
      body: body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        if (token != null) 'cookie': 'sid=$token',
      },
    ),
  );

  test('沒登入：一律導去登入頁', () async {
    for (final url in [
      'http://x/',
      'http://x/settle',
      'http://x/today',
      'http://x/close',
      'http://x/checks/new',
    ]) {
      final res = await req('GET', url);
      expect(res.statusCode, 303, reason: url);
      expect(res.headers['location'], '/login');
    }
  });

  test('密碼錯：不透露是帳號錯還是密碼錯', () {
    expect(
      () => fx.auth.login('boss', 'wrong'),
      throwsA(
        isA<SettlementRejected>().having((e) => e.message, 'message', '帳號或密碼不對。'),
      ),
    );
    expect(
      () => fx.auth.login('nobody', 'whatever'),
      throwsA(
        isA<SettlementRejected>().having((e) => e.message, 'message', '帳號或密碼不對。'),
      ),
    );
  });

  test('員工看不到五格：首頁與收款頁都沒有活盤數字', () async {
    fx.seedLoan();
    final staff = await (await req(
      'GET',
      'http://x/',
      token: fx.staffToken,
    )).readAsString();
    expect(staff, contains('今天要做的事'));
    expect(staff, contains('活盤五格與日結只有老闆看得到'));
    expect(staff, isNot(contains('在外借款本金')));

    final boss = await (await req(
      'GET',
      'http://x/',
      token: fx.bossToken,
    )).readAsString();
    expect(boss, contains('1 在外借款本金'));
  });

  test('員工看不到導覽列的「日結」，直接打網址也會被擋（後端再檢查一次）', () async {
    final staffHome = await (await req(
      'GET',
      'http://x/',
      token: fx.staffToken,
    )).readAsString();
    expect(staffHome, isNot(contains('>日結<')));

    final res = await req('GET', 'http://x/close', token: fx.staffToken);
    expect(res.statusCode, 403);
    expect(await res.readAsString(), contains('這個動作只有老闆能做'));
  });

  test('員工不能按四關，POST 直接 403', () async {
    for (final stage in ['review', 'confirm', 'certify']) {
      final res = await req(
        'POST',
        'http://x/close/$stage',
        token: fx.staffToken,
        body: 'date=2026-05-01',
      );
      expect(res.statusCode, 403, reason: stage);
    }
  });

  test('員工的今日流水只有自己登的', () async {
    fx.seedLoan(daysAgo: 30);
    // 老闆登一筆收款。
    fx.settlement.post(
      opId: newId(),
      operatorId: fx.bossId,
      loanId: fx.loanId,
      seqs: const [1],
      amountCents: 888488,
      paidAt: DateTime.now(),
      overpayAck: false,
    );

    final staff = await (await req(
      'GET',
      'http://x/today',
      token: fx.staffToken,
    )).readAsString();
    expect(staff, contains('今日流水（我登的）'));
    expect(staff, contains('今天還沒有任何紀錄'));

    final boss = await (await req(
      'GET',
      'http://x/today',
      token: fx.bossToken,
    )).readAsString();
    expect(boss, contains('今日流水（全部人）'));
    expect(boss, contains('收款·本金'));
  });

  test('停用帳號：手上開著的 session 下一個動作就失效', () async {
    final before = await req('GET', 'http://x/', token: fx.staffToken);
    expect(before.statusCode, 200);

    fx.auth.disable(fx.staffId);

    final after = await req('GET', 'http://x/', token: fx.staffToken);
    expect(after.statusCode, 303, reason: '不是等他自己登出');
    expect(after.headers['location'], '/login');

    // 老闆不受影響。
    expect((await req('GET', 'http://x/', token: fx.bossToken)).statusCode, 200);
  });

  test('登出後 cookie 失效', () async {
    final res = await req('POST', 'http://x/logout', token: fx.staffToken);
    expect(res.statusCode, 303);
    expect(
      (await req('GET', 'http://x/', token: fx.staffToken)).statusCode,
      303,
    );
  });
}
