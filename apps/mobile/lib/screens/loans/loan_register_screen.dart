import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lending_engine/lending_engine.dart' as engine;

import '../../domain/license_repository.dart';
import '../../providers/app_providers.dart';
import '../../widgets/format.dart';

/// 登記貸款 ＋ 自動生成計畫（四步上手第 2、3 步）。UI 只呼叫
/// `lending_engine.generateSchedule` 產生預覽，不內嵌任何攤還公式
/// （見 spec §1 硬性要求）。
class LoanRegisterScreen extends ConsumerStatefulWidget {
  const LoanRegisterScreen({super.key, this.preselectedBorrowerId});

  final String? preselectedBorrowerId;

  @override
  ConsumerState<LoanRegisterScreen> createState() => _LoanRegisterScreenState();
}

class _LoanRegisterScreenState extends ConsumerState<LoanRegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _principalCtrl = TextEditingController(text: '100000');
  final _rateCtrl = TextEditingController(text: '100');
  final _tenorCtrl = TextEditingController(text: '12');
  final _periodDaysCtrl = TextEditingController(text: '30');
  final _graceDaysCtrl = TextEditingController(text: '3');

  String? _borrowerId;
  engine.RepaymentMethod _method = engine.RepaymentMethod.emi;
  engine.RateType _rateType = engine.RateType.monthly;
  engine.DayCount _dayCount = engine.DayCount.thirty360;
  bool _penaltyEnabled = false;
  DateTime _plannedDate = DateTime.now();
  engine.ScheduleResult? _preview;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _borrowerId = widget.preselectedBorrowerId;
  }

  @override
  void dispose() {
    _principalCtrl.dispose();
    _rateCtrl.dispose();
    _tenorCtrl.dispose();
    _periodDaysCtrl.dispose();
    _graceDaysCtrl.dispose();
    super.dispose();
  }

  void _generatePreview() {
    if (!_formKey.currentState!.validate() || _borrowerId == null) {
      if (_borrowerId == null) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('請先選擇借款人')));
      }
      return;
    }
    final terms = engine.LoanTerms(
      principalCents: int.parse(_principalCtrl.text) * 100,
      method: _method,
      rateSpec: engine.RateSpec(
        rateType: _rateType,
        rateBps: int.parse(_rateCtrl.text),
        dayCount: _dayCount,
        periodDays: int.parse(_periodDaysCtrl.text),
      ),
      tenorPeriods: int.parse(_tenorCtrl.text),
      disbursedAt: _plannedDate,
      graceDays: int.parse(_graceDaysCtrl.text),
    );
    setState(() => _preview = engine.generateSchedule(terms));
  }

  Future<void> _submit() async {
    if (_preview == null) {
      _generatePreview();
      if (_preview == null) return;
    }
    setState(() => _saving = true);
    try {
      final licenseRepo = ref.read(licenseRepositoryProvider);
      final loanRepo = ref.read(loanRepositoryProvider);
      final loan = await licenseRepo.performGatedWrite(
        () => loanRepo.registerLoan(
          borrowerId: _borrowerId!,
          principalCents: int.parse(_principalCtrl.text) * 100,
          method: _method,
          rateType: _rateType,
          rateBps: int.parse(_rateCtrl.text),
          dayCount: _dayCount,
          tenorPeriods: int.parse(_tenorCtrl.text),
          plannedDisbursementDate: _plannedDate,
          periodDays: int.parse(_periodDaysCtrl.text),
          graceDays: int.parse(_graceDaysCtrl.text),
          penaltyEnabled: _penaltyEnabled,
        ),
      );
      ref.invalidate(dashboardSnapshotProvider);
      if (!mounted) return;
      context.pushReplacement('/loans/${loan.id}');
    } on TrialExhaustedException catch (e) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('試用次數已用盡'),
          content: Text('$e'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('關閉'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(context);
                context.go('/settings');
              },
              child: const Text('前往輸入授權碼'),
            ),
          ],
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final borrowersAsync = ref.watch(borrowersStreamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('登記貸款')),
      body: Form(
        key: _formKey,
        onChanged: () => setState(() => _preview = null),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            borrowersAsync.when(
              data: (borrowers) => DropdownButtonFormField<String>(
                initialValue: _borrowerId,
                decoration: const InputDecoration(labelText: '借款人 *'),
                items: [
                  for (final b in borrowers)
                    DropdownMenuItem(value: b.id, child: Text(b.name)),
                ],
                onChanged: (v) => setState(() {
                  _borrowerId = v;
                  _preview = null;
                }),
                validator: (v) => v == null ? '請選擇借款人' : null,
              ),
              loading: () => const LinearProgressIndicator(),
              error: (_, _) => const Text('借款人清單載入失敗'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _principalCtrl,
              decoration: const InputDecoration(labelText: '貸款本金（元）*'),
              keyboardType: TextInputType.number,
              validator: _positiveIntValidator,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<engine.RepaymentMethod>(
              initialValue: _method,
              decoration: const InputDecoration(labelText: '還款方式 *'),
              items: const [
                DropdownMenuItem(
                  value: engine.RepaymentMethod.emi,
                  child: Text('等額本息（EMI）'),
                ),
                DropdownMenuItem(
                  value: engine.RepaymentMethod.epp,
                  child: Text('等額本金（EPP）'),
                ),
                DropdownMenuItem(
                  value: engine.RepaymentMethod.io,
                  child: Text('先息後本（IO）'),
                ),
                DropdownMenuItem(
                  value: engine.RepaymentMethod.bullet,
                  child: Text('一次本息（BULLET）'),
                ),
              ],
              onChanged: (v) => setState(() => _method = v!),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<engine.RateType>(
              initialValue: _rateType,
              decoration: const InputDecoration(labelText: '利率類型 *'),
              items: const [
                DropdownMenuItem(
                  value: engine.RateType.monthly,
                  child: Text('月利率'),
                ),
                DropdownMenuItem(
                  value: engine.RateType.annual,
                  child: Text('年利率'),
                ),
                DropdownMenuItem(
                  value: engine.RateType.daily,
                  child: Text('日利率'),
                ),
                DropdownMenuItem(
                  value: engine.RateType.period,
                  child: Text('期利率'),
                ),
              ],
              onChanged: (v) => setState(() => _rateType = v!),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _rateCtrl,
              decoration: const InputDecoration(labelText: '利率（基點，100 = 1%）*'),
              keyboardType: TextInputType.number,
              validator: _nonNegativeIntValidator,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<engine.DayCount>(
              initialValue: _dayCount,
              decoration: const InputDecoration(labelText: '日數基礎 *'),
              items: const [
                DropdownMenuItem(
                  value: engine.DayCount.thirty360,
                  child: Text('THIRTY_360'),
                ),
                DropdownMenuItem(
                  value: engine.DayCount.act365,
                  child: Text('ACT_365'),
                ),
                DropdownMenuItem(
                  value: engine.DayCount.act360,
                  child: Text('ACT_360'),
                ),
              ],
              onChanged: (v) => setState(() => _dayCount = v!),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _tenorCtrl,
              decoration: const InputDecoration(labelText: '期數 *'),
              keyboardType: TextInputType.number,
              validator: _positiveIntValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _periodDaysCtrl,
              decoration: const InputDecoration(labelText: '每期天數'),
              keyboardType: TextInputType.number,
              validator: _positiveIntValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _graceDaysCtrl,
              decoration: const InputDecoration(labelText: '寬限天數'),
              keyboardType: TextInputType.number,
              validator: _nonNegativeIntValidator,
            ),
            SwitchListTile(
              title: const Text('啟用罰息'),
              value: _penaltyEnabled,
              onChanged: (v) => setState(() {
                _penaltyEnabled = v;
                _preview = null;
              }),
            ),
            ListTile(
              title: const Text('預計撥款日'),
              subtitle: Text(formatDate(_plannedDate)),
              trailing: const Icon(Icons.calendar_month),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _plannedDate,
                  firstDate: DateTime.now().subtract(const Duration(days: 365)),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (picked != null) {
                  setState(() {
                    _plannedDate = picked;
                    _preview = null;
                  });
                }
              },
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _generatePreview,
              icon: const Icon(Icons.auto_awesome),
              label: const Text('自動生成計畫預覽'),
            ),
            if (_preview != null) ...[
              const SizedBox(height: 16),
              _SchedulePreview(result: _preview!),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('建立貸款（建約）'),
            ),
          ],
        ),
      ),
    );
  }
}

String? _positiveIntValidator(String? v) {
  final n = int.tryParse(v ?? '');
  if (n == null || n <= 0) return '請輸入正整數';
  return null;
}

String? _nonNegativeIntValidator(String? v) {
  final n = int.tryParse(v ?? '');
  if (n == null || n < 0) return '請輸入不小於 0 的整數';
  return null;
}

class _SchedulePreview extends StatelessWidget {
  const _SchedulePreview({required this.result});
  final engine.ScheduleResult result;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '計畫預覽（共 ${result.items.length} 期）',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              '本金合計 ${formatMoney(result.totalPrincipalCents)} · 利息合計 ${formatMoney(result.totalInterestCents)}',
            ),
            const Divider(),
            SizedBox(
              height: 220,
              child: ListView.builder(
                itemCount: result.items.length,
                itemBuilder: (context, i) {
                  final item = result.items[i];
                  return ListTile(
                    dense: true,
                    leading: Text('#${item.periodNumber}'),
                    title: Text(formatDate(item.dueDate)),
                    subtitle: Text(
                      '本金 ${formatMoney(item.principalCents)} + 利息 ${formatMoney(item.interestCents)}',
                    ),
                    trailing: Text(formatMoney(item.totalDueCents)),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
