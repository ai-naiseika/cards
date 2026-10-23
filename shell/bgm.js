// 正月のカードの BGM（本人 2026-10-23「クリスマスで BGM 作ったみたいに、正月の曲を何曲か作って加えて。同じようにメドレー機能も」）
// 音声ファイルは使わず、その場で合成する。殻（shell.js）が、最初にさわった後に読む。作り方の手本は クリスマス/共通/town_bgm.js
// 旋律の出典（どれも著作権の切れた曲。旋律だけを使い、歌詞は使わない。編曲と音色は自作）：
//   お正月 … 作曲 瀧廉太郎（1879〜1903）。1901年『幼稚園唱歌』。作詞の東くめ（1969年没）の詞は保護期間中なので使わない
//   雪（雪やこんこ）… 文部省唱歌（作詞・作曲者不詳）。1911年『尋常小学唱歌（二）』
//   ふじの山 … 文部省唱歌（作曲者不詳）。1910年『尋常小学読本唱歌』
//   冬の夜 … 文部省唱歌（作詞・作曲者不詳）。1912年『尋常小学唱歌（三）』
//   楽譜は、日本語版ウィキペディアの各曲の記事の楽譜（score の LilyPond）。検査（tests/BGM書き出し.py）が、その楽譜とこの旋律を1音ずつ比べる
// 暗く・怖くしない（クリスマスで、自作の旋律を夜のオルゴールで鳴らしたらハロウィンのように聞こえた 本人）：長調・高めの音・残響はひかえめ
// 音は、どれも音量を0から始めて0で終える。はじく・打つ音は最初に1度だけ波形を作り、1音＝ノード1つで鳴らす（スマホで、さわる音と一緒でも追いつくように）
let ctx = null, rig = null, live = null, timer = null, wanted = false, cur = 'oshogatsu', medley = false, vol = 0.7;   // vol＝「BGM の大きさ」（効果音より少し小さく。既定 0.7）
const LOOK = 3, TICK = 250, TAU = Math.PI * 2;   // 3秒先まで予約し、0.25秒ごとに見回る（画面の処理で止まっても途切れない）
const rnd = (a, b) => a + Math.random() * (b - a), mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- 土台：出口・残響（スマホのスピーカー向けに、出ない低さを削り、旋律の通る所を少し上げる） ----------
function makeRig(c) {
  const master = c.createGain(), comp = c.createDynamicsCompressor(); master.gain.value = 0.55; comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3;
  const hp = c.createBiquadFilter(), lo = c.createBiquadFilter(), pr = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120; hp.Q.value = 0.7;
  lo.type = 'lowshelf'; lo.frequency.value = 220; lo.gain.value = -3; pr.type = 'peaking'; pr.frequency.value = 2800; pr.Q.value = 0.9; pr.gain.value = 3;
  master.connect(hp); hp.connect(lo); lo.connect(pr); pr.connect(comp); comp.connect(c.destination);
  // 残響は0.6秒のモノラル。右だけ13ms遅らせて、左右に少し広げる
  const sr = c.sampleRate, n = Math.floor(sr * 0.6), ir = c.createBuffer(1, n, sr), d = ir.getChannelData(0); let lp = 0;
  for (let i = 0; i < n; i++) { lp += 0.3 * (Math.random() * 2 - 1 - lp); d[i] = lp * Math.pow(1 - i / n, 2.6); }
  const revIn = c.createGain(), conv = c.createConvolver(), dly = c.createDelay(0.05), mg = c.createChannelMerger(2);
  revIn.channelCount = 1; revIn.channelCountMode = 'explicit'; conv.buffer = ir; dly.delayTime.value = 0.013;
  revIn.connect(conv); conv.connect(mg, 0, 0); conv.connect(dly); dly.connect(mg, 0, 1); mg.connect(master);
  return { c, master, revIn, bank: {}, waves: {} };
}
// 楽器の通り道（音量・こもらせ・左右）。曲ごとに作り、曲を替えたら捨てる
function chan(r, bus, v, lp, pan) { const c = r.c, g = c.createGain(); g.gain.value = v; let out = g;
  if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; } out.connect(bus);
  if (!lp) return g; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.6; f.connect(g); return f; }

// ---------- はじく・打つ音：1度だけ波形を作る（頭はなめらかに立ち上げ、終わりの3割で0まで下げる） ----------
function bake(c, sec, atk, fill) { const sr = c.sampleRate, n = Math.ceil(sec * sr), b = c.createBuffer(1, n, sr), d = b.getChannelData(0); fill(d, sr);
  const A = Math.max(1, Math.round(atk * sr)), F = Math.floor(n * 0.3); let pk = 0;
  for (let i = 0; i < n; i++) { if (i < A) d[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / A); if (i > n - F) d[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - n + F) / F); pk = Math.max(pk, Math.abs(d[i])); }
  for (let i = 0; i < n; i++) d[i] /= pk || 1; return b; }
