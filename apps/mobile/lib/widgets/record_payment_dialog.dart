import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/loan_repository.dart';
import '../providers/app_providers.dart';
import 'format.dart';

/// 記一筆還款（已繳／部分／提前／逾期由引擎依瀑布結果自動判定，見
/// docs/interest-rules.md §6、docs/state-machines.md §2）。
///
/// 金額**預設帶入本期應繳的精確分值**，並提供逾期合計／一次結清兩個快捷。
/// 使用者永遠不需要照畫面上被截去分的數字自己敲——那正是帳不平的來源。
Future<void> showRecordPaymentDialog(
  BuildContext context,
  WidgetRef ref,
  String loanId,
) async {
  final PaymentSuggestion suggestion = await ref
      .read(loanRepositoryProvider)
      .paymentSuggestion(loanId);

  if (!context.mounted) return;

  final amountCtrl = TextEditingController(
    text: suggestion.currentDueCents > 0
        ? centsToInput(suggestion.currentDueCents)
        : '',
  );
  final noteCtrl = TextEditingController();
  DateTime paidAt = DateTime.now();
  String? error;

  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return StatefulBuilder(
        builder: (dialogContext, setState) {
          void fill(int cents) {
            amountCtrl.text = centsToInput(cents);
            setState(() => error = null);
          }

          return AlertDialog(
            title: const Text('記一筆還款'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: amountCtrl,
                    autofocus: true,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: '繳款金額（元，可到小數兩位）',
                      errorText: error,
                      helperText:
                          '本期應繳 ${formatMoney(suggestion.currentDueCents)}',
                    ),
                    onChanged: (_) {
                      if (error != null) setState(() => error = null);
                    },
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      if (suggestion.currentDueCents > 0)
                        ActionChip(
                          label: Text(
                            '本期 ${formatMoney(suggestion.currentDueCents)}',
                          ),
                          onPressed: () => fill(suggestion.currentDueCents),
                        ),
                      if (suggestion.overdueCents > 0)
                        ActionChip(
                          label: Text(
                            '逾期合計 ${formatMoney(suggestion.overdueCents)}',
                          ),
                          onPressed: () => fill(suggestion.overdueCents),
                        ),
                      if (suggestion.payoffCents > 0)
                        ActionChip(
                          label: Text(
                            '一次結清 ${formatMoney(suggestion.payoffCents)}',
                          ),
                          onPressed: () => fill(suggestion.payoffCents),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: noteCtrl,
                    decoration: const InputDecoration(labelText: '備註（選填）'),
                  ),
                  const SizedBox(height: 12),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('繳款日期'),
                    subtitle: Text(formatDate(paidAt)),
                    trailing: const Icon(Icons.calendar_month),
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: dialogContext,
                        initialDate: paidAt,
                        firstDate: DateTime.now().subtract(
                          const Duration(days: 3650),
                        ),
                        lastDate: DateTime.now().add(
                          const Duration(days: 3650),
                        ),
                      );
                      if (picked != null) setState(() => paidAt = picked);
                    },
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () async {
                  final int? cents = parseAmountToCents(amountCtrl.text);
                  if (cents == null || cents <= 0) {
                    setState(() => error = '請輸入大於 0 的金額，最多兩位小數');
                    return;
                  }
                  await ref
                      .read(loanRepositoryProvider)
                      .recordPayment(
                        loanId: loanId,
                        amountCents: cents,
                        paidAt: paidAt,
                        note: noteCtrl.text.trim().isEmpty
                            ? null
                            : noteCtrl.text.trim(),
                      );
                  ref.invalidate(dashboardSnapshotProvider);
                  if (dialogContext.mounted) Navigator.pop(dialogContext);
                },
                child: const Text('確認入帳'),
              ),
            ],
          );
        },
      );
    },
  );
}
