import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// 備份匯出：複製本機加密資料庫檔案到 `backups/` 子目錄，回傳備份檔路徑。
/// 全程只在本機檔案系統操作，不上傳伺服器（見 spec §0）。
Future<File> backupDatabaseFile({String dbFileName = 'lending.db'}) async {
  final Directory dbFolder = await getApplicationDocumentsDirectory();
  final File source = File(p.join(dbFolder.path, dbFileName));
  if (!await source.exists()) {
    throw StateError('找不到資料庫檔案：${source.path}');
  }
  final Directory backupDir = Directory(p.join(dbFolder.path, 'backups'));
  if (!await backupDir.exists()) {
    await backupDir.create(recursive: true);
  }
  final String timestamp = DateTime.now().toIso8601String().replaceAll(
    RegExp(r'[:.]'),
    '-',
  );
  final File target = File(
    p.join(backupDir.path, 'lending-backup-$timestamp.db'),
  );
  return source.copy(target.path);
}