// はじいた弦（カープラス・ストロング）。bright＝はじいた瞬間の明るさ、t60＝1000分の1に消えるまでの秒
const pluck = (bright, t60) => (d, sr, f) => { const P = sr / f - 0.5, L = Math.floor(P - 0.1), C = (1 - (P - L)) / (1 + (P - L)), buf = new Float32Array(L), rho = Math.pow(0.001, 1 / (t60 * f)); let lp = 0, mean = 0;
  for (let i = 0; i < L; i++) { lp += bright * (Math.random() * 2 - 1 - lp); buf[i] = lp; mean += lp / L; } for (let i = 0; i < L; i++) buf[i] -= mean;
  let j = 0, prev = 0, x1 = 0, y1 = 0; for (let i = 0; i < d.length; i++) { const x = buf[j]; d[i] = x; const y = rho * 0.5 * (x + prev); prev = x; const a = C * y + x1 - C * y1; x1 = y; y1 = a; buf[j] = a; if (++j === L) j = 0; } };
// お琴：明るくはじいた絹の弦＋爪の当たる小さな音
const kotoFill = (d, sr, f) => { pluck(0.6, 2.2)(d, sr, f); let x0 = 0, hp = 0; const n = Math.round(sr * 0.006);
  for (let i = 0; i < n; i++) { const x = Math.random() * 2 - 1; hp = 0.5 * (hp + x - x0); x0 = x; d[i] += 0.3 * hp * Math.exp(-i / (sr * 0.0015)); } };
// 小さな鈴：3つが少しずつずれて、しゃらん
function suzuFill(d, sr) { const A = Math.round(sr * 0.0008);
  [[4200, 1, 0], [5000, 0.7, 0.006], [3600, 0.8, 0.014]].forEach(([f0, amp, dt]) => { const o = Math.floor(sr * dt), f = f0 * rnd(0.98, 1.02);
    for (const [m, g, tau] of [[1, 1, 0.35], [1.52, 0.35, 0.18], [2.3, 0.18, 0.09]]) { if (f * m > sr * 0.42) continue; const w = TAU * f * m / sr, k = Math.exp(-1 / (tau * sr)); let e = amp * g;
      for (let i = 0; o + i < d.length && e > 1e-5; i++, e *= k) d[o + i] += (i < A ? 0.5 - 0.5 * Math.cos(Math.PI * i / A) : 1) * e * Math.sin(w * i); } }); }
// 締太鼓（テン）：張りの強い小さな太鼓。高く当たって、すぐ消える
function shimeFill(d, sr) { let ph = 0, x0 = 0, hp = 0;
  for (let i = 0; i < d.length; i++) { const t = i / sr, x = Math.random() * 2 - 1; ph += TAU * (420 + 160 * Math.exp(-t / 0.012)) / sr; hp = 0.55 * (hp + x - x0); x0 = x; d[i] = Math.exp(-t / 0.07) * Math.sin(ph) + 0.5 * hp * Math.exp(-t / 0.008); } }
// 当たり鉦（チン）：金属の、少しずれた倍音
function kaneFill(d, sr) { for (const [f, g, tau] of [[1480, 1, 0.22], [2860, 0.6, 0.12], [4150, 0.4, 0.08], [5600, 0.25, 0.05]]) { const w = TAU * f / sr, k = Math.exp(-1 / (tau * sr)); let e = g; for (let i = 0; i < d.length && e > 1e-5; i++, e *= k) d[i] += e * Math.sin(w * i); }
  let x0 = 0, hp = 0; for (let i = 0; i < d.length; i++) { const x = Math.random() * 2 - 1; hp = 0.7 * (hp + x - x0); x0 = x; d[i] += 0.6 * hp * Math.exp(-i / (sr * 0.01)); } }
// 笛の息（吹きはじめのシュッ）。lo＝こもらせる強さ、tau＝消える速さ
const breathFill = (lo, tau) => (d, sr) => { let a = 0, a0 = 0, hp = 0;
  for (let i = 0; i < d.length; i++) { const x = Math.random() * 2 - 1; a += lo * (x - a); hp = 0.85 * (hp + a - a0); a0 = a; d[i] = hp * Math.exp(-i / (sr * tau)); } };
