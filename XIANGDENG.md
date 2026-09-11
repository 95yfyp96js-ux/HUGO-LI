# 香燈年約 — 資訊架構

對齊 `DESIGN.md`。
這份文件定義 route 分屬、家庭與燈的資料、一年週期、到期前 30／7／1 天的畫面，以及什麼東西可以是紙。

訂閱賣的是「這一盎還在、家裡的名字還在燈上」，不是更靈、更亮、更多抽籤。

---

## 0. 目標與非目標

### 做

- 把台灣宮廟已存在的年燈週期（約元宵開燈、十二月廿四關燈）做成可續的年約。
- 一戶多盎：本人、家人、毛孩。
- 讓香客在非年節的十一個月裡，看得到燈還在、願有沒有還、初一十五到了。
- 紙憑據只發給「廟方或香客真正會經手的紙」。

### 不做

- 不賣「訂戶燈比較旺」。
- 不把每日抽籤、無限擲笋做成年約甜頭。
- 不把祭改、補運套裝、改運方案打進年約禮包。
- 不做功德排行、電子放生、3D 佛堂、第二光源。
- 不讓沒付錢的人進不了廟：求籤、擲笋、看廟、看自己的紀錄摘要維持可及。

### 用詞

對香客與對內文案都用左邊，不用右邊。

| 用 | 不用 |
|---|---|
| 香燈、續點、香燈油、守護這一盎 | 訂閱、會員、VIP、Premium、Plus |
| 年約、開燈、關燈、安奉 | 方案升級、解鎖、加倍靈驗 |
| 名條、疏文、香火帳 | 電子符、NFT、成就徽章 |
| 家庭、這一戶 | 席次、seat、workspace |

介面上對香客避免出現「訂閱」二字。對帳務系統、App Store 後台可以對內叫 subscription。

---

## 1. 三層權益

### 可及（免費）

任何人可做：

- 看廟、看燈種說明（管理）
- 拜拜（儀式：上香／禱詞；管理：寫祈願卡）
- 抽籤（儀式：擲笋→抽籤→展開籤紙；管理：AI 解讀、存檔）
- 看自己的香火帳摘要
- 初一／十五當天一則提醒（若已留下通知許可）

### 香燈（年約，主商品）

對標現有油香 600–1,200 元／盎／年，一戶可多盎。

一盎香燈包含：

- 指定宮廟、燈種、被點燈人（姓名、生辰、地址）
- 廟方實體安奉
- 開燈日→關燈日的日曆
- 名條與安奉通知的狀態
- 到期前 30／7／1 天續點
- 香火帳裡這一盎的完整紀錄

一盎一價。家庭折扣若做，用「同一戶第二盎起」表述，不用「升級方案」。

### 守護（可選、薄、年或月）

只賣在場，不賣燈：

- 初一十五流程提醒（先神明、後祖先；若產品做家庭神案）
- 願的到期
- 該廟聖誕／開燈／關燈節點
- 把實體籤／通知函拍進香火帳（墨色紙存檔）

價格心理帳戶必須是香油，不是影音平台。
無守護仍可持有香燈。

---

## 2. Route 地圖

每個 route 必須標 `mode: ceremony | page`。
一個 route 只能是一種。需要兩種節奏時，拆成兩個 route，用一次前進接起來。

### 儀式 `CeremonyScreen`（置中、一盎燈）

| route | 光釘在 | 何時進入 | 何時離開 |
|---|---|---|---|
| `/worship` | 香爐 | 香客說要拜 | 香盡、或寫完祈願卡之後回到管理 |
| `/lots` | 籤筒旁燭，或抽出籤紙前的爐 | 問事開始 | 籤紙展開後；解讀在下一頁 |
| `/lots/slip` | 極弱，紙自身不發光 | 聖笋之後 | 收進香火帳 |
| `/lamps/:id/kindle` | 這一盎燈 | 廟方狀態轉為「已安奉」後，或香客第一次打開該燈 | 火穩定，回 `/lamps/:id` |
| `/lamps/:id/extinguish` | 將滅的燈 | 關燈日當日可進 | 燈滅，回香火帳 |
| `/renew/:id/kindle` | 續點後新的一盎 | 續點完成且廟方已安奉 | 同 kindle |

