import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lending_engine/lending_engine.dart' as engine;

import '../../domain/enum_mapping.dart';
import '../../providers/app_providers.dart';
import '../../widgets/format.dart';

/// 貸款清單。狀態依 spec §3 精簡為 UI 四種分組顯示。
class LoanListScreen extends ConsumerWidget {
  const LoanListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loansAsync = ref.watch(loansStreamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('貸款')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/loans/new'),
        icon: const Icon(Icons.add),
        label: const Text('登記貸款'),
      ),
      body: loansAsync.when(
        data: (loans) {
          if (loans.isEmpty) {
            return const Center(child: Text('尚無貸款，請點右下角登記'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            itemCount: loans.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final loan = loans[index];
              final status = parseLoanStatus(loan.status);
              return Card(
                child: ListTile(
                  title: Text(formatMoney(loan.principalCents)),
                  subtitle: Text(
                    '${_methodLabel(parseRepaymentMethod(loan.method))} · ${loan.tenorPeriods} 期 · '
                    '${_statusLabel(status)}',
                  ),
                  trailing: _StatusChip(status: status),
                  onTap: () => context.push('/loans/${loan.id}'),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('讀取失敗：$err')),
      ),
    );
  }
}

String _methodLabel(engine.RepaymentMethod method) {
  switch (method) {
    case engine.RepaymentMethod.emi:
      return '等額本息';
    case engine.RepaymentMethod.epp:
      return '等額本金';
    case engine.RepaymentMethod.io:
      return '先息後本';
    case engine.RepaymentMethod.bullet:
      return '一次本息';
  }
}

String _statusLabel(engine.LoanStatus status) {
  switch (status.group) {
    case engine.LoanStatusGroup.draft:
      return '未撥款';
    case engine.LoanStatusGroup.current:
      return '進行中';
    case engine.LoanStatusGroup.delinquent:
      return '逾期';
    case engine.LoanStatusGroup.closed:
      return '結案';
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final engine.LoanStatus status;

  @override
  Widget build(BuildContext context) {
    final Color color;
    switch (status.group) {
      case engine.LoanStatusGroup.draft:
        color = Colors.grey;
      case engine.LoanStatusGroup.current:
        color = Colors.blue;
      case engine.LoanStatusGroup.delinquent:
        color = Colors.red;
      case engine.LoanStatusGroup.closed:
        color = Colors.green;
    }
    return Chip(
      label: Text(
        _statusLabel(status),
        style: const TextStyle(color: Colors.white, fontSize: 12),
      ),
      backgroundColor: color,
      visualDensity: VisualDensity.compact,
    );
  }
}