const INST = {
  koto: { bases: [48, 60, 72, 84], sec: (b) => (b < 70 ? 2.4 : 1.7), atk: 0.0012, fill: kotoFill },
  suzu: { bases: [0], sec: () => 1.1, atk: 0.0006, fill: suzuFill },
  shime: { bases: [0], sec: () => 0.3, atk: 0.0008, fill: shimeFill },
  kane: { bases: [0], sec: () => 0.6, atk: 0.0006, fill: kaneFill },
  breath: { bases: [0], sec: () => 0.16, atk: 0.006, fill: breathFill(0.55, 0.04) },     // 篠笛
  breathL: { bases: [0], sec: () => 0.4, atk: 0.02, fill: breathFill(0.3, 0.12) },      // 尺八（低く、長め）
};
// midi＝音の高さ。vol を渡した時だけ、音量のノードを足す
function hit(r, dest, t, name, midi, v) { const I = INST[name], base = I.bases.find((b) => b >= midi) ?? I.bases[I.bases.length - 1], key = name + base;
  const b = r.bank[key] || (r.bank[key] = bake(r.c, I.sec(base), I.atk, (d, sr) => I.fill(d, sr, mtof(base), base))), s = r.c.createBufferSource();
  s.buffer = b; s.playbackRate.value = Math.pow(2, (midi - base) / 12);
  if (v != null) { const g = r.c.createGain(); g.gain.value = v; s.connect(g); g.connect(dest); } else s.connect(dest); s.start(t); }

// ---------- のばす音（笛・尺八・笙）：1音＝発振器＋音量 ----------
const WAVES = { fue: [1, 0.12, 0.05, 0.02], shaku: [1, 0.4, 0.18, 0.1, 0.06, 0.03], sho: [1, 0.55, 0.4, 0.28, 0.2, 0.14, 0.1, 0.07] };
function wave(r, k) { if (!r.waves[k]) { const A = WAVES[k], re = new Float32Array(A.length + 1), im = new Float32Array(A.length + 1); A.forEach((a, i) => { im[i + 1] = a; }); r.waves[k] = r.c.createPeriodicWave(re, im); } return r.waves[k]; }
// o: w＝音色 a＝立ち上がり rel＝消える時間 sus＝終わりぎわの音量の割合 vib＝ビブラート（セント） scoop＝下からすくう（セント）
function voice(r, dest, t, midi, len, v, o) { const c = r.c, g = c.createGain(), a = o.a || 0.02, rel = o.rel || 0.1, end = t + Math.max(len, a + 0.03), stop = end + rel + 0.02;
  g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.linearRampToValueAtTime(v * (o.sus ?? 0.8), end); g.gain.linearRampToValueAtTime(0, end + rel); g.connect(dest);
  const s = c.createOscillator(); s.setPeriodicWave(wave(r, o.w)); s.frequency.value = mtof(midi);
  if (o.scoop) { s.detune.setValueAtTime(-o.scoop, t); s.detune.linearRampToValueAtTime(0, t + 0.07); }
  // ビブラートは0.3秒たってから。ノードを足さず、細かい予約の列で揺らす
  if (o.vib && end - t > 0.5) { const n = Math.ceil((stop - t - 0.3) * 40), w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = o.vib * Math.min(1, i / 12) * Math.sin(TAU * 5 * i / 40); s.detune.setValueCurveAtTime(w, t + 0.3, n / 40); }
  s.connect(g); s.start(t); s.stop(stop); }
// 笙の和音（合竹）：ゆっくりふくらみ、ゆっくり消える。前の和音と重ねて、すき間をつくらない
function sho(r, dest, t, midis, len, v) { const c = r.c, g = c.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.9); g.gain.setValueAtTime(v, t + len); g.gain.linearRampToValueAtTime(0, t + len + 1); g.connect(dest);
  for (const m of midis) { const s = c.createOscillator(); s.setPeriodicWave(wave(r, 'sho')); s.frequency.value = mtof(m); s.detune.value = rnd(-4, 4); s.connect(g); s.start(t); s.stop(t + len + 1.05); } }

// 和音：[低音, [和音の音]]。お琴の低い弦は 48 より下を1オクターブ上げる
const CH = { F: [41, [57, 60, 65]], C: [48, [55, 60, 64]], Bb: [46, [58, 62, 65]], Dm: [50, [57, 62, 65]], G: [43, [55, 59, 62]], G7: [43, [53, 59, 62]], Am: [45, [57, 60, 64]], D: [38, [54, 57, 62]] };
const lowKoto = (m) => (m < 48 ? m + 12 : m);
const SHO = { C: [72, 74, 76, 79, 81], F: [72, 74, 77, 79, 81], G: [74, 76, 79, 81, 83], G7: [74, 77, 79, 81, 83], Am: [72, 76, 79, 81, 84] };
// 和音の床（笙の音色を低く、こもらせて、ごく小さく）。お琴の音が消えていく所や、曲のつなぎ目に、すき間をつくらない（スマホの小さな音でも -60dB を割らない）
const BED = { F: [53, 60, 65, 69], C: [48, 55, 64, 67], Bb: [50, 58, 62, 65], Dm: [50, 57, 62, 65], G: [55, 62, 67, 71], D: [50, 57, 62, 66] };
function bed(r, dest, t, H, half, v) { if (H[0] === H[1]) sho(r, dest, t, BED[H[0]], 2 * half, v); else { sho(r, dest, t, BED[H[0]], half, v); sho(r, dest, t + half, BED[H[1]], half, v); } }

