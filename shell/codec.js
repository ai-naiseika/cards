// カードの中身（リンクの #c=n1.〜）の詰め方と検査。殻の中で、入力を受け取るのはここ1か所だけ。
// 画面には textContent でしか出さない（shell.js）。長さの上限・見えない文字の除去・日付と時刻の形の検査・目的ごとの項目の白リストは、ここで。
export const NS = 'n1.';
export const MAX = { t: 28, to: 24, vn: 40, va: 60, c: 60, m: 200, f: 24, dc: 40, rm: 80 };
export const KEYS = ['p', 'rk', 't', 'to', 'd', 's', 'e', 'vn', 'va', 'c', 'm', 'f', 'dc', 'rp', 'rd', 'rm'];
// 目的：g あいさつ／c 改まったあいさつ・おいわい（名前は節目ごとに setsume.json で付ける。正月は「目上の方へ」）／i おさそい／r おしらせ（招待状から作る。rk＝a お返事のお願い・n 念押し・t いよいよ明日）
export const PURPOSES = ['g', 'c', 'i', 'r'];
export const PURPOSE_KEYS = {
  g: ['p', 't', 'to', 'm', 'f'],
  c: ['p', 't', 'to', 'm', 'f'],
  i: ['p', 't', 'to', 'd', 's', 'e', 'vn', 'va', 'c', 'm', 'f', 'dc', 'rp'],
  r: ['p', 'rk', 't', 'to', 'd', 's', 'e', 'vn', 'va', 'c', 'f', 'dc', 'rp', 'rd', 'rm'],
};
export const MAX_LINK = 2200;   // 作る時：リンク全体の上限
const MAX_READ = 4000;          // 読む時：#c= の後ろの長さの上限

// 見えない文字（制御文字・幅ゼロ・双方向の制御・BOM）か。番号で決める（字そのものをソースに書かない）
const invisible = (cp, keepNl) => (cp < 32 && !(keepNl && cp === 10)) || cp === 127
  || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;
// ひとこと（m・rm）だけ改行を残す
const str = (v, n, keepNl) => {
  if (typeof v !== 'string') return '';
  const s = Array.from(v.replace(/\r\n?/g, '\n')).filter((ch) => !invisible(ch.codePointAt(0), keepNl)).join('').trim();
  return Array.from(s).slice(0, n).join('');
};
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const validTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function clean(o) {
  const r = {};
  if (!o || typeof o !== 'object') return r;
  const p = PURPOSES.includes(o.p) ? o.p : '';
  if (!p) return r;
  for (const k of PURPOSE_KEYS[p]) {
    let v = Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
    if (k === 'p') v = p;
    else if (k === 'rk') v = ['a', 'n', 't'].includes(v) ? v : 'n';
    else if (k === 'rp') v = v === '1' ? '1' : '';
    else if (k === 'd' || k === 'rd') v = validDate(v) ? v : '';
    else if (k === 's' || k === 'e') v = validTime(v) ? v : '';
    else v = str(v, MAX[k], k === 'm' || k === 'rm');
    if (v) r[k] = v;
  }
  if (r.p === 'r' && r.rk !== 'a') delete r.rd;   // 返事の期限は「お返事のお願い」の時だけ
  return r;
}
// 中身があるか（目的だけのカードは、空とみなす）
export const hasBody = (c) => Object.keys(c).some((k) => k !== 'p' && k !== 'rk');

const b64u = {
  enc(s) { const b = new TextEncoder().encode(s); let x = ''; b.forEach((c) => { x += String.fromCharCode(c); }); return btoa(x).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const x = atob(s), b = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i); return new TextDecoder('utf-8', { fatal: true }).decode(b); },
};
export const Card = {
  encode(o) { return NS + b64u.enc(JSON.stringify(clean(o))); },
  decode(s) {
    try {
      if (typeof s !== 'string' || s.indexOf(NS) !== 0 || s.length > MAX_READ) return null;
      const o = clean(JSON.parse(b64u.dec(s.slice(NS.length))));
      return o.p && hasBody(o) ? o : null;
    } catch (e) { return null; }
  },
  // アドレスの # から読む。形が合わなければ null（見本を出す）
  fromHash(h) { const m = /^#c=([A-Za-z0-9._-]+)$/.exec(h || ''); return m ? Card.decode(m[1]) : null; },
  rawFromHash(h) { const m = /^#c=([A-Za-z0-9._-]+)$/.exec(h || ''); return m ? m[1] : ''; },
};
