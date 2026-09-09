import 'dart:io';

import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:web_ledger/db/schema.dart';
import 'package:web_ledger/web/handlers.dart';

/// 第 1 版：一個網址，電腦與 iPhone Safari 同一套。
///
/// 用法：
///   dart run bin/server.dart            # 資料存 ledger.db
///   PORT=9000 dart run bin/server.dart
Future<void> main(List<String> args) async {
  final String path = Platform.environment['DB_PATH'] ?? 'ledger.db';
  final int port = int.tryParse(Platform.environment['PORT'] ?? '') ?? 8080;
  final db = openDatabase(path: path);
  final handlers = AppHandlers(db);
  final server = await shelf_io.serve(handlers.handler, '0.0.0.0', port);
  stdout.writeln('小額借款＋支票貼現：http://localhost:${server.port}/  （DB: $path）');
}
