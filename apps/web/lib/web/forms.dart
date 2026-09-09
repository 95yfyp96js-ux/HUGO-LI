import 'package:sqlite3/sqlite3.dart';

import '../domain/auth.dart';
import '../domain/model.dart';
import '../money.dart';
import 'chrome.dart';

/// 其餘 7 個按鈕的畫面。每一頁的規矩都一樣：
/// * `op_id` 在 GET 組表單時就發，跟著這一份表單走完（雙擊只成立一次）。
/// * 金額欄位一律讓使用者打「元.分」，由伺服器解析，前端不算。
/// * 存不下去時，錯誤訊息要說「哪一筆、差多少、下一步做什麼」，而且**不清空
///   已填的內容**。
class Field {
  const Field(this.name, this.label, {this.type = 'text', this.hint = ''});
  final String name;
  final String label;
  final String type;
  final String hint;
}

String _input(Field f, Map<String, String> values) {
  final String v = escapeHtml(values[f.name] ?? '');
  return '<label for="${f.name}">${escapeHtml(f.label)}</label>'
      '<input id="${f.name}" name="${f.name}" type="${f.type}" '
      '${f.type == 'text' ? 'inputmode="text" ' : ''}value="$v" '
      '${f.hint.isEmpty ? '' : 'placeholder="${escapeHtml(f.hint)}"'}>';
}

String _money(Field f, Map<String, String> values) {
  final String v = escapeHtml(values[f.name] ?? '');
  return '<label for="${f.name}">${escapeHtml(f.label)}</label>'
      '<input id="${f.name}" name="${f.name}" type="text" inputmode="decimal" '
      'value="$v" placeholder="0.00">';
}

String _select(
  String name,
  String label,
  List<({String value, String text})> options,
  String? selected,
) {
  final buffer = StringBuffer('<label for="$name">${escapeHtml(label)}</label>');
  buffer.write('<select id="$name" name="$name">');
  buffer.write('<option value="">— 請選擇 —</option>');
  for (final o in options) {
    buffer.write(
      '<option value="${escapeHtml(o.value)}"'
      '${o.value == selected ? ' selected' : ''}>${escapeHtml(o.text)}</option>',
    );
  }
  buffer.write('</select>');
  return buffer.toString();
}

String _form(String action, String opId, String inner, String submit) =>
    '<form method="post" action="$action">'
    '<input type="hidden" name="op_id" value="${escapeHtml(opId)}">'
    '$inner<button type="submit">${escapeHtml(submit)}</button></form>';

// ------------------------------------------------------------------ 1 新增客戶

String customerForm({
  required String opId,
  required Map<String, String> v,
  String? error,
  String? success,
}) =>
    card(
      '<h2>1 新增客戶</h2>'
      '${banner(error, bad: true)}${banner(success, bad: false)}'
      '${_form('/customers/new', opId, '${_input(const Field('name', '姓名 *'), v)}'
          '${_input(const Field('id_number', '身分證字號 *'), v)}'
          '${_input(const Field('phone', '電話'), v)}'
          '<p class="muted">證號只存末四碼與雜湊供查重，畫面與匯出一律遮罩，'
          '完整值不會出現在網址或錯誤訊息裡。</p>', '儲存')}',
    );

// ------------------------------------------------------------------ 2 新增借款

const List<({String value, String text})> methodOptions = [
  (value: 'emi', text: '等額本息（EMI）'),
  (value: 'epp', text: '等額本金（EPP）'),
  (value: 'io', text: '只繳息、到期還本（IO）'),
  (value: 'bullet', text: '一次本息（BULLET）'),
];
const List<({String value, String text})> rateTypeOptions = [
  (value: 'monthly', text: '月利率'),
  (value: 'annual', text: '年利率'),
  (value: 'daily', text: '日利率'),
  (value: 'period', text: '每期利率'),
];
const List<({String value, String text})> dayCountOptions = [
  (value: 'thirty360', text: '30/360'),
  (value: 'act365', text: 'ACT/365'),
  (value: 'act360', text: 'ACT/360'),
];

