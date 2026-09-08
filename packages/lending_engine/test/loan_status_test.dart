import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('LoanStatus 狀態機', () {
    test('合法轉移允許', () {
      expect(
          LoanStatus.draft.canTransitionTo(LoanStatus.pendingDecision), isTrue);
      expect(
        LoanStatus.pendingDecision
            .canTransitionTo(LoanStatus.approvedConditional),
        isTrue,
      );
      expect(LoanStatus.accepted.canTransitionTo(LoanStatus.disbursed), isTrue);
      expect(LoanStatus.disbursed.canTransitionTo(LoanStatus.current), isTrue);
      expect(LoanStatus.current.canTransitionTo(LoanStatus.delinquent), isTrue);
      expect(LoanStatus.delinquent.canTransitionTo(LoanStatus.current), isTrue);
      expect(
          LoanStatus.delinquent.canTransitionTo(LoanStatus.default_), isTrue);
      expect(
          LoanStatus.default_.canTransitionTo(LoanStatus.chargedOff), isTrue);
    });

    test('非法轉移禁止（例如跳過撥款直接變 CURRENT）', () {
      expect(LoanStatus.draft.canTransitionTo(LoanStatus.current), isFalse);
      expect(LoanStatus.draft.canTransitionTo(LoanStatus.disbursed), isFalse);
      expect(LoanStatus.offered.canTransitionTo(LoanStatus.disbursed), isFalse);
    });

    test('終態不可再轉移', () {
      for (final status in [
        LoanStatus.settled,
        LoanStatus.chargedOff,
        LoanStatus.cancelled
      ]) {
        expect(status.isTerminal, isTrue);
        for (final target in LoanStatus.values) {
          expect(status.canTransitionTo(target), isFalse,
              reason: '$status -> $target');
        }
      }
    });

    test('撥款前狀態不可取消到已撥款狀態（未撥款不可逆跳過核決流程）', () {
      expect(LoanStatus.disbursed.canTransitionTo(LoanStatus.draft), isFalse);
    });

    test('UI 精簡分組對應正確', () {
      expect(LoanStatus.draft.group, LoanStatusGroup.draft);
      expect(LoanStatus.offered.group, LoanStatusGroup.draft);
      expect(LoanStatus.disbursed.group, LoanStatusGroup.current);
      expect(LoanStatus.current.group, LoanStatusGroup.current);
      expect(LoanStatus.delinquent.group, LoanStatusGroup.delinquent);
      expect(LoanStatus.default_.group, LoanStatusGroup.delinquent);
      expect(LoanStatus.settled.group, LoanStatusGroup.closed);
      expect(LoanStatus.cancelled.group, LoanStatusGroup.closed);
    });

    test('isDisbursed 只在撥款後為 true', () {
      expect(LoanStatus.accepted.isDisbursed, isFalse);
      expect(LoanStatus.disbursed.isDisbursed, isTrue);
      expect(LoanStatus.current.isDisbursed, isTrue);
      expect(LoanStatus.settled.isDisbursed, isTrue);
    });
  });

  group('ScheduleItemStatus', () {
    test('終態判定', () {
      expect(ScheduleItemStatus.paid.isTerminal, isTrue);
      expect(ScheduleItemStatus.prepaid.isTerminal, isTrue);
      expect(ScheduleItemStatus.waived.isTerminal, isTrue);
      expect(ScheduleItemStatus.due.isTerminal, isFalse);
      expect(ScheduleItemStatus.partial.isTerminal, isFalse);
      expect(ScheduleItemStatus.overdue.isTerminal, isFalse);
    });
  });

  group('UnderwritingRecommendation', () {
    test('五種建議完整列舉，系統永不自動核准', () {
      expect(UnderwritingRecommendation.values, hasLength(5));
      expect(
        UnderwritingRecommendation.values,
        containsAll([
          UnderwritingRecommendation.approveRecommend,
          UnderwritingRecommendation.refer,
          UnderwritingRecommendation.requestInfo,
          UnderwritingRecommendation.declineRecommend,
          UnderwritingRecommendation.escalateFraud,
        ]),
      );
    });
  });
}
