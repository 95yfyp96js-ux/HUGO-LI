import 'package:meta/meta.dart';

import 'ledger_entry.dart';

/// Append-only 分錄簿。不變式（見 docs/interest-rules.md §不變式）：
/// - 只能用 [append] / [appendAll] 新增分錄。
/// - 沒有任何刪除或修改既有分錄的方法；型別系統本身就禁止改帳。
/// - 每次 [append] 回傳新的 [LedgerBook]（immutable value type），舊物件
///   的 [entries] 內容永遠不變。
@immutable
class LedgerBook {
  const LedgerBook._(List<LedgerEntry> entries) : _entries = entries;

  const LedgerBook.empty() : _entries = const [];

  factory LedgerBook.fromEntries(Iterable<LedgerEntry> entries) =>
      LedgerBook._(List.unmodifiable(entries));

  final List<LedgerEntry> _entries;

  /// 全部分錄（唯讀、依寫入順序）。
  List<LedgerEntry> get entries => _entries;

  LedgerBook append(LedgerEntry entry) =>
      LedgerBook._(List.unmodifiable([..._entries, entry]));

  LedgerBook appendAll(Iterable<LedgerEntry> newEntries) =>
      LedgerBook._(List.unmodifiable([..._entries, ...newEntries]));

  List<LedgerEntry> entriesForLoan(String loanId) =>
      _entries.where((e) => e.loanId == loanId).toList(growable: false);
}
