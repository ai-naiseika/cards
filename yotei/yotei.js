// 送る予定（あとで送る）：束をつくる → カレンダーに入れる → 時間になったら、1人ずつ LINE の送信先を選んで送る。
// 画面に文字を出すのは put() だけ（textContent）。HTML として解釈させる書き方は使わない。
// 読む入口：アドレスの #b=・#d=（bundle.js が検査）、貼ったカードのリンク（bundle.js が検査）、同じ場所の setsume.json・design.json。
// 端末に残すのは「送れた印」（元に戻せない短い番号と時刻）だけ。束の中身は残さない。
import { Bundle, normalize, pack, validAt, cardFromText, cardUrl, lineShare, line, MAX_ITEMS, MAX_MAKE } from './bundle.js';
import { icsFor } from './ics.js';

const $ = (id) => document.getElementById(id);
function put(node, s) { node.textContent = s; }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) put(e, text); return e; };
const ext = (a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
const LINE_UA = /Line\//i.test(navigator.userAgent);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PAGE = location.origin + location.pathname;
const CARDS = new URL('../', PAGE).href;
const SAFE_ID = /^[a-z0-9-]{3,40}$/;
const state = { bundle: null, pending: -1, sets: {}, names: {} };
let tt = 0;

function toast(msg) { const t = $('toast'); put(t, msg); t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }
function show(id) { $('toast').classList.remove('show'); for (const v of ['vBroken', 'vMake', 'vDone', 'vSend']) $(v).hidden = v !== id; $('lineBox').hidden = !(LINE_UA && (id === 'vMake' || id === 'vDone')); window.scrollTo(0, 0); }

// ---------- 日時の言い方 ----------
const p2 = (n) => String(n).padStart(2, '0');
const atDate = (at) => { const [y, m, d] = at.slice(0, 10).split('-').map(Number), [h, mi] = at.slice(11).split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const whenText = (at) => { const t = atDate(at); return (t.getMonth() + 1) + '月' + t.getDate() + '日（' + WD[t.getDay()] + '）' + t.getHours() + ':' + p2(t.getMinutes()); };
function defaultAt(setsume) {
  const now = new Date();
  let t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0);
  if (setsume === 'shogatsu') { t = new Date(now.getFullYear() + (now.getMonth() === 0 && now.getDate() === 1 && now.getHours() < 8 ? 0 : 1), 0, 1, 8, 0); }
  return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + 'T' + p2(t.getHours()) + ':' + p2(t.getMinutes());
}

// ---------- 節目の約束とデザインの名前（同じ場所のファイル。読めなくても送れる） ----------
async function getJSON(u) { const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw new Error('読めない'); return r.json(); }
async function loadMeta(items) {
  const sets = [...new Set(items.map((x) => x.d.split('/')[0]))], ds = [...new Set(items.map((x) => x.d))];
  await Promise.all(sets.filter((s) => !state.sets[s]).map((s) => getJSON(CARDS + s + '/setsume.json').then((j) => { state.sets[s] = j; }).catch(() => { state.sets[s] = {}; })));
  await Promise.all(ds.filter((d) => !state.names[d] && SAFE_ID.test(d.split('/')[1])).map((d) => getJSON(CARDS + d + '/design.json').then((j) => { state.names[d] = typeof j.pageTitle === 'string' ? line(j.pageTitle, 60) : ''; }).catch(() => { state.names[d] = ''; })));
}
const setOf = (it) => state.sets[it.d.split('/')[0]] || {};
const dict = (o, k) => (o && typeof o === 'object' && typeof o[k] === 'object' && o[k]) || {};
function titleOf(it) { const t = it.c.t || dict(dict(setOf(it), 'defaults'), it.c.p).t; return typeof t === 'string' ? line(t, 28) : ''; }
function shareText(it) {
  const s = dict(setOf(it), 'share')[it.c.p], msg = typeof s === 'string' ? line(s, 40) : 'カードを送ったよ。ひらいてね';
  return [titleOf(it), msg, cardUrl(CARDS, it)].filter(Boolean).join('\n');
}
const nameOf = (it) => state.names[it.d] || it.d;
const whoOf = (it) => it.c.to || (state.bundle && state.bundle.items.length === 1 ? 'あて名なし（まとめて）' : 'あて名なし');

// ---------- 送れた印：束の日時・行・カードの中身から作る短い番号（元には戻せない）と時刻だけ ----------
const STORE = 'cards-sent-v1', KEEP = 200, DAYS = 400;
function hash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; }
  return 's' + a.toString(36) + b.toString(36);
}
const keyOf = (b, i) => hash(b.at + '|' + i + '|' + b.items[i].d + '|' + cardUrl('', b.items[i]));
function readSent() {
  try { const o = JSON.parse(localStorage.getItem(STORE) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
function sentAt(k) { const v = readSent()[k]; return Number.isFinite(v) ? v : 0; }
function setSent(k, on) {
  try {
    const o = readSent(), lim = Date.now() - DAYS * 86400000;
    delete o[k]; if (on) o[k] = Date.now();
    const ks = Object.keys(o).filter((x) => /^s[0-9a-z]{2,16}$/.test(x) && Number.isFinite(o[x]) && o[x] > lim).sort((x, y) => o[x] - o[y]);
    const keep = {}; ks.slice(-KEEP).forEach((x) => { keep[x] = o[x]; });
    localStorage.setItem(STORE, JSON.stringify(keep));
  } catch (e) { /* 覚えられない画面（プライベートモードなど）では、印が残らないだけ */ }
}

// ---------- 1. あとで送る（つくる） ----------
let base = null;   // 送るカード（あて名以外は全員で同じ）
function addRow(to, mm) {
  const rows = $('rows');
  if (rows.children.length >= MAX_ITEMS) { toast(MAX_ITEMS + '人までです'); return; }
  const r = el('div', 'row'), a = el('input'), m = el('input'), x = el('button', 'x', '×');
  a.name = 'to'; a.maxLength = 24; a.placeholder = 'あて名（例：たなかさん）'; a.value = to || ''; a.setAttribute('aria-label', 'あて名');
  m.name = 'mm'; m.maxLength = 24; m.placeholder = 'メモ（例：大学の友人）'; m.value = mm || ''; m.setAttribute('aria-label', 'メモ（自分だけ）');
  x.type = 'button'; x.setAttribute('aria-label', 'この人を消す'); x.addEventListener('click', () => { r.remove(); });
  r.append(a, m, x); rows.appendChild(r);
}
function openMake(draft) {
  show('vMake');
  $('mkMsg').textContent = '';
  base = draft ? { d: draft.items[0].d, c: Object.assign({}, draft.items[0].c) } : null;
  $('mkPaste').hidden = !!base; $('mkCard').hidden = !base; $('mkForm').hidden = !base;
  if (!base) return;
  delete base.c.to;
  loadMeta([base]).then(() => { put($('mkCardName'), nameOf(base)); });
  put($('mkCardName'), nameOf(base)); put($('mkCardTitle'), titleOf(base) || '（題なし）');
  $('mkCardOpen').href = cardUrl(CARDS, base);
  const f = $('mkForm'), at = draft.at || defaultAt(base.d.split('/')[0]);
  f.elements.day.value = at.slice(0, 10); f.elements.time.value = at.slice(11);
  f.elements.n.value = draft.n || (base.d.indexOf('shogatsu/') === 0 ? '年賀' : '');
  $('rows').textContent = '';
  const given = draft.items.filter((x) => x.c.to || x.mm);
  given.forEach((x) => addRow(x.c.to, x.mm));
  for (let i = given.length; i < 3; i++) addRow('', '');
}
function makeBundle() {
  const f = $('mkForm'), at = f.elements.day.value + 'T' + f.elements.time.value;
  if (!validAt(at)) return { err: '送る日と時刻を入れてね' };
  if (atDate(at) < new Date(Date.now() - 60000)) return { err: 'その時刻は、もう過ぎています' };
  const rows = [...$('rows').children].map((r) => ({ to: line(r.querySelector('[name=to]').value, 24), mm: line(r.querySelector('[name=mm]').value, 24) })).filter((x) => x.to || x.mm);
  const items = (rows.length ? rows : [{ to: '', mm: '' }]).map((x) => { const c = Object.assign({}, base.c); if (x.to) c.to = x.to; return { d: base.d, c, mm: x.mm }; });
  const b = normalize(pack({ at, n: line(f.elements.n.value, 16), items }), false);
  if (!b) return { err: 'カードの中身が読めませんでした。カードを作りなおしてね' };
  const url = PAGE + '#b=' + Bundle.encode(b);
  if (url.length > MAX_MAKE) return { err: '長すぎます（' + url.length + '字・' + MAX_MAKE + '字まで）。人数を減らすか、カードのひとことを短くしてね' };
  return { b, url };
}
function summaryOf(b) { return whenText(b.at) + '　' + (b.n || 'カード') + '　' + b.items.length + '人'; }
function titleForCal(b) { return 'カードを送る：' + (b.n || 'カード') + '（' + b.items.length + '人）'; }
function openDone(b, url) {
  show('vDone');
  try { history.replaceState(null, '', '#d=' + Bundle.encode(b)); } catch (e) { /* 別の枠の中 */ }
  put($('dnSummary'), summaryOf(b));
  $('dnUrl').value = url; $('lnSend').href = url;
  $('lnKeep').href = lineShare('【送る予定の控え・人に送らない】\n' + summaryOf(b) + '\n' + url);
  $('btnIcs').onclick = () => {
    const txt = icsFor({ at: b.at, title: titleForCal(b), url, note: 'このリンクを開いて、LINE で送ります。相手の名前が入っています。人に送らないでね。' });
    const u = URL.createObjectURL(new Blob([txt], { type: 'text/calendar;charset=utf-8' })), a = document.createElement('a');
    a.href = u; a.download = 'okuru-yotei.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
    toast('カレンダーのファイルを書き出しました');
  };
}

// ---------- 2. 送る ----------
function askFor(i) {
  const b = state.bundle, it = b.items[i], unsent = (j) => j !== i && !sentAt(keyOf(b, j));
  let next = b.items.findIndex((x, j) => j > i && unsent(j));   // 次はこの人より下の、まだの人。いなければ上に戻る
  if (next < 0) next = b.items.findIndex((x, j) => unsent(j));
  state.pending = i;
  put($('sdAskText'), whoOf(it) + (it.mm ? '（' + it.mm + '）' : '') + ' に、送れた？');
  const na = $('sdAskNext'), nd = $('sdAskDone');
  na.hidden = next < 0; nd.hidden = next >= 0;
  if (next >= 0) { put(na, '送れた・次へ（' + whoOf(b.items[next]) + '）'); na.href = lineShare(shareText(b.items[next])); na.dataset.next = String(next); }
  $('sdAsk').hidden = false;
}
function renderSend() {
  const b = state.bundle, list = $('sdList');
  put($('sdTitle'), 'カードを送る：' + (b.n || 'カード'));
  const t = atDate(b.at), days = Math.ceil((t - new Date()) / 86400000);
  put($('sdWhen'), whenText(b.at) + (t > new Date() ? ' に送る予定（' + (days >= 1 ? 'あと ' + days + ' 日' : 'もうすぐ') + '）' : '　送る時間です'));
  // 全員が同じ絵・同じ題なら、カードの名前は上に1回だけ出す
  const cardLine = (it) => nameOf(it) + (it.c.t ? '　「' + it.c.t + '」' : ''), same = b.items.every((x) => x.d === b.items[0].d && x.c.t === b.items[0].c.t);
  put($('sdCard'), same ? '送るカード：' + cardLine(b.items[0]) : ''); $('sdCard').hidden = !same;
  let done = 0; list.textContent = '';
  b.items.forEach((it, i) => {
    const k = keyOf(b, i), at = sentAt(k), li = el('li', 'item' + (at ? ' sent' : ''));
    const who = el('p', 'nm'); who.appendChild(el('b', null, whoOf(it))); if (it.mm) who.appendChild(el('small', null, '（' + it.mm + '）')); li.appendChild(who);
    if (!same) li.appendChild(el('p', 'sub', cardLine(it)));
    const acts = el('div', 'rowacts');
    const go = ext(el('a', 'btn' + (at ? ' ghost' : ' main'), at ? 'もう一度送る' : (b.items.length === 1 && !it.c.to ? 'まとめて送る' : 'LINEで送る')));
    go.href = lineShare(shareText(it)); go.addEventListener('click', () => { state.pending = i; });
    const mk = el('button', 'btn ghost small', at ? '印を消す' : '送れた'); mk.type = 'button';
    mk.addEventListener('click', () => { setSent(k, !at); $('sdAsk').hidden = true; renderSend(); });
    const see = ext(el('a', 'linkbtn', 'カードを見る ›')); see.href = cardUrl(CARDS, it);
    acts.append(go, mk, see); li.appendChild(acts);
    if (at) { const d = new Date(at); li.appendChild(el('p', 'stamp', '送れた ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + p2(d.getMinutes()))); done++; }
    list.appendChild(li);
  });
  put($('sdCount'), done + ' / ' + b.items.length + ' 送れた' + (done === b.items.length ? '。おつかれさまでした（カレンダーの予定は、消してもだいじょうぶ）' : ''));
  $('lnEdit').href = '#d=' + Bundle.encode(b);
}
async function openSend(b) {
  state.bundle = b; state.pending = -1;
  show('vSend'); $('sdAsk').hidden = true;
  renderSend();
  await loadMeta(b.items);
  if (state.bundle === b) renderSend();
}

// ---------- 道すじ ----------
function route() {
  const { kind, bundle } = Bundle.fromHash(location.hash);
  if (kind === 'b') { if (bundle) openSend(bundle); else show('vBroken'); }
  else if (kind === 'd') { if (bundle) openMake(bundle); else show('vBroken'); }
  else if (location.hash && location.hash !== '#') show('vBroken');
  else openMake(null);
}
function init() {
  try { if (/[?&]openExternalBrowser=1/.test(location.search)) { const u = new URL(location.href); u.searchParams.delete('openExternalBrowser'); history.replaceState(null, '', u.pathname + u.search + u.hash); } } catch (e) { /* 別の枠の中 */ }
  $('btnReopen').addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('openExternalBrowser', '1'); location.href = u.href; });
  $('btnPaste').addEventListener('click', () => {
    const it = cardFromText($('pasteText').value, location.origin);
    if (!it) { toast('カードのリンクが見つかりませんでした'); return; }
    location.hash = '#d=' + Bundle.encode({ at: '', n: '', items: [it] });
  });
  $('btnAddRow').addEventListener('click', () => addRow('', ''));
  $('mkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const r = makeBundle();
    if (r.err) { put($('mkMsg'), r.err); return; }
    openDone(r.b, r.url);
  });
  $('btnCopy').addEventListener('click', async () => {
    const u = $('dnUrl').value;
    try { await navigator.clipboard.writeText(u); toast('控えのリンクをコピーしました'); }
    catch (e) { const f = $('dnUrl'); f.focus(); f.select(); try { document.execCommand('copy'); toast('控えのリンクをコピーしました'); } catch (e2) { toast('リンクを長押ししてコピーしてね'); } }
  });
  $('sdAskNext').addEventListener('click', () => {
    const b = state.bundle; if (!b || state.pending < 0) return;
    setSent(keyOf(b, state.pending), true);
    const n = Number($('sdAskNext').dataset.next); state.pending = Number.isInteger(n) ? n : -1;
    $('sdAsk').hidden = true; renderSend();
  });
  $('sdAskDone').addEventListener('click', () => { const b = state.bundle; if (b && state.pending >= 0) setSent(keyOf(b, state.pending), true); state.pending = -1; $('sdAsk').hidden = true; renderSend(); });
  $('sdAskNot').addEventListener('click', () => { state.pending = -1; $('sdAsk').hidden = true; });
  // LINE から戻った時（画面がまた見えた時）に「送れた？」と聞く
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.bundle && state.pending >= 0 && !$('vSend').hidden && !sentAt(keyOf(state.bundle, state.pending))) askFor(state.pending); });
  window.addEventListener('hashchange', route);
  route();
}
init();
