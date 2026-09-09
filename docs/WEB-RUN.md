# WEB-RUN — 怎麼把系統打開

給不寫程式的人看。**照著複製貼上就好**，看不懂的字不用管。

先講結論，免得你抱著錯的期待往下做：

> **第 1 版仍然需要一台開著的電腦。**
> 這套系統是跑在你自己的電腦上，不是租來的雲端主機。電腦關機、睡眠、
> 換 Wi-Fi，網址就沒了。第 3 節那個「手機也能開的網址」是把你這台電腦
> 暫時開一個對外入口，**不是把系統搬上雲**。

---

## 0. 你需要什麼

| | 說明 |
|---|---|
| 一台電腦 | Mac 或 Windows 都行。這台電腦要一直開著，員工才連得到 |
| 網路 | 一般家用／辦公室網路就夠 |
| 30 分鐘 | 第一次會花點時間裝東西，之後每次開只要 10 秒 |

**只有第 1 步需要「裝軟體」（Dart）。** 裝完之後就再也不用碰它了。

---

## 1. 裝 Dart（只做一次，這步一定要裝東西）

Dart 是這套系統的執行引擎，沒有它電腦不知道怎麼跑這些程式。

### macOS

打開「終端機」（按 `⌘ + 空白鍵`，打 `終端機`，Enter），貼上：

```bash
brew install dart-sdk
```

如果它說 `command not found: brew`，先貼這行裝 Homebrew，跑完再回來貼上面那行：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Windows

打開「PowerShell」（開始選單搜尋 `PowerShell`），貼上：

```powershell
winget install --id Dart.DartSDK
```

裝完**把視窗關掉重開**（不重開會找不到指令）。

### 確認裝好了

```bash
dart --version
```

有印出版本號（像 `Dart SDK version: 3.x.x`）就成功。印 `command not found` 就是沒裝好，回上面重來。

---

## 2. 抓專案、跑起來

### 2-1 抓下來（只做一次）

```bash
cd ~
git clone https://github.com/95yfyp96js-ux/HUGO-LI.git
cd HUGO-LI/apps/web
```

> `git` 通常已經內建。若說找不到：macOS 跑 `xcode-select --install`，
> Windows 跑 `winget install --id Git.Git` 再重開視窗。

### 2-2 裝相依套件（只做一次）

```bash
dart pub get
```

跑完最後一行是 `Changed N dependencies!` 就對了。

### 2-3 設密碼並開機（每次開電腦都跑這一行）

```bash
cd ~/HUGO-LI/apps/web
BOSS_PASSWORD=請自己改一組 STAFF_PASSWORD=請自己改另一組 dart run bin/server.dart
```

**`請自己改一組` 這幾個字要換成你自己的密碼**，例如：

```bash
BOSS_PASSWORD=Aa3388kk STAFF_PASSWORD=Bb7799mm dart run bin/server.dart
```

Windows PowerShell 的寫法不一樣，要分兩行：

```powershell
$env:BOSS_PASSWORD="Aa3388kk"; $env:STAFF_PASSWORD="Bb7799mm"
dart run bin/server.dart
```

畫面會印出：

```
已建立初始帳號（只會建立一次）：
  老闆  boss  / Aa3388kk
  員工  staff / Bb7799mm
請自己記下來，這行不會再印第二次。
小額借款＋支票貼現：http://localhost:8080/  （DB: ledger.db）
```

**帳號只會在第一次建立，之後改環境變數也不會改到密碼。**
密碼忘了怎麼辦，見第 5 節。

### 2-4 打開瀏覽器

在**這台電腦**的瀏覽器網址列打：

```
http://localhost:8080
```

看到「登入」兩個字 + 帳號密碼兩個欄位，就是成功了。用 `boss` 登入。

> 這個終端機視窗**不能關**。關掉＝系統關機。要停就在視窗裡按 `Ctrl + C`。

---

## 3. 讓員工的手機也能開（可選）

### 3-1 先試最簡單的：同一個 Wi-Fi

員工手機和電腦連同一個 Wi-Fi 時，直接用電腦的內網 IP 就好，什麼都不用裝。

先查電腦 IP：

```bash
# macOS
ipconfig getifaddr en0
# Windows PowerShell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.PrefixOrigin -eq "Dhcp"}).IPAddress
```

假設印出 `192.168.1.23`，員工手機 Safari 打：

