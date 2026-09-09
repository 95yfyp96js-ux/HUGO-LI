import 'dart:ffi';
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlcipher_flutter_libs/sqlcipher_flutter_libs.dart';
import 'package:sqlite3/open.dart';

/// 開發旁路：`--dart-define=DISABLE_DB_ENCRYPTION=true` 可關掉 SQLCipher，
/// 用一般 sqlite3 開檔（方便用 DB 工具直接檢查內容）。
///
/// **正式 build 一定是加密的**：這個旗標預設 false，而且 release build 會直接
/// 忽略它（見 [databaseEncryptionEnabled]），所以不可能靠傳旗標把上架版本
/// 變成明文。
const bool _disableEncryptionFlag = bool.fromEnvironment(
  'DISABLE_DB_ENCRYPTION',
);

/// 目前這個 build 是否加密儲存。設定頁的「儲存狀態」顯示這個值（只顯示開／關，
/// 不顯示金鑰本身）。
bool get databaseEncryptionEnabled {
  // kReleaseMode 等價判斷：assert 在 release 被移除，所以 debug/profile 才有
  // 機會關閉加密。
  bool allowDisable = false;
  assert(() {
    allowDisable = true;
    return true;
  }());
  return !(allowDisable && _disableEncryptionFlag);
}

Future<File> databaseFile({String dbFileName = 'lending.db'}) async {
  final Directory dbFolder = await getApplicationDocumentsDirectory();
  return File(p.join(dbFolder.path, dbFileName));
}

/// 開啟本機資料庫。預設 SQLCipher 加密、只存本機、不上傳伺服器（spec §0）。
/// [passphrase] 來自 Keychain／Keystore（見 db_key_store.dart），不寫死於程式碼。
LazyDatabase openEncryptedConnection({
  required String passphrase,
  String dbFileName = 'lending.db',
}) {
  return LazyDatabase(() async {
    final bool encrypted = databaseEncryptionEnabled;
    if (encrypted) _overrideForSqlCipher();

    final File file = await databaseFile(dbFileName: dbFileName);

    return NativeDatabase.createInBackground(
      file,
      setup: (rawDb) {
        if (encrypted) {
          rawDb.execute("PRAGMA key = '${passphrase.replaceAll("'", "''")}';");
        }
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
