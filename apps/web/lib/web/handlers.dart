import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:shelf/shelf.dart';
import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import '../db/store.dart';
import '../domain/auth.dart';
import '../domain/board.dart';
import '../domain/checks.dart';
import '../domain/daily_close.dart';
import '../domain/loans.dart';
import '../domain/model.dart';
import '../domain/settlement.dart';
import '../money.dart';
import 'chrome.dart';
import 'close_view.dart';
import 'forms.dart';
import 'views.dart';

/// 路由與權限。
///
/// 三條寫死的：
/// * **每個請求都重查帳號**（`AuthService.userForToken`），停用即時生效。
/// * **老闆專屬的動作在後端再檢查一次角色**；前端不畫按鈕不算權限。
/// * **`op_id` 在 GET 組表單時就發**，跟著表單走完；同一個 op_id 只成立一次。
class AppHandlers {
  AppHandlers(this.db)
    : _store = Store(db),
      _auth = AuthService(db),
      _loans = LoanService(db),
      _checks = CheckService(db),
      _settlement = SettlementService(db),
      _board = BoardService(db),
      _close = DailyCloseService(db);

  final Database db;
  final Store _store;
  final AuthService _auth;
  final LoanService _loans;
  final CheckService _checks;
  final SettlementService _settlement;
  final BoardService _board;
  final DailyCloseService _close;

  static const String cookieName = 'sid';

  Handler get handler => _dispatch;

  // ------------------------------------------------------------ 分派

  Future<Response> _dispatch(Request request) async {
    final String path = '/${request.url.path}';
    final User? user = _auth.userForToken(_cookie(request));

    if (path == '/login') {
      if (request.method == 'GET') return _loginPage();
      if (request.method == 'POST') return _doLogin(request);
    }
    if (path == '/logout' && request.method == 'POST') {
      final String? token = _cookie(request);
      if (token != null) _auth.logout(token);
      return _redirect('/login', clearCookie: true);
    }

    if (user == null) return _redirect('/login');

    final bool get = request.method == 'GET';
    switch (path) {
      case '/':
        return _home(user);
      case '/customers/new':
        return get ? _customerPage(user) : _customerPost(request, user);
      case '/loans/new':
        return get ? _loanPage(user) : _loanPost(request, user);
      case '/loans/disburse':
        return get ? _disbursePage(user) : _disbursePost(request, user);
      case '/checks/new':
        return get ? _checkPage(user) : _checkPost(request, user);
      case '/checks/cash':
        return get ? _cashPage(user) : _cashPost(request, user);
      case '/checks/bounce':
        return get ? _bouncePage(user) : _bouncePost(request, user);
      case '/settle':
        return get ? _settlePage(request, user) : _settlePost(request, user);
      case '/today':
        return _todayPage(user);
      case '/close':
        return _closePage(request, user);
      case '/close/review':
      case '/close/confirm':
      case '/close/certify':
        return _closeStage(request, user, path.split('/').last);
    }
    return Response.notFound('Not found');
  }

  // ------------------------------------------------------------ 登入

  Response _loginPage({String? error, String username = ''}) => _html(
    shell(
      title: '登入',
      body: loginPage(error: error, username: username),
    ),
  );

  Future<Response> _doLogin(Request request) async {
    final form = _parseForm(await request.readAsString());
    final String username = form['username']?.first ?? '';
    try {
      final String token = _auth.login(username, form['password']?.first ?? '');
      return _redirect('/', setCookie: token);
    } on SettlementRejected catch (e) {
      return _loginPage(error: escapeHtml(e.message), username: username);
    }
  }

  // ------------------------------------------------------------ 首頁

  /// 員工看不到五格。這不是把 div 藏起來——右欄根本不會被算、不會被送出去。
  Future<Response> _home(User user) async {
    final String right = user.isBoss
        ? card(boardPanel(_board.compute()))
        : card(
            '<h2>活盤</h2><p class="muted">活盤五格與日結只有老闆看得到。'
            '你可以從「看今日流水」確認自己今天登了什麼。</p>',
          );
    return _page(user, buttonGrid(user) + right, active: 'home', two: true);
  }

  // ------------------------------------------------------ 1 新增客戶

  Future<Response> _customerPage(
    User user, {
    Map<String, String>? v,
    String? error,
    String? success,
  }) async => _page(
    user,
    customerForm(
      opId: newId(),
      v: v ?? const {},
      error: error,
      success: success,
    ),
  );