```
http://192.168.1.23:8080
```

**限制**：只有在同一個 Wi-Fi 底下才有效。員工出門、用 4G，就連不到。

### 3-2 出門也能開：一鍵對外網址

用 Cloudflare 的免費「快速通道」。不用註冊帳號、不用自己架機房。

**先裝 cloudflared（只做一次）**

```bash
# macOS
brew install cloudflared
# Windows PowerShell
winget install --id Cloudflare.cloudflared
```

**每次要開放時跑這行**（取代 2-3 的指令）：

```bash
cd ~/HUGO-LI/apps/web
./bin/serve-public.sh
```

Windows 沒有 `bash` 的話，分兩個視窗各跑一行：

```powershell
# 視窗 A
$env:SECURE_COOKIES="1"; dart run bin/server.dart
# 視窗 B
cloudflared tunnel --url http://localhost:8080
```

跑完會印出一行像這樣的網址：

```
手機開這個網址：https://xxxx-yyyy-zzzz.trycloudflare.com
```

**員工手機就開那個網址。** 帳號密碼用 `staff` 那一組（第 2-3 節印出來的）。

**這件事的真相，先講清楚：**

| 問題 | 答案 |
|---|---|
| 網址固定嗎？ | **不固定。** 每次重跑都是新的一串，要重新傳給員工 |
| 電腦關機呢？ | 網址立刻失效。**電腦必須開著** |
| 誰都能連嗎？ | 拿到網址的人都連得到**登入頁**。進不進得去看密碼。所以**密碼不要用 1234** |
| 安全嗎？ | 網址到 Cloudflare 那段是加密的（https）。但這是「臨時通道」等級，不是正式服務。**不要在這上面放你不敢外洩的東西** |
| 這算上線了嗎？ | **不算。** 這是「先讓員工用得到」的權宜之計 |

> **誠實說明**：第 3-2 節的指令是照 Cloudflare 官方文件寫的，
> 但**我沒能在開發環境實測**——這台開發機的網路封鎖了 Cloudflare 的
> 通道網域，連不出去。`cloudflared` 本身下載得到、跑得起來。
> 你第一次跑若卡住，把畫面上的錯誤訊息貼回來。
> 第 3-1 節（同 Wi-Fi）與第 2 節（本機）**都實測過**。

---

## 4. 每天怎麼用

**開店：**

```bash
cd ~/HUGO-LI/apps/web
dart run bin/server.dart          # 只在店裡用
# 或
./bin/serve-public.sh             # 員工要在外面用
```

**收店：** 在終端機視窗按 `Ctrl + C`。資料都在 `ledger.db` 這個檔案裡，不會不見。

**資料在哪：** `~/HUGO-LI/apps/web/ledger.db`。
**這個檔就是你的帳本，記得備份**（複製到隨身碟或雲端硬碟就行，第 1 版沒有自動備份）。

---

## 5. 卡住的時候

| 症狀 | 怎麼辦 |
|---|---|
| `command not found: dart` | 第 1 步沒裝好，或裝完沒重開終端機視窗 |
| `Address already in use` | 上一個還開著。找到那個視窗按 `Ctrl + C`，或改用 `PORT=8081 dart run bin/server.dart` |
| 密碼忘了 | 停掉伺服器 → 刪掉 `ledger.db` → 重跑 2-3（**會把帳一起刪掉**）。或找工程師改 `users` 表 |
| 手機連不到 3-1 的內網 IP | 手機和電腦不在同一個 Wi-Fi；或電腦防火牆擋了 8080 埠 |
| 員工說「網址掛了」 | 你的電腦睡著了，或 3-2 的視窗被關掉了。重跑一次會拿到**新網址** |
| 想確認程式沒壞 | `dart test`（預期 76 支全過）、`dart analyze`（預期 No issues found!） |

---

## 6. 這一版沒有的東西（不要期待）

- 沒有雲端主機，**電腦關了就沒了**
- 沒有固定網址、沒有自己的網域
- 沒有自動備份（`ledger.db` 要自己複製）
- 沒有更正單（認證鎖帳後改不了）、沒有週月報畫面
- 沒有 App，只有網頁

要有「電腦關了系統還在」，得租一台雲端主機並把 `ledger.db` 搬上去。
那是下一輪的事，這一輪只做「打得開」。
