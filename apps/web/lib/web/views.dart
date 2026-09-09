import '../domain/board.dart';
import '../domain/settlement.dart';
import '../money.dart';
import 'chrome.dart';

/// 收款並核銷（左）與活盤（右）的畫面。版面與共用元件在 chrome.dart。

// --------------------------------------------------------------------- 左

String settleForm({
  required String opId,
  required List<LoanOption> loans,
  required String? selectedLoanId,
  required List<PeriodRow> periods,
  required String amountValue,
  required String paidAtValue,
  required Set<int> checkedSeqs,
  String? errorHtml,
  String? successHtml,
  SettlementPreview? ackPreview,
}) {
  final buffer = StringBuffer('<h2>收款並核銷</h2>');
  if (successHtml != null) buffer.write('<div class="banner ok">$successHtml</div>');
  if (errorHtml != null) buffer.write('<div class="banner bad">$errorHtml</div>');

  if (ackPreview != null) {
    buffer.write(_ackPanel(ackPreview, opId, paidAtValue, amountValue));
    return buffer.toString();
  }

  buffer.write('<form method="post" action="/settle">');
  buffer.write('<input type="hidden" name="op_id" value="${escapeHtml(opId)}">');

  buffer.write('<label for="loan">哪一筆借款 *</label>');
  buffer.write(
    '<select id="loan" name="loan_id" onchange="this.form.action=\'/\';'
    'this.form.method=\'get\';this.form.submit()">',
  );
  buffer.write('<option value="">— 請選擇 —</option>');
  for (final loan in loans) {
    final sel = loan.id == selectedLoanId ? ' selected' : '';
    buffer.write(
      '<option value="${escapeHtml(loan.id)}"$sel>${escapeHtml(loan.label)}</option>',
    );
  }
  buffer.write('</select>');

  if (selectedLoanId == null) {
    buffer.write('<p class="muted">選了借款之後，才會列出可以沖銷的期別。</p></form>');
    return buffer.toString();
  }

  buffer.write('<label>哪幾期 *（至少選一期，沒選期別的收款不能存）</label>');
  if (periods.isEmpty) {
    buffer.write('<p class="muted">這筆借款已經沒有未清期別了。</p>');
  } else {
    buffer.write('<div class="periods">');
    for (final p in periods) {
      final checked = checkedSeqs.contains(p.seq) ? ' checked' : '';
      buffer.write(
        '<label><input type="checkbox" name="seq" value="${p.seq}"$checked>'
        '<span>第 ${p.seq} 期<br><span class="muted">到期 ${escapeHtml(p.dueDate)}'
        '${p.overdue ? ' · <span class="od">逾期</span>' : ''}</span></span>'
        '<span class="amt">${escapeHtml(p.dueLabel)}'
        '${p.penaltyLabel == null ? '' : '<br><span class="muted">含罰息 ${escapeHtml(p.penaltyLabel!)}</span>'}'
        '</span></label>',
      );
    }
    buffer.write('</div>');
  }

  buffer.write(
    '<label for="amount">收款金額（元，可到小數兩位）*</label>'
    '<input id="amount" name="amount" type="text" inputmode="decimal" '
    'value="${escapeHtml(amountValue)}" placeholder="8884.88">',
  );
  buffer.write(
    '<label for="paid_at">收款日 *</label>'
    '<input id="paid_at" name="paid_at" type="date" value="${escapeHtml(paidAtValue)}">',
  );
  buffer.write('<button type="submit">確認入帳</button>');
  buffer.write(
    '<p class="muted">金額由伺服器依固定瀑布（罰息→費用→利息→本金）分配到分，'
    '瀏覽器不做任何計算。</p>',
  );
  buffer.write('</form>');
  return buffer.toString();
}

String _ackPanel(
  SettlementPreview p,
  String opId,
  String paidAtValue,
  String amountValue,
) {
  final rows = StringBuffer();
  void row(String k, int v) =>
      rows.write('<tr><td>$k</td><td class="num">${formatMoney(v)}</td></tr>');
  row('本次收款', p.amountCents);
  if (p.penaltyCents > 0) row('沖罰息', p.penaltyCents);
  if (p.feeCents > 0) row('沖費用', p.feeCents);
  row('沖利息', p.interestCents);
  row('沖本金', p.principalCents);

  final seqs = p.allocations.map((a) => a.seq).join('、');
  return '''
<div class="banner bad"><b>這筆錢超過應繳金額</b></div>
<table>$rows
<tr><td><b>沖完全部未繳期別後仍多出</b></td>
    <td class="num"><b>${formatMoney(p.overpaymentCents)}</b></td></tr></table>
<p class="muted">已沖銷第 $seqs 期。多出來的錢會記成一筆負向調整分錄（溢繳）
待人工處理，<b>目前版本沒有自動退款流程</b>。</p>
<form method="post" action="/settle">
  <input type="hidden" name="op_id" value="${escapeHtml(opId)}">
  <input type="hidden" name="loan_id" value="${escapeHtml(p.loan.id)}">
  <input type="hidden" name="amount" value="${escapeHtml(amountValue)}">
  <input type="hidden" name="paid_at" value="${escapeHtml(paidAtValue)}">
  ${p.allocations.map((a) => '<input type="hidden" name="seq" value="${a.seq}">').join()}
  <input type="hidden" name="overpay_ack" value="1">
  <button type="submit">了解，確認入帳</button>
</form>
<form method="get" action="/">
  <input type="hidden" name="loan_id" value="${escapeHtml(p.loan.id)}">
  <button class="ghost" type="submit">回去改金額</button>
</form>''';
}

