import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:license/license.dart' as license;

import '../../db/backup_codec.dart';
import '../../db/backup_service.dart';
import '../../db/connection.dart';
import '../../db/db_key_store.dart';
import '../../db/seed.dart';
import '../../domain/license_repository.dart';
import '../../providers/app_providers.dart';

/// 設定：儲存狀態、備份／還原、授權、範例資料（見 spec §7）。
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _codeCtrl = TextEditingController();
  bool _activating = false;
  bool _busy = false;

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _activate() async {
    if (_codeCtrl.text.trim().isEmpty) return;
    setState(() => _activating = true);
    try {
      final result = await ref
          .read(licenseRepositoryProvider)
          .activate(_codeCtrl.text);
      if (!mounted) return;
      _toast(
        result.valid ? '授權啟用成功' : '授權碼無效：${result.reason?.name ?? '未知原因'}',
      );
      if (result.valid) _codeCtrl.clear();
    } finally {
      if (mounted) setState(() => _activating = false);
    }
  }

  // ---------------------------------------------------------------- 備份匯出

  Future<void> _export() async {
    final String? passphrase = await _askPassphrase(
      title: '設定備份口令',
      description:
          '備份檔會用這組口令加密（AES-256-GCM）。**口令沒有存在 App 裡，忘記就永遠解不開**，'
          '請自己記下來。',
      confirmField: true,
    );
    if (passphrase == null) return;

    setState(() => _busy = true);
    try {
      final String armored = await ref
          .read(backupServiceProvider)
          .exportToString(passphrase: passphrase);
      final dir = await BackupFiles.directory();
      final file = File('${dir.path}/${BackupFiles.fileName(rescue: false)}');
      await file.writeAsString(armored, flush: true);
      if (!mounted) return;
      await _showInfo(
        title: '備份完成',
        body:
            '已寫入本機：\n${file.path}\n\n'
            '這是「資料內容」備份，不是資料庫檔案，換裝置、換金鑰都能還原。\n'
            '目前版本沒有分享／匯出到其他 App 的功能，檔案要靠電腦端工具'
            '（Finder／adb）拉出去（見 docs/MANUAL-QA.md）。',
      );
    } catch (e) {
      _toast('備份失敗：$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---------------------------------------------------------------- 備份還原

  Future<void> _restore() async {
    final List<File> files;
    try {
      files = await BackupFiles.list();
    } catch (e) {
      _toast('讀不到備份資料夾：$e');
      return;
    }
    if (files.isEmpty) {
      await _showInfo(
        title: '沒有可還原的備份',
        body: '本機 backups/ 資料夾裡沒有 .slbak 檔。請先「匯出備份」，或把備份檔放進該資料夾。',
      );
      return;
    }
    if (!mounted) return;

    final File? picked = await showDialog<File>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('選擇要還原的備份檔'),
        children: [
          for (final f in files)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, f),
              child: Text(f.uri.pathSegments.last),
            ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
        ],
      ),
    );
    if (picked == null || !mounted) return;

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('還原會覆蓋現在的全部資料'),
        content: const Text(
          '還原會把目前的借款人、貸款、還款計畫、分錄全部換成備份檔裡的內容。\n\n'
          '在替換之前，App 會先把「現在的資料」另存成一份救援備份（rescue-*.slbak，'
          '用你等下輸入的同一組口令加密）。口令錯或檔案毀損時會直接中止，現有資料不會被動到。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('我了解，繼續'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final String? passphrase = await _askPassphrase(
      title: '輸入備份口令',
      description: '請輸入建立這個備份檔時設定的口令。',
      confirmField: false,
    );
    if (passphrase == null) return;

    setState(() => _busy = true);
    File? rescueFile;
    try {
      final String armored = await picked.readAsString();
      final outcome = await ref
          .read(backupServiceProvider)
          .restoreFromString(
            armored: armored,
            passphrase: passphrase,
            saveRescue: (rescueArmored) async {
              final dir = await BackupFiles.directory();
              rescueFile = File(
                '${dir.path}/${BackupFiles.fileName(rescue: true)}',
              );
              await rescueFile!.writeAsString(rescueArmored, flush: true);
            },
          );
      ref.invalidate(dashboardSnapshotProvider);
      if (!mounted) return;
      await _showInfo(
        title: '還原完成',
        body:
            '已還原 ${outcome.borrowers} 位借款人、${outcome.loans} 筆貸款、'
            '${outcome.ledgerEntries} 筆分錄。\n\n'
            '還原前的資料存在：\n${rescueFile?.path ?? '（未產生）'}',
      );
    } on BackupPassphraseException catch (e) {
      await _showInfo(title: '口令錯誤', body: '${e.message}\n\n現有資料完全沒有變動。');
    } on BackupVersionException catch (e) {
      await _showInfo(title: '備份檔版本不符', body: '${e.message}\n\n現有資料完全沒有變動。');
    } on BackupFormatException catch (e) {
      await _showInfo(title: '備份檔無法讀取', body: '${e.message}\n\n現有資料完全沒有變動。');
    } catch (e) {
      await _showInfo(
        title: '還原失敗',
        body: '$e\n\n若已產生救援備份，路徑為：\n${rescueFile?.path ?? '（未產生）'}',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---------------------------------------------------------------- 範例資料

  Future<void> _seed() async {
    final summary = await summarizeExistingData(
      borrowers: ref.read(borrowerRepositoryProvider),
      loans: ref.read(loanRepositoryProvider),
    );
    if (!mounted) return;

    if (!summary.isEmpty) {
      final bool? go = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('這台機器已經有資料了'),
          content: Text(
            '${summary.description}\n\n'
            '載入範例資料只會「新增」2 位假借款人與 2 筆假貸款，不會刪除或修改你現有的任何一筆資料，'
            '但範例資料會混進你的清單與看板數字裡，之後要自己一筆一筆分辨。\n\n'
            '確定要在已有資料的情況下載入範例嗎？',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('我了解，仍要載入'),
            ),
          ],
        ),
      );
      if (go != true || !mounted) return;
    }

    setState(() => _busy = true);
    try {
      await seedDemoData(
        borrowers: ref.read(borrowerRepositoryProvider),
        loans: ref.read(loanRepositoryProvider),
      );
      ref.invalidate(dashboardSnapshotProvider);
      _toast('已載入範例資料');
    } catch (e) {
      _toast('載入失敗：$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---------------------------------------------------------------- 共用對話框

  Future<void> _showInfo({required String title, required String body}) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(child: Text(body)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('關閉'),
          ),
        ],
      ),
    );
  }

  Future<String?> _askPassphrase({
    required String title,
    required String description,
    required bool confirmField,
  }) async {
    final a = TextEditingController();
    final b = TextEditingController();
    String? error;
    final String? result = await showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(description),
                const SizedBox(height: 12),
                TextField(
                  controller: a,
                  autofocus: true,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: '口令',
                    errorText: error,
                  ),
                ),
                if (confirmField) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: b,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: '再輸入一次'),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () {
                if (a.text.length < 8) {
                  setLocal(() => error = '口令至少 8 個字元');
                  return;
                }
                if (confirmField && a.text != b.text) {
                  setLocal(() => error = '兩次輸入不一致');
                  return;
                }
                Navigator.pop(ctx, a.text);
              },
              child: const Text('確定'),
            ),
          ],
        ),
      ),
    );
    a.dispose();
    b.dispose();
    return result;
  }

  // ---------------------------------------------------------------------- UI

  @override
  Widget build(BuildContext context) {
    final licenseRowAsync = ref.watch(licenseRowStreamProvider);
    final devOverride = ref.watch(devLicenseOverrideProvider);
    final DbKeyOrigin keyOrigin = ref.watch(dbKeyOriginProvider);
    final bool encrypted = databaseEncryptionEnabled;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('設定')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ------------------------------------------------------ A3 儲存狀態
          _SettingsCard(
            title: '儲存狀態',
            children: [
              Row(
                children: [
                  Icon(
                    encrypted ? Icons.lock : Icons.lock_open,
                    color: encrypted ? Colors.green.shade700 : Colors.red,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      encrypted ? '資料庫加密：開啟（SQLCipher）' : '資料庫加密：關閉（開發模式）',
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: encrypted ? null : Colors.red,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(switch (keyOrigin) {
                DbKeyOrigin.secureStorage =>
                  '金鑰來源：系統安全儲存（iOS Keychain／Android Keystore）。',
                DbKeyOrigin.migratedFromLegacy =>
                  '金鑰來源：本次啟動已從舊版明文設定檔搬進系統安全儲存，並確認讀得回來後才刪除明文。',
                DbKeyOrigin.created => '金鑰來源：本次啟動新產生（32 bytes 亂數），存放於系統安全儲存。',
              }),
              const SizedBox(height: 8),
              const Text('金鑰本身不會顯示在畫面上，也不會寫進備份檔或匯出的 CSV。'),
              if (!encrypted) ...[
                const SizedBox(height: 8),
                const Text(
                  '這個 build 帶了 --dart-define=DISABLE_DB_ENCRYPTION，資料是明文存放，'
                  '只能用來開發除錯，禁止放真實客戶資料。Release build 會忽略此旗標，一律加密。',
                  style: TextStyle(color: Colors.red),
                ),
              ],
              const SizedBox(height: 8),
              const Text('資料只存在這台機器，不會上傳任何伺服器。'),
            ],
          ),
          const SizedBox(height: 16),

          // ------------------------------------------------------ A1 備份還原
          _SettingsCard(
            title: '備份與還原',
            children: [
              const Text(
                '備份匯出的是「資料內容」（加密後的全表 JSON），不是資料庫檔案，'
                '所以換裝置、重裝、換金鑰之後都還原得回來。',
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _export,
                    icon: const Icon(Icons.backup),
                    label: const Text('匯出備份'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _restore,
                    icon: const Icon(Icons.restore),
                    label: const Text('從備份還原'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text('還原前 App 會先自動存一份救援備份；口令錯誤或檔案毀損時直接中止，現有資料不動。'),
            ],
          ),
          const SizedBox(height: 16),

          // -------------------------------------------------------- C7 授權
          _SettingsCard(
            title: '授權狀態',
            children: [
              licenseRowAsync.when(
                data: (row) {
                  final state = license.computeLicenseState(
                    usedCount: row.usedCount,
                    freeLimit: LicenseRepository.trialGate.freeLimit,
                    isLicensed: row.isLicensed,
                    devOverride: devOverride,
                  );
                  final String label = switch (state) {
                    license.LicenseState.licensed =>
                      devOverride ? '已授權（DEV_LICENSE 開發旁路）' : '已授權',
                    license.LicenseState.trial =>
                      '試用中（已用 ${row.usedCount}/'
                          '${LicenseRepository.trialGate.freeLimit} 次）',
                    license.LicenseState.trialExhausted => '試用次數已用盡，請輸入授權碼',
                  };
                  return Text(label, style: theme.textTheme.bodyLarge);
                },
                loading: () => const LinearProgressIndicator(),
                error: (err, _) => Text('讀取失敗：$err'),
              ),
              const SizedBox(height: 8),
              Text(
                licenseSigningConfigured
                    ? '此 build 已帶入授權簽章密鑰，可驗證授權碼。'
                    : '此 build 沒有帶入授權簽章密鑰（LICENSE_HMAC_KEY），任何授權碼都不會通過，'
                          'App 只能用試用次數。',
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
                child: _activating ? const Text('驗證中...') : const Text('啟用授權'),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.warning_amber,
                          color: theme.colorScheme.onErrorContainer,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '此版本授權為示範等級，可被破解',
                          style: theme.textTheme.titleSmall?.copyWith(
                            color: theme.colorScheme.onErrorContainer,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '驗證完全在本機離線進行，簽章密鑰會被打進 App 二進位檔，反編譯即可取出並自行'
                      '簽發授權碼；試用次數存在本機資料庫，重裝或改資料即可重置。\n\n'
                      '因此：禁止把這個機制當成正式收費閘門，也禁止在本 App 內儲存任何真實金流'
                      '密碼、信用卡號或收單帳號。要收費請走 App Store／Google Play 或另外的'
                      '伺服器驗證。',
                      style: TextStyle(
                        color: theme.colorScheme.onErrorContainer,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          // ---------------------------------------------------- C8 範例資料
          if (kDebugMode) ...[
            const SizedBox(height: 16),
            _SettingsCard(
              title: '開發用',
              children: [
                const Text(
                  '僅 Debug 模式顯示。建立 2 位假借款人＋2 筆示範貸款。只新增、不刪除，'
                  '若這台機器已經有資料會先跳出二次確認。',
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _seed,
                  icon: const Icon(Icons.dataset),
                  label: const Text('載入範例資料'),
                ),
              ],
            ),
          ],

          const SizedBox(height: 16),
          _SettingsCard(
            title: '關於',
            children: const [
              Text('小額放款帳戶系統（出借人端）'),
              Text('本系統永不自動核准貸款；核貸建議僅供參考。'),
            ],
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...children,
          ],
        ),
      ),
    );
  }
}
