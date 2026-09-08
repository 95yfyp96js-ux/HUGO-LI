import 'package:ledger/ledger.dart';
import 'package:test/test.dart';

LedgerEntry _entry(String id, {String loanId = 'L1', int amount = 100}) =>
    LedgerEntry(
      id: id,
      loanId: loanId,
      type: LedgerEntryType.disbursement,
      amountCents: amount,
      postedAt: DateTime(2026, 1, 1),
    );

void main() {
  group('LedgerBook（append-only）', () {
    test('append 回傳新物件，舊物件內容不變', () {
      const empty = LedgerBook.empty();
      final withOne = empty.append(_entry('e1'));

      expect(empty.entries, isEmpty);
      expect(withOne.entries, hasLength(1));
      expect(withOne.entries.single.id, 'e1');
    });

    test('appendAll 依序累加，不覆蓋既有分錄', () {
      const empty = LedgerBook.empty();
      final book =
          empty.append(_entry('e1')).appendAll([_entry('e2'), _entry('e3')]);
      expect(book.entries.map((e) => e.id), ['e1', 'e2', 'e3']);
    });

    test('entries 為唯讀 List，無法從外部修改帳本', () {
      final book = const LedgerBook.empty().append(_entry('e1'));
      expect(() => book.entries.add(_entry('e2')), throwsUnsupportedError);
    });

    test('entriesForLoan 只回傳指定貸款的分錄', () {
      final book = const LedgerBook.empty().appendAll([
        _entry('e1', loanId: 'A'),
        _entry('e2', loanId: 'B'),
        _entry('e3', loanId: 'A'),
      ]);
      expect(book.entriesForLoan('A').map((e) => e.id), ['e1', 'e3']);
    });

    test('非 adjustment 分錄金額不可為負', () {
      expect(
        () => LedgerEntry(
          id: 'bad',
          loanId: 'A',
          type: LedgerEntryType.principal,
          amountCents: -1,
          postedAt: DateTime(2026, 1, 1),
        ),
        throwsA(isA<AssertionError>()),
      );
    });

    test('adjustment 分錄允許負金額（沖正）', () {
      final entry = LedgerEntry(
        id: 'adj1',
        loanId: 'A',
        type: LedgerEntryType.adjustment,
        amountCents: -500,
        postedAt: DateTime(2026, 1, 1),
      );
      expect(entry.amountCents, -500);
    });
  });
}