// ---------- 1 お正月：ヘ長調・4拍子・107bpm・12小節。お琴（旋律と、トン・テン）・小さな鈴。2回目は篠笛が歌い、締太鼓がそっと ----------
// 旋律は楽譜どおり（[拍, 音の高さ, 長さ]・書いてある高さ）。和音は自作（半小節ごと）
const OS_B = 0.56;
const OS_MEL = [[[0, 65, 2], [2, 67, 1], [3, 65, 0.5], [3.5, 67, 0.5]], [[0, 69, 1], [1, 72, 1], [2, 69, 2]], [[0, 67, 1], [1, 67, 1], [2, 65, 1], [3, 67, 1]], [[0, 69, 3]],
  [[0, 65, 0.5], [0.5, 65, 0.5], [1, 62, 0.5], [1.5, 62, 0.5], [2, 60, 0.5], [2.5, 60, 0.5], [3, 60, 1]], [[0, 65, 0.5], [0.5, 65, 0.5], [1, 67, 0.5], [1.5, 67, 0.5], [2, 69, 2]],
  [[0, 69, 0.5], [0.5, 69, 0.5], [1, 67, 1], [2, 65, 0.5], [2.5, 65, 0.5], [3, 65, 0.5], [3.5, 65, 0.5]], [[0, 67, 0.5], [0.5, 67, 0.5], [1, 69, 0.5], [1.5, 69, 0.5], [2, 72, 2]],
  [[0, 65, 2], [2, 67, 1], [3, 65, 0.5], [3.5, 67, 0.5]], [[0, 69, 1], [1, 72, 1], [2, 69, 1], [3, 69, 1]], [[0, 67, 1], [1, 67, 1], [2, 69, 1], [3, 67, 1]], [[0, 65, 3]]];
const OS_HARM = [['F', 'F'], ['F', 'F'], ['C', 'C'], ['F', 'F'], ['Bb', 'F'], ['F', 'F'], ['Dm', 'F'], ['C', 'F'], ['F', 'F'], ['F', 'F'], ['C', 'C'], ['F', 'F']];
const oshoSetup = (r, bus) => ({ bed: chan(r, bus, 0.5, 1800), koto: chan(r, bus, 0.16, 0, -0.1), kotoB: chan(r, bus, 0.1, 0, 0.12), fue: chan(r, bus, 1.2, 5200, 0.05), breath: chan(r, bus, 0.03, 0, 0.05), suzu: chan(r, bus, 0.05, 0, 0.2), shime: chan(r, bus, 0.035, 0, -0.15) });
function oshoBar(r, ch, k, t, n) { const B = OS_B, round = Math.floor(n / 12) % 2, H = OS_HARM[k];
  for (const [off, m, len] of OS_MEL[k]) { const tt = t + off * B + rnd(0, 0.006);
    if (!round) hit(r, ch.koto, tt, 'koto', m);
    else { voice(r, ch.fue, tt, m + 12, len * B * 0.88, 0.045, { w: 'fue', a: 0.03, rel: 0.1, vib: 10, scoop: 30, sus: 0.85 }); hit(r, ch.breath, tt, 'breath', 0); hit(r, ch.kotoB, tt, 'koto', m, 0.6); } }
  // 低い弦：1・3拍目に和音の根、2・4拍目に5度（トン・テン）
  for (const [b, h] of [[0, H[0]], [2, H[1]]]) { const root = lowKoto(CH[h][0]); hit(r, ch.kotoB, t + b * B, 'koto', root); hit(r, ch.kotoB, t + (b + 1) * B, 'koto', root + 7, 0.7); }
  bed(r, ch.bed, t, H, 2 * B, 0.008);
  if (k % 4 === 0) hit(r, ch.suzu, t, 'suzu', 0);
  if (round) { hit(r, ch.shime, t + 3 * B, 'shime', 0); hit(r, ch.shime, t + 3.5 * B, 'shime', 0, 0.6); }
  if (k === 11) [65, 69, 72, 74, 77, 81, 84].forEach((m, i) => hit(r, ch.koto, t + 2 * B + i * 0.06, 'koto', m, 0.55)); }   // 終わり：流し爪で、上へさらりと

