# 網頁版第 1 版：收款並核銷 ＋ 活盤

一個網址，電腦與 iPhone Safari 同一套。規格見
[`docs/BOSS-SPEC.md`](../../docs/BOSS-SPEC.md)。

## 這一輪只有一個畫面

| 位置 | 內容 |
|---|---|
| 左 | **收款並核銷** — 必選「哪一筆借款的哪幾期」、金額到分、溢繳先確認、`op_id` 開表單就發 |
| 右 | **活盤五格** — 含改過的格 2（所有持有票面，拆未到期／已到期未處理）＋今日未核銷紅字；現況與流水重放對不上就打「盤不平」 |

票的收票／兌現／退票畫面、日結四關畫面**這一輪沒做**（`CheckService`、
`LoanService` 只提供函式給種子資料與測試用，沒有 HTTP 入口）。

## 跑起來

```bash
cd apps/web
dart pub get
dart run bin/seed.dart          # 假資料（可略）
dart run bin/server.dart        # http://localhost:8080
```

環境變數：`PORT`（預設 8080）、`DB_PATH`（預設 `ledger.db`）。

```bash
dart analyze   # 預期 No issues found!
dart test      # 預期 40 支全過
```

## 金額權威在伺服器

- 分配（罰息→費用→利息→本金）、罰息計提、五格、盤不平，全部在 Dart 後端算，
  攤還公式直接呼叫 `packages/lending_engine`（沒有重寫、沒有編成 JS）。
- 瀏覽器收到的每個金額都是伺服器格式化好的字串。**這一頁沒有 `<script>`**，
  溢繳確認也是一次伺服器來回。`test/page_test.dart` 有一支測試在盯這件事。

## 為什麼計畫表要重算

`schedule_items` 只存「已繳了多少」，每期的本金／利息／到期日一律由
`lending_engine` 依貸款條件**重算**。所以有人手改資料庫裡的金額欄位而沒有留
分錄時，重放算出來的數字會跟現況對不上，右邊就會打「盤不平」並列出差在哪一格、
差多少（`test/board_test.dart`）。
