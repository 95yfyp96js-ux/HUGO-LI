export interface NavItem {
  to: string;
  label: string;
  icon: string; // 簡化：以文字符號代替圖示庫，避免引入未使用的圖示依賴
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '首頁', icon: '⌂' },
  { to: '/explore', label: '探索', icon: '☯' },
  { to: '/lantern', label: '點燈', icon: '☼' },
  { to: '/ritual', label: '儀式', icon: '卐' },
  { to: '/my', label: '我的', icon: '☰' },
];
