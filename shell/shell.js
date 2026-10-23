// 節目カードの殻：中身の読み取り・表示・つくる・送る・LINE・音・おみくじ。
// 画面に文字を出すのは put() だけ（textContent）。HTML として解釈させる書き方（innerHTML など）は使わない。
// 読む入口は2つだけ：アドレスの #c=（codec.js が検査）と、このページの design.json。? は openExternalBrowser を消す時だけ見る
import { Card, clean, hasBody, PURPOSE_KEYS, MAX_LINK } from './codec.js';
import * as OMK from './omikuji.js';
import * as SND from './sound.js';

const $ = (id) => document.getElementById(id);
function put(node, s) { node.textContent = s; }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) put(e, text); return e; };
const SAFE_FILE = /^[a-z0-9_-]+\.(svg|webp|png|jpg)$/;
const SAFE_ID = /^[a-z0-9-]{3,40}$/;
const SAFE_NAME = /^[a-z0-9]{1,16}$/;
const GIMMICKS = { butai: () => import('../gim/butai.js') };
const pct = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x) && x >= -100 && x <= 200);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TEST = /[?&]t=1(&|$)/.test(location.search);
const LINE_UA = /Line\//i.test(navigator.userAgent);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const state = { card: null, raw: '', sample: true, mine: false, revealed: false, gimDone: false, omk: null, slipTaken: false, design: null, set: null, edKeep: false, edKind: 'g', lastCard: null, soundHinted: false };
let gim = null, tt = 0;

