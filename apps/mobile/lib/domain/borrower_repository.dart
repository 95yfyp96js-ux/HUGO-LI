import 'package:drift/drift.dart';

import '../db/app_database.dart';
import '../db/pii_codec.dart';
import 'id_gen.dart';

class DuplicateBorrowerException implements Exception {
  DuplicateBorrowerException(this.existingBorrowerId);
  final String existingBorrowerId;
}

/// 借款人管理（見 spec §1「借款人管理」、不變式 5：身分證只存密文＋雜湊查重）。
class BorrowerRepository {
  BorrowerRepository(this._db, this._codec);

  final AppDatabase _db;
  final PiiCodec _codec;

  Future<List<Borrower>> listAll() => (_db.select(
    _db.borrowers,
  )..orderBy([(t) => OrderingTerm.desc(t.createdAt)])).get();

  Stream<List<Borrower>> watchAll() => (_db.select(
    _db.borrowers,
  )..orderBy([(t) => OrderingTerm.desc(t.createdAt)])).watch();

  Future<Borrower?> findById(String id) => (_db.select(
    _db.borrowers,
  )..where((t) => t.id.equals(id))).getSingleOrNull();

  /// 新增借款人。同一身分證字號（依 idHash 查重，不明文比對）已存在時拋出
  /// [DuplicateBorrowerException]，由呼叫端決定是否沿用既有借款人。
  Future<Borrower> create({
    required String name,
    required String idNumber,
    String? phone,
    String? address,
    String? bankAccount,
  }) async {
    final String idHash = PiiCodec.hashForDedup(idNumber);
    final existing = await (_db.select(
      _db.borrowers,
    )..where((t) => t.idHash.equals(idHash))).getSingleOrNull();
    if (existing != null) {
      throw DuplicateBorrowerException(existing.id);
    }

    final id = newId();
    final companion = BorrowersCompanion.insert(
      id: id,
      name: name,
      idNumberCipher: _codec.encryptText(idNumber),
      idHash: idHash,
      phone: Value(phone),
      addressCipher: Value(
        address == null ? null : _codec.encryptText(address),
      ),
      bankAccountCipher: Value(
        bankAccount == null ? null : _codec.encryptText(bankAccount),
      ),
      createdAt: DateTime.now(),
    );
    await _db.into(_db.borrowers).insert(companion);
    return (await findById(id))!;
  }

  /// 畫面顯示用：解密後只回傳遮罩字串（末 4 碼），絕不回傳明文。
  String maskedIdNumber(Borrower borrower) {
    final plain = _codec.decryptText(borrower.idNumberCipher);
    return PiiCodec.maskTail4(plain);
  }
}
