/// 貸款狀態（完整列舉，見 docs/state-machines.md §1）。
enum LoanStatus {
  draft,
  pendingDecision,
  approvedConditional,
  offered,
  accepted,
  disbursed,
  current,
  delinquent,
  default_,
  settled,
  chargedOff,
  cancelled,
}

/// UI 精簡呈現的四種可見狀態（見 docs/state-machines.md §1）。
enum LoanStatusGroup { draft, current, delinquent, closed }

extension LoanStatusX on LoanStatus {
  static const Map<LoanStatus, Set<LoanStatus>> _allowedTransitions = {
    LoanStatus.draft: {LoanStatus.pendingDecision, LoanStatus.cancelled},
    LoanStatus.pendingDecision: {
      LoanStatus.approvedConditional,
      LoanStatus.cancelled,
    },
    LoanStatus.approvedConditional: {LoanStatus.offered, LoanStatus.cancelled},
    LoanStatus.offered: {LoanStatus.accepted, LoanStatus.cancelled},
    LoanStatus.accepted: {LoanStatus.disbursed, LoanStatus.cancelled},
    LoanStatus.disbursed: {LoanStatus.current},
    LoanStatus.current: {LoanStatus.delinquent, LoanStatus.settled},
    LoanStatus.delinquent: {
      LoanStatus.current,
      LoanStatus.default_,
      LoanStatus.settled,
    },
    LoanStatus.default_: {LoanStatus.chargedOff, LoanStatus.settled},
    LoanStatus.settled: {},
    LoanStatus.chargedOff: {},
    LoanStatus.cancelled: {},
  };

  bool canTransitionTo(LoanStatus target) =>
      _allowedTransitions[this]?.contains(target) ?? false;

  bool get isTerminal =>
      this == LoanStatus.settled ||
      this == LoanStatus.chargedOff ||
      this == LoanStatus.cancelled;

  bool get isDisbursed =>
      this == LoanStatus.disbursed ||
      this == LoanStatus.current ||
      this == LoanStatus.delinquent ||
      this == LoanStatus.default_ ||
      this == LoanStatus.settled ||
      this == LoanStatus.chargedOff;

  LoanStatusGroup get group {
    switch (this) {
      case LoanStatus.draft:
      case LoanStatus.pendingDecision:
      case LoanStatus.approvedConditional:
      case LoanStatus.offered:
      case LoanStatus.accepted:
        return LoanStatusGroup.draft;
      case LoanStatus.disbursed:
      case LoanStatus.current:
        return LoanStatusGroup.current;
      case LoanStatus.delinquent:
      case LoanStatus.default_:
        return LoanStatusGroup.delinquent;
      case LoanStatus.settled:
      case LoanStatus.chargedOff:
      case LoanStatus.cancelled:
        return LoanStatusGroup.closed;
    }
  }
}

/// 核貸建議（系統永不自動核准，只能輸出建議）。
enum UnderwritingRecommendation {
  approveRecommend,
  refer,
  requestInfo,
  declineRecommend,
  escalateFraud,
}