function toast(msg) { const t = $('toast'); put(t, msg); t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }
const ext = (a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
async function getJSON(name) { const r = await fetch(name, { credentials: 'same-origin' }); if (!r.ok) throw new Error('読めない: ' + name); return r.json(); }

// ---------- 1. 絵の舞台：design.json の層を並べる（ファイル名は英数字だけを通す） ----------
// 層の名前は英小文字と数字だけ。win＝窓（枠の外は見せず、中の絵を動かす）・px＝ドット（拡大してもぼかさない）・org＝回る・縮む中心（%）
// alt＝目的ごとに差しかえる絵（あいさつの言葉：目上の方へ＝c）。窓でない層だけ。差しかえの絵は、その目的になった時に読む
const words = [];
function buildStage(d) {
  const stage = $('stage'), U = 1080, layers = {};
  for (const L of d.layers) {
    if (!SAFE_FILE.test(L.src) || !SAFE_NAME.test(L.n) || Object.prototype.hasOwnProperty.call(layers, L.n)) throw new Error('層の指定がおかしい');
    const w = el('div', 'layer' + (L.win ? ' win' : '') + (L.px ? ' px' : '')), img = el('img');
    img.src = L.src; img.alt = ''; img.decoding = 'async'; img.draggable = false;
    if (Array.isArray(L.box) && L.box.length === 4 && L.box.every(Number.isFinite)) {
      const [x, y, bw, bh] = L.box; w.style.left = (x / U * 100) + '%'; w.style.top = (y / U * 100) + '%'; w.style.width = (bw / U * 100) + '%'; w.style.height = (bh / U * 100) + '%';
    } else w.classList.add('full');
    const t = L.win ? img : w;
    if (pct(L.org, 2)) t.style.transformOrigin = L.org[0] + '% ' + L.org[1] + '%';
    // 窓の形（窓の層だけ。多角形の頂点を %）。中の絵が動いても、窓の外には出ない
    if (L.win && Array.isArray(L.poly) && L.poly.length >= 3 && L.poly.length <= 12 && L.poly.every((q) => pct(q, 2))) w.style.clipPath = 'polygon(' + L.poly.map((q) => q[0] + '% ' + q[1] + '%').join(',') + ')';
    w.appendChild(img); stage.insertBefore(w, $('hint')); layers[L.n] = t;
    if (!L.win && L.alt && typeof L.alt === 'object') {
      const alts = {};
      for (const p of Object.keys(L.alt)) if (state.set.purposes.includes(p) && SAFE_FILE.test(L.alt[p])) { const a = el('img', 'alt'); a.alt = ''; a.hidden = true; a.draggable = false; w.appendChild(a); alts[p] = [a, L.alt[p]]; }
      words.push([img, alts]);
    }
  }
  return layers;
}
function setWord(p) {
  for (const [base, alts] of words) {
    const a = Object.prototype.hasOwnProperty.call(alts, p) ? alts[p] : null;
    for (const k of Object.keys(alts)) alts[k][0].hidden = true;
    if (a) { if (!a[0].getAttribute('src')) a[0].src = a[1]; a[0].hidden = false; }
    base.hidden = !!a;
  }
}
// おみくじの札：kuwaeru＝殻の描く札／e＝作品の絵の札（殻は、透明の押せる所だけを重ねる）。位置と大きさは舞台の %
const BUBBLE_DIRS = ['ur', 'ul', 'dr', 'dl', 'r', 'l'];
function placeSlip(d) {
  const s = $('omkSlip'), o = d.omikuji || {};
  if (pct(o.anchor, 2)) { s.style.left = o.anchor[0] + '%'; s.style.top = o.anchor[1] + '%'; }
  if (pct(o.size, 2)) { s.style.width = o.size[0] + '%'; s.style.height = o.size[1] + '%'; }
  if (Number.isFinite(o.rot) && Math.abs(o.rot) <= 90) s.style.transform = 'translate(-50%,-50%) rotate(' + o.rot + 'deg)';
  s.classList.toggle('own', o.kata === 'e');
  // 吹き出しは札の縁に置き、しっぽで札を指す（向きは作品ごと。絵の主役とあいさつの字を避ける向きを選ぶ）
  if (pct(o.anchor, 2)) {
    const d = BUBBLE_DIRS.includes(o.bubble) ? o.bubble : 'ur', [ax, ay] = o.anchor, [sw, sh] = pct(o.size, 2) ? o.size : [20, 5], b = $('omkBubble');
    b.dataset.dir = d;
    b.style.left = (d === 'r' ? ax + sw / 2 : d === 'l' ? ax - sw / 2 : ax) + '%';
    b.style.top = (d[0] === 'u' ? ay - sh / 2 : d[0] === 'd' ? ay + sh / 2 : ay) + '%';
  }
}

// ---------- 2. カードの表示 ----------
function dateText(c) {
  if (!c.d) return '';
  const [y, m, d] = c.d.split('-').map(Number), w = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  let s = m + '月' + d + '日（' + w + '）';
  if (c.s) s += '\n' + c.s + (c.e ? ' 〜 ' + c.e : ' 〜');
  return s;
}
function daysUntil(ds) { const [y, m, d] = ds.split('-').map(Number), now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), t1 = new Date(y, m - 1, d); return Math.round((t1 - t0) / 86400000); }
function row(dt, dd, cls) { const r = el('div', 'row' + (cls ? ' ' + cls : '')); r.appendChild(el('dt', null, dt)); const d = el('dd'); if (typeof dd === 'string') put(d, dd); else d.appendChild(dd); r.appendChild(d); return r; }
const titleOf = (c) => c.t || (state.set.defaults[c.p] || {}).t || '';
function gcalUrl(c) {
  const d = c.d.replace(/-/g, ''), p2 = (n) => String(n).padStart(2, '0'); let dates;
  if (c.s) dates = d + 'T' + c.s.replace(':', '') + '00/' + d + 'T' + (c.e || c.s).replace(':', '') + '00';
  else { const [y, m, dd] = c.d.split('-').map(Number), n = new Date(Date.UTC(y, m - 1, dd + 1)); dates = d + '/' + n.getUTCFullYear() + p2(n.getUTCMonth() + 1) + p2(n.getUTCDate()); }
  const q = (k, v) => k + '=' + encodeURIComponent(v);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&' + q('text', titleOf(c)) + '&dates=' + dates + '&' + q('location', [c.vn, c.va].filter(Boolean).join(' ')) + '&' + q('details', c.m || '');
}
function icsText(c) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'), p2 = (n) => String(n).padStart(2, '0');
  const d = c.d.replace(/-/g, ''), now = new Date(), stamp = now.getUTCFullYear() + p2(now.getUTCMonth() + 1) + p2(now.getUTCDate()) + 'T' + p2(now.getUTCHours()) + p2(now.getUTCMinutes()) + p2(now.getUTCSeconds()) + 'Z';
  let start, end;
  if (c.s) { start = 'DTSTART:' + d + 'T' + c.s.replace(':', '') + '00'; end = 'DTEND:' + d + 'T' + (c.e || c.s).replace(':', '') + '00'; }
  else { const [y, m, dd] = c.d.split('-').map(Number), n = new Date(Date.UTC(y, m - 1, dd + 1)); start = 'DTSTART;VALUE=DATE:' + d; end = 'DTEND;VALUE=DATE:' + n.getUTCFullYear() + p2(n.getUTCMonth() + 1) + p2(n.getUTCDate()); }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fc-cards//JA', 'BEGIN:VEVENT', 'UID:' + stamp + '-' + Math.random().toString(36).slice(2) + '@fc-cards', 'DTSTAMP:' + stamp, start, end,
    'SUMMARY:' + esc(titleOf(c)), 'LOCATION:' + esc([c.vn, c.va].filter(Boolean).join(' ')), 'DESCRIPTION:' + esc(c.m), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function renderCard(c, sample) {
  state.card = c; state.sample = sample; setWord(c.p);
  const greet = c.p === 'g' || c.p === 'c', title = titleOf(c), len = Array.from(title).length, card = $('card');
  put($('ttl'), title); $('ttl').className = 'ttl' + (len > 22 ? ' l3' : len > 14 ? ' l2' : '');
  card.classList.toggle('greet', greet);
  document.title = sample ? state.design.pageTitle : title + ' ─ ' + state.set.name + 'のカード';
  $('sampleTag').hidden = !sample;
  const rows = $('rows'), acts = $('acts'); rows.textContent = ''; acts.textContent = '';
  if (greet) {
    if (c.to) rows.appendChild(row('TO', c.to + ' へ', 'to'));
    rows.appendChild(row('ひとこと', c.m || (state.set.defaults[c.p] || {}).m || '', 'msg'));
    if (c.f) rows.appendChild(row('FROM', c.f + ' より', 'from'));
    $('count').hidden = true;
  } else {
    if (c.to) rows.appendChild(row('TO', c.to + ' へ'));
    if (c.d) rows.appendChild(row('日時', dateText(c)));
    if (c.vn || c.va) { const dd = el('div'); if (c.vn) dd.appendChild(document.createTextNode(c.vn)); if (c.va) dd.appendChild(el('small', null, c.va)); rows.appendChild(row('会場', dd)); }
    if (c.dc) rows.appendChild(row(state.set.labels.dc, c.dc));
    if (c.c) rows.appendChild(row('連絡先', c.c));
    if (c.m) rows.appendChild(row('ひとこと', c.m, 'msg'));
    if (c.f) rows.appendChild(row('FROM', c.f));
    const cnt = $('count');
    if (c.d) { const n = daysUntil(c.d); cnt.hidden = false; put(cnt, n > 1 ? 'あと ' + n + ' 日' : n === 1 ? 'いよいよ、あした！' : n === 0 ? '今日が、その日！' : 'ありがとう、楽しかったね'); } else cnt.hidden = true;
    if (c.vn || c.va) { const a = ext(el('a', null, '地図を開く')); a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([c.vn, c.va].filter(Boolean).join(' ')); acts.appendChild(a); }
    if (c.d) {
      const g = ext(el('a', null, 'Googleカレンダーに入れる')); g.href = gcalUrl(c); acts.appendChild(g);
      const b = el('button', null, 'iPhoneのカレンダーに入れる'); b.type = 'button';
      b.addEventListener('click', () => { SND.play('tap'); const u = URL.createObjectURL(new Blob([icsText(c)], { type: 'text/calendar;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = 'shinnenkai.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('カレンダーのファイルを書き出しました'); });
      acts.appendChild(b);
      acts.appendChild(el('p', 'hint2', 'Android・パソコン：上のボタンで、予定の入った画面が開きます。\niPhone：下のボタンのあと、「カレンダーに追加」を押します。' + (LINE_UA ? '\nLINEの中では保存できないことがあります。その時は、下の「ブラウザで開きなおす」から。' : '')));
    }
    if (c.rp) {
      const rep = el('div', 'reply'), when = c.d ? dateText(c).split('\n')[0] : '', ra = el('div', 'ra');
      rep.appendChild(el('p', null, 'ご出欠のお返事'));
      [['参加する', title + '\n参加します！' + (when ? '（' + when + '）' : '')], ['欠席する', title + '\nごめんなさい、今回は欠席します。']].forEach(([label, msg]) => { const a = ext(el('a', null, label)); a.href = 'https://line.me/R/share?text=' + encodeURIComponent(msg); ra.appendChild(a); });
      rep.appendChild(ra); rep.appendChild(el('p', 'hint2', 'LINEの画面で、返事を送る相手（このカードをくれたトーク）を選んで送ってね。'));
      acts.appendChild(rep);
    }
  }
  // 見本＝「このカードで書く」／もらったカード＝「自分もこの絵で送る（コピー）」と「白紙から」／つくった直後＝「書きかえる」
  $('btnMake').hidden = state.mine; $('btnEdit').hidden = sample || !state.mine; $('btnBlank').hidden = sample;
  put($('btnMake'), sample ? 'このカードで書く' : '自分もこの絵で送る（中身をコピー）');
  if (!greet || state.revealed) reveal(false);
}
function reveal(anim) {
  const card = $('card'); if (!card.hidden) return;
  state.revealed = true; card.hidden = false; $('btnRead').hidden = true;
  if (anim && !REDUCED) { card.classList.remove('show'); void card.offsetWidth; card.classList.add('show'); }
}
function loadFromHash() {
  const c = Card.fromHash(location.hash), raw = c ? Card.rawFromHash(location.hash) : '';
  const allowed = state.set.purposes.concat(['r']);
  if (c && allowed.includes(c.p)) { state.raw = raw; renderCard(c, false); }
  else { state.raw = ''; state.mine = false; renderCard(sampleCard('g'), true); }
  state.omk = state.raw ? OMK.recall(OMK.keyOf(state.raw)) : null;
  showBadge();
}
function sampleCard(p) {
  const ex = Object.assign({ p }, state.set.examples[p] || {});
  if (ex.d === 'next-jan-3') { const now = new Date(); let y = now.getFullYear(); if (now > new Date(y, 0, 3, 23, 59)) y += 1; ex.d = y + '-01-03'; }
  return clean(ex);
}

// ---------- 3. 仕掛けと、おみくじ ----------
function afterGimmick() {
  state.gimDone = true; $('hint').hidden = true;
  reveal(true);
  const s = $('omkSlip');
  loadKami();
  if (!state.slipTaken) { s.hidden = false; $('omkBubble').hidden = false; if (!REDUCED && !s.classList.contains('own')) s.animate([{ opacity: 0, transform: 'translate(-50%,-90%) rotate(-30deg)' }, { opacity: 1, transform: s.style.transform || 'translate(-50%,-50%) rotate(-10deg)' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' }); }
}
function showBadge() {
  const r = state.omk; $('omkBadge').hidden = !r;
  if (r) put($('omkBadgeL'), OMK.LEVELS[r.level]);
}
function openOmikuji() {
  SND.unlock();
  const key = state.raw ? OMK.keyOf(state.raw) : '';
  const W = omkWords();
  let res = key ? OMK.recall(key) : null; const again = !!res;
  if (!res) { res = OMK.draw(W); if (key) OMK.remember(key, res); }
  state.omk = res; state.slipTaken = true;
  const level = OMK.LEVELS[res.level], list = W[level] || [''], word = list[res.word % list.length];
  put($('omkL'), level); put($('omkW'), word);
  dressOmikuji();
  const tv = state.design.trivia || [], t = tv.length ? tv[res.word % tv.length] : null;
  $('omkT').hidden = !t;
  if (t) { put($('omkTa'), t.a); put($('omkTs'), (t.src || '') + (t.checked ? '' : '（試作の文・出典の確認前）')); }
  put($('omkN'), state.sample ? '見本なので、何度でも引けます（ためし引き）。' : again ? 'このカードのおみくじは、もう引いたよ。結果は前と同じです。' : 'おみくじは、このカードで1回。結果は、この端末にだけ残ります。');
  $('omkSlip').hidden = true; $('omkBubble').hidden = true;
  $('omkBack').hidden = false; $('omk').hidden = false;
  // おみくじを開く音：紙の音のあとに、その作品の画材と世界の音（design の omikuji.snd。無ければ鐘）
  const os = (state.design.omikuji || {}).snd;
  SND.play('paper'); setTimeout(() => SND.play(SND.NAMES.includes(os) ? os : 'chime'), 260);
  if (!REDUCED) $('omk').animate([{ transform: 'translate(-50%,-50%) scale(.3,.06)', opacity: 0.4 }, { transform: 'translate(-50%,-50%) scale(1,.06)', opacity: 1, offset: 0.35 }, { transform: 'translate(-50%,-50%) scale(1,1)', opacity: 1 }], { duration: 560, easing: 'ease-out' });
  $('omkX').focus({ preventScroll: true });
  showBadge();
}
// おみくじの言葉は作品ごと（その絵の世界の言い回し）。形が合わなければ、節目の共通の言葉
function omkWords() {
  const w = (state.design.omikuji || {}).words;
  const ok = w && typeof w === 'object' && OMK.LEVELS.every((l) => Array.isArray(w[l]) && w[l].length > 0 && w[l].every((x) => typeof x === 'string' && x.length > 0 && x.length <= 40));
  return ok ? w : state.set.omikuji.words;
}
// 開いた札の見た目：作品の画材で描いた紙（kami）・字の色・見出し
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
// 紙は札が出た時に読みはじめ、届いてから縁として貼る（開いた瞬間に無地から差しかわらないように）。
// 字の色は紙に合わせた物なので、紙と一緒に付ける（紙が届かない時は、無地の紙と元の字の色のまま）。bg＝縁の継ぎ目からのぞく、紙の真ん中の色
let kamiImg = null;
function loadKami() {
  const o = state.design.omikuji || {};
  if (kamiImg || !SAFE_FILE.test(o.kami || '')) return;
  kamiImg = new Image();
  kamiImg.onload = () => {
    const box = $('omk');
    box.style.borderImageSource = 'url("' + o.kami + '")';
    if (HEX.test(o.bg || '')) box.style.backgroundColor = o.bg;
    if (HEX.test(o.ink || '')) box.style.color = o.ink;
    if (HEX.test(o.inkL || '')) $('omkL').style.color = o.inkL;
    if (HEX.test(o.tbox || '')) $('omkT').style.background = o.tbox;
    box.classList.add('kami');
  };
  kamiImg.src = o.kami;
}
function dressOmikuji() {
  const o = state.design.omikuji || {};
  loadKami();
  put($('omkH'), typeof o.dai === 'string' && o.dai.length > 0 && o.dai.length <= 14 ? o.dai : 'おみくじ');
}
function closeOmikuji() { $('omk').hidden = true; $('omkBack').hidden = true; SND.play('tap'); }

// ---------- 4. つくる・送る ----------
const editor = () => $('editor');
function setKind(k) {
  const purposes = state.set.purposes; state.edKind = purposes.includes(k) ? k : purposes[0];
  const greet = state.edKind === 'g' || state.edKind === 'c', f = editor();
  f.classList.toggle('g', greet);
  for (const b of $('kinds').children) b.setAttribute('aria-pressed', String(b.dataset.k === state.edKind));
  put($('kindNote'), state.set.kindNote[state.edKind] || '');
  f.elements.t.placeholder = (state.set.defaults[state.edKind] || {}).t || '';
  f.elements.m.placeholder = (state.set.examples[state.edKind] || {}).m || '';
}
function fillForm(c) { setKind(c.p === 'r' ? 'i' : c.p); const f = editor(); for (const k of PURPOSE_KEYS.i) { const x = f.elements[k]; if (!x || k === 'p') continue; if (k === 'rp') x.checked = c[k] === '1'; else x.value = c[k] || ''; } }
function readForm() { const f = editor(), o = { p: state.edKind }; for (const k of PURPOSE_KEYS.i) { const x = f.elements[k]; if (!x || k === 'p') continue; o[k] = k === 'rp' ? (x.checked ? '1' : '') : x.value; } return clean(o); }
function openSheet(sh, back) { back.hidden = false; sh.hidden = false; void sh.offsetWidth; sh.classList.add('open'); }
function closeSheet(sh, back) { sh.classList.remove('open'); back.hidden = true; setTimeout(() => { sh.hidden = true; }, 360); }
// src：'copy'＝もらったカードを写す（あて名・差出人は空）／'blank'＝白紙から／なし＝見本から、または、つくった直後のカードを書きかえる
function openEditor(src) {
  SND.unlock(); SND.play('tap');
  state.edKeep = src === 'copy' || src === 'blank';
  if (src === 'copy') { const o = Object.assign({}, state.card || {}); delete o.to; delete o.f; if (o.p === 'r') { o.p = 'i'; delete o.rd; delete o.rm; delete o.rk; } fillForm(o); }
  else if (src === 'blank') fillForm({ p: state.card && state.card.p === 'i' ? 'i' : 'g' });
  else fillForm(state.sample ? { p: 'g' } : state.card || { p: 'g' });
  $('edCopyNote').hidden = src !== 'copy'; $('edResult').hidden = true; put($('edMsg'), '');
  openSheet(editor(), $('edBack')); editor().elements.t.focus({ preventScroll: true });
}
const shareUrl = (c) => location.href.split('#')[0].split('?')[0] + '#c=' + Card.encode(c);
const shareText = (c) => titleOf(c) + '\n' + (state.set.share[c.p] || '');
function onSubmit(e) {
  e.preventDefault(); SND.unlock(); SND.play('chime');
  const c = readForm();
  if (!hasBody(c)) { put($('edMsg'), 'どれか1つは、書いてね。'); return; }
  const url = shareUrl(c);
  if (url.length > MAX_LINK) { put($('edMsg'), 'リンクが長すぎます（' + url.length + '字）。ひとことを短くしてね。'); $('edResult').hidden = true; return; }
  state.lastCard = c;
  if (!state.edKeep) { try { history.replaceState(null, '', '#c=' + Card.encode(c)); } catch (er) { /* 別の枠の中 */ } state.mine = true; state.raw = Card.rawFromHash(location.hash); renderCard(c, false); state.omk = OMK.recall(OMK.keyOf(state.raw)); showBadge(); }
  $('edUrl').value = url; $('edOpen').href = url; $('edOpen').hidden = !state.edKeep;
  $('shLine').href = 'https://line.me/R/share?text=' + encodeURIComponent(shareText(c) + '\n' + url);
  put($('edMsg'), 'リンクの長さ：' + url.length + '字');
  $('shNative').hidden = !navigator.share;
  $('edResult').hidden = false; $('edResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function copyLink() {
  const u = $('edUrl').value; SND.play('tap');
  try { await navigator.clipboard.writeText(u); toast('リンクをコピーしました'); }
  catch (e) { const f = $('edUrl'); f.focus(); f.select(); try { document.execCommand('copy'); toast('リンクをコピーしました'); } catch (e2) { toast('リンクを長押ししてコピーしてね'); } }
}

// ---------- 5. 組み立て ----------
function setupUI() {
  const stage = $('stage');
  const touchStage = () => {
    SND.unlock(); $('hint').hidden = true;
    if (!state.soundHinted && SND.isOn()) { state.soundHinted = true; setTimeout(() => toast('音が出ない時は、\nマナーモードを解除してね'), 1400); }
    if (gim) gim.tap();
  };
  // なぞる・引く（指を動かす）も、さわるのと同じに数える。動かした後のクリックは2回目に数えない
  let down = null, swiped = false;
  stage.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; swiped = false; });
  stage.addEventListener('pointerup', (e) => {
    if (down && !e.target.closest('#omkSlip') && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 24) { swiped = true; touchStage(); }
    down = null;
  });
  stage.addEventListener('click', (e) => {
    if (e.target.closest('#omkSlip')) return;
    if (swiped) { swiped = false; return; }
    touchStage();
  });
  $('omkSlip').addEventListener('click', (e) => { e.stopPropagation(); openOmikuji(); });
  $('omkAgain').addEventListener('click', openOmikuji);
  $('omkX').addEventListener('click', closeOmikuji); $('omkBack').addEventListener('click', closeOmikuji);
  $('btnRead').addEventListener('click', () => { SND.unlock(); SND.play('tap'); reveal(true); });
  $('btnSnd').addEventListener('click', () => { SND.unlock(); const on = !SND.isOn(); SND.setOn(on); $('btnSnd').setAttribute('aria-pressed', String(on)); if (on) SND.play('tap'); toast(on ? '音：オン\n（音が出ない時は、マナーモードを解除してね）' : '音：オフ'); });
  // 目的の切りかえ（この節目で使える物だけ）
  for (const k of state.set.purposes) { const b = el('button', null, state.set.kindName[k]); b.type = 'button'; b.dataset.k = k; b.addEventListener('click', () => { SND.play('tap'); setKind(k); if (!state.edKeep) { const c = readForm(); renderCard(hasBody(c) ? c : sampleCard(state.edKind), !hasBody(c)); } }); $('kinds').appendChild(b); }
  put($('dcName'), state.set.labels.dc);
  $('btnMake').addEventListener('click', () => openEditor(state.sample || state.mine ? undefined : 'copy'));
  $('btnBlank').addEventListener('click', () => openEditor('blank'));
  $('btnEdit').addEventListener('click', () => openEditor());
  $('edX').addEventListener('click', () => closeSheet(editor(), $('edBack'))); $('edBack').addEventListener('click', () => closeSheet(editor(), $('edBack')));
  $('edSample').addEventListener('click', () => { fillForm(sampleCard(state.edKind)); if (!state.edKeep) renderCard(readForm(), false); });
  editor().addEventListener('input', () => { if (!state.edKeep) { const c = readForm(); if (hasBody(c)) renderCard(c, false); } });
  editor().addEventListener('submit', onSubmit);
  $('shCopy').addEventListener('click', copyLink);
  $('shNative').addEventListener('click', () => { const c = state.lastCard || state.card || {}; if (navigator.share) navigator.share({ title: titleOf(c), text: state.set.share[c.p] || '', url: $('edUrl').value }).catch(() => {}); });
  $('btnForget').addEventListener('click', () => { OMK.forgetAll(); state.omk = null; showBadge(); toast('おみくじの記録を消しました'); });
  if (LINE_UA) { $('lineBox').hidden = false; $('btnReopen').addEventListener('click', () => { SND.play('tap'); const u = new URL(location.href); u.searchParams.set('openExternalBrowser', '1'); location.href = u.href; }); }
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!$('omk').hidden) closeOmikuji(); else if (!editor().hidden) closeSheet(editor(), $('edBack')); });
  window.addEventListener('hashchange', loadFromHash);
}
function removeOpenExternal() {
  if (!/[?&]openExternalBrowser=1/.test(location.search)) return;
  try { const u = new URL(location.href); u.searchParams.delete('openExternalBrowser'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) { /* 別の枠の中 */ }
}
async function boot() {
  removeOpenExternal();
  const [d, s] = await Promise.all([getJSON('design.json'), getJSON('../setsume.json')]);
  if (!SAFE_ID.test(d.id) || !GIMMICKS[d.shikake] || !OMK.KATA.includes(d.omikuji && d.omikuji.kata) || !Array.isArray(d.layers)) throw new Error('design.json がおかしい');
  state.design = d; state.set = s;
  if (/^[a-z]+$/.test(d.hyogen)) document.documentElement.dataset.hyogen = d.hyogen;   // 表現ごとの色（カード・札）
  put($('kicker'), s.kicker);
  const layers = buildStage(d); placeSlip(d);
  const mod = await GIMMICKS[d.shikake]();
  gim = mod.create({ layers, d: d.butai, reduced: REDUCED, play: SND.play, onDone: afterGimmick });
  $('hint').hidden = false;
  setupUI(); loadFromHash();
  window.__fcReady = true;
  if (TEST) window.__fc = { Card, clean, OMK, state, words: s.omikuji.words, gim: () => gim.state };
}
boot().catch((e) => { window.__fcError = String(e && e.message || e); toast('カードを開けませんでした'); });
