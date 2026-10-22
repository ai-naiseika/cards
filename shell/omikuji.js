// おみくじ：正月のカードの全部に付く、共通の仕掛け（本人 2026-10-21）。
// ・凶は出さない。吉の字の並び（どれが上か）は神社によって違うので、画面では順番を言わない
// ・1つのカードにつき、その端末で1回。覚えるのは「カードの中身から作った短い番号」と結果だけ（中身そのものは残さない）
// ・見本（リンクの中身なし）は、ためし引き（何度でも・覚えない）
// 出てくる形（kata）：kuwaeru＝主役がくわえて持ってくる（札は殻が描く）／e＝作品の絵の中に札が出てくる（宝箱・引き出し・落款など、作品ごと）
export const LEVELS = ['大吉', '吉', '中吉', '小吉', '末吉'];
const WEIGHTS = [16, 24, 20, 20, 20];
const STORE = 'cards-omikuji-v1', KEEP = 30;

// 0〜1 の乱数（crypto が使えなければ Math.random）
function rnd() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); }
}
export function draw(words, r = rnd) {
  let x = r() * WEIGHTS.reduce((a, b) => a + b, 0), i = 0;
  while (i < WEIGHTS.length - 1 && x >= WEIGHTS[i]) { x -= WEIGHTS[i]; i++; }
  const list = (words && words[LEVELS[i]]) || [''];
  return { level: i, word: Math.floor(r() * list.length) % list.length };
}
// カードの中身（#c= の後ろの文字列）から作る短い番号。元の中身には戻せない
export function keyOf(raw) {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'k' + h.toString(36);
}
function readAll() {
  try { const o = JSON.parse(localStorage.getItem(STORE) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
export function recall(key) {
  const v = readAll()[key];
  return Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && v[0] < LEVELS.length && Number.isInteger(v[1]) && v[1] >= 0 ? { level: v[0], word: v[1] } : null;
}
export function remember(key, res) {
  try {
    const o = readAll(); delete o[key]; o[key] = [res.level, res.word, Date.now()];
    const ks = Object.keys(o).sort((a, b) => (o[a][2] || 0) - (o[b][2] || 0));
    while (ks.length > KEEP) delete o[ks.shift()];
    localStorage.setItem(STORE, JSON.stringify(o));
  } catch (e) { /* 覚えられない画面（プライベートモードなど）では、開くたびに引く */ }
}
export function forgetAll() { try { localStorage.removeItem(STORE); } catch (e) { /* 消せなくても、画面は動く */ } }
export const KATA = ['kuwaeru', 'e'];
