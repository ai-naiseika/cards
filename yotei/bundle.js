// 送る予定の「束」（だれに・いつ・どのカード）の詰め方と検査。送る予定のページで、入力を受け取るのはここ1か所だけ。
// 束は #b=y1.〜（送る画面）／#d=y1.〜（書きかけ）。カードの項目は codec.js の clean() に通す（目的ごとの白リスト・字数・見えない文字）。
// 束にしか無い項目（at・n・mm）と、デザインの指定（d）は、ここで検査する。
import { Card, clean, hasBody, validDate, KEYS } from '../shell/codec.js';

export const NS = 'y1.';
export const MAX_ITEMS = 15;    // 1つの束に入る人数（転送の上限15件に合わせ、「不特定多数」から遠ざける）
export const MAX_MAKE = 2200;   // 作る時：束のリンク全体の上限（カードと同じ）
const MAX_READ = 4000;          // 読む時：#b= の後ろの長さの上限
const MAX_N = 16, MAX_MM = 24;
const SETSUME = ['shogatsu', 'tanjobi', 'kinenbi', 'hinamatsuri', 'kodomonohi', 'halloween', 'christmas'];
const DID = /^([a-z]{3,16})\/([a-z0-9-]{3,40})$/;
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// 見えない文字（制御文字・幅ゼロ・双方向の制御・BOM）を番号で除く。codec.js と同じ範囲。束の名前とメモは1行なので改行も除く
const invisible = (cp) => cp < 32 || cp === 127 || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e)
  || (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;
export function line(v, n) {
  if (typeof v !== 'string') return '';
  const s = Array.from(v).filter((ch) => !invisible(ch.codePointAt(0))).join('').trim();
  return Array.from(s).slice(0, n).join('');
}
export function validAt(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s)) return false;
  return validDate(s.slice(0, 10));
}
export function validDesign(d) {
  const m = typeof d === 'string' ? DID.exec(d) : null;
  return !!m && SETSUME.includes(m[1]);
}

// カードの項目を、共通（cm.c）と1件ずつ（it.c）から重ねる。キーは決まった物だけを見る（__proto__ などは拾わない）
function merge(base, over) {
  const o = {};
  for (const k of KEYS) {
    if (own(over, k)) o[k] = over[k];
    else if (own(base, k)) o[k] = base[k];
  }
  return o;
}

// 束を検査して、扱いやすい形（items の並び）にする。形が合わなければ null。
// 書きかけ（draft）は日時が無くてもよい。送る画面の束は、日時が要る
export function normalize(o, draft) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
  const at = validAt(o.at) ? o.at : '';
  if (!at && !draft) return null;
  const cm = own(o, 'cm') && o.cm && typeof o.cm === 'object' && !Array.isArray(o.cm) ? o.cm : {};
  const its = own(o, 'it') ? o.it : null;
  if (!Array.isArray(its) || its.length < 1 || its.length > MAX_ITEMS) return null;
  const items = [];
  for (const it of its) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
    const d = own(it, 'd') ? it.d : cm.d;
    if (!validDesign(d)) return null;
    const c = clean(merge(own(cm, 'c') ? cm.c : null, own(it, 'c') ? it.c : null));
    if (!c.p || !hasBody(c)) return null;
    items.push({ d, c, mm: line(own(it, 'mm') ? it.mm : '', MAX_MM) });
  }
  return { at, n: line(o.n, MAX_N), items };
}

// 詰める：全員で同じ値は共通（cm）へ、違う値だけ1件ずつに残す（同じ文で宛名だけ変える時に短くなる）
export function pack(b) {
  const its = b.items, cm = {}, cc = {};
  if (its.every((x) => x.d === its[0].d)) cm.d = its[0].d;
  for (const k of KEYS) {
    const v0 = own(its[0].c, k) ? its[0].c[k] : undefined;
    if (v0 !== undefined && its.every((x) => own(x.c, k) && x.c[k] === v0)) cc[k] = v0;
  }
  if (Object.keys(cc).length) cm.c = cc;
  const it = its.map((x) => {
    const o = {}, oc = {};
    if (!cm.d) o.d = x.d;
    for (const k of KEYS) if (own(x.c, k) && !own(cc, k)) oc[k] = x.c[k];
    if (Object.keys(oc).length) o.c = oc;
    if (x.mm) o.mm = x.mm;
    return o;
  });
  const o = { v: 1 };
  if (b.at) o.at = b.at;
  if (b.n) o.n = b.n;
  if (Object.keys(cm).length) o.cm = cm;
  o.it = it;
  return o;
}

const b64u = {
  enc(s) { const b = new TextEncoder().encode(s); let x = ''; b.forEach((c) => { x += String.fromCharCode(c); }); return btoa(x).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const x = atob(s), b = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i); return new TextDecoder('utf-8', { fatal: true }).decode(b); },
};
export const Bundle = {
  encode(b) { return NS + b64u.enc(JSON.stringify(pack(b))); },
  decode(s, draft) {
    try {
      if (typeof s !== 'string' || s.indexOf(NS) !== 0 || s.length > MAX_READ) return null;
      return normalize(JSON.parse(b64u.dec(s.slice(NS.length))), draft);
    } catch (e) { return null; }
  },
  // アドレスの # から読む：{ kind: 'b'（送る）| 'd'（書きかけ）| '', bundle | null }
  fromHash(h) {
    const m = /^#([bd])=([A-Za-z0-9._-]+)$/.exec(h || '');
    if (!m) return { kind: '', bundle: null };
    return { kind: m[1], bundle: Bundle.decode(m[2], m[1] === 'd') };
  },
};

// 貼りつけた文（LINE の吹き出しをまるごと貼っても）から、カードのリンクを1つ取り出す。
// 受け取るのは、公開先かこのページと同じ場所の /cards/<節目>/<ID>/#c=n1.〜 だけ。中身は Card.decode に通す
export function cardFromText(text, origin) {
  if (typeof text !== 'string' || text.length > 6000) return null;
  const okHost = [new URL('https://ai-naiseika.github.io/').origin, origin];
  for (const u of text.match(/https?:\/\/[^\s"'<>]+/g) || []) {
    const m = /^(https?:\/\/[^/]+)\/(?:[A-Za-z0-9._-]+\/)*cards\/([a-z]{3,16})\/([a-z0-9-]{3,40})\/(?:index\.html)?#c=([A-Za-z0-9._-]+)$/.exec(u);
    if (!m || !okHost.includes(m[1])) continue;
    const d = m[2] + '/' + m[3], c = Card.decode(m[4]);
    if (validDesign(d) && c) return { d, c, mm: '' };
  }
  return null;
}

// リンクを作る（受け取った文字はそのまま使わず、検査して詰め直した中身から作り直す）
export const cardUrl = (cardsBase, it) => cardsBase + it.d + '/#c=' + Card.encode(it.c);
export const lineShare = (text) => 'https://line.me/R/share?text=' + encodeURIComponent(text);