// ---------- 2 雪（雪やこんこ）：お囃子ふう。ヘ長調・2拍子・109bpm・16小節。篠笛（旋律）・締太鼓「テン・テン・テケ・テン」・当たり鉦・お琴（低い弦）。2回目は、お琴も旋律を重ねる ----------
const YK_B = 0.55;
const YK_MEL = [[[0, 72, 0.75], [0.75, 74, 0.25], [1, 72, 0.75], [1.75, 74, 0.25]], [[0, 72, 1], [1, 69, 0.5]], [[0, 69, 0.75], [0.75, 70, 0.25], [1, 69, 0.75], [1.75, 70, 0.25]], [[0, 69, 1], [1, 65, 0.5]],
  [[0, 69, 1], [1, 65, 0.5], [1.5, 67, 0.5]], [[0, 69, 1], [1, 65, 0.5], [1.5, 67, 0.5]], [[0, 69, 0.75], [0.75, 70, 0.25], [1, 72, 0.5], [1.5, 72, 0.5]], [[0, 67, 0.75], [0.75, 69, 0.25], [1, 67, 0.5]],
  [[0, 72, 0.75], [0.75, 74, 0.25], [1, 72, 0.75], [1.75, 74, 0.25]], [[0, 72, 0.5], [0.5, 72, 0.5], [1, 69, 0.5], [1.5, 69, 0.5]], [[0, 69, 0.75], [0.75, 70, 0.25], [1, 69, 0.75], [1.75, 70, 0.25]], [[0, 69, 0.5], [0.5, 69, 0.5], [1, 65, 0.5]],
  [[0, 74, 1], [1, 72, 0.5], [1.5, 69, 0.5]], [[0, 72, 0.5], [0.5, 72, 0.5], [1, 69, 0.5], [1.5, 65, 0.5]], [[0, 69, 0.5], [0.5, 69, 0.5], [1, 67, 0.75], [1.75, 67, 0.25]], [[0, 65, 1]]];
const YK_HARM = [['F', 'F'], ['F', 'F'], ['F', 'F'], ['F', 'F'], ['F', 'C'], ['F', 'C'], ['F', 'F'], ['C', 'C'], ['F', 'F'], ['F', 'F'], ['F', 'F'], ['F', 'F'], ['Bb', 'F'], ['F', 'F'], ['F', 'C'], ['F', 'F']];
const yukiSetup = (r, bus) => ({ bed: chan(r, bus, 0.5, 1800), fue: chan(r, bus, 1.25, 5600, 0.05), breath: chan(r, bus, 0.035, 0, 0.05), koto: chan(r, bus, 0.12, 0, -0.12), kotoM: chan(r, bus, 0.12, 0, -0.08),
  shime: chan(r, bus, 0.05, 0, -0.18), kane: chan(r, bus, 0.02, 0, 0.2), suzu: chan(r, bus, 0.045, 0, 0.2) });
function yukiBar(r, ch, k, t, n) { const B = YK_B, round = Math.floor(n / 16) % 2, H = YK_HARM[k];
  for (const [off, m, len] of YK_MEL[k]) { const tt = t + off * B + rnd(0, 0.005);
    voice(r, ch.fue, tt, m + 12, len * B * 0.86, 0.042, { w: 'fue', a: 0.02, rel: 0.08, vib: 8, scoop: 25, sus: 0.8 }); hit(r, ch.breath, tt, 'breath', 0);
    if (round) hit(r, ch.kotoM, tt, 'koto', m); }
  for (const [b, v] of [[0, 1], [0.5, 0.5], [1, 0.8], [1.25, 0.45], [1.5, 0.7]]) hit(r, ch.shime, t + b * B, 'shime', 0, v);
  bed(r, ch.bed, t, H, B, 0.006);
  hit(r, ch.kane, t, 'kane', 0); if (round) hit(r, ch.kane, t + B, 'kane', 0, 0.6);
  for (const [b, h] of [[0, H[0]], [1, H[1]]]) hit(r, ch.koto, t + b * B, 'koto', lowKoto(CH[h][0]), b ? 0.6 : 1);
  if (k === 15) hit(r, ch.suzu, t + B, 'suzu', 0); }

