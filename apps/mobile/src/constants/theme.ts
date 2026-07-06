/**
 * デザイントークン（SPEC §2 UI/UX基準）
 * - 最小フォント16pt / 主要ボタン高さ48pt以上 / タップ領域44pt以上
 * - プライマリ #C0392B 系の落ち着いた暖色、背景は白基調
 * - 派手なグラデーション・アニメーション禁止
 */

export const colors = {
  primary: '#C0392B',
  primaryPressed: '#96281B',
  primarySoft: '#F9EBE9',
  background: '#FFFFFF',
  surface: '#FAF7F5',
  border: '#D9D0CC',
  text: '#2B2B2B',
  textSub: '#6E6560',
  textOnPrimary: '#FFFFFF',
  danger: '#B03A2E',
  success: '#2E7D32',
  disabled: '#CFC7C3',
  badge: '#2E7D32',
} as const;

export const fontSize = {
  body: 16,
  button: 18,
  label: 16,
  title: 24,
  heading: 20,
  small: 16, // 16pt未満は使わない
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const sizes = {
  buttonHeight: 52,
  inputHeight: 52,
  tapArea: 44,
  radius: 10,
} as const;
