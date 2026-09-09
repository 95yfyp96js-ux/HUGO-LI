import '../domain/daily_close.dart';
import '../money.dart';
import 'chrome.dart';

/// 日結一張表（docs/BOSS-SPEC.md E、F）。四關全部只有老闆能按。
String closeSheet({
  required DailyCloseSheet s,
  String? error,
  String? success,
}) {
  final b = StringBuffer('<h2>日結 · ${formatDate(s.businessDate)}</h2>');
  b.write(banner(error, bad: true));
  b.write(banner(success, bad: false));

  // 四關進度
  b.write('<div class="stage">');
  b.write('<span class="${s.isReviewed ? 'done' : ''}">核定</span>');
  b.write('<span class="${s.unreconciled.isEmpty ? 'done' : ''}">核銷檢查</span>');
  b.write('<span class="${s.isConfirmed ? 'done' : ''}">確認</span>');
  b.write('<span class="${s.isCertified ? 'lock' : ''}">認證${s.isCertified ? '（已鎖帳）' : ''}</span>');
  b.write('</div>');

  if (s.isCertified) {
    b.write(
      '<div class="banner ok"><b>${formatDate(s.businessDate)} 已認證鎖帳。</b>'
      '這一天（含之前）任何寫入都會被擋掉——收款、收票、兌現、退票、補登撥付都不行。'
      '要更正只能開更正單（本版尚未提供）。</div>',
    );
  }

  // 不能認證的理由
  if (s.blockers.isNotEmpty) {
    b.write('<div class="banner bad"><b>這一天不能認證：</b><ul>');
    for (final blocker in s.blockers) {
      b.write(
        '<li>${escapeHtml(blocker.reason)}'
        '${blocker.detail.isEmpty ? '' : '<br><span class="muted">${escapeHtml(blocker.detail)}</span>'}</li>',
      );
    }
    b.write('</ul></div>');
  }

  // 未核銷紅字（可以核定，但認證前一定看得到）
  if (s.unreconciled.isNotEmpty) {
    b.write(
      '<div class="banner bad"><b>今日有 ${s.unreconciled.length} 筆到期項未核銷，'
      '認證後這些項目會留到明天。</b></div>',
    );
  }

  String row(String label, int open, int close) =>
      '<tr><td>${escapeHtml(label)}</td>'
      '<td class="num">${formatMoney(open)}</td>'
      '<td class="num">${formatMoney(close)}</td></tr>';

  b.write('<h3>五格：期初 → 期末</h3>');
  b.write('<table><tr><th>格</th><th class="num">期初</th><th class="num">期末</th></tr>');
  b.write(row('1 在外借款本金', s.opening.outstandingPrincipal, s.closing.outstandingPrincipal));
  b.write(row('2 持有票面合計', s.opening.heldFaceTotal, s.closing.heldFaceTotal));
  b.write(row('　其中未到期', s.opening.heldFaceNotDue, s.closing.heldFaceNotDue));
  b.write(row('　其中已到期未處理', s.opening.heldFaceOverdueUnhandled, s.closing.heldFaceOverdueUnhandled));
  b.write(row('3 今日應收', s.opening.dueToday, s.closing.dueToday));
  b.write(row('4 今日已收', s.opening.receivedToday, s.closing.receivedToday));
  b.write(row('5 逾期＋追償', s.opening.overdueAndRecourse, s.closing.overdueAndRecourse));
  b.write('</table>');

  final m = s.movements;
  b.write('<h3>本期進出</h3><table>');
  b.write('<tr><td>放款</td><td class="num">${formatMoney(m.disbursed)}</td></tr>');
  b.write('<tr><td>收款（借款核銷）</td><td class="num">${formatMoney(m.loanCollected)}</td></tr>');
  b.write('<tr><td>收票實付（現金流出）</td><td class="num">${formatMoney(m.checkCashPaid)}</td></tr>');
  b.write('<tr><td>兌現（實收）</td><td class="num">${formatMoney(m.checkCashed)}</td></tr>');
  b.write('<tr><td>退票（轉追償）</td><td class="num">${formatMoney(m.checkBounced)}</td></tr>');
  b.write('</table>');

  b.write('<h3>不平項目</h3>');
  if (s.imbalances.isEmpty) {
    b.write('<p class="muted">沒有。現況與流水重放對得起來。</p>');
  } else {
    b.write(
      '<table class="redlist"><tr><th>格</th><th class="num">現況</th>'
      '<th class="num">重放</th><th class="num">差額</th></tr>',
    );
    for (final i in s.imbalances) {
      b.write(
        '<tr><td>${escapeHtml(i.box)}</td>'
        '<td class="num">${formatMoney(i.stateCents)}</td>'
        '<td class="num">${formatMoney(i.replayCents)}</td>'
        '<td class="num od">${formatMoney(i.diffCents)}</td></tr>',
      );
    }
    b.write('</table>');
  }

  b.write('<h3>今日未核銷的到期項</h3>');
  if (s.unreconciled.isEmpty) {
    b.write('<p class="muted">今天到期的項目都處理完了。</p>');
  } else {
    b.write(
      '<table class="redlist"><tr><th>類型</th><th>對象</th><th>到期日</th>'
      '<th class="num">金額</th></tr>',
    );
    for (final u in s.unreconciled) {
      b.write(
        '<tr><td>${escapeHtml(u.kind)}</td><td>${escapeHtml(u.label)}</td>'
        '<td>${formatDate(u.dueDate)}</td>'
        '<td class="num od">${formatMoney(u.amountCents)}</td></tr>',
      );
    }
    b.write('</table>');
  }

  // 四關按鈕
  if (!s.isCertified) {
    final String date = formatDate(s.businessDate);
    String stageForm(String action, String label, {required bool enabled, String cls = ''}) =>
        '<form method="post" action="/close/$action">'
        '<input type="hidden" name="date" value="$date">'
        '<button class="$cls" type="submit"${enabled ? '' : ' disabled'}>'
        '${escapeHtml(label)}</button></form>';

    b.write('<h3>四關（只有老闆能按）</h3>');
    b.write(stageForm('review', s.isReviewed ? '已核定' : '核定：這張日結我看過', enabled: !s.isReviewed));
    b.write(stageForm(
      'confirm',
      s.isConfirmed ? '已確認' : '確認：盤我對過',
      enabled: s.isReviewed && !s.isConfirmed,
      cls: 'ghost',
    ));
    b.write(stageForm(
      'certify',
      s.canCertify ? '認證並鎖帳（不可逆）' : '認證（尚不可按）',
      enabled: s.canCertify,
      cls: 'warn',
    ));
    if (!s.canCertify && s.isConfirmed && s.blockers.isNotEmpty) {
      b.write('<p class="muted">上面的「不能認證」清單清空之前，認證按鈕不會亮。</p>');
    }
  }

  b.write(
    '<p class="muted">週報／月報 = 該區間<b>已認證日結</b>的加總，'
    '沒有第二套月結引擎（本版尚未做報表畫面）。</p>',
  );
  return card(b.toString());
}