/// 期別列（已經在伺服器格式化好，view 不做算術）。
class PeriodRow {
  const PeriodRow({
    required this.seq,
    required this.dueDate,
    required this.dueLabel,
    required this.overdue,
    this.penaltyLabel,
  });
  final int seq;
  final String dueDate;
  final String dueLabel;
  final bool overdue;
  final String? penaltyLabel;
}

// --------------------------------------------------------------------- 右

String boardPanel(BoardSnapshot snapshot) {
  final b = snapshot.state;
  final buffer = StringBuffer('<h2>活盤（${formatDate(snapshot.businessDate)}）</h2>');

  if (!snapshot.isBalanced) {
    final rows = snapshot.imbalances
        .map(
          (i) =>
              '<tr><td>${escapeHtml(i.box)}</td>'
              '<td class="num">${formatMoney(i.stateCents)}</td>'
              '<td class="num">${formatMoney(i.replayCents)}</td>'
              '<td class="num"><b>${formatMoney(i.diffCents)}</b></td></tr>',
        )
        .join();
    buffer.write(
      '<div class="banner bad"><b>盤不平</b>：現況與流水重放對不起來，'
      '下面的數字不可信，請立刻查。'
      '<table><tr><th>格</th><th class="num">現況</th>'
      '<th class="num">重放</th><th class="num">差額</th></tr>$rows</table></div>',
    );
  }

  String box(String title, int cents, {String sub = ''}) =>
      '<div class="box"><div class="t">${escapeHtml(title)}</div>'
      '<div class="v">${formatMoneyRounded(cents)}</div>'
      '<div class="sub">${formatMoney(cents)}$sub</div></div>';

  buffer.write('<div class="boxes">');
  buffer.write(box('1 在外借款本金', b.outstandingPrincipal));
  buffer.write(
    box(
      '2 持有票面合計',
      b.heldFaceTotal,
      sub: '<br>未到期 ${formatMoney(b.heldFaceNotDue)}'
          '<br>已到期未處理 <b>${formatMoney(b.heldFaceOverdueUnhandled)}</b>',
    ),
  );
  buffer.write(box('3 今日應收', b.dueToday));
  buffer.write(box('4 今日已收', b.receivedToday));
  buffer.write(box('5 逾期＋追償', b.overdueAndRecourse));
  buffer.write('</div>');
  buffer.write(
    '<p class="muted">格 2 含已到期未處理的持有票（G1 定案）；這些票'
    '<b>不</b>計入格 5，同一筆錢只放一格。</p>',
  );

  buffer.write('<h3>今日未核銷的到期項</h3>');
  if (snapshot.unreconciled.isEmpty) {
    buffer.write('<p class="muted">今天到期的項目都處理完了。</p>');
  } else {
    buffer.write(
      '<table class="redlist"><tr><th>類型</th><th>對象</th>'
      '<th>到期日</th><th class="num">未核銷金額</th></tr>',
    );
    for (final item in snapshot.unreconciled) {
      buffer.write(
        '<tr><td>${escapeHtml(item.kind)}</td>'
        '<td>${escapeHtml(item.label)}</td>'
        '<td>${formatDate(item.dueDate)}</td>'
        '<td class="num od">${formatMoney(item.amountCents)}</td></tr>',
      );
    }
    buffer.write('</table>');
    buffer.write(
      '<p class="muted">共 ${snapshot.unreconciled.length} 筆。'
      '這張清單非空時，日結認證畫面必須紅字警示（本輪未做日結畫面）。</p>',
    );
  }
  return buffer.toString();
}

/// 下拉選單的一列（標籤在 handler 就組好，view 不碰領域物件）。
class LoanOption {
  const LoanOption({required this.id, required this.label});
  final String id;
  final String label;
}