// ---------- 3 ふじの山：雅楽ふう。ハ長調・4拍子・83bpm・16小節。尺八（旋律）・笙の和音・お琴（句の頭に、さらりと上へ）。2回目は、お琴が旋律 ----------
const FJ_B = 0.72;
const FJ_MEL = [[[0, 67, 1.5], [1.5, 67, 0.5], [2, 69, 1], [3, 67, 1]], [[0, 64, 1], [1, 60, 0.5], [1.5, 62, 0.5], [2, 64, 1]], [[0, 62, 1.5], [1.5, 67, 0.5], [2, 67, 1], [3, 65, 0.5], [3.5, 64, 0.5]], [[0, 62, 3]],
  [[0, 67, 1.5], [1.5, 67, 0.5], [2, 64, 1], [3, 60, 1]], [[0, 69, 1.5], [1.5, 71, 0.5], [2, 72, 1], [3, 69, 1]], [[0, 67, 1.5], [1.5, 69, 0.5], [2, 67, 0.5], [2.5, 65, 0.5], [3, 64, 0.5], [3.5, 62, 0.5]], [[0, 60, 3]],
  [[0, 62, 1.5], [1.5, 62, 0.5], [2, 62, 1], [3, 62, 1]], [[0, 60, 0.5], [0.5, 62, 0.5], [1, 64, 0.5], [1.5, 65, 0.5], [2, 67, 1]], [[0, 69, 1.5], [1.5, 71, 0.5], [2, 72, 1], [3, 69, 1]], [[0, 67, 3]],
  [[0, 72, 2], [2, 69, 1], [3, 65, 1]], [[0, 64, 2], [2, 69, 1], [3, 67, 1]], [[0, 65, 1], [1, 64, 1], [2, 62, 1.5], [3.5, 60, 0.5]], [[0, 60, 3]]];
const FJ_HARM = [['C', 'C'], ['C', 'C'], ['G', 'G7'], ['G', 'G'], ['C', 'C'], ['Am', 'F'], ['C', 'G7'], ['C', 'C'], ['G', 'G'], ['C', 'C'], ['Am', 'F'], ['G', 'G'], ['C', 'F'], ['C', 'F'], ['F', 'G7'], ['C', 'C']];
const fujiSetup = (r, bus) => ({ shaku: chan(r, bus, 1.15, 3600, -0.05), breath: chan(r, bus, 0.03, 0, -0.05), sho: chan(r, bus, 0.55, 4200, 0.1), koto: chan(r, bus, 0.15, 0, 0.12), suzu: chan(r, bus, 0.04, 0, 0.2) });
function fujiBar(r, ch, k, t, n) { const B = FJ_B, round = Math.floor(n / 16) % 2, H = FJ_HARM[k], sv = round ? 0.012 : 0.009;
  for (const [off, m, len] of FJ_MEL[k]) { const tt = t + off * B + rnd(0, 0.008);
    if (!round) { voice(r, ch.shaku, tt, m, len * B * 0.93, 0.05, { w: 'shaku', a: 0.07, rel: 0.16, vib: 16, scoop: 50, sus: 0.82 }); hit(r, ch.breath, tt, 'breathL', 0); }
    else hit(r, ch.koto, tt, 'koto', m + 12); }
  if (H[0] === H[1]) sho(r, ch.sho, t, SHO[H[0]], 4 * B, sv); else { sho(r, ch.sho, t, SHO[H[0]], 2 * B, sv); sho(r, ch.sho, t + 2 * B, SHO[H[1]], 2 * B, sv); }
  const [root, tones] = CH[H[0]], low = lowKoto(root);
  if (k % 4 === 0) [low, low + 7, low + 12, ...tones.map((x) => x + 12)].forEach((m, i) => hit(r, ch.koto, t + i * 0.07, 'koto', m, 0.5)); else hit(r, ch.koto, t, 'koto', low, 0.8);
  if (k === 0 || k === 15) hit(r, ch.suzu, t, 'suzu', 0); }

// ---------- 4 冬の夜：ト長調・4拍子・91bpm・20小節。お琴の二重奏（旋律と、低い弦の分散和音）。2回目は尺八が歌う ----------
const FY_B = 0.66;
const FY_A = [[[0, 67, 1.5], [1.5, 71, 0.5], [2, 71, 1], [3, 69, 0.5], [3.5, 67, 0.5]], [[0, 62, 1.5], [1.5, 64, 0.5], [2, 62, 1], [3, 67, 1]], [[0, 71, 1.5], [1.5, 74, 0.5], [2, 74, 1], [3, 71, 0.5], [3.5, 67, 0.5]]];
const FY_B2 = [[[0, 62, 1.5], [1.5, 64, 0.5], [2, 62, 1], [3, 67, 0.5], [3.5, 69, 0.5]], [[0, 71, 1.5], [1.5, 71, 0.5], [2, 69, 1], [3, 67, 1]], [[0, 69, 1.5], [1.5, 74, 0.5], [2, 69, 1], [3, 69, 1]], [[0, 69, 1.5], [1.5, 71, 0.5], [2, 67, 1]]];
const FY_MEL = [...FY_A, [[0, 69, 1.5], [1.5, 71, 0.5], [2, 69, 1]], ...FY_B2, ...FY_A, [[0, 69, 1], [1, 69, 0.5], [1.5, 71, 0.5], [2, 69, 1]], ...FY_B2,
  [[0, 69, 1.5], [1.5, 71, 0.5], [2, 69, 0.5], [2.5, 67, 0.5], [3, 66, 0.5], [3.5, 64, 0.5]], [[0, 62, 0.5], [0.5, 64, 0.5], [1, 66, 0.5], [2, 69, 0.5], [2.5, 71, 0.5], [3, 69, 0.5]],
  [[0, 74, 1.5], [1.5, 71, 0.5], [2, 72, 0.5], [2.5, 71, 0.5], [3, 69, 0.5], [3.5, 67, 0.5]], [[0, 66, 0.5], [0.5, 67, 0.5], [1, 69, 0.5], [1.5, 71, 0.5], [2, 67, 1]]];
