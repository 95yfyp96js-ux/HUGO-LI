import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/loan_repository.dart';
import '../providers/app_providers.dart';
import 'format.dart';

/// 記一筆還款（已繳／部分／提前／逾期由引擎依瀑布結果自動判定，見
/// docs/interest-rules.md §6、docs/state-machines.md §2）。
///
/// 兩件事在這裡被強制：
/// 1. 金額**預設帶入本期應繳的精確分值**，另有逾期合計／一次結清快捷。使用者
///    永遠不需要照畫面上被截去分的數字自己敲。
/// 2. 實收大於應付時，**先跳出溢繳說明對話框**講清楚多少錢、去哪裡，確認才
///    入帳。禁止默默寫分錄。
Future<void> showRecordPaymentDialog(
  BuildContext context,
  WidgetRef ref,
  String loanId,
) async {
  final repo = ref.read(loanRepositoryProvider);
  final PaymentSuggestion suggestion = await repo.paymentSuggestion(loanId);

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

          Future<void> submit() async {
            final int? cents = parseAmountToCents(amountCtrl.text);
            if (cents == null || cents <= 0) {
              setState(() => error = '請輸入大於 0 的金額，最多兩位小數');
              return;
            }

            // 入帳前先算一次：會不會溢繳、會不會動到未到期的期別。
            final preview = await repo.previewPayment(
              loanId: loanId,
              amountCents: cents,
              paidAt: paidAt,
            );

            if (preview.isOverpayment || preview.isPrepayment) {
              if (!dialogContext.mounted) return;
              final confirmed = await showDialog<bool>(
                context: dialogContext,
                builder: (ctx) => _OverpaymentConfirmDialog(preview: preview),
              );
              if (confirmed != true) return;
            }

            await repo.recordPayment(
              loanId: loanId,
              amountCents: cents,
              paidAt: paidAt,
              note: noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
            );
            ref.invalidate(dashboardSnapshotProvider);
            if (dialogContext.mounted) Navigator.pop(dialogContext);
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
              FilledButton(onPressed: submit, child: const Text('確認入帳')),
            ],
          );
        },
      );
    },
  );
}

/// 溢繳／提前還本的事前說明。使用者必須看過金額與去向才能入帳。
class _OverpaymentConfirmDialog extends StatelessWidget {
  const _OverpaymentConfirmDialog({required this.preview});

  final PaymentPreview preview;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(preview.isOverpayment ? '這筆錢超過應繳金額' : '這筆錢會提前還本'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _row('本次收款', formatMoney(preview.amountCents)),
          if (preview.penaltyCents > 0)
            _row('沖罰息', formatMoney(preview.penaltyCents)),
          _row('沖利息', formatMoney(preview.interestCents)),
          _row('沖本金', formatMoney(preview.principalCents)),
          const Divider(),
          if (preview.isPrepayment)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                '這筆錢除了本期以外，還會往後沖銷 '
                '${preview.futurePeriodsBeyondCurrent} 期尚未到期的期別，'
                '依規則視為提前還本。',
              ),
            ),
          if (preview.isOverpayment)
            Text(
              '沖完全部未繳期別後仍多出 ${formatMoney(preview.overpaymentCents)}。'
              '這筆錢會記成一筆負向調整分錄（溢繳）待人工處理，'
              '目前版本沒有自動退款流程。',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('回去改金額'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('了解，確認入帳'),
        ),
      ],
    );
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [Text(label), Text(value)],
    ),
  );
}
