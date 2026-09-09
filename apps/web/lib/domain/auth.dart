import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import 'settlement.dart' show newId, SettlementRejected;

/// 登入與權限（docs/BOSS-SPEC.md A、docs/THREAT-REVIEW.md 第 8、11 條）。
///
/// 三條寫死的：
/// 1. **每人一組帳號，不共用。** 流水上的名字要對得到人。
/// 2. **停用即時生效。** 每一次請求都重查帳號狀態，不是只看 cookie 有沒有
///    簽名——離職當天停用，他手上開著的分頁下一次動作就會被踢出去。
/// 3. **權限在後端判。** 前端不顯示按鈕不算權限；每個老闆專屬的動作都會再
///    檢查一次角色。
class User {
  const User({
    required this.id,
    required this.username,
    required this.displayName,
    required this.role,
  });

  final String id;
  final String username;
  final String displayName;
  final String role;

  bool get isBoss => role == Role.boss;
  String get roleLabel => isBoss ? '老闆' : '員工';
}

class AuthService {
  AuthService(this.db);

  final Database db;

  String createUser({
    required String username,
    required String displayName,
    required String role,
    required String password,
  }) {
    final String id = newId();
    final String salt = newId();
    db.execute(
      'INSERT INTO users (id, username, display_name, role, password_hash, salt) '
      'VALUES (?, ?, ?, ?, ?, ?)',
      [id, username, displayName, role, _hash(password, salt), salt],
    );
    return id;
  }

  void disable(String userId) {
    db.execute('UPDATE users SET disabled_at = ? WHERE id = ?', [
      DateTime.now().toIso8601String(),
      userId,
    ]);
    // 停用即撤銷所有既有登入，不等他自己登出。
    db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  /// 登入成功回 session token；失敗一律丟同一句話，不透露是帳號錯還是密碼錯。
  String login(String username, String password) {
    final rows = db.select('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.isEmpty) throw SettlementRejected('帳號或密碼不對。');
    final row = rows.first;
    if (row['disabled_at'] != null) {
      throw SettlementRejected('這個帳號已停用，請找老闆。');
    }
    if (_hash(password, row['salt'] as String) != row['password_hash']) {
      throw SettlementRejected('帳號或密碼不對。');
    }
    final String token = '${newId()}${newId()}';
    db.execute(
      'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
      [token, row['id'], DateTime.now().toIso8601String()],
    );
    return token;
  }

  void logout(String token) =>
      db.execute('DELETE FROM sessions WHERE token = ?', [token]);

  /// 每次請求都走這裡：帳號被停用時，既有的 cookie 立刻失效。
  User? userForToken(String? token) {
    if (token == null || token.isEmpty) return null;
    final rows = db.select(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id '
      'WHERE s.token = ? AND u.disabled_at IS NULL',
      [token],
    );
    if (rows.isEmpty) return null;
    final row = rows.first;
    return User(
      id: row['id'] as String,
      username: row['username'] as String,
      displayName: row['display_name'] as String,
      role: row['role'] as String,
    );
  }

  static String _hash(String password, String salt) =>
      sha256.convert(utf8.encode('$salt::$password')).toString();
}