const FY_H8 = [['G', 'G'], ['G', 'G'], ['G', 'G'], ['D', 'D'], ['G', 'G'], ['G', 'D'], ['D', 'D'], ['D', 'G']];
const FY_HARM = [...FY_H8, ...FY_H8.slice(0, 3), ['D', 'D'], ...FY_H8.slice(4), ['D', 'D'], ['D', 'D'], ['G', 'C'], ['D', 'G']];
const fuyuSetup = (r, bus) => ({ bed: chan(r, bus, 0.5, 1800), koto: chan(r, bus, 0.13, 0, -0.1), koto2: chan(r, bus, 0.13, 0, 0.14), shaku: chan(r, bus, 1.1, 3600, -0.05), breath: chan(r, bus, 0.028, 0, -0.05), suzu: chan(r, bus, 0.035, 0, 0.2) });
function fuyuBar(r, ch, k, t, n) { const B = FY_B, round = Math.floor(n / 20) % 2, H = FY_HARM[k];
  for (const [off, m, len] of FY_MEL[k]) { const tt = t + off * B + rnd(0, 0.006);
    if (!round) hit(r, ch.koto, tt, 'koto', m);
    else { voice(r, ch.shaku, tt, m, len * B * 0.92, 0.048, { w: 'shaku', a: 0.07, rel: 0.15, vib: 14, scoop: 45, sus: 0.85 }); hit(r, ch.breath, tt, 'breathL', 0); } }
  // もう1面のお琴：低い弦から、4分でゆっくり（根・和音の音）
  for (const [b, h] of [[0, H[0]], [2, H[1]]]) { const [root, tones] = CH[h]; hit(r, ch.koto2, t + b * B, 'koto', lowKoto(root)); hit(r, ch.koto2, t + (b + 1) * B, 'koto', tones[1], 0.7); }
  bed(r, ch.bed, t, H, 2 * B, 0.011);
  if (k === 0) hit(r, ch.suzu, t, 'suzu', 0);
  if (k === 19) [67, 71, 74, 79, 83, 86].forEach((m, i) => hit(r, ch.koto, t + 2.5 * B + i * 0.07, 'koto', m, 0.5)); }

// beat＝1拍の秒・beats＝1小節の拍数・bars＝1周の小節数・wet＝残響・vol＝曲の音量（曲の間で、聞こえの大きさをそろえる。検査が平均の大きさを測る）
const TRACKS = {
  oshogatsu: { name: 'お正月', desc: 'お琴と、小さな鈴', beat: OS_B, beats: 4, bars: 12, wet: 0.14, vol: 0.54, setup: oshoSetup, play: oshoBar, mel: OS_MEL },
  yuki: { name: '雪（お囃子ふう）', desc: '篠笛と、締太鼓・鉦', beat: YK_B, beats: 2, bars: 16, wet: 0.12, vol: 0.45, setup: yukiSetup, play: yukiBar, mel: YK_MEL },
  fuji: { name: 'ふじの山', desc: '尺八と、笙の和音', beat: FJ_B, beats: 4, bars: 16, wet: 0.18, vol: 0.5, setup: fujiSetup, play: fujiBar, mel: FJ_MEL },
  fuyu: { name: '冬の夜', desc: 'お琴の二重奏', beat: FY_B, beats: 4, bars: 20, wet: 0.16, vol: 0.56, setup: fuyuSetup, play: fuyuBar, mel: FY_MEL },
};

// ---------- 予約 ----------
function player(r, id, t0) { const tr = TRACKS[id], c = r.c, bus = c.createGain(), send = c.createGain();
  if (r.bankFor !== id) { r.bank = {}; r.bankFor = id; }   // 作っておいた波形は、今の曲の分だけ持つ
  bus.gain.value = 0; bus.gain.setValueAtTime(0, c.currentTime); bus.gain.linearRampToValueAtTime(tr.vol, t0 + 0.3); send.gain.value = tr.wet; bus.connect(r.master); bus.connect(send); send.connect(r.revIn);
  return { tr, bus, ch: tr.setup(r, bus), bar: 0, next: t0, len: tr.beat * tr.beats }; }
