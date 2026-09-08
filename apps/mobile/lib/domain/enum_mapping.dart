import 'package:ledger/ledger.dart' as ledger;
import 'package:lending_engine/lending_engine.dart' as engine;

import '../db/app_database.dart';

/// Drift 只存 enum 的 `.name`（字串），這裡集中做雙向轉換，避免各 repository
/// 各自重複 switch。

engine.RepaymentMethod parseRepaymentMethod(String value) =>
    engine.RepaymentMethod.values.byName(value);

engine.RateType parseRateType(String value) =>
    engine.RateType.values.byName(value);

engine.DayCount parseDayCount(String value) =>
    engine.DayCount.values.byName(value);

engine.LoanStatus parseLoanStatus(String value) =>
    engine.LoanStatus.values.byName(value);

engine.ScheduleItemStatus parseScheduleItemStatus(String value) =>
    engine.ScheduleItemStatus.values.byName(value);

ledger.LedgerEntryType parseLedgerEntryType(String value) =>
    ledger.LedgerEntryType.values.byName(value);

/// 把 Drift 的 `LedgerEntryRow`（DB 列）轉成 `package:ledger` 的
/// `LedgerEntry`（純值物件），供 `replayLoan` / `computeDashboard` 使用。
ledger.LedgerEntry mapLedgerEntryRow(LedgerEntryRow row) => ledger.LedgerEntry(
  id: row.id,
  loanId: row.loanId,
  type: parseLedgerEntryType(row.type),
  amountCents: row.amountCents,
  postedAt: row.postedAt,
  relatedPeriodNumber: row.relatedPeriodNumber,
  note: row.note,
);
