import 'dart:ffi';
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlcipher_flutter_libs/sqlcipher_flutter_libs.dart';
import 'package:sqlite3/open.dart';

/// 開啟本機 SQLCipher 加密資料庫（見 spec §0：本機 SQLite 加密儲存、不上傳
/// 伺服器）。[passphrase] 由 `packages/license` 或裝置金鑰庫衍生，不寫死於
/// 程式碼。
LazyDatabase openEncryptedConnection({
  required String passphrase,
  String dbFileName = 'lending.db',
}) {
  return LazyDatabase(() async {
    _overrideForSqlCipher();

    final Directory dbFolder = await getApplicationDocumentsDirectory();
    final File file = File(p.join(dbFolder.path, dbFileName));

    return NativeDatabase.createInBackground(
      file,
      setup: (rawDb) {
        rawDb.execute("PRAGMA key = '${passphrase.replaceAll("'", "''")}';");
        rawDb.execute('PRAGMA foreign_keys = ON;');
      },
    );
  });
}

bool _overridden = false;

void _overrideForSqlCipher() {
  if (_overridden) return;
  _overridden = true;
  open.overrideFor(OperatingSystem.android, openCipherOnAndroid);
  open.overrideFor(OperatingSystem.iOS, DynamicLibrary.process);
}