  Future<Response> _customerPost(Request request, User user) async {
    final f = _parseForm(await request.readAsString());
    final v = _values(f, ['name', 'id_number', 'phone']);
    if ((v['name'] ?? '').isEmpty || (v['id_number'] ?? '').isEmpty) {
      return _customerPage(user, v: v, error: '姓名與身分證字號都要填。');
    }
    try {
      _loans.createCustomer(
        name: v['name']!,
        idNumber: v['id_number']!,
        phone: v['phone'],
      );
      return await _customerPage(user, success: '已新增客戶：${escapeHtml(v['name']!)}。');
    } on SettlementRejected catch (e) {
      return _customerPage(user, v: v, error: escapeHtml(e.message));
    }
  }

  // ------------------------------------------------------ 2 新增借款

  Future<Response> _loanPage(
    User user, {
    Map<String, String>? v,
    String? error,
    String? success,
  }) async => _page(
    user,
    loanForm(
      opId: newId(),
      customers: _store.customers(),
      v: v ?? const {},
      error: error,
      success: success,
    ),
  );

  Future<Response> _loanPost(Request request, User user) async {
    final f = _parseForm(await request.readAsString());
    final v = _values(f, [
      'customer_id',
      'principal',
      'method',
      'rate_type',
      'rate_bps',
      'day_count',
      'tenor',
      'period_days',
      'grace_days',
      'penalty',
    ]);
    final int? principal = parseAmountToCents(v['principal'] ?? '');
    final int? rateBps = int.tryParse(v['rate_bps'] ?? '');
    final int? tenor = int.tryParse(v['tenor'] ?? '');
    if ((v['customer_id'] ?? '').isEmpty) {
      return _loanPage(user, v: v, error: '請先選客戶。');
    }
    if (principal == null || principal <= 0) {
      return _loanPage(user, v: v, error: '金額必須大於 0，最多兩位小數。');
    }
    if (rateBps == null || rateBps < 0) {
      return _loanPage(user, v: v, error: '利率必須是 0 以上的整數基點（100 = 1%）。');
    }
    if (tenor == null || tenor < 1) {
      return _loanPage(user, v: v, error: '期數必須是 1 以上的整數。');
    }
    try {
      _loans.registerLoan(
        customerId: v['customer_id']!,
        principalCents: principal,
        method: engine.RepaymentMethod.values.byName(v['method'] ?? 'emi'),
        rateType: engine.RateType.values.byName(v['rate_type'] ?? 'monthly'),
        rateBps: rateBps,
        dayCount: engine.DayCount.values.byName(v['day_count'] ?? 'thirty360'),
        tenorPeriods: tenor,
        periodDays: int.tryParse(v['period_days'] ?? '') ?? 30,
        graceDays: int.tryParse(v['grace_days'] ?? '') ?? 3,
        penaltyEnabled: v['penalty'] == '1',
      );
      return await _loanPage(
        user,
        success: '已建約（尚未撥付，活盤不會動）。'
            '接著按「3 確認撥付」才會開始計息。',
      );
    } on SettlementRejected catch (e) {
      return _loanPage(user, v: v, error: escapeHtml(e.message));
    }
  }

  // ------------------------------------------------------ 3 確認撥付

  Future<Response> _disbursePage(
    User user, {
    Map<String, String>? v,
    String? error,
    String? success,
  }) async {
    final options = [
      for (final loan in _store.undisbursedLoans())
        (
          id: loan.id,
          text:
              '${_store.customerName(loan.customerId)} · '
              '${formatMoney(loan.principalCents)} · '
              '${loan.method.toUpperCase()} ${loan.tenorPeriods} 期',
        ),
    ];
    return _page(
      user,
      disburseForm(
        opId: newId(),
        loans: options,
        v: {
          'disbursed_at': formatDate(dateOnly(DateTime.now())),
          ...?v,
        },
        error: error,
        success: success,
      ),
    );
  }

  Future<Response> _disbursePost(Request request, User user) async {
    final f = _parseForm(await request.readAsString());
    final v = _values(f, ['op_id', 'loan_id', 'disbursed_at']);
    if ((v['loan_id'] ?? '').isEmpty) {
      return _disbursePage(user, v: v, error: '請先選一筆借款。');
    }
    try {
      _loans.confirmDisbursement(
        opId: v['op_id']!,
        operatorId: user.id,
        loanId: v['loan_id']!,
        disbursedAt: parseDate(v['disbursed_at']!),
      );
      return await _disbursePage(
        user,
        success: '已確認撥付（撥付日 ${escapeHtml(v['disbursed_at']!)}）。',
      );
    } on SettlementRejected catch (e) {
      return _disbursePage(user, v: v, error: escapeHtml(e.message));
    }
  }

