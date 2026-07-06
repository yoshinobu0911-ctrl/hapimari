const B64_LOOKUP = new Uint8Array(128);
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

/** base64文字列をバイト列に変換する（atob非依存・全プラットフォーム共通） */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n=]+/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)] ?? 0;
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)] ?? 0;
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0;
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0;
    bytes[p++] = (a << 2) | (b >> 4);
    if (p < length) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < length) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}
