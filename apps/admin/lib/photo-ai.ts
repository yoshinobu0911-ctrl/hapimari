/**
 * AI画像解析の差し込み口（M6.5 判断#2: 写真対策は人力+AIのハイブリッド）。
 * docs/design/photo_ai_moderation_proposal.md（2026-09-09オーナー承認・プロバイダA=OpenAI）。
 *
 * 外部モデレーションAPIのキー（PHOTO_MODERATION_API_KEY）が未設定、またはAPI障害時は
 * null を返し、審査は人力のみで安全側に動く。判定は「参考情報」であり、
 * 最終的な承認・却下は常に人力（管理画面の操作）で行う。
 */

export interface AiPhotoVerdict {
  /** ok=問題なし / ng=不適切の疑い / unsure=判定不能（人力で必ず確認） */
  verdict: 'ok' | 'ng' | 'unsure';
  detail: string;
}

export function aiModerationAvailable(): boolean {
  return !!process.env.PHOTO_MODERATION_API_KEY;
}

// OpenAI moderations の categories キー → 日本語ラベル
const CATEGORY_LABELS: Record<string, string> = {
  sexual: '性的な表現',
  'sexual/minors': '性的な表現（未成年関連）',
  violence: '暴力的な表現',
  'violence/graphic': '暴力的な表現（グラフィック）',
  harassment: 'ハラスメント',
  'harassment/threatening': '脅迫的な表現',
  'self-harm': '自傷行為',
  'self-harm/intent': '自傷行為の意図',
  'self-harm/instructions': '自傷行為の手段',
  hate: '差別的な表現',
  'hate/threatening': '差別的な脅迫',
  illicit: '違法行為',
  'illicit/violent': '違法な暴力',
};

interface OpenAiModerationResponse {
  results?: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
  }>;
}

export async function analyzePhoto(signedUrl: string): Promise<AiPhotoVerdict | null> {
  const apiKey = process.env.PHOTO_MODERATION_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: [{ type: 'image_url', image_url: { url: signedUrl } }],
      }),
    });
    // API障害時は人力のみへフォールバック（AI判定バッジを出さない）
    if (!res.ok) return null;

    const data = (await res.json()) as OpenAiModerationResponse;
    const result = data.results?.[0];
    if (!result) return null;

    if (!result.flagged) {
      return { verdict: 'ok', detail: '該当カテゴリなし' };
    }
    const flaggedCategories = Object.entries(result.categories)
      .filter(([, hit]) => hit)
      .map(([key]) => CATEGORY_LABELS[key] ?? key);
    return {
      verdict: 'ng',
      detail: flaggedCategories.length > 0 ? flaggedCategories.join('・') : '不適切の疑いあり',
    };
  } catch {
    return null;
  }
}
