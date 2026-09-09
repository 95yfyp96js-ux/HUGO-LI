import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'app_database.dart';
import 'backup_codec.dart';

/// 備份與還原。
///
/// 匯出的是**資料內容**（全表 JSON）而不是 SQLCipher 檔案本身，原因有二：
/// 還原時可以先驗證再替換；換裝置、換金鑰也能還原（檔案層備份綁死在原本的
/// DB 金鑰上）。
class BackupService {
  const BackupService(this._db);

  static const List<String> _tables = [
    'borrowers',
    'loans',
    'schedule_items',
    'ledger_entries',
    'payments',
    'loan_events',
    'app_license_rows',
    'audit_logs',
  ];

  final AppDatabase _db;

  /// 把整個資料庫倒成可序列化的 Map。
  Future<Map<String, dynamic>> dump() async {
    return {
      'borrowers': [
        for (final r in await _db.select(_db.borrowers).get()) r.toJson(),
      ],
      'loans': [for (final r in await _db.select(_db.loans).get()) r.toJson()],
      'schedule_items': [
        for (final r in await _db.select(_db.scheduleItems).get()) r.toJson(),
      ],
      'ledger_entries': [
        for (final r in await _db.select(_db.ledgerEntries).get()) r.toJson(),
      ],
      'payments': [
        for (final r in await _db.select(_db.payments).get()) r.toJson(),
      ],
      'loan_events': [
        for (final r in await _db.select(_db.loanEvents).get()) r.toJson(),
      ],
      'app_license_rows': [
        for (final r in await _db.select(_db.appLicenseRows).get()) r.toJson(),
      ],
      'audit_logs': [
        for (final r in await _db.select(_db.auditLogs).get()) r.toJson(),
      ],
    };
  }

  /// 檢查 dump 出來（或解密出來）的內容形狀對不對。內容不合就不動現有資料。
  static void validateContent(Map<String, dynamic> content) {
    for (final table in _tables) {
      if (!content.containsKey(table)) {
        throw BackupFormatException('備份檔缺少「$table」資料表，內容不完整，未進行還原。');
      }
      if (content[table] is! List) {
        throw BackupFormatException('備份檔的「$table」格式不正確，未進行還原。');
      }
    }
  }

  /// 用備份內容整個取代現有資料。**呼叫端必須先做好救援備份**。
  Future<void> replaceAll(Map<String, dynamic> content) async {
    validateContent(content);

    List<Map<String, dynamic>> rows(String table) => [
      for (final row in content[table] as List)
        Map<String, dynamic>.from(row as Map),
    ];

    await _db.transaction(() async {
      // 反向刪除，避免外鍵順序問題。
      await _db.delete(_db.auditLogs).go();
      await _db.delete(_db.appLicenseRows).go();
      await _db.delete(_db.loanEvents).go();
      await _db.delete(_db.payments).go();
      await _db.delete(_db.ledgerEntries).go();
      await _db.delete(_db.scheduleItems).go();
      await _db.delete(_db.loans).go();
      await _db.delete(_db.borrowers).go();

      for (final json in rows('borrowers')) {
        await _db.into(_db.borrowers).insert(Borrower.fromJson(json));
      }
      for (final json in rows('loans')) {
        await _db.into(_db.loans).insert(Loan.fromJson(json));
      }
      for (final json in rows('schedule_items')) {
        await _db.into(_db.scheduleItems).insert(ScheduleItem.fromJson(json));
      }
      for (final json in rows('ledger_entries')) {
        await _db.into(_db.ledgerEntries).insert(LedgerEntryRow.fromJson(json));
      }
      for (final json in rows('payments')) {
        await _db.into(_db.payments).insert(Payment.fromJson(json));
      }
      for (final json in rows('loan_events')) {
        await _db.into(_db.loanEvents).insert(LoanEvent.fromJson(json));
      }
      for (final json in rows('app_license_rows')) {
        await _db.into(_db.appLicenseRows).insert(AppLicenseRow.fromJson(json));
      }
      for (final json in rows('audit_logs')) {
        await _db.into(_db.auditLogs).insert(AuditLog.fromJson(json));
      }
    });
  }

  /// 匯出成加密字串（測試與檔案匯出共用）。
  Future<String> exportToString({
    required String passphrase,
    int iterations = kDefaultPbkdf2Iterations,
  }) async {
    return encodeBackup(
      content: await dump(),
      passphrase: passphrase,
      iterations: iterations,
    );
  }

  /// 從加密字串還原。
  ///
  /// 順序刻意如此：**先把目前的庫另存一份救援備份**（用同一組口令加密），
  /// 再解密、驗證，最後才替換。任何一步失敗都在替換之前，現有資料不動。
  Future<RestoreOutcome> restoreFromString({
    required String armored,
    required String passphrase,
    required Future<void> Function(String rescueArmored) saveRescue,
    int iterations = kDefaultPbkdf2Iterations,
  }) async {
    // 1. 救援備份（先做，做不出來就不要往下走）。
    final String rescue = await exportToString(
      passphrase: passphrase,
      iterations: iterations,
    );
    await saveRescue(rescue);

    // 2. 解密 + 驗證（失敗會拋 BackupException，現庫還沒被動過）。
    final content = decodeBackup(armored: armored, passphrase: passphrase);
    validateContent(content);

    // 3. 替換。
    await replaceAll(content);

    return RestoreOutcome(
      borrowers: (content['borrowers'] as List).length,
      loans: (content['loans'] as List).length,
      ledgerEntries: (content['ledger_entries'] as List).length,
    );
  }
}

class RestoreOutcome {
  const RestoreOutcome({
    required this.borrowers,
    required this.loans,
    required this.ledgerEntries,
  });
  final int borrowers;
  final int loans;
  final int ledgerEntries;
}

/// 備份檔在本機的存放位置與命名。
class BackupFiles {
  static const String extension = '.slbak';

  static Future<Directory> directory() async {
    final Directory docs = await getApplicationDocumentsDirectory();
    final Directory dir = Directory(p.join(docs.path, 'backups'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  static String fileName({required bool rescue, DateTime? at}) {
    final String stamp = (at ?? DateTime.now()).toIso8601String().replaceAll(
      RegExp(r'[:.]'),
      '-',
    );
    return '${rescue ? 'rescue' : 'lending-backup'}-$stamp$extension';
  }

  static Future<List<File>> list() async {
    final dir = await directory();
    final files = await dir
        .list()
        .where((e) => e is File && e.path.endsWith(extension))
        .cast<File>()
        .toList();
    files.sort((a, b) => b.path.compareTo(a.path)); // 新的在前
    return files;
  }
}
