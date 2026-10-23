// 仕掛け「舞台」：作品ごとの段取り（design.json の butai）どおりに、層を動かす・差しかえる。仕組みだけを共通にし、絵と段取りは作品ごと。
// 約束：利用者の文字は受け取らない／design.json の数は範囲を確かめてから使う／終わったら env.onDone() で殻に知らせる。
// さわるたびに段が1つ進む（なぞる・引くも、さわると同じ）。動きを減らす設定の人には、1回さわると最後の形を見せる
const EASE = { lin: 'linear', io: 'ease-in-out', out: 'cubic-bezier(.2,.8,.3,1)', in: 'cubic-bezier(.55,0,.8,.45)', pop: 'cubic-bezier(.3,1.5,.5,1)', st3: 'steps(3,end)', st4: 'steps(4,end)', st6: 'steps(6,end)' };
// x・y＝ずらし（層の大きさの %）・sx・sy＝拡大・r＝回転（度）・o＝不透明度・ct cr cb cl＝上右下左を隠す量（%。描いていく線・ふき取り）
const BASE = { x: 0, y: 0, sx: 1, sy: 1, r: 0, o: 1, ct: 0, cr: 0, cb: 0, cl: 0 };
const RANGE = { x: [-400, 400], y: [-400, 400], sx: [-10, 10], sy: [-10, 10], r: [-720, 720], o: [0, 1], ct: [0, 100], cr: [0, 100], cb: [0, 100], cl: [0, 100] };
const MAX_STEPS = 12, MAX_ANIMS = 64, MAX_KEYS = 24;
const fin = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d);
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

function props(p) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  if ('s' in p) o.sx = o.sy = fin(p.s, -10, 10, 1);
  for (const k of Object.keys(RANGE)) if (k in p) o[k] = fin(p[k], RANGE[k][0], RANGE[k][1], BASE[k]);
  return o;
}
const css = (s) => ({ transform: 'translate(' + s.x + '%,' + s.y + '%) rotate(' + s.r + 'deg) scale(' + s.sx + ',' + s.sy + ')', opacity: String(s.o), clipPath: 'inset(' + s.ct + '% ' + s.cr + '% ' + s.cb + '% ' + s.cl + '%)' });

export function create(env) {
  const L = env.layers, B = env.d && typeof env.d === 'object' ? env.d : {}, cur = {};
  const steps = list(B.steps, MAX_STEPS).map((s) => list(s, MAX_ANIMS));
  let state = 'hidden', step = 0, loops = [], afterBusy = false;
  const apply = (n) => { const c = css(cur[n]); L[n].style.transform = c.transform; L[n].style.opacity = c.opacity; L[n].style.clipPath = c.clipPath; };
  for (const n of Object.keys(L)) cur[n] = Object.assign({}, BASE);
  const init = B.init && typeof B.init === 'object' ? B.init : {};
  for (const n of Object.keys(init)) if (Object.prototype.hasOwnProperty.call(L, n)) Object.assign(cur[n], props(init[n]));
  for (const n of Object.keys(L)) apply(n);

  // 1つの動きの鍵（時刻 0〜1 と、その時の形）を、今の形から順に重ねて、アニメーションの形にする
  function frames(a, from) {
    const ks = list(a.k, MAX_KEYS).filter((x) => Array.isArray(x) && x.length === 2).map(([t, p]) => [fin(t, 0, 1, 0), p]).sort((p, q) => p[0] - q[0]);
    let s = Object.assign({}, from); const out = [];
    for (const [t, p] of ks) { s = Object.assign({}, s, props(p)); out.push(Object.assign({ offset: t }, css(s))); }
    if (out.length) { out[0].offset = 0; out[out.length - 1].offset = 1; }
    return [out, s];
  }
  // 1つの段の中で、同じ層に動きを2つ以上置いてよい（2つめ以降は、始まるまで前の動きの形のまま）。段が全部終わってから形を確定する
  function play(items, loop) {
    const waits = [], runs = [], seen = new Set();
    for (const a of items) {
      if (!a || typeof a !== 'object') continue;
      const at = fin(a.at, 0, 20000, 0);
      if (typeof a.snd === 'string') { setTimeout(() => env.play(a.snd, a.p), at); continue; }   // p＝音の高さの倍率（作品ごとの違い）
      const n = a.l;
      if (typeof n !== 'string' || !Object.prototype.hasOwnProperty.call(L, n)) continue;
      const [kf, end] = frames(a, cur[n]);
      if (kf.length < 2) continue;
      const rep = loop || a.loop === 1;
      const an = L[n].animate(kf, { duration: fin(a.d, 1, 20000, 600), delay: at, easing: EASE[a.e] || 'ease', iterations: rep ? Infinity : 1, fill: seen.has(n) ? 'forwards' : 'both' });
      seen.add(n);
      if (rep) { loops.push(an); continue; }
      cur[n] = end; runs.push([n, an]);
      waits.push(an.finished.catch(() => {}));
    }
    return Promise.all(waits).then(() => { for (const [n, an] of runs) { apply(n); an.cancel(); } });
  }
  function stopLoops() { for (const a of loops) a.cancel(); loops = []; }
  function settle() {   // 動きを減らす設定：残りの段の最後の形を、順に当てはめる
    for (; step < steps.length; step++) for (const a of steps[step]) if (a && Object.prototype.hasOwnProperty.call(L, a.l)) { cur[a.l] = frames(a, cur[a.l])[1]; apply(a.l); }
  }
  function done() { state = 'up'; env.onDone(); if (!env.reduced) play(list(B.end, MAX_ANIMS), true); }
  function next() {
    stopLoops();
    if (env.reduced) { settle(); done(); return; }
    state = 'busy';
    const items = steps[step++] || [];
    play(items).then(() => {
      if (step >= steps.length) done();
      else { state = 'wait'; play(list((list(B.wait, MAX_STEPS)[step - 1]), MAX_ANIMS), true); }
    });
  }
  if (!env.reduced) play(list(B.idle, MAX_ANIMS), true);
  return {
    tap() {
      if (state === 'hidden' || state === 'wait') next();
      else if (state === 'up' && !afterBusy && !env.reduced && Array.isArray(B.after)) { afterBusy = true; play(list(B.after, MAX_ANIMS)).then(() => { afterBusy = false; }); }
    },
    get state() { return state; },
  };
}