String loanForm({
  required String opId,
  required List<({String id, String name, String last4})> customers,
  required Map<String, String> v,
  String? error,
  String? success,
}) {
  final inner = StringBuffer();
  inner.write(
    _select(
      'customer_id',
      '客戶 *',
      [
        for (final c in customers)
          (value: c.id, text: '${c.name}（****${c.last4}）'),
      ],
      v['customer_id'],
    ),
  );
  inner.write(_money(const Field('principal', '貸款本金（元）*'), v));
  inner.write(_select('method', '還款方式 *', methodOptions, v['method'] ?? 'emi'));
  inner.write(
    _select('rate_type', '利率類型 *', rateTypeOptions, v['rate_type'] ?? 'monthly'),
  );
  inner.write(_input(const Field('rate_bps', '利率（基點，100 = 1%）*'), v));
  inner.write(
    _select(
      'day_count',
      '日數基礎 *',
      dayCountOptions,
      v['day_count'] ?? 'thirty360',
    ),
  );
  inner.write(_input(const Field('tenor', '期數 *'), v));
  inner.write(_input(const Field('period_days', '每期天數（預設 30）'), v));
  inner.write(_input(const Field('grace_days', '寬限天數（預設 3）'), v));
  inner.write(
    '<label><input type="checkbox" name="penalty" value="1"'
    '${v['penalty'] == '1' ? ' checked' : ''}> 啟用罰息（年息 6%、ACT/365）</label>',
  );
  inner.write(
    '<p class="muted">建約 ≠ 撥付。按下去只會產生還款計畫，'
    '不寫任何分錄、不計息，活盤也不會動；要按「3 確認撥付」才開始算。</p>',
  );
  return card(
    '<h2>2 新增借款</h2>${banner(error, bad: true)}${banner(success, bad: false)}'
    '${_form('/loans/new', opId, inner.toString(), '建立貸款（建約）')}',
  );
}

// ------------------------------------------------------------------ 3 確認撥付

String disburseForm({
  required String opId,
  required List<({String id, String text})> loans,
  required Map<String, String> v,
  String? error,
  String? success,
}) {
  final inner = StringBuffer();
  inner.write(
    _select(
      'loan_id',
      '哪一筆借款 *',
      [for (final l in loans) (value: l.id, text: l.text)],
      v['loan_id'],
    ),
  );
  inner.write(
    _input(const Field('disbursed_at', '實際撥付日 *', type: 'date'), v),
  );
  inner.write(
    '<p class="muted">可以補登過去的日期（錢早就借出去、現在才建檔），'
    '<b>但不可以選未來</b>。撥付日一旦確認就鎖住，之後只能開更正單。</p>',
  );
  return card(
    '<h2>3 確認撥付</h2>${banner(error, bad: true)}${banner(success, bad: false)}'
    '${_form('/loans/disburse', opId, inner.toString(), '確認撥付')}',
  );
}

// ------------------------------------------------------------------ 4 收票

String checkForm({
  required String opId,
  required List<({String id, String name, String last4})> customers,
  required Map<String, String> v,
  String? error,
  String? success,
}) {
  final inner = StringBuffer();
  inner.write(
    _select(
      'customer_id',
      '客戶 *',
      [
        for (final c in customers)
          (value: c.id, text: '${c.name}（****${c.last4}）'),
      ],
      v['customer_id'],
    ),
  );
  inner.write(_input(const Field('bank_code', '行庫代號 *', hint: '004'), v));
  inner.write(_input(const Field('check_no', '票號 *'), v));
  inner.write(_money(const Field('face', '票面（元）*'), v));
  inner.write(_money(const Field('discount', '貼現息（元）*'), v));
  inner.write(_money(const Field('other_fee', '其他費用（元）'), v));
  inner.write(_money(const Field('cash_paid', '實付（元）*'), v));
  inner.write(_input(const Field('due_date', '到期日 *', type: 'date'), v));
  inner.write(
    _input(const Field('received_date', '收票日 *', type: 'date'), v),
  );
  inner.write(
    '<p class="muted">恆等式：<b>實付 = 票面 − 貼現息 − 其他費用</b>。'
    '不相符就存不下去，訊息會直接寫出差多少。票號存完整、畫面只顯示末四碼。</p>',
  );
  return card(
    '<h2>4 收票（貼現）</h2>${banner(error, bad: true)}${banner(success, bad: false)}'
    '${_form('/checks/new', opId, inner.toString(), '收票')}',
  );
}

// ------------------------------------------------------------ 5 兌現 / 6 退票

String checkOptions(List<CheckState> checks, String? selected, String Function(String) nameOf) => [
  for (final c in checks)
    (
      value: c.id,
      text:
          '${nameOf(c.id)} · ${c.bankCode} ${c.maskedCheckNo} · '
          '未收 ${formatMoney(c.outstandingFaceCents)} · 到期 ${formatDate(c.dueDate)}',
    ),
].map((o) => '<option value="${escapeHtml(o.value)}"'
    '${o.value == selected ? ' selected' : ''}>${escapeHtml(o.text)}</option>').join();