  // ---------------------------------------------------------- 4 收票

  Future<Response> _checkPage(
    User user, {
    Map<String, String>? v,
    String? error,
    String? success,
  }) async => _page(
    user,
    checkForm(
      opId: newId(),
      customers: _store.customers(),
      v: {'received_date': formatDate(dateOnly(DateTime.now())), ...?v},
      error: error,
      success: success,
    ),
  );

  Future<Response> _checkPost(Request request, User user) async {
    final f = _parseForm(await request.readAsString());
    final v = _values(f, [
      'op_id',
      'customer_id',
      'bank_code',
      'check_no',
      'face',
      'discount',
      'other_fee',
      'cash_paid',
      'due_date',
      'received_date',
    ]);
    final int? face = parseAmountToCents(v['face'] ?? '');
    final int? discount = parseAmountToCents(v['discount'] ?? '0');
    final int? other = parseAmountToCents(
      (v['other_fee'] ?? '').isEmpty ? '0' : v['other_fee']!,
    );
    final int? cash = parseAmountToCents(v['cash_paid'] ?? '');
    if ((v['customer_id'] ?? '').isEmpty) {
      return _checkPage(user, v: v, error: '請先選客戶。');
    }
    if ((v['check_no'] ?? '').isEmpty || (v['bank_code'] ?? '').isEmpty) {
      return _checkPage(user, v: v, error: '行庫與票號都要填。');
    }
    if (face == null || discount == null || other == null || cash == null) {
      return _checkPage(user, v: v, error: '金額必須是數字，最多兩位小數。');
    }
    if ((v['due_date'] ?? '').isEmpty || (v['received_date'] ?? '').isEmpty) {
      return _checkPage(user, v: v, error: '到期日與收票日都要填。');
    }
    try {
      _checks.receive(
        opId: v['op_id']!,
        operatorId: user.id,
        customerId: v['customer_id']!,
        bankCode: v['bank_code']!,
        checkNo: v['check_no']!,
        faceCents: face,
        discountInterestCents: discount,
        cashPaidCents: cash,
        otherFeeCents: other,
        dueDate: parseDate(v['due_date']!),
        receivedDate: parseDate(v['received_date']!),
      );
      return await _checkPage(
        user,
        success: '已收票，票面 ${formatMoney(face)}、實付 ${formatMoney(cash)}。',
      );
    } on SqliteException catch (e) {
      final bool dup = e.message.contains('UNIQUE');
      return _checkPage(
        user,
        v: v,
        error: dup
            ? '這張票已經收過了（同一行庫 + 同一票號只能收一次）。'
            : escapeHtml(e.message),
      );
    } on SettlementRejected catch (e) {
      return _checkPage(user, v: v, error: escapeHtml(e.message));
    }
  }

  // ---------------------------------------------------------- 5 兌現

  Future<Response> _cashPage(
    User user, {
    Map<String, String>? v,
    String? error,
    String? success,
  }) async => _page(
    user,
    cashForm(
      opId: newId(),
      held: _store.heldChecks(),
      nameOf: (id) => _store.customerName(_store.customerIdForCheck(id)),
      v: {'cashed_at': formatDate(dateOnly(DateTime.now())), ...?v},
      error: error,
      success: success,
    ),
  );

  Future<Response> _cashPost(Request request, User user) async {
    final f = _parseForm(await request.readAsString());
    final v = _values(f, [
      'op_id',
      'check_id',
      'received',
      'cashed_at',
      'diff_reason',
    ]);
    if ((v['check_id'] ?? '').isEmpty) {
      return _cashPage(user, v: v, error: '請先選到要兌現的票。');
    }
    final int? received = parseAmountToCents(v['received'] ?? '');
    if (received == null || received <= 0) {
      return _cashPage(user, v: v, error: '實收必須大於 0，最多兩位小數。');
    }
    try {
      _checks.cash(
        opId: v['op_id']!,
        operatorId: user.id,
        checkId: v['check_id']!,
        receivedCents: received,
        cashedAt: parseDate(v['cashed_at']!),
        diffReason: v['diff_reason'],
      );
      return await _cashPage(user, success: '已兌現 ${formatMoney(received)}。');
    } on SettlementRejected catch (e) {
      return _cashPage(user, v: v, error: escapeHtml(e.message));
    }
  }

  // ---------------------------------------------------------- 6 退票

