// 備份／還原：資料不能掉。
//
// 重點不只是「還原得回來」，更是「失敗的時候不能把現有的庫毀掉」——口令錯、
// 檔案壞、版本不合，三種情況現庫都必須原封不動。
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/db/backup_codec.dart';
import 'package:mobile/db/backup_service.dart';
import 'package:mobile/domain/dashboard_repository.dart';
import 'package:mobile/domain/loan_repository.dart';

/// 測試用的低迭代次數：正式預設是 150,000（每次約 0.2 秒），測試裡不需要。
const int kTestIterations = 1000;

Future<AppDatabase> _open() async => AppDatabase(NativeDatabase.memory());

Future<String> _seedLoan(AppDatabase db, {String suffix = ''}) async {
  final loans = LoanRepository(db);
  await db
      .into(db.borrowers)
      .insert(
        BorrowersCompanion.insert(
          id: 'b$suffix',
          name: '王小明$suffix',
          idNumberCipher: 'cipher$suffix',
          idHash: 'hash$suffix',
          createdAt: DateTime.now(),
        ),
      );
  final loan = await loans.registerLoan(
    borrowerId: 'b$suffix',
    principalCents: 10000000,
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 100,
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
    plannedDisbursementDate: DateTime.now(),
  );
  await loans.confirmDisbursement(loan.id);
  await loans.recordPayment(
    loanId: loan.id,
    amountCents: 888488,
    paidAt: DateTime.now(),
  );
  return loan.id;
}

