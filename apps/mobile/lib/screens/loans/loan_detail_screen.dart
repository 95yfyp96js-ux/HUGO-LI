import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lending_engine/lending_engine.dart' as engine;

import '../../db/app_database.dart';
import '../../domain/dashboard_repository.dart';
import '../../domain/enum_mapping.dart';
import '../../domain/license_repository.dart';
import '../../providers/app_providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/format.dart';
import '../../widgets/record_payment_dialog.dart';

/// 貸款詳情：計畫表、Ledger 摘要、建約與撥款分開按鈕（見 spec §6）。
class LoanDetailScreen extends ConsumerWidget {
  const LoanDetailScreen({super.key, required this.loanId});

  final String loanId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loanRepo = ref.watch(loanRepositoryProvider);
    final scheduleAsync = ref.watch(scheduleStreamProvider(loanId));

    return Scaffold(
      appBar: AppBar(title: const Text('貸款詳情')),
      body: FutureBuilder<Loan?>(
        future: loanRepo.findById(loanId),
        builder: (context, loanSnap) {
          if (!loanSnap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final loan = loanSnap.data;
          if (loan == null) return const Center(child: Text('找不到此貸款'));
          final status = parseLoanStatus(loan.status);

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            formatCents(loan.principalCents),
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          _StatusBadge(status: status),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${loan.tenorPeriods} 期 · rule_version=${loan.ruleVersion}',
                      ),
                      if (loan.disbursedAt != null)
                        Text('撥款日：${formatDate(loan.disbursedAt!)}'),
                      const SizedBox(height: 16),
                      FutureBuilder<LoanSummary>(
                        future: loanRepo.replaySummary(loanId),
                        builder: (context, summarySnap) {
                          if (!summarySnap.hasData) {
                            return const SizedBox.shrink();
                          }
                          final s = summarySnap.data!;
                          return Wrap(
                            spacing: 16,
                            runSpacing: 8,
                            children: [
                              _SummaryStat(
                                label: '已撥款',
                                value: formatCents(s.disbursedCents),
                              ),
                              _SummaryStat(
                                label: '已收利息',
                                value: formatCents(s.interestReceivedCents),
                              ),
                              _SummaryStat(
                                label: '已收本金',
                                value: formatCents(s.principalReceivedCents),
                              ),
                              _SummaryStat(
                                label: '未償本金',
                                value: formatCents(s.outstandingPrincipalCents),
                              ),
                            ],
                          );
                        },
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          if (status == engine.LoanStatus.accepted)
                            Expanded(
                              child: FilledButton.icon(
                                icon: const Icon(Icons.paid),
                                label: const Text('確認撥款'),
                                onPressed: () =>
                                    _confirmDisbursement(context, ref),
                              ),
                            ),
                          if (status.group == engine.LoanStatusGroup.current ||
                              status.group ==
                                  engine.LoanStatusGroup.delinquent) ...[
                            Expanded(
                              child: FilledButton.icon(
                                icon: const Icon(Icons.add_card),
                                label: const Text('記一筆還款'),
                                onPressed: () => showRecordPaymentDialog(
                                  context,
                                  ref,
                                  loanId,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text('還款計畫', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              scheduleAsync.when(
                data: (items) => Column(
                  children: [
                    for (final item in items) _ScheduleTile(item: item),
                  ],
                ),
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (err, _) => Text('讀取失敗：$err'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _confirmDisbursement(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('確認撥款'),
        content: const Text('確認後將寫入撥款分錄並開始計息，此動作無法復原（後續調整需用沖正分錄）。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('確認撥款'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final licenseRepo = ref.read(licenseRepositoryProvider);
      final loanRepo = ref.read(loanRepositoryProvider);
      await licenseRepo.performGatedWrite(
        () => loanRepo.confirmDisbursement(loanId),
      );
      ref.invalidate(dashboardSnapshotProvider);
    } on TrialExhaustedException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final engine.LoanStatus status;

  @override
  Widget build(BuildContext context) {
    final label = switch (status.group) {
      engine.LoanStatusGroup.draft => '未撥款',
      engine.LoanStatusGroup.current => '進行中',
      engine.LoanStatusGroup.delinquent => '逾期',
      engine.LoanStatusGroup.closed => '結案',
    };
    final color = switch (status.group) {
      engine.LoanStatusGroup.draft => Colors.grey,
      engine.LoanStatusGroup.current => AppColors.accent,
      engine.LoanStatusGroup.delinquent => AppColors.danger,
      engine.LoanStatusGroup.closed => AppColors.success,
    };
    return Chip(
      label: Text(label, style: const TextStyle(color: Colors.white)),
      backgroundColor: color,
    );
  }
}

class _SummaryStat extends StatelessWidget {
  const _SummaryStat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        Text(
          value,
          style: Theme.of(context).textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}

class _ScheduleTile extends StatelessWidget {
  const _ScheduleTile({required this.item});
  final ScheduleItem item;

  @override
  Widget build(BuildContext context) {
    final status = parseScheduleItemStatus(item.status);
    final Color color = switch (status) {
      engine.ScheduleItemStatus.paid ||
      engine.ScheduleItemStatus.prepaid => AppColors.success,
      engine.ScheduleItemStatus.overdue => AppColors.danger,
      engine.ScheduleItemStatus.partial => AppColors.warning,
      engine.ScheduleItemStatus.waived => Colors.grey,
      engine.ScheduleItemStatus.due => AppColors.deepBlue,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color,
          child: Text(
            '${item.periodNumber}',
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ),
        title: Text('到期日 ${formatDate(item.dueDate)}'),
        subtitle: Text(
          '本金 ${formatCents(item.principalCents)} + 利息 ${formatCents(item.interestCents)}'
          '${item.interestPaidCents + item.principalPaidCents > 0 ? '（已繳 ${formatCents(item.interestPaidCents + item.principalPaidCents)}）' : ''}',
        ),
        trailing: Text(
          _statusLabel(status),
          style: TextStyle(color: color, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }

  String _statusLabel(engine.ScheduleItemStatus status) => switch (status) {
    engine.ScheduleItemStatus.due => '待繳',
    engine.ScheduleItemStatus.paid => '已繳',
    engine.ScheduleItemStatus.partial => '部分',
    engine.ScheduleItemStatus.prepaid => '提前繳清',
    engine.ScheduleItemStatus.overdue => '逾期',
    engine.ScheduleItemStatus.waived => '已減免',
  };
}
