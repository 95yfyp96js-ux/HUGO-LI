import 'package:shelf/shelf.dart';
import 'package:sqlite3/sqlite3.dart';

import '../db/store.dart';
import '../domain/board.dart';
import '../domain/model.dart';
import '../domain/settlement.dart';
import '../money.dart';
import 'views.dart';

/// 第 1 版唯一的畫面：左邊收款並核銷，右邊活盤五格＋今日未核銷紅字。
///
/// 兩條規則在這一層被守住：
/// 1. **op_id 在表單被送出去給瀏覽器時就產生**（GET 時 mint），不是等使用者
///    按下送出。後者擋不住雙擊。
/// 2. **金額只在伺服器算。** 送進來的只有金額字串與勾選的期別編號。
class AppHandlers {
  AppHandlers(this.db, {this.operatorId = 'staff-1', this.operatorName = '員工'})
    : _store = Store(db),
      _settlement = SettlementService(db),
      _board = BoardService(db);

  final Database db;
  final String operatorId;
  final String operatorName;
  final Store _store;
  final SettlementService _settlement;
  final BoardService _board;

  Handler get handler => (Request request) async {
    if (request.method == 'GET' && request.url.path.isEmpty) {
      return _renderIndex(request);
    }
    if (request.method == 'POST' && request.url.path == 'settle') {
      return _postSettle(request);
    }
    return Response.notFound('Not found');
  };

  // ------------------------------------------------------------ GET /

  Future<Response> _renderIndex(
    Request request, {
    String? errorHtml,
    String? successHtml,
    SettlementPreview? ackPreview,
    String? forcedOpId,
    String? amountValue,
    Set<int>? checkedSeqs,
  }) async {
    final q = request.url.queryParameters;
    final String? loanId = _blankToNull(q['loan_id']);
    final DateTime today = dateOnly(DateTime.now());
    final String paidAt = q['paid_at'] ?? formatDate(today);

    // op_id：這一頁被組出來的當下就發，跟著表單走完預覽與確認。
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

    final left = settleForm(
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
    );

    return Response.ok(
      page(
        left: left,
        right: boardPanel(_board.compute(asOf: today)),
        operatorName: operatorName,
      ),
      headers: {'content-type': 'text/html; charset=utf-8'},
    );
  }

  // ------------------------------------------------------- POST /settle

  Future<Response> _postSettle(Request request) async {
    final body = await request.readAsString();
    final form = _parseForm(body);

    final String opId = form['op_id']?.first ?? newId();
    final String? loanId = _blankToNull(form['loan_id']?.first);
    final seqs = (form['seq'] ?? const <String>[])
        .map(int.tryParse)
        .whereType<int>()
        .toList();
    final String amountRaw = form['amount']?.first ?? '';
    final String paidAtRaw =
        form['paid_at']?.first ?? formatDate(dateOnly(DateTime.now()));
    final bool ack = form['overpay_ack']?.first == '1';

    Request back({Map<String, String> extra = const {}}) => Request(
      'GET',
      request.requestedUri.replace(
        path: '/',
        queryParameters: {
          if (loanId != null) 'loan_id': loanId,
          'paid_at': paidAtRaw,
          ...extra,
        },
      ),
    );

    // 冪等：這個 op_id 已經成立過就直接回放。這一步必須排在所有驗證之前，
    // 否則重送會收到「這期已經結清了」，員工只會再按一次。
    final done = _settlement.findResult(opId);
    if (done != null) {
      return _renderIndex(
        back(),
        successHtml: '這筆已經入過帳了（同一次送出只會成立一次），沒有重複寫入：'
            '${escapeHtml(formatMoney(done.amountCents))}。',
      );
    }

    if (loanId == null) {
      return _renderIndex(
        back(),
        errorHtml: '請先選一筆借款。',
        forcedOpId: opId,
        amountValue: amountRaw,
      );
    }

    final int? amountCents = parseAmountToCents(amountRaw);
    if (amountCents == null || amountCents <= 0) {
      return _renderIndex(
        back(),
        errorHtml: '金額必須大於 0，最多兩位小數。',
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }

    final DateTime paidAt = parseDate(paidAtRaw);

    // 1. 先預覽（不寫入）。
    final SettlementPreview preview;
    try {
      preview = _settlement.preview(
        loanId: loanId,
        seqs: seqs,
        amountCents: amountCents,
        paidAt: paidAt,
      );
    } on SettlementRejected catch (e) {
      return _renderIndex(
        back(),
        errorHtml: escapeHtml(e.message),
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }

    if (!preview.canPost) {
      return _renderIndex(
        back(),
        errorHtml: escapeHtml(preview.blocked!),
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }

    // 2. 溢繳：先把去向講清楚，確認才寫（同一個 op_id 帶回來）。
    if (preview.isOverpayment && !ack) {
      return _renderIndex(
        back(),
        ackPreview: preview,
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }

    // 3. 寫入。
    try {
      final result = _settlement.post(
        opId: opId,
        operatorId: operatorId,
        loanId: loanId,
        seqs: seqs,
        amountCents: amountCents,
        paidAt: paidAt,
        overpayAck: ack,
      );
      final String msg = result.replayed
          ? '這筆已經入過帳了（同一次送出只會成立一次），沒有重複寫入。'
          : '已入帳 ${formatMoney(result.amountCents)}：'
                '沖罰息 ${formatMoney(result.penaltyCents)}、'
                '沖利息 ${formatMoney(result.interestCents)}、'
                '沖本金 ${formatMoney(result.principalCents)}'
                '${result.overpaymentCents > 0 ? '，溢繳 ${formatMoney(result.overpaymentCents)} 已記為負向調整分錄' : ''}。';
      return await _renderIndex(back(), successHtml: escapeHtml(msg));
    } on SettlementRejected catch (e) {
      return _renderIndex(
        back(),
        errorHtml: escapeHtml(e.message),
        forcedOpId: opId,
        amountValue: amountRaw,
        checkedSeqs: seqs.toSet(),
      );
    }
  }

  static String? _blankToNull(String? value) =>
      (value == null || value.trim().isEmpty) ? null : value.trim();

  /// `application/x-www-form-urlencoded`，同名欄位（勾選的期別）會有多個值。
  static Map<String, List<String>> _parseForm(String body) {
    final result = <String, List<String>>{};
    for (final pair in body.split('&')) {
      if (pair.isEmpty) continue;
      final int i = pair.indexOf('=');
      final String key = Uri.decodeQueryComponent(i < 0 ? pair : pair.substring(0, i));
      final String value =
          i < 0 ? '' : Uri.decodeQueryComponent(pair.substring(i + 1));
      result.putIfAbsent(key, () => <String>[]).add(value);
    }
    return result;
  }
}
