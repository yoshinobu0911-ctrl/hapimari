/**
 * AI画像解析の差し込み口（M6.5 判断#2: 写真対策は人力+AIのハイブリッド）。
 *
 * 外部モデレーションAPIのキー（PHOTO_MODERATION_API_KEY）が設定されるまでは
 * null を返し、審査は人力のみで安全側に動く。キー取得（オーナーの契約作業）後に
 * ここへプロバイダ呼び出しを実装すれば、審査キューに AI判定が並記される。
 * 想定プロバイダ: OpenAI omni-moderation（画像対応・無料） / AWS Rekognition / Google Vision SafeSearch
 */

export interface AiPhotoVerdict {
  /** ok=問題なし / ng=不適切の疑い / unsure=判定不能（人力で必ず確認） */
  verdict: 'ok' | 'ng' | 'unsure';
  detail: string;
}

export function aiModerationAvailable(): boolean {
  return !!process.env.PHOTO_MODERATION_API_KEY;
}

export async function analyzePhoto(_signedUrl: string): Promise<AiPhotoVerdict | null> {
  if (!aiModerationAvailable()) return null;
  // TODO(M7): PHOTO_MODERATION_API_KEY 取得後、ここで外部APIを呼び出して判定を返す。
  // 実装するまでは「未判定」として人力審査に委ねる。
  return null;
}