`/lamps/:id/kindle` 是點燈作為儀式的唯一入口。
不得在 kindle 畫面放燈種選擇、身分欄位、付款。

### 管理 `PageScreen`（靠左、無光源強調）

| route | 內容 |
|---|---|
| `/` | 農曆條、這一戶的燈、距初一十五、到期最近的一盎 |
| `/explore` | 廟、燈種、節點說明 |
| `/records` | 香火帳：燈、籤、願、紙憑據索引 |
| `/household` | 這一戶的人（含毛孩） |
| `/lamps` | 燈列表 |
| `/lamps/new` | 選廟、選燈種、填名條、付款（整段管理） |
| `/lamps/:id` | 一盎燈的狀態、日期、名條預覽入口、續點入口 |
| `/lamps/:id/name-slip` | 名條紙（`<Paper>`），仍在管理殼，因為這是讀紙不是點火 |
| `/vows` | 許願／還願清單 |
| `/vows/new` | 寫祈願卡（卡是紙，頁是管理；寫完可選進 `/worship`） |
| `/renew/:id` | 續點表單與付款 |
| `/offerings/ritual-booking` | 祭改等預約。永遠管理。永不進年約禮包 |
| `/orders/:id` | 收據、物流、安奉進度（不是紙） |
| `/guard` | 守護說明與開關（文案禁止「解鎖」） |

### 明確禁止的混種

- 首頁中央放大香爐又在旁邊排燈種價目。
- `/lamps/new` 背景放一盎已經在燒的燈。
- 祭改頁加香爐或漸亮。
- 付款成功頁放煙火或第二光源。成功之後若要給儀式，導向 `/lamps/:id/kindle`，中間不插慶祝。

---

## 3. 資料

最小集合。名稱用香客聽得懂的字。

```
Household
  id
  notice_ok            # 可否提醒初一十五、到期

Person
  household_id
  name
  calendar             # lunar | civil
  birth
  birth_hour           # 可空，空則吉時
  address
  relation             # self | family | pet
  notes

Temple
  id
  name
  kindle_on            # 開燈，農曆日期
  extinguish_on        # 關燈，農曆日期
  ships_notice         # 是否寄通知函／結緣品

LampKind
  temple_id
  name                 # 光明、太歲、文昌、財神、姻緣、藥師、毛孩…
  purpose
  price_year
  requires_zodiac      # 安太歲類

Lamp
  id
  household_id
  person_id
  temple_id
  kind_id
  year                 # 農曆年
  status               # draft | paid | awaiting | seated | kindled | extinguishing | extinguished | lapsed
  seated_on
  kindle_on
  extinguish_on
  name_slip_id
  notice_shipment_id
  renewal_of           # 上一盎 id，可空

Vow
  id
  household_id
  person_id
  temple_id
  text
  made_on
  due_on               # 可空
  status               # open | due | fulfilled | released
  paper_id

Lot
  id
  household_id
  temple_id
  asked
  blocks               # 擲笋序列
  slip_no
  slip_paper_id
  reading              # AI 解讀，純文字，不是紙

Paper
  id
  type                 # slip | vow-card | name-slip | memorial | thanks-card | notice-scan
  ink
  source               # temple | household | scan
```

`Lamp.status` 推進：

```
draft → paid → awaiting → seated → kindled → extinguishing → extinguished
                                                      ↘ lapsed   （未續）
extinguished → (new Lamp.renewal_of) draft …
```

`kindled` 與 `extinguished` 必須能對上儀式 route。
中間的 `paid`／`awaiting`／`seated` 只出現在管理頁。

---

## 4. 一盎燈的一年

日期以合作廟為準。預設語意：

- 開燈：農曆正月十五（元宵）
- 關燈：農曆十二月二十四（送神）
- 年約涵蓋「這一盎被寫上名的那一年」，不是付款日加 365 天

若香客在年中點燈，仍然走到該年關燈日，價格與廟方一致，不自行發明「按月折算靈力」。

### 狀態在畫面上怎麼說

