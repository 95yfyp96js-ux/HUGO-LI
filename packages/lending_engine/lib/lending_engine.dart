/// Small Lending OS 領域引擎：計息、攤還計畫、狀態機、瀑布、日結、尾差處理。
///
/// UI 不得內嵌任何攤還公式，一律呼叫本套件。
library;

export 'src/accrual.dart';
export 'src/engine.dart';
export 'src/loan_status.dart';
export 'src/money.dart';
export 'src/rate.dart';
export 'src/schedule.dart';
export 'src/schedule_item_status.dart';
export 'src/waterfall.dart';
