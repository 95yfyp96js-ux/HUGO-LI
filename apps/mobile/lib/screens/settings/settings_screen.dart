import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:license/license.dart' as license;

import '../../db/backup.dart';
import '../../db/seed.dart';
import '../../providers/app_providers.dart';

/// 設定：授權狀態、輸入授權碼、備份匯出（見 spec §7、實作順序第 7 步）。
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _codeCtrl = TextEditingController();
  bool _activating = false;
  bool _backingUp = false;
  bool _seeding = false;

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _activate() async {
    if (_codeCtrl.text.trim().isEmpty) return;
    setState(() => _activating = true);
    try {
      final result = await ref
          .read(licenseRepositoryProvider)
          .activate(_codeCtrl.text);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.valid ? '授權啟用成功' : '授權碼無效：${result.reason}'),
        ),
      );
      if (result.valid) _codeCtrl.clear();
    } finally {
      if (mounted) setState(() => _activating = false);
    }
  }

  Future<void> _backup() async {
    setState(() => _backingUp = true);
    try {
      final file = await backupDatabaseFile();
      if (!mounted) return;
      showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('備份完成'),
          content: Text('已複製到本機：\n${file.path}'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('關閉'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('備份失敗：$e')));
    } finally {
      if (mounted) setState(() => _backingUp = false);
    }
  }

  Future<void> _seed() async {
    setState(() => _seeding = true);
    try {
      await seedDemoData(
        borrowers: ref.read(borrowerRepositoryProvider),
        loans: ref.read(loanRepositoryProvider),
      );
      ref.invalidate(dashboardSnapshotProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('已載入範例資料')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('載入失敗：$e')));
    } finally {
      if (mounted) setState(() => _seeding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final licenseRowAsync = ref.watch(licenseRowStreamProvider);
    final devOverride = ref.watch(devLicenseOverrideProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('設定')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('授權狀態', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  licenseRowAsync.when(
                    data: (row) {
                      final state = license.computeLicenseState(
                        usedCount: row.usedCount,
                        freeLimit: 10,
                        isLicensed: row.isLicensed,
                        devOverride: devOverride,
                      );
                      final String label = switch (state) {
                        license.LicenseState.licensed =>
                          devOverride ? '已授權（DEV_LICENSE 開發旁路）' : '已授權',
                        license.LicenseState.trial =>
                          '試用中（已用 ${row.usedCount}/10 次）',
                        license.LicenseState.trialExhausted => '試用次數已用盡，請輸入授權碼',
                      };
                      return Text(label);
                    },
                    loading: () => const LinearProgressIndicator(),
                    error: (err, _) => Text('讀取失敗：$err'),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _codeCtrl,
                    decoration: const InputDecoration(
                      labelText: '輸入授權碼',
                      hintText: '<payload>.<簽章>',
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: _activating ? null : _activate,
                    child: _activating
                        ? const Text('驗證中...')
                        : const Text('啟用授權'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('資料備份', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  const Text('資料只存在本機（SQLCipher 加密），不會上傳伺服器。可手動備份到本機另一個檔案。'),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _backingUp ? null : _backup,
                    icon: const Icon(Icons.backup),
                    label: Text(_backingUp ? '備份中...' : '匯出備份'),
                  ),
                ],
              ),
            ),
          ),
          if (kDebugMode) ...[
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('開發用', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    const Text('僅 Debug 模式顯示。建立 2 位借款人＋2 筆示範貸款，方便快速體驗四步上手流程。'),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _seeding ? null : _seed,
                      icon: const Icon(Icons.dataset),
                      label: Text(_seeding ? '載入中...' : '載入範例資料'),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('關於', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  const Text('小額放款帳戶系統（出借人端）'),
                  const Text('本系統永不自動核准貸款；核貸建議僅供參考。'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
