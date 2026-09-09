import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../db/app_database.dart';
import '../../domain/dashboard_repository.dart';
import '../../domain/enum_mapping.dart';
import '../../domain/license_repository.dart';
import '../../domain/loan_csv.dart';
import '../../domain/schedule_item_math.dart';
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
                            formatMoney(loan.principalCents),
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
                                value: formatMoney(s.disbursedCents),
                              ),
                              _SummaryStat(
                                label: '已收利息',
                                value: formatMoney(s.interestReceivedCents),
                              ),
                              _SummaryStat(
                                label: '已收本金',
                                value: formatMoney(s.principalReceivedCents),
                              ),
                              _SummaryStat(
                                label: '未償本金',
                                value: formatMoney(s.outstandingPrincipalCents),
                              ),
                            ],
                          );
                        },
                      ),
                      if (loan.penaltyEnabled)
                        FutureBuilder<int>(
                          future: loanRepo.accruedPenaltyCents(loanId),
                          builder: (context, penaltySnap) {
                            final int penalty = penaltySnap.data ?? 0;
                            return Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text('應計罰息（尚未入帳）'),
                                  Text(
                                    formatMoney(penalty),
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: penalty > 0
                                          ? AppColors.danger
                                          : AppColors.deepBlue,
                                    ),
                                  ),
                                ],
                              ),
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
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('還款計畫', style: Theme.of(context).textTheme.titleMedium),
                  TextButton.icon(
                    icon: const Icon(Icons.table_view, size: 18),
                    label: const Text('匯出 CSV'),
                    onPressed: () => _exportCsv(context, ref),
                  ),
                ],
              ),
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

  /// 匯出這筆貸款的計畫表＋實收＋分錄 CSV，方便封測者跟紙本對帳。
  /// 檔案只寫到 App 自己的目錄，內容不含未遮罩的身分證字號。
  Future<void> _exportCsv(BuildContext context, WidgetRef ref) async {
    try {
      final loanRepo = ref.read(loanRepositoryProvider);
      final borrowerRepo = ref.read(borrowerRepositoryProvider);
      final loan = (await loanRepo.findById(loanId))!;
      final borrower = await borrowerRepo.findById(loan.borrowerId);

      final csv = buildLoanCsv(
        loan: loan,
        borrowerName: borrower?.name ?? '(已刪除)',
        maskedIdNumber: borrower == null
            ? ''
            : borrowerRepo.maskedIdNumber(borrower),
        schedule: await loanRepo.scheduleFor(loanId),
        payments: await loanRepo.paymentsFor(loanId),
        ledger: await loanRepo.ledgerFor(loanId),
      );

      final dir = await getApplicationDocumentsDirectory();
      final exports = Directory(p.join(dir.path, 'exports'));
      if (!await exports.exists()) await exports.create(recursive: true);
      final stamp = DateTime.now().toIso8601String().replaceAll(
        RegExp(r'[:.]'),
        '-',
      );
      final file = File(p.join(exports.path, 'loan-$stamp.csv'));
      await file.writeAsString(csv);

      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('已匯出 CSV'),
          content: Text('檔案位置：\n${file.path}\n\n內容不含完整身分證字號。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('關閉'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('匯出失敗：$e')));
    }
  }

  /// 確認撥款：可選實際撥款日（預設今天、可往回選、不可選未來）。
  ///
  /// 「錢早就借出去了、現在才建檔」是出借人的常態，所以補登歷史撥款是必要
  /// 功能而不是測試後門。撥款日一旦定案，計畫表的到期日與計息起算日都以它
  /// 為錨點（見 docs/interest-rules.md §1、docs/state-machines.md §1.1）。
  Future<void> _confirmDisbursement(BuildContext context, WidgetRef ref) async {
    DateTime disbursedAt = DateTime.now();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: const Text('確認撥款'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('確認後將寫入撥款分錄並開始計息，此動作無法復原（後續調整需用沖正分錄）。'),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('實際撥款日'),
                subtitle: Text(formatDate(disbursedAt)),
                trailing: const Icon(Icons.calendar_month),
                onTap: () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(
                    context: dialogContext,
                    initialDate: disbursedAt,
                    firstDate: now.subtract(const Duration(days: 3650)),
                    lastDate: now, // 撥款是既成事實，不能預約未來
                    helpText: '選擇實際撥款日（不可選未來）',
                  );
                  if (picked != null) setState(() => disbursedAt = picked);
                },
              ),
              const Text(
                '補登過去的撥款日時，計畫表到期日與計息都會從那天重新起算；'
                '若已逾期，日結會立刻把逾期期別標出來。',
                style: TextStyle(fontSize: 12),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('確認撥款'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;

    try {
      final licenseRepo = ref.read(licenseRepositoryProvider);
      final loanRepo = ref.read(loanRepositoryProvider);
      await licenseRepo.performGatedWrite(() async {
        await loanRepo.confirmDisbursement(loanId, at: disbursedAt);
        // 補登歷史撥款可能立刻產生逾期期別，撥款後馬上跑一次日結。
        await loanRepo.runDailyBatch(loanId: loanId);
      });
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
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '本金 ${formatMoney(item.principalCents)} ＋ 利息 '
              '${formatMoney(item.interestCents)} ＝ ${formatMoney(item.totalDueCents)}',
            ),
            if (item.shortfallCents > 0 && item.paidCents > 0)
              // 差額不到 1 元也必須看得見，否則使用者以為繳清了，帳其實沒平。
              Text(
                '已繳 ${formatMoney(item.paidCents)} · 尚差 '
                '${formatMoney(item.shortfallCents)}',
                style: const TextStyle(
                  color: AppColors.warning,
                  fontWeight: FontWeight.bold,
                ),
              )
            else if (item.paidCents > 0)
              Text('已繳 ${formatMoney(item.paidCents)}'),
          ],
        ),
        isThreeLine: item.paidCents > 0,
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