String cashForm({
  required String opId,
  required List<CheckState> held,
  required String Function(String) nameOf,
  required Map<String, String> v,
  String? error,
  String? success,
}) {
  final inner = StringBuffer();
  inner.write('<label for="check_id">哪一張票 *</label>');
  inner.write(
    '<select id="check_id" name="check_id"><option value="">— 請選擇 —</option>'
    '${checkOptions(held, v['check_id'], nameOf)}</select>',
  );
  inner.write(_money(const Field('received', '實收（元）*'), v));
  inner.write(_input(const Field('cashed_at', '兌現日 *', type: 'date'), v));
  inner.write(
    _select(
      'diff_reason',
      '差額原因（實收 ≠ 票面時必選）',
      const [
        (value: '手續費', text: '手續費'),
        (value: '部分兌現', text: '部分兌現'),
        (value: '其他', text: '其他'),
      ],
      v['diff_reason'],
    ),
  );
  inner.write(
    '<p class="muted"><b>部分兌現不會把票變成「已兌現」</b>：狀態維持持有、'
    '只累加已收金額，剩下的票面仍留在活盤格 2；到期日過了就變成'
    '「已到期未處理」並進紅字清單。</p>',
  );
  return card(
    '<h2>5 票兌現並核銷</h2>${banner(error, bad: true)}${banner(success, bad: false)}'
    '${_form('/checks/cash', opId, inner.toString(), '確認兌現')}',
  );
}

String bounceForm({
  required String opId,
  required List<CheckState> held,
  required String Function(String) nameOf,
  required Map<String, String> v,
  String? error,
  String? success,
}) {
  final inner = StringBuffer();
  inner.write('<label for="check_id">哪一張票 *</label>');
  inner.write(
    '<select id="check_id" name="check_id"><option value="">— 請選擇 —</option>'
    '${checkOptions(held, v['check_id'], nameOf)}</select>',
  );
  inner.write(_money(const Field('recourse', '追償金額（元）*'), v));
  inner.write(_input(const Field('bounced_at', '退票日 *', type: 'date'), v));
  inner.write(_input(const Field('reason', '改動原因（追償金額 ≠ 未收票面時必填）'), v));
  inner.write(
    '<p class="muted">追償金額預設等於未收票面。改了就必須留原因，'
    '原因會寫進流水。退票不會刪掉原本的收票紀錄——收票、退票是兩筆事件。</p>',
  );
  return card(
    '<h2>6 票退票並轉追償</h2>${banner(error, bad: true)}${banner(success, bad: false)}'
    '${_form('/checks/bounce', opId, inner.toString(), '確認退票並轉追償')}',
  );
}

// ------------------------------------------------------------------ 7 今日流水

String todayPanel({
  required List<Row> rows,
  required DateTime date,
  required bool all,
  required String Function(Row) describe,
}) {
  final buffer = StringBuffer(
    '<h2>${all ? '今日流水（全部人）' : '今日流水（我登的）'}</h2>'
    '<p class="muted">${formatDate(date)}</p>',
  );
  if (rows.isEmpty) {
    buffer.write('<p class="muted">今天還沒有任何紀錄。</p>');
    return card(buffer.toString());
  }
  buffer.write(
    '<table><tr><th>時間</th><th>動作</th><th>對象</th><th class="num">金額</th></tr>',
  );
  for (final row in rows) {
    final String posted = (row['posted_at'] as String).substring(11, 16);
    buffer.write(
      '<tr><td>$posted</td>${describe(row)}'
      '<td class="num">${formatMoney(row['amount_cents'] as int)}</td></tr>',
    );
  }
  buffer.write('</table>');
  buffer.write('<p class="muted">共 ${rows.length} 筆。分錄只會新增，不會被改寫。</p>');
  return card(buffer.toString());
}

// ------------------------------------------------------------------ 首頁按鈕

String buttonGrid(User user) => card(
  '<h2>今天要做的事</h2><div class="grid8">'
  '<a href="/customers/new"><span class="n">1</span>新增客戶</a>'
  '<a href="/loans/new"><span class="n">2</span>新增借款</a>'
  '<a href="/loans/disburse"><span class="n">3</span>確認撥付</a>'
  '<a href="/checks/new"><span class="n">4</span>收票（貼現）</a>'
  '<a href="/settle"><span class="n">5</span>收款並核銷</a>'
  '<a href="/checks/cash"><span class="n">6</span>票兌現並核銷</a>'
  '<a href="/checks/bounce"><span class="n">7</span>票退票並轉追償</a>'
  '<a href="/today"><span class="n">8</span>看今日流水</a>'
  '</div>'
  '<p class="muted">就這 8 個。沒有第 9 個按鈕。'
  '${user.isBoss ? '日結與認證在上方「日結」。' : '日結與認證只有老闆能按。'}</p>',
);

// ------------------------------------------------------------------ 登入

String loginPage({String? error, String username = ''}) => card(
  '<h2>登入</h2>${banner(error, bad: true)}'
  '<form method="post" action="/login">'
  '<label for="u">帳號</label>'
  '<input id="u" name="username" type="text" autocapitalize="none" '
  'autocomplete="username" value="${escapeHtml(username)}">'
  '<label for="p">密碼</label>'
  '<input id="p" name="password" type="password" autocomplete="current-password">'
  '<button type="submit">登入</button></form>'
  '<p class="muted">每人一組帳號，不要共用。'
  '帳號一被停用，手上開著的分頁下一個動作就會被踢出去。</p>',
);
