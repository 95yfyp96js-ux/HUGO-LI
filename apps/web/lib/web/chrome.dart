import '../domain/auth.dart';

/// 版面與共用元件。
///
/// **整站沒有任何 JavaScript 算術。** 頁面上每一個金額都是伺服器算完之後的
/// 字串，瀏覽器只做顯示與表單送出；溢繳確認、日結四關也都是伺服器來回。
String escapeHtml(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const String _css = '''
  :root {
    --ink:#10233d; --ink-2:#4a5b74; --line:#d8e0ea; --bg:#f4f6f9; --card:#fff;
    --brand:#123a6b; --ok:#0d7a4a; --bad:#b3261e; --warn-bg:#fdecea;
    --warn-line:#f2b8b5; --ok-bg:#e7f4ec; --ok-line:#b6ddc6;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,"Noto Sans TC","PingFang TC",sans-serif;
    -webkit-text-size-adjust:100%}
  header{background:var(--brand);color:#fff;padding:12px 16px}
  header .row{display:flex;justify-content:space-between;align-items:center;
    gap:12px;max-width:1240px;margin:0 auto}
  header h1{font-size:16px;margin:0;font-weight:700}
  header .who{font-size:13px;opacity:.9}
  nav{background:#0d2c53;padding:0 16px}
  nav .row{display:flex;gap:4px;max-width:1240px;margin:0 auto;overflow-x:auto}
  nav a{color:#cfe0f5;text-decoration:none;font-size:14px;padding:10px 12px;
    white-space:nowrap;border-bottom:3px solid transparent}
  nav a.on{color:#fff;border-bottom-color:#fff;font-weight:600}
  nav form{margin-left:auto}
  nav button{background:none;border:0;color:#cfe0f5;font:inherit;font-size:14px;
    padding:10px 12px;width:auto;margin:0;cursor:pointer}
  .wrap{display:grid;gap:16px;padding:16px;max-width:1240px;margin:0 auto;
    grid-template-columns:1fr}
  .wrap.two{grid-template-columns:1fr}
  @media(min-width:1000px){.wrap.two{grid-template-columns:1fr 1fr;align-items:start}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .card h2{font-size:15px;margin:0 0 12px;letter-spacing:.02em}
  label{display:block;font-size:13px;color:var(--ink-2);margin:12px 0 4px}
  input[type=text],input[type=date],input[type=password],select,textarea{
    width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--line);
    border-radius:8px;background:#fff;color:var(--ink)}
  button{font:inherit;font-weight:600;padding:12px 16px;border-radius:8px;border:0;
    background:var(--brand);color:#fff;width:100%;margin-top:14px}
  button.ghost{background:#fff;color:var(--brand);border:1px solid var(--brand)}
  button.warn{background:var(--bad)}
  button[disabled]{background:#c3ccd8;color:#6b7688}
  .grid8{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .grid8 a{display:block;text-align:center;text-decoration:none;padding:18px 10px;
    border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--brand);
    font-weight:600;font-size:15px}
  .grid8 a .n{display:block;font-size:11px;color:var(--ink-2);font-weight:400}
  .periods{border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .periods label{display:flex;gap:10px;align-items:flex-start;margin:0;padding:10px 12px;
    border-bottom:1px solid var(--line);font-size:14px;color:var(--ink);cursor:pointer}
  .periods label:last-child{border-bottom:0}
  .periods input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}
  .periods .amt{margin-left:auto;text-align:right;white-space:nowrap}
  .muted{color:var(--ink-2);font-size:13px}
  .od{color:var(--bad);font-weight:700}
  .boxes{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .box{border:1px solid var(--line);border-radius:10px;padding:12px}
  .box .t{font-size:12px;color:var(--ink-2)}
  .box .v{font-size:22px;font-weight:700;margin-top:4px}
  .box .sub{font-size:12px;color:var(--ink-2);margin-top:6px}
  .box .sub b{color:var(--bad)}
  .banner{border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:14px}
  .banner.bad{background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--bad)}
  .banner.ok{background:var(--ok-bg);border:1px solid var(--ok-line);color:var(--ok)}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line)}
  td.num,th.num{text-align:right;white-space:nowrap}
  .redlist th{color:var(--bad)}
  h3{font-size:13px;margin:18px 0 8px;color:var(--ink-2)}
  .stage{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .stage span{font-size:12px;padding:4px 10px;border-radius:999px;
    border:1px solid var(--line);color:var(--ink-2)}
  .stage span.done{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)}
  .stage span.lock{background:#10233d;border-color:#10233d;color:#fff}
''';

/// 頁面外殼。[user] 為 null 時（登入頁）不畫導覽列。
String shell({
  required String title,
  required String body,
  User? user,
  String active = '',
  bool twoColumn = false,
}) {
  final nav = user == null
      ? ''
      : '''<nav><div class="row">
  <a href="/"${active == 'home' ? ' class="on"' : ''}>首頁</a>
  <a href="/settle"${active == 'settle' ? ' class="on"' : ''}>收款並核銷</a>
  <a href="/today"${active == 'today' ? ' class="on"' : ''}>今日流水</a>
  ${user.isBoss ? '<a href="/close"${active == 'close' ? ' class="on"' : ''}>日結</a>' : ''}
  <form method="post" action="/logout"><button type="submit">登出</button></form>
</div></nav>''';

  return '''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>$_css</style>
</head>
<body>
<header><div class="row">
  <h1>小額借款＋支票貼現</h1>
  ${user == null ? '' : '<span class="who">${escapeHtml(user.displayName)}（${user.roleLabel}）</span>'}
</div></header>
$nav
<div class="wrap${twoColumn ? ' two' : ''}">$body</div>
</body>
</html>''';
}

String banner(String? message, {required bool bad}) => message == null
    ? ''
    : '<div class="banner ${bad ? 'bad' : 'ok'}">$message</div>';

String card(String inner) => '<section class="card">$inner</section>';