| status | 管理頁（靠左） | 儀式 |
|---|---|---|
| draft | 名條未送出 | 無 |
| paid | 已點、等候廟方 | 無 |
| awaiting | 廟方處理中 | 無 |
| seated | 名已上燈，可看名條 | 可進 kindle（若尚未看過點火） |
| kindled | 燃著。寫開燈日、關燈日 | 日常不進儀式 |
| extinguishing | 關燈日。燈將盡 | `/lamps/:id/extinguish` |
| extinguished | 已關。邀請續點 | 無 |
| lapsed | 未續。不消失，收入香火帳 | 無 |

燃著的時候，`/lamps/:id` 不放動態火。
火只存在 kindle／extinguish／拜拜／抽籤。
管理頁用一行字：「丙午年　光明燈　燃著　至十二月二十四」。

光的亮度不隨剩餘天數加劇閃爌。
若要表達將盡：關燈日前 7 天，管理頁字由 `ash` 轉為較少的 `ember` 文案，不加第二光源。

---

## 5. 到期前 30／7／1 天

對象：`status = kindled` 且距 `extinguish_on` 的天數。
提醒寫給「這一戶」，點進去落在 `/renew/:id`（管理），不是彈儀式。

### 30 天 — 記事

- 通路：站內一條、可選推播一則。
- 首頁農曆條多一行：某盎、某廟、關燈日。
- 文案語氣是記事，不是促銷。
  「十二月二十四關燈。這盎是給○○的光明燈，要續的話從這裡。」
- 不出現倒數動畫、不出現折扣。
- 不擋住求籤或拜拜。

### 7 天 — 請決定

- 通路：站內置頂一條、推播一則。
- `/lamps/:id` 主行動改為「續點」細線按鈕。
- 文案：
  「再七日關燈。續點是下一盎，不是把這盎再撥亮。」
- 仍可進名條紙。
- 若該人次年犯太歲，可在同一管理頁多一行說明，讓香客自己加太歲燈。不加套裝勾選。

### 1 天 — 關燈前夕

- 通路：站內一條。推播最多一則。
- 文案：
  「明日關燈。燈滅之後，這一盎會收進香火帳。」
- 提供兩個平等的細線行動：「續點下一盎」／「讓它關」。
- 「讓它關」不是流失話術，是合法結局。

### 關燈日

- 可進 `/lamps/:id/extinguish`（儀式，置中，光在將滅的燈）。
- 滅完回 `/records`。
- 未續：`extinguished` → 之後標 `lapsed`。
- 已續且廟方已收件：舊盎仍走滅燈；新盎走 `paid → awaiting → seated`，安奉後才進新的 kindle。
- 舊盎與新盎不得同畫面兩團火。

### 開燈日（已 seated 的新一年）

- 可進 `/lamps/:id/kindle`。
- 若香客當天不打開 App，不強迫播儀式。下一次進入 `/lamps/:id` 給一次「看點火」的入口，看過即收。

### 初一／十五（守護可加強，免費也可有一則）

- 管理首頁農曆條標出「今日初一」或「今日十五」。
- 不自動進入拜拜儀式。給一個靠左的入口「去拜」。
- 提醒次數：當日最多一則。不是連續打卡。

---

## 6. 點燈全程（年約轉換）

拆成兩段，中間用一次前進，不共用光源。

```
/explore 或 /
  → /lamps/new          管理：選廟、燈種、為誰、生辰地址、付款
  → /orders/:id         管理：等候安奉、物流
  →（廟方 seated）
  → /lamps/:id/kindle   儀式：火亮
  → /lamps/:id          管理：這一盎的日子
```

`/lamps/new` 欄位順序（大字、高對比）：

1. 哪一座廟
2. 哪一種燈（目的一句話，價錢一行，不排燈海）
3. 為誰（這一戶既有的人，或新增）
4. 名、生辰、時辰、地址
5. 確認名條預覽（此時可開 `<Paper>` 預覽，仍在管理殼）
6. 付款

名條預覽不是儀式。
付款成功不放煙火。下一句話是「名條已交給廟方」。

續點 `/renew/:id` 預填上一盎的人與廟與燈種，只問「還是這一位、這一盎嗎」。
改燈種或改人視為新的 `/lamps/new`，切斷 `renewal_of`。