  Future<Response> _bouncePage(
    User user, {
    Map<String, String>? v,
    String? error,
    String? success,
  }) async => _page(
    user,
    bounceForm(
      opId: newId(),
      held: _store.heldChecks(),
      nameOf: (id) => _store.customerName(_store.customerIdForCheck(id)),
      v: {'bounced_at': formatDate(dateOnly(DateTime.now())), ...?v},
      error: error,
      success: success,
    ),
  );

  Future<Response> _bouncePost(Request request, User user) async {
    final f = _parseForm(await request.readAsString());
    final v = _values(f, [
      'op_id',
      'check_id',
      'recourse',
      'bounced_at',
      'reason',
    ]);
    if ((v['check_id'] ?? '').isEmpty) {
      return _bouncePage(user, v: v, error: '請先選到要退票的票。');
    }
    final int? recourse = parseAmountToCents(v['recourse'] ?? '');
    if (recourse == null || recourse <= 0) {
      return _bouncePage(user, v: v, error: '追償金額必須大於 0，最多兩位小數。');
    }
    try {
      _checks.bounce(
        opId: v['op_id']!,
        operatorId: user.id,
        checkId: v['check_id']!,
        recourseCents: recourse,
        bouncedAt: parseDate(v['bounced_at']!),
        reason: v['reason'],
      );
      return await _bouncePage(
        user,
        success: '已轉追償 ${formatMoney(recourse)}，這筆金額會出現在活盤格 5。',
      );
    } on SettlementRejected catch (e) {
      return _bouncePage(user, v: v, error: escapeHtml(e.message));
    }
  }

  // -------------------------------------------------- 7 收款並核銷

  Future<Response> _settlePage(
    Request request,
    User user, {
    String? errorHtml,
    String? successHtml,
    SettlementPreview? ackPreview,
    String? forcedOpId,
    String? amountValue,
    Set<int>? checkedSeqs,
    Map<String, String> query = const {},
  }) async {
    final q = {...request.url.queryParameters, ...query};
    final String? loanId = _blank(q['loan_id']);
    final String paidAt = q['paid_at'] ?? formatDate(dateOnly(DateTime.now()));
    final String opId = forcedOpId ?? newId();

    final options = [
      for (final loan in _store.disbursedLoans())
        LoanOption(
          id: loan.id,
          label:
              '${_store.customerName(loan.customerId)} · '
              '${formatMoney(loan.principalCents)} · '
              '${loan.method.toUpperCase()} ${loan.tenorPeriods} 期',
        ),
    ];

    final rows = <PeriodRow>[];
    if (loanId != null) {
      final Loan? loan = _store.loanById(loanId);
      if (loan != null && loan.isDisbursed) {
        for (final period in _store.scheduleFor(loan)) {
          if (period.isSettled) continue;
          final int penalty = _settlement.penaltyOwedCents(
            loan: loan,
            item: period,
            asOf: parseDate(paidAt),
          );
          rows.add(
            PeriodRow(
              seq: period.seq,
              dueDate: formatDate(period.dueDate),
              dueLabel: formatMoney(period.shortfallCents + penalty),
              overdue: period.isOverdue(
                asOf: parseDate(paidAt),
                graceDays: loan.graceDays,
              ),
              penaltyLabel: penalty > 0 ? formatMoney(penalty) : null,
            ),
          );
        }
      }
    }

    final left = card(
      settleForm(
        opId: opId,
        loans: options,
        selectedLoanId: loanId,
        periods: rows,
        amountValue: amountValue ?? '',
        paidAtValue: paidAt,
        checkedSeqs: checkedSeqs ?? const <int>{},
        errorHtml: errorHtml,
        successHtml: successHtml,
        ackPreview: ackPreview,
      ),
    );
    final right = user.isBoss
        ? card(boardPanel(_board.compute()))
        : card(
            '<h2>活盤</h2><p class="muted">活盤五格只有老闆看得到。</p>',
          );
    return _page(user, left + right, active: 'settle', two: true);
  }

