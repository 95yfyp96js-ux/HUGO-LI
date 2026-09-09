import '../db/app_database.dart';
import 'schedule_item_math.dart';

/// 單筆貸款的 CSV 匯出（計畫表＋實收＋分錄），給封測者跟紙本對帳用。
///
/// **不含未遮罩的身分證字號**：CSV 會被丟進 Excel、寄來寄去，個資不能跟著跑。
/// 借款人只放姓名與遮罩後的證號。金額一律以「元.分」輸出，不做四捨五入。
String buildLoanCsv({
  required Loan loan,
  required String borrowerName,
  required String maskedIdNumber,
  required List<ScheduleItem> schedule,
  required List<Payment> payments,
  required List<LedgerEntryRow> ledger,
}) {
  final buffer = StringBuffer();

  void section(String title) {
    buffer.writeln();
    buffer.writeln('# $title');
  }

  void row(List<Object?> cells) {
    buffer.writeln(cells.map(_csvCell).join(','));
  }

  buffer.writeln('# 貸款基本資料');
  row(['項目', '內容']);
  row(['貸款編號', loan.id]);
  row(['借款人', borrowerName]);
  row(['身分證字號', maskedIdNumber]); // 已遮罩
  row(['本金', _money(loan.principalCents)]);
  row(['還款方式', loan.method]);
  row(['利率類型', loan.rateType]);
  row(['利率(基點)', loan.rateBps]);
  row(['日數基礎', loan.dayCount]);
  row(['期數', loan.tenorPeriods]);
  row(['每期天數', loan.periodDays]);
  row(['寬限天數', loan.graceDays]);
  row(['罰息', loan.penaltyEnabled ? '啟用' : '未啟用']);
  row(['狀態', loan.status]);
  row(['撥款日', _date(loan.disbursedAt)]);
  row(['規則版本', loan.ruleVersion]);

  section('還款計畫');
  row(['期別', '到期日', '期初餘額', '本金', '利息', '應繳合計', '已繳', '尚差', '期末餘額', '狀態']);
  for (final item in schedule) {
    row([
      item.periodNumber,
      _date(item.dueDate),
      _money(item.openingBalanceCents),
      _money(item.principalCents),
      _money(item.interestCents),
      _money(item.totalDueCents),
      _money(item.paidCents),
      _money(item.shortfallCents),
      _money(item.closingBalanceCents),
      item.status,
    ]);
  }

  section('實收紀錄');
  row(['繳款日', '金額', '備註']);
  for (final payment in payments) {
    row([
      _date(payment.paidAt),
      _money(payment.amountCents),
      payment.note ?? '',
    ]);
  }

  section('分錄（append-only）');
  row(['入帳日', '類型', '金額', '對應期別', '備註']);
  for (final entry in ledger) {
    row([
      _date(entry.postedAt),
      entry.type,
      _money(entry.amountCents),
      entry.relatedPeriodNumber ?? '',
      entry.note ?? '',
    ]);
  }

  return buffer.toString();
}

String _money(int cents) {
  final String sign = cents < 0 ? '-' : '';
  final int abs = cents.abs();
  return '$sign${abs ~/ 100}.${(abs % 100).toString().padLeft(2, '0')}';
}

String _date(DateTime? date) {
  if (date == null) return '';
  return '${date.year}-${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';
}

/// CSV 逸出：含逗號、引號或換行的欄位要用雙引號包起來。
String _csvCell(Object? value) {
  final String text = value?.toString() ?? '';
  if (text.contains(RegExp(r'[",\n\r]'))) {
    return '"${text.replaceAll('"', '""')}"';
  }
  return text;
}