void main() {
  group('備份檔加解密（backup_codec）', () {
    test('往返：加密後用同一組口令解得回原內容', () {
      final content = {
        'borrowers': [
          {'id': 'b1', 'name': '王小明'},
        ],
        'loans': <dynamic>[],
      };
      final armored = encodeBackup(
        content: content,
        passphrase: 'hunter2',
        iterations: kTestIterations,
      );
      final decoded = decodeBackup(armored: armored, passphrase: 'hunter2');
      expect(decoded, content);
    });

    test('備份檔外層是可辨識的 JSON 信封，且不含明文內容', () {
      final armored = encodeBackup(
        content: {
          'borrowers': [
            {'name': '王小明', 'idNumberCipher': 'secret'},
          ],
        },
        passphrase: 'hunter2',
        iterations: kTestIterations,
      );
      expect(armored, contains('"format": "SLOS-BACKUP"'));
      expect(armored, contains('"version": 1'));
      expect(armored, contains('PBKDF2-HMAC-SHA256'));
      // 內容必須是密文：明文欄位不可以出現在檔案裡。
      expect(armored, isNot(contains('王小明')));
      expect(armored, isNot(contains('idNumberCipher')));
    });

    test('口令錯 → BackupPassphraseException', () {
      final armored = encodeBackup(
        content: {'borrowers': <dynamic>[]},
        passphrase: '正確口令',
        iterations: kTestIterations,
      );
      expect(
        () => decodeBackup(armored: armored, passphrase: '錯誤口令'),
        throwsA(isA<BackupPassphraseException>()),
      );
    });

    test('檔案被竄改 → BackupPassphraseException（GCM 驗證擋下）', () {
      final armored = encodeBackup(
        content: {'borrowers': <dynamic>[]},
        passphrase: 'hunter2',
        iterations: kTestIterations,
      );
      // 動 payload 的最後一個 base64 字元。
      final tampered = armored.replaceFirst(
        RegExp(r'"payload": "([^"]+)"'),
        '"payload": "AAAA"',
      );
      expect(
        () => decodeBackup(armored: tampered, passphrase: 'hunter2'),
        throwsA(isA<BackupException>()),
      );
    });

    test('不是備份檔 → BackupFormatException', () {
      expect(
        () => decodeBackup(armored: '這不是備份檔', passphrase: 'x'),
        throwsA(isA<BackupFormatException>()),
      );
      expect(
        () => decodeBackup(armored: '{"format":"OTHER"}', passphrase: 'x'),
        throwsA(isA<BackupFormatException>()),
      );
    });

    test('版本比 App 新 → BackupVersionException，訊息說明要更新 App', () {
      final armored = encodeBackup(
        content: {'borrowers': <dynamic>[]},
        passphrase: 'hunter2',
        iterations: kTestIterations,
      ).replaceFirst('"version": 1', '"version": 99');
      expect(
        () => decodeBackup(armored: armored, passphrase: 'hunter2'),
        throwsA(
          isA<BackupVersionException>().having(
            (e) => e.message,
            'message',
            allOf(contains('v99'), contains('現有資料未變動')),
          ),
        ),
      );
    });

    test('空口令不給匯出', () {
      expect(
        () => encodeBackup(content: const {}, passphrase: ''),
        throwsA(isA<BackupPassphraseException>()),
      );
    });
  });

  group('還原（BackupService）', () {
    test('還原後借款人、貸款、分錄、看板數字與備份當下一致', () async {
      final source = await _open();
      final loanId = await _seedLoan(source);
      final sourceRepo = LoanRepository(source);
      final sourceDash = DashboardRepository(sourceRepo);
      final before = await sourceDash.compute();
      final beforeSchedule = await sourceRepo.scheduleFor(loanId);
      final beforeLedger = await sourceRepo.ledgerFor(loanId);

      final armored = await BackupService(source)
          .exportToString(passphrase: 'hunter2', iterations: kTestIterations);
      await source.close();

      // 換一個全新的空資料庫還原。
      final target = await _open();
      String? rescue;
      final outcome = await BackupService(target).restoreFromString(
        armored: armored,
        passphrase: 'hunter2',
        iterations: kTestIterations,
        saveRescue: (r) async => rescue = r,
      );

      expect(rescue, isNotNull, reason: '還原前一定要先做救援備份');
      expect(outcome.borrowers, 1);
      expect(outcome.loans, 1);

      final targetRepo = LoanRepository(target);
      expect(await targetRepo.listAll(), hasLength(1));
      expect((await target.select(target.borrowers).get()).single.name, '王小明');

      final afterSchedule = await targetRepo.scheduleFor(loanId);
      expect(afterSchedule, hasLength(beforeSchedule.length));
      for (var i = 0; i < afterSchedule.length; i++) {
        expect(
          afterSchedule[i].principalCents,
          beforeSchedule[i].principalCents,
        );
        expect(afterSchedule[i].interestCents, beforeSchedule[i].interestCents);
        expect(afterSchedule[i].status, beforeSchedule[i].status);
        expect(afterSchedule[i].dueDate, beforeSchedule[i].dueDate);
      }

      final afterLedger = await targetRepo.ledgerFor(loanId);
      expect(afterLedger.map((e) => e.type), beforeLedger.map((e) => e.type));
      expect(
        afterLedger.map((e) => e.amountCents),
        beforeLedger.map((e) => e.amountCents),
      );

      final after = await DashboardRepository(targetRepo).compute();
      expect(after.totalDisbursedCents, before.totalDisbursedCents);
      expect(
        after.totalInterestReceivedCents,
        before.totalInterestReceivedCents,
      );
      expect(
        after.totalOutstandingPrincipalCents,
        before.totalOutstandingPrincipalCents,
      );
      expect(after.totalUnpaidInterestCents, before.totalUnpaidInterestCents);
      expect(after.totalReceivableCents, before.totalReceivableCents);
      expect(after.totalOverdueCents, before.totalOverdueCents);

      await target.close();
    });

    test('還原會覆蓋掉目標庫原有的資料，但救援備份救得回來', () async {
      // 目標庫本來有自己的一筆資料。
      final target = await _open();
      await _seedLoan(target, suffix: '-舊');
      final targetRepo = LoanRepository(target);
      expect(await targetRepo.listAll(), hasLength(1));

      // 另一個庫的備份。
      final source = await _open();
      await _seedLoan(source, suffix: '-新');
      final armored = await BackupService(source)
          .exportToString(passphrase: 'pw', iterations: kTestIterations);
      await source.close();

      String? rescue;
      await BackupService(target).restoreFromString(
        armored: armored,
        passphrase: 'pw',
        iterations: kTestIterations,
        saveRescue: (r) async => rescue = r,
      );
      expect(
        (await target.select(target.borrowers).get()).single.name,
        '王小明-新',
      );

      // 用救援備份倒回去，原本的資料回來了。
      await BackupService(target).restoreFromString(
        armored: rescue!,
        passphrase: 'pw',
        iterations: kTestIterations,
        saveRescue: (_) async {},
      );
      expect(
        (await target.select(target.borrowers).get()).single.name,
        '王小明-舊',
      );

      await target.close();
    });

    test('口令錯：拋例外且現有資料完全不動', () async {
      final target = await _open();
      await _seedLoan(target, suffix: '-原');

      final source = await _open();
      await _seedLoan(source, suffix: '-新');
      final armored = await BackupService(source)
          .exportToString(passphrase: '正確', iterations: kTestIterations);
      await source.close();

      await expectLater(
        BackupService(target).restoreFromString(
          armored: armored,
          passphrase: '錯的',
          iterations: kTestIterations,
          saveRescue: (_) async {},
        ),
        throwsA(isA<BackupPassphraseException>()),
      );

      expect(
        (await target.select(target.borrowers).get()).single.name,
        '王小明-原',
        reason: '口令錯不可以動到現有資料',
      );
      expect(await LoanRepository(target).listAll(), hasLength(1));
      await target.close();
    });

    test('檔案壞掉：拋例外且現有資料完全不動', () async {
      final target = await _open();
      await _seedLoan(target, suffix: '-原');

      await expectLater(
        BackupService(target).restoreFromString(
          armored: '{"format":"SLOS-BACKUP","version":1,"kdf":{}}',
          passphrase: 'pw',
          iterations: kTestIterations,
          saveRescue: (_) async {},
        ),
        throwsA(isA<BackupFormatException>()),
      );
      expect(
        (await target.select(target.borrowers).get()).single.name,
        '王小明-原',
      );
      await target.close();
    });

    test('內容缺表：拋例外且現有資料完全不動', () async {
      final target = await _open();
      await _seedLoan(target, suffix: '-原');

      // 格式與口令都對，但內容少了資料表。
      final armored = encodeBackup(
        content: {'borrowers': <dynamic>[]},
        passphrase: 'pw',
        iterations: kTestIterations,
      );
      await expectLater(
        BackupService(target).restoreFromString(
          armored: armored,
          passphrase: 'pw',
          iterations: kTestIterations,
          saveRescue: (_) async {},
        ),
        throwsA(
          isA<BackupFormatException>().having(
            (e) => e.message,
            'message',
            contains('未進行還原'),
          ),
        ),
      );
      expect(await LoanRepository(target).listAll(), hasLength(1));
      await target.close();
    });

    test('救援備份寫不出來就整個中止，不會走到替換那一步', () async {
      final target = await _open();
      await _seedLoan(target, suffix: '-原');

      final source = await _open();
      await _seedLoan(source, suffix: '-新');
      final armored = await BackupService(source)
          .exportToString(passphrase: 'pw', iterations: kTestIterations);
      await source.close();

      await expectLater(
        BackupService(target).restoreFromString(
          armored: armored,
          passphrase: 'pw',
          iterations: kTestIterations,
          saveRescue: (_) async => throw const FileSystemException('磁碟已滿'),
        ),
        throwsA(isA<FileSystemException>()),
      );
      expect(
        (await target.select(target.borrowers).get()).single.name,
        '王小明-原',
      );
      await target.close();
    });
  });
}