  Future<Response> _settlePost(Request request, User user) async {
    final form = _parseForm(await request.readAsString());
    final String opId = form['op_id']?.first ?? newId();
    final String? loanId = _blank(form['loan_id']?.first);
    final seqs = (form['seq'] ?? const <String>[])
        .map(int.tryParse)
        .whereType<int>()
        .toList();
    final String amountRaw = form['amount']?.first ?? '';
    final String paidAtRaw =
        form['paid_at']?.first ?? formatDate(dateOnly(DateTime.now()));
    final bool ack = form['overpay_ack']?.first == '1';
    final query = {
      if (loanId != null) 'loan_id': loanId,
      'paid_at': paidAtRaw,
    };

    // 冪等：這個 op_id 已經成立過就直接回放。必須排在所有驗證之前，否則重送
    // 會收到「這期已經結清了」，員工只會再按一次。
    final done = _settlement.findResult(opId);
    if (done != null) {
      return _settlePage(
        request,
        user,
        query: query,
        successHtml: '這筆已經入過帳了（同一次送出只會成立一次），沒有重複寫入：'
            '${escapeHtml(formatMoney(done.amountCents))}。',
      );
    }

    if (loanId == null) {
      return _settlePage(
        request,
        user,
        query: query,
        errorHtml: '請先選一筆借款。',
        forcedOpId: opId,
        amountValue: amountRaw,
      );
    }

    final int? amountCents = parseAmountToCents(amountRaw);
    if (amountCents == null || amountCents <= 0) {
      return _settlePage(
        request,
        user,
        query: query,
        errorHtml: '金額必須大於 0，最多兩位小數。',
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }

    Future<Response> fail(String message) => _settlePage(
      request,
      user,
      query: query,
      errorHtml: escapeHtml(message),
      forcedOpId: opId,
      amountValue: amountRaw,
      checkedSeqs: seqs.toSet(),
    );

    final SettlementPreview preview;
    try {
      preview = _settlement.preview(
        loanId: loanId,
        seqs: seqs,
        amountCents: amountCents,
        paidAt: parseDate(paidAtRaw),
      );
    } on SettlementRejected catch (e) {
      return fail(e.message);
    }
    if (!preview.canPost) return fail(preview.blocked!);

    // 溢繳：先把去向講清楚，確認才寫（同一個 op_id 帶回來）。
    if (preview.isOverpayment && !ack) {
      return _settlePage(
        request,
        user,
        query: query,
        ackPreview: preview,
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }

    try {
      final result = _settlement.post(
        opId: opId,
        operatorId: user.id,
        loanId: loanId,
        seqs: seqs,
        amountCents: amountCents,
        paidAt: parseDate(paidAtRaw),
        overpayAck: ack,
      );
      final String msg = '已入帳 ${formatMoney(result.amountCents)}：'
          '沖罰息 ${formatMoney(result.penaltyCents)}、'
          '沖利息 ${formatMoney(result.interestCents)}、'
          '沖本金 ${formatMoney(result.principalCents)}'
          '${result.overpaymentCents > 0 ? '，溢繳 ${formatMoney(result.overpaymentCents)} 已記為負向調整分錄' : ''}。';
      return await _settlePage(
        request,
        user,
        query: query,
        successHtml: escapeHtml(msg),
      );
    } on SettlementRejected catch (e) {
      return fail(e.message);
    }
  }

  // ------------------------------------------------------ 8 今日流水

  Future<Response> _todayPage(User user) async {
    final DateTime today = dateOnly(DateTime.now());
    // 員工只看得到自己登的（docs/BOSS-SPEC.md A）。
    final rows = _store.entriesForDate(
      today,
      operatorId: user.isBoss ? null : user.id,
    );
    return _page(
      user,
      todayPanel(
        rows: rows,
        date: today,
        all: user.isBoss,
        describe: _describeEntry,
      ),
      active: 'today',
    );
  }

  String _describeEntry(row) {
    const labels = {
      EntryType.loanDisburse: '撥付',
      EntryType.collectPenalty: '收款·罰息',
      EntryType.collectFee: '收款·費用',
      EntryType.collectInterest: '收款·利息',
      EntryType.collectPrincipal: '收款·本金',
      EntryType.overpayAdjust: '溢繳調整',
      EntryType.checkReceive: '收票',
      EntryType.checkCashPartial: '兌現（部分）',
      EntryType.checkCashFull: '兌現（全額）',
      EntryType.checkBounce: '退票轉追償',
      EntryType.checkRecover: '追回',
    };
    final String type = row['type'] as String;
    final String? loanId = row['loan_id'] as String?;
    final String? checkId = row['check_id'] as String?;
    final int? seq = row['schedule_seq'] as int?;

    String target;
    if (loanId != null) {
      final name = _store.loanCustomerName(loanId) ?? '（查無客戶）';
      target = seq == null ? name : '$name · 第 $seq 期';
    } else if (checkId != null) {
      final label = _store.checkLabel(checkId);
      final name = _store.customerName(_store.customerIdForCheck(checkId));
      target = label == null ? name : '$name · ${label.bank} ${label.masked}';
    } else {
      target = '—';
    }
    return '<td>${escapeHtml(labels[type] ?? type)}</td>'
        '<td>${escapeHtml(target)}</td>';
  }

  // ---------------------------------------------------------- 日結

  Future<Response> _closePage(
    Request request,
    User user, {
    String? error,
    String? success,
  }) async {
    if (!user.isBoss) return _forbidden(user);
    final String dateRaw =
        request.url.queryParameters['date'] ??
        formatDate(dateOnly(DateTime.now()));
    final sheet = _close.sheet(parseDate(dateRaw));
    return _page(
      user,
      closeSheet(s: sheet, error: error, success: success),
      active: 'close',
    );
  }

  Future<Response> _closeStage(
    Request request,
    User user,
    String stage,
  ) async {
    // 老闆專屬。前端沒畫按鈕不算權限，這裡再檢查一次。
    if (!user.isBoss) return _forbidden(user);
    final form = _parseForm(await request.readAsString());
    final String dateRaw =
        form['date']?.first ?? formatDate(dateOnly(DateTime.now()));
    final DateTime date = parseDate(dateRaw);
    final probe = Request('GET', Uri.parse('http://x/close?date=$dateRaw'));
    try {
      switch (stage) {
        case 'review':
          _close.review(date, user.id);
          return await _closePage(probe, user, success: '已核定：這張日結你看過了。');
        case 'confirm':
          _close.confirm(date, user.id);
          return await _closePage(probe, user, success: '已確認：盤你對過了。');
        case 'certify':
          _close.certify(date, user.id);
          return await _closePage(
            probe,
            user,
            success: '$dateRaw 已認證並鎖帳。這一天（含之前）不能再寫入。',
          );
      }
    } on SettlementRejected catch (e) {
      return _closePage(probe, user, error: escapeHtml(e.message));
    }
    return Response.notFound('Not found');
  }

  // ---------------------------------------------------------- 共用

  Response _forbidden(User user) => _html(
    shell(
      title: '沒有權限',
      user: user,
      body: card(
        '<h2>沒有權限</h2><p>這個動作只有老闆能做。</p>'
        '<p class="muted">核定、確認、認證四關都只檢查一件事：是不是老闆帳號。</p>',
      ),
    ),
    status: 403,
  );

  Future<Response> _page(
    User user,
    String body, {
    String active = '',
    bool two = false,
  }) async => _html(
    shell(
      title: '小額借款＋支票貼現',
      user: user,
      body: body,
      active: active,
      twoColumn: two,
    ),
  );

  Response _html(String body, {int status = 200}) => Response(
    status,
    body: body,
    headers: {'content-type': 'text/html; charset=utf-8'},
  );

  Response _redirect(
    String location, {
    String? setCookie,
    bool clearCookie = false,
  }) {
    final headers = <String, String>{'location': location};
    if (setCookie != null) {
      headers['set-cookie'] =
          '$cookieName=$setCookie; Path=/; HttpOnly; SameSite=Lax';
    }
    if (clearCookie) {
      headers['set-cookie'] = '$cookieName=; Path=/; HttpOnly; Max-Age=0';
    }
    return Response(303, headers: headers);
  }

  static String? _cookie(Request request) {
    final raw = request.headers['cookie'];
    if (raw == null) return null;
    for (final part in raw.split(';')) {
      final t = part.trim();
      if (t.startsWith('$cookieName=')) {
        return t.substring(cookieName.length + 1);
      }
    }
    return null;
  }

  static String? _blank(String? value) =>
      (value == null || value.trim().isEmpty) ? null : value.trim();

  static Map<String, String> _values(
    Map<String, List<String>> form,
    List<String> keys,
  ) => {
    for (final k in keys)
      if (form[k]?.first != null) k: form[k]!.first.trim(),
  };

  /// `application/x-www-form-urlencoded`，同名欄位（勾選的期別）會有多個值。
  static Map<String, List<String>> _parseForm(String body) {
    final result = <String, List<String>>{};
    for (final pair in body.split('&')) {
      if (pair.isEmpty) continue;
      final int i = pair.indexOf('=');
      final String key =
          Uri.decodeQueryComponent(i < 0 ? pair : pair.substring(0, i));
      final String value =
          i < 0 ? '' : Uri.decodeQueryComponent(pair.substring(i + 1));
      result.putIfAbsent(key, () => <String>[]).add(value);
    }
    return result;
  }
}
