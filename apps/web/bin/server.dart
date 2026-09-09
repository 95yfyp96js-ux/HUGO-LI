import 'dart:io';

import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:sqlite3/sqlite3.dart';
import 'package:web_ledger/db/schema.dart';
import 'package:web_ledger/domain/auth.dart';
import 'package:web_ledger/web/handlers.dart';

/// 第 1 版：一個網址，電腦與 iPhone Safari 同一套。
///
///   dart run bin/server.dart
///   PORT=9000 DB_PATH=/tmp/x.db dart run bin/server.dart
///
/// 第一次啟動會建兩個帳號（老闆 boss / 員工 staff），密碼由
/// `BOSS_PASSWORD` / `STAFF_PASSWORD` 指定，沒給就隨機產生並印在主控台。
Future<void> main(List<String> args) async {
  final String path = Platform.environment['DB_PATH'] ?? 'ledger.db';
  final int port = int.tryParse(Platform.environment['PORT'] ?? '') ?? 8080;
  final db = openDatabase(path: path);
  bootstrapUsers(db);
  // 對外開放時把 cookie 標成 Secure（見 docs/WEB-RUN.md）。
  final bool secure = Platform.environment['SECURE_COOKIES'] == '1';
  final handlers = AppHandlers(db, secureCookies: secure);
  final server = await shelf_io.serve(handlers.handler, '0.0.0.0', port);
  stdout.writeln('小額借款＋支票貼現：http://localhost:${server.port}/  （DB: $path）');
}

/// 只在 users 表是空的時候建立初始帳號。**不會覆蓋既有密碼。**
void bootstrapUsers(Database db) {
  final n = db.select('SELECT COUNT(*) AS n FROM users').first['n'] as int;
  if (n > 0) return;
  final auth = AuthService(db);
  final String bossPw =
      Platform.environment['BOSS_PASSWORD'] ?? _randomPassword();
  final String staffPw =
      Platform.environment['STAFF_PASSWORD'] ?? _randomPassword();
  auth.createUser(
    username: 'boss',
    displayName: '老闆',
    role: Role.boss,
    password: bossPw,
  );
  auth.createUser(
    username: 'staff',
    displayName: '阿明',
    role: Role.staff,
    password: staffPw,
  );
  stdout.writeln('已建立初始帳號（只會建立一次）：');
  stdout.writeln('  老闆  boss  / $bossPw');
  stdout.writeln('  員工  staff / $staffPw');
  stdout.writeln('請自己記下來，這行不會再印第二次。');
}

String _randomPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  final r = DateTime.now().microsecondsSinceEpoch;
  final buffer = StringBuffer();
  var seed = r;
  for (int i = 0; i < 12; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buffer.write(chars[seed % chars.length]);
  }
  return buffer.toString();
}
