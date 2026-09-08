/// 期別狀態（見 docs/state-machines.md §2）。
enum ScheduleItemStatus { due, paid, partial, prepaid, overdue, waived }

extension ScheduleItemStatusX on ScheduleItemStatus {
  bool get isTerminal =>
      this == ScheduleItemStatus.paid ||
      this == ScheduleItemStatus.prepaid ||
      this == ScheduleItemStatus.waived;
}
