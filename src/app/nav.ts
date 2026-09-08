export interface NavItem {
  to: string;
  label: string;
}

/**
 * 導覽只有文字。
 *
 * 原本這裡有一組 Unicode 符號當圖示（⌂ ☯ ☼ 卐 ☰），現已全部移除：
 *   1. 視覺方向明訂不使用裝飾性圖案；
 *   2. 那些符號各自屬於不同的宗教／文化體系，混用只是「看起來很東方」，
 *      其中 卐 更是有實際宗教意義且極易被誤讀的符號，拿來當導覽圖示並不恰當。
 * 層級改由字色與一條被火光照到的細線表示。
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '首頁' },
  { to: '/explore', label: '探索' },
  { to: '/lantern', label: '點燈' },
  { to: '/ritual', label: '儀式' },
  { to: '/my', label: '紀錄' },
];