function pumpTo(r, p, until) { const now = r.c.currentTime;
  // 見回りが遅れた時：間に合わない小節は鳴らさず、次の小節の頭から入る（遅れた分を一度に鳴らすと、音が団子になって割れる）
  if (p.next < now + 0.03) { const k = Math.ceil((now + 0.03 - p.next) / p.len); p.bar += k; p.next += k * p.len; }
  while (p.next < until && (p.limit == null || p.bar < p.limit)) { p.tr.play(r, p.ch, p.bar % p.tr.bars, p.next, p.bar); p.next += p.len; p.bar++; } }
// 0.15秒の時定数で消して、消えたら線を外す
function release(r, p) { const g = p.bus.gain, now = r.c.currentTime;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else { const v = g.value; g.cancelScheduledValues(now); g.setValueAtTime(v, now); }
  g.setTargetAtTime(0, now, 0.15); setTimeout(() => p.bus.disconnect(), 1500); }
// メドレー：1曲を最後の小節まで（短い曲は40秒ほどになるまで繰り返して）鳴らしたら、ほかの曲へ。前の曲の最後の小節の後に、ひと呼吸おいて入る
const loopsOf = (p) => Math.max(1, Math.round(40 / (p.tr.bars * p.len)));
function medleyNext() { if (!live || !medley) return; if (live.limit == null) live.limit = live.tr.bars * loopsOf(live); if (live.bar < live.limit) return;
  const ids = Object.keys(TRACKS).filter((k) => k !== cur), id = BGM.pick ? BGM.pick(ids) : ids[Math.floor(Math.random() * ids.length)], t0 = live.next + 0.15, old = live, g = old.bus.gain;
  g.setTargetAtTime(0, live.next + 0.1, 0.35);   // 前の曲の残りの音（お琴の余韻・和音の床）が消えきる前に、次の曲が入る setTimeout(() => old.bus.disconnect(), (t0 - ctx.currentTime + 2) * 1000);
  cur = id; live = player(rig, cur, t0); if (BGM.onChange) BGM.onChange(cur); }
function start() { if (!ctx || live) return; if (!rig) { rig = makeRig(ctx); rig.master.gain.value = 0.55 * vol; } live = player(rig, cur, ctx.currentTime + 0.12); pumpTo(rig, live, ctx.currentTime + LOOK);
  if (!timer) timer = setInterval(() => { if (!live) return; medleyNext(); pumpTo(rig, live, ctx.currentTime + LOOK); }, TICK); }
function stop() { if (timer) { clearInterval(timer); timer = null; } if (live) { release(rig, live); live = null; } }
export const BGM = {
  tracks: Object.keys(TRACKS).map((id) => ({ id, name: TRACKS[id].name, desc: TRACKS[id].desc })),
  // 旋律（楽譜と照合する検査のため）：曲ごとに 1小節の拍数と、小節ごとの [拍, 音の高さ, 長さ]
  scores: Object.fromEntries(Object.keys(TRACKS).map((id) => [id, { beats: TRACKS[id].beats, bars: TRACKS[id].mel }])),
  // ac＝効果音と同じ音の部屋（最初のタップで作られる）。on＝鳴らすか
  set(ac, on) { ctx = ac || ctx; wanted = !!on; if (on && ctx) { if (ctx.state !== 'running') ctx.resume(); start(); } else stop(); },
  get on() { return wanted; }, get track() { return cur; }, get playing() { return !!live; },
  get volume() { return vol; }, setVolume(v) { vol = Math.max(0, Math.min(1.5, v)); if (rig) rig.master.gain.setTargetAtTime(0.55 * vol, ctx.currentTime, 0.05); },
  // メドレー（オンにすると、曲が終わるたびに、ほかの曲へランダムに変わる）。onChange＝曲が変わった時に呼ぶ（メニューの表示を合わせる）
  get medley() { return medley; }, setMedley(on) { medley = !!on; if (live) live.limit = null; },
  pick: null,   // 検査だけが使う：メドレーの次の曲を決める（どの曲へのつなぎ目も確かめるため）。ふだんは null＝ランダム
  // 鳴っている時は、前の曲をすっと消しながら、次の曲を頭から始める
  setTrack(id) { if (!TRACKS[id] || id === cur) return; cur = id; if (live) { release(rig, live); live = player(rig, cur, ctx.currentTime + 0.15); pumpTo(rig, live, ctx.currentTime + LOOK); } },
  // 書き出し（検査用）：音の部屋 ac（OfflineAudioContext）に、曲 id を sec 秒ぶん。本番と同じく少しずつ予約する。返り値＝1周の長さ（秒）
  render(ac, id, sec) { const r = makeRig(ac), p = player(r, id, 0.1); pumpTo(r, p, LOOK);
    for (let k = 1; k * 0.25 < sec; k++) ac.suspend(k * 0.25).then(() => { pumpTo(r, p, k * 0.25 + LOOK); ac.resume(); });
    return p.tr.bars * p.len; },
};
