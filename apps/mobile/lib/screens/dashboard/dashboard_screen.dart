import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/format.dart';

/// 看板：貸款總額、已收利息、待收金額、逾期（全部由 Ledger 重放得出，見
/// docs/ASSUMPTIONS.md §8）。
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshotAsync = ref.watch(dashboardSnapshotProvider);
    final borrowersAsync = ref.watch(borrowersStreamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('看板')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dashboardSnapshotProvider),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            snapshotAsync.when(
              data: (snapshot) => GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.5,
                children: [
                  _MetricCard(
                    label: '貸款總額',
                    value: formatCents(snapshot.totalDisbursedCents),
                    color: AppColors.deepBlue,
                    icon: Icons.account_balance,
                  ),
                  _MetricCard(
                    label: '已收利息',
                    value: formatCents(snapshot.totalInterestReceivedCents),
                    color: AppColors.success,
                    icon: Icons.savings,
                  ),
                  _MetricCard(
                    label: '待收金額',
                    value: formatCents(snapshot.totalReceivableCents),
                    color: AppColors.accent,
                    icon: Icons.hourglass_bottom,
                  ),
                  _MetricCard(
                    label: '逾期',
                    value: formatCents(snapshot.totalOverdueCents),
                    color: AppColors.danger,
                    icon: Icons.warning_amber,
                  ),
                ],
              ),
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (err, st) => Padding(
                padding: const EdgeInsets.all(16),
                child: Text('看板載入失敗：$err'),
              ),
            ),
            const SizedBox(height: 24),
            borrowersAsync.when(
              data: (borrowers) => borrowers.isEmpty
                  ? const _OnboardingHint()
                  : const SizedBox.shrink(),
              loading: () => const SizedBox.shrink(),
              error: (err, st) => Text('借款人清單載入失敗：$err'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  final String label;
  final String value;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Icon(icon, color: color),
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: Theme.of(context).textTheme.titleLarge
                    ?.copyWith(color: color, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingHint extends StatelessWidget {
  const _OnboardingHint();

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppColors.deepBlue,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '四步上手',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              '① 新增借款人 → ② 登記貸款 → ③ 自動生成計畫 → ④ 確認撥款並追蹤還款',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: AppColors.deepBlue,
              ),
              onPressed: () => context.push('/borrowers/new'),
              child: const Text('開始：新增借款人'),
            ),
          ],
        ),
      ),
    );
  }
}
