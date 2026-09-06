/**
 * Motion System — 見 PROJECT_SPEC.md Phase 7 原則：
 * 重要操作 → 強烈回饋；一般操作 → 微小回饋；閱讀 → 幾乎無動畫。
 * 數值需與 src/styles/tokens.css 的 CSS 變數保持一致。
 */
export const duration = {
  micro: 0.12,
  standard: 0.24,
  ceremony: 0.64,
  reveal: 0.9,
} as const;

export const ease = {
  standard: [0.4, 0, 0.2, 1] as const,
  ceremony: [0.22, 1, 0.36, 1] as const,
  settle: [0.16, 1, 0.3, 1] as const,
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: duration.standard, ease: ease.standard },
};

export const riseIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: duration.standard, ease: ease.settle },
};

export const ceremonyReveal = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: { duration: duration.ceremony, ease: ease.ceremony },
};
