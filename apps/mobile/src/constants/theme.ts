/**
 * デザイントークン v2（SPEC §2 UI/UX基準 ／ docs/design/designer_brief.md §2.2）
 *
 * 対象ユーザーは45〜65歳。老眼・スマホ不慣れを前提に、可読性を最優先する。
 * - 最小フォント16pt / 主要ボタン高さ48pt以上 / タップ領域44pt以上
 * - プライマリ #C0392B 系の落ち着いた暖色、背景は白基調
 * - 派手なグラデーション・アニメーション禁止
 *
 * v2 での変更（2026-08-04・オーナー承認済みのUI刷新）:
 * 1. 暖色寄りのグレースケールを9段階に拡張（区切り線・無効文字・薄い面を描き分けるため）
 * 2. warning / info のセマンティックカラーを追加（詐欺注意バナー・審査待ち表示に必要）
 * 3. 文字サイズを4段階→8段階に。本文を16→17ptへ引き上げ
 * 4. lineHeight を新設（日本語の行間不足を解消。これまで未定義だった）
 * 5. shadow（3段階）と radius（5段階）を新設し、面の階層を表現できるようにした
 * 6. typography プリセットを追加し、画面ごとの文字スタイル定義のばらつきを解消
 *
 * v1 のキーはすべて維持しているため、未改修の画面もそのまま動作する。
 */

// ---------------------------------------------------------------------------
// パレット（原色。画面から直接参照せず、下の colors 経由で使う）
// ---------------------------------------------------------------------------

/** 暖色寄りのニュートラル。白基調のトーンを崩さないため、わずかに赤みを含ませている */
const neutral = {
  0: '#FFFFFF',
  50: '#FAF8F7',
  100: '#F3EFED',
  200: '#E7E1DE',
  300: '#D9D0CC',
  400: '#BDB2AD',
  500: '#8F8079',
  600: '#6E6560',
  700: '#4A433F',
  800: '#2B2B2B',
  900: '#1A1817',
} as const;

const brand = {
  base: '#C0392B',
  pressed: '#96281B',
  border: '#E5C4BF',
  soft: '#F9EBE9',
  subtle: '#FDF6F5',
} as const;

// ---------------------------------------------------------------------------
// セマンティックカラー
// ---------------------------------------------------------------------------

export const colors = {
  // ブランド
  primary: brand.base,
  primaryPressed: brand.pressed,
  /** 選択状態の背景・バナー背景 */
  primarySoft: brand.soft,
  /** primarySoft よりさらに淡い面。広い面積に敷くとき用 */
  primarySubtle: brand.subtle,
  /** primarySoft の面に添える枠線 */
  primaryBorder: brand.border,

  // 面
  background: neutral[0],
  /** カード内プレースホルダ・受信吹き出し等の面 */
  surface: '#FAF7F5',
  /** background より一段沈んだ面（画面全体の下地・セクション区切り） */
  surfaceSunken: neutral[100],

  // 線
  border: neutral[300],
  /** 区切りとして目立たせたい線（セクション境界など） */
  borderStrong: neutral[400],
  /** ごく薄い区切り線（リストの行間） */
  borderSubtle: neutral[200],

  // 文字
  text: neutral[800],
  textSub: neutral[600],
  /** 補助的な文字。コントラスト比 3.6:1 のため 18pt以上か太字でのみ使う */
  textMuted: neutral[500],
  textOnPrimary: neutral[0],

  // 状態
  danger: '#B03A2E',
  dangerSoft: '#FBEDEB',
  warning: '#9A6410',
  warningSoft: '#FDF3E2',
  success: '#2E7D32',
  successSoft: '#EDF5EE',
  info: '#2C5F82',
  infoSoft: '#EDF3F7',

  disabled: '#CFC7C3',
  disabledText: neutral[500],

  /** モーダル背面のオーバーレイ */
  overlay: 'rgba(26, 24, 23, 0.45)',

  badge: '#2E7D32',

  /** 生のグレースケールが必要なときだけ使う */
  neutral,
} as const;

// ---------------------------------------------------------------------------
// タイポグラフィ
// ---------------------------------------------------------------------------

/** 単位pt。16pt未満は仕様で全面禁止（designer_brief §4-1） */
export const fontSize = {
  small: 16,
  body: 17,
  label: 17,
  button: 18,
  heading: 20,
  headingLg: 22,
  title: 26,
  display: 34,
} as const;

/**
 * 行送り（絶対値px）。日本語は欧文より行間を要するため約1.6倍を基準にした。
 * 見出しほど比率を下げ、本文ほど上げる。
 */
export const lineHeight = {
  small: 26,
  body: 28,
  label: 24,
  button: 24,
  heading: 30,
  headingLg: 32,
  title: 36,
  display: 44,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * 文字スタイルのプリセット。画面側は原則これを使い、fontSize を直接指定しない。
 * （v1では画面ごとに fontSize:20/fontWeight:'700' 等を手書きしていて揺れていた）
 */
export const typography = {
  /** ウェルカム画面のロゴ・特大数値 */
  display: {
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  /** 画面タイトル */
  title: {
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  /** セクション見出し（大） */
  headingLg: {
    fontSize: fontSize.headingLg,
    lineHeight: lineHeight.headingLg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  /** セクション見出し */
  heading: {
    fontSize: fontSize.heading,
    lineHeight: lineHeight.heading,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  /** 本文 */
  body: {
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
    fontWeight: fontWeight.regular,
    color: colors.text,
  },
  /** 本文（強調） */
  bodyStrong: {
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  /** 補足文・キャプション */
  caption: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.regular,
    color: colors.textSub,
  },
  /** 入力欄のラベル */
  label: {
    fontSize: fontSize.label,
    lineHeight: lineHeight.label,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  /** ボタンラベル */
  button: {
    fontSize: fontSize.button,
    lineHeight: lineHeight.button,
    fontWeight: fontWeight.semibold,
  },
} as const;

// ---------------------------------------------------------------------------
// レイアウト
// ---------------------------------------------------------------------------

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  /** 完全な角丸（チップ・バッジ） */
  pill: 999,
} as const;

export const sizes = {
  /** 主要ボタン。SPEC の48pt下限に対し余裕を持たせている */
  buttonHeight: 52,
  /** 補助ボタン。下限48ptは死守 */
  buttonHeightSm: 48,
  inputHeight: 52,
  /** 最小タップ領域（SPEC §2） */
  tapArea: 44,
  /** 既定の角丸。v1の10から12へ */
  radius: radius.md,
  /** 画面ヘッダーの高さ（セーフエリアを除く） */
  headerHeight: 56,
  tabBarHeight: 68,
  avatarSm: 44,
  avatarMd: 64,
  avatarLg: 96,
  /** アイコンの標準サイズ */
  icon: 24,
  iconSm: 20,
  iconLg: 28,
} as const;

/**
 * 影。「派手な装飾の禁止」（designer_brief §4-5）に反しない範囲で、
 * カードが背景から浮いていることが分かる最小限の強さに留めている。
 */
export const shadow = {
  sm: {
    shadowColor: neutral[900],
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: neutral[900],
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  lg: {
    shadowColor: neutral[900],
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;
