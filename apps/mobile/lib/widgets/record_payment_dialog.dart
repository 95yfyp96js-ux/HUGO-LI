import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';

/// 記一筆還款（已繳／部分／提前／逾期由引擎依瀑布結果自動判定，見
/// docs/interest-rules.md §6、docs/state-machines.md §2）。
Future<void> showRecordPaymentDialog(
  BuildContext context,
  WidgetRef ref,
  String loanId,
) async {
  final amountCtrl = TextEditingController();
  final noteCtrl = TextEditingController();
  DateTime paidAt = DateTime.now();

  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return StatefulBuilder(
        builder: (dialogContext, setState) {
          return AlertDialog(
            title: const Text('記一筆還款'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: amountCtrl,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '繳款金額（元）'),
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
                  subtitle: Text(
                    '${paidAt.year}/${paidAt.month.toString().padLeft(2, '0')}/${paidAt.day.toString().padLeft(2, '0')}',
                  ),
                  trailing: const Icon(Icons.calendar_month),
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: dialogContext,
                      initialDate: paidAt,
                      firstDate: DateTime.now().subtract(
                        const Duration(days: 3650),
                      ),
                      lastDate: DateTime.now().add(const Duration(days: 3650)),
                    );
                    if (picked != null) setState(() => paidAt = picked);
                  },
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () async {
                  final amount = int.tryParse(amountCtrl.text);
                  if (amount == null || amount <= 0) return;
                  await ref
                      .read(loanRepositoryProvider)
                      .recordPayment(
                        loanId: loanId,
                        amountCents: amount * 100,
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