---

## 7. 紙憑據

什麼時候用 `<Paper>`，紙上有什麼，從哪裡打開。

| 憑據 | type | 誰寫 | 打開位置 | 紙上有 | 紙上沒有 |
|---|---|---|---|---|---|
| 籤紙 | slip | 廟方籤譜 | `/lots/slip` | 籤號、籤題、籤文 | AI 解讀、分享按鈕 |
| 祈願卡 | vow-card | 香客 | `/vows/:id` | 姓名、所求、日期 | 價格 |
| 名條 | name-slip | 香客填、廟方安奉 | `/lamps/:id/name-slip` | 廟、燈種、姓名、生辰、年 | 訂單號、金額 |
| 疏文副本 | memorial | 廟方 | `/records/papers/:id` | 疏題、姓名、日期 | 行銷句 |
| 還願卡 | thanks-card | 香客 | `/vows/:id/fulfill` | 原願一句、已還 | 評分 |
| 通知函掃描 | notice-scan | 香客拍、守護可存 | `/records/papers/:id` | 原件影像、墨色註記 | 濾鏡、貼圖 |

朱印：僅當廟方狀態變 `seated` 之後，可在名條角落蓋一次「已安奉」。
一年一戳。續點是新的一張名條、新的一戳。

電子收據、物流編號、安奉進度條：`/orders/:id`，`ash` 字，不是紙。

AI 解讀：籤紙下方或次頁，旁白材質，可關。
解讀遺失不得讓籤文一起消失。

---

## 8. 首頁（管理）資訊層級

靠左，右邊留空。沒有香爐大圖。

由上到下只准這些區塊，可缺不可加燈海：

1. 今日農曆（含初一／十五／開燈／關燈若碰上）
2. 這一戶燃著的燈，一盎一行：為誰、哪種、哪廟、關燈日
3. 最近的一張未還的願（有才出現）
4. 兩個入口字：「去拜」「問一件事」
5. 探索、香火帳、這一戶 — 純字導覽

有 30／7／1 天到期時，第 2 塊把該行提前並改用到期文案。
仍然一行，不加色條動畫。

---

## 9. 與四條規則的檢查表

實作與 review 用。任一項失敗不得發佈該 route。

- [ ] 該 route 宣告了 `ceremony` 或 `page`，且只有一種
- [ ] `CeremonyScreen`／`PageScreen` 的 `light` 至多一盎；頁面沒有直接 render `<Light>`
- [ ] 訂閱狀態沒有改變光的亮度、位置、數量
- [ ] 管理頁沒有描邊發光按鈕
- [ ] `<Paper>` 的 type 屬於第 7 節清單
- [ ] AI 解讀、收據、祭改表單不在紙上
- [ ] 祭改走 `/offerings/ritual-booking`，無光、非年約權益
- [ ] 導覽沒有宗教符號圖示
- [ ] 到期 30／7／1 沒有第二光源或倒數特效
- [ ] 舊盎關燈與新盎點火不在同一畫面

---

## 10. 給實作的介面契約（建議）

名稱可改，語意不可改。

```ts
type ScreenMode = "ceremony" | "page";

type LightKind = "censer" | "candle" | "lamp" | "dying-lamp";

interface ScreenLight {
  kind: LightKind;
  // 釘在發光物。禁止用指標座標讓光跟著遊標或滾動跑掉
  anchor: "hearth";
  // 0..1，只隨儀式階段，不隨 plan
  phase: number;
}

type PaperType =
  | "slip"
  | "vow-card"
  | "name-slip"
  | "memorial"
  | "thanks-card"
  | "notice-scan";

type LampStatus =
  | "draft"
  | "paid"
  | "awaiting"
  | "seated"
  | "kindled"
  | "extinguishing"
  | "extinguished"
  | "lapsed";
```

`CeremonyScreen` 必填 `light`。
`PageScreen` 預設無 `light`。若將來要極弱環境光，仍須走同一個 `light` prop，且 `phase` 上限必須低於任何儀式場。

到期計算用廟方農曆，不用裝置時區的午夜自行切年。
顯示可同時給農曆與國曆，農曆在前。
