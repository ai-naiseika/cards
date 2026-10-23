// 音：合成だけ（音のファイルなし）。最初に画面にふれてから鳴らす。BGM は無し（最初は切の方針。試作では作らない）
// 本人 2026-10-23「タップしたときの音は、作品に合わせたふさわしい音に」。触った時の音は、その作品の画材の道具の音と、図柄の世界の音（作品ごとに選ぶ。表は できた作品/音の割り当て.md）
// 波・風・人のざわめきのような環境音は、合成だと「激しすぎる」（本人の基準）。録音の素材が決まるまでは、ごく小さな仮の音にしておく（nami・kaze・zawa）
// 音の大きさ：どの音も、いちばん大きい所（ピーク）がそろうように GAIN で合わせる（検査が OfflineAudioContext で測る）
let ac = null, out = null, on = true;
function ctx() { return ac && ac.state === 'running' ? ac : null; }
export function unlock() {
  try {
    if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; ac = new A(); out = ac.createGain(); out.gain.value = 0.8; out.connect(ac.destination); }
    if (ac.state !== 'running') ac.resume();
  } catch (e) { /* 音が出なくても使える */ }
}
export function setOn(v) { on = !!v; }
export const isOn = () => on;

// 音の部品。a＝音の場、dest＝出口、t0＝鳴らしはじめ、p＝高さの倍率（作品ごとの違い）、k＝大きさの倍率（GAIN）
function kit(a, dest, t0, p, k) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);   // 雑音も毎回同じ形（大きさを測れるように）
  const env = (g, t, vol, att, dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(vol * k, 0.0002), t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
  return {
    tone(f0, f1, vol, delay, dur, type = 'sine', att = 0.008) {
      const t = t0 + delay, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0 * p, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * p, t + dur * 0.7);
      env(g, t, vol, att, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(vol, delay, dur, freq, q, att = 0.004, freq1 = freq, type = 'bandpass') {
      const t = t0 + delay, n = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = buf; f.type = type; f.frequency.setValueAtTime(freq * p, t); if (freq1 !== freq) f.frequency.exponentialRampToValueAtTime(freq1 * p, t + dur); f.Q.value = q;
      env(g, t, vol, att, dur); s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + dur + 0.02);
    },
  };
}

const SND = {
  // ---------- 画面の操作・おみくじ（どの作品でも同じ） ----------
  tap(S) { S.tone(1400, 1100, 0.03, 0, 0.06); },
  paper(S) { S.noise(0.18, 0, 0.12, 2400, 0.8); S.noise(0.12, 0.1, 0.1, 3200, 0.9); },
  chime(S) { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => S.tone(f, f, 0.05, i * 0.09, 0.9)); },
  // ---------- 木版画：版木を置く・バレンでこする・拍子木 ----------
  hangi(S) { S.tone(240, 200, 0.16, 0, 0.12, 'triangle'); S.noise(0.12, 0, 0.03, 1800, 1.4); },
  baren(S) { S.noise(0.1, 0, 0.32, 500, 0.7, 0.05, 900); S.noise(0.08, 0.3, 0.3, 700, 0.7, 0.05, 1100); },
  hyoshigi(S) { for (const d of [0, 0.22]) { S.tone(1250, 1200, 0.12, d, 0.09, 'triangle'); S.noise(0.1, d, 0.03, 2500, 2); } },
  // ---------- 消しゴムはんこ：ぽんと押す・朱肉 ----------
  pon(S) { S.tone(380, 300, 0.12, 0, 0.12, 'triangle'); S.noise(0.08, 0, 0.04, 900, 1); },
  inniku(S) { for (const d of [0, 0.11]) { S.tone(200, 160, 0.08, d, 0.08, 'triangle'); S.noise(0.05, d, 0.03, 700, 1); } },
  // ---------- 切り絵：はさみ・のりで貼る ----------
  hasami(S) { for (const d of [0, 0.16]) { S.noise(0.14, d, 0.035, 5200, 3); S.tone(3100, 2900, 0.03, d, 0.05, 'triangle'); } },
  nori(S) { S.noise(0.1, 0, 0.08, 1300, 0.8); S.tone(260, 220, 0.04, 0, 0.1, 'triangle'); },
  // ---------- ゆるかわ：ぽよん・ぴょん ----------
  poyon(S) { S.tone(520, 300, 0.12, 0, 0.32); S.tone(260, 180, 0.05, 0.03, 0.4, 'triangle'); },
  pyon(S) { S.tone(320, 900, 0.1, 0, 0.18, 'triangle'); S.tone(900, 700, 0.05, 0.15, 0.2); },
  pop(S) { S.tone(300, 900, 0.1, 0, 0.18); S.tone(900, 620, 0.07, 0.12, 0.3); },
  // ---------- ドット絵：8bit ----------
  pico(S) { S.tone(1320, 1320, 0.05, 0, 0.06, 'square'); S.tone(1760, 1760, 0.05, 0.06, 0.07, 'square'); },
  coin8(S) { S.tone(988, 988, 0.05, 0, 0.07, 'square'); S.tone(1319, 1319, 0.05, 0.07, 0.25, 'square'); },
  jump8(S) { S.tone(440, 1320, 0.05, 0, 0.16, 'square'); },
  hit8(S) { S.tone(180, 90, 0.07, 0, 0.12, 'square'); S.noise(0.08, 0, 0.08, 1200, 0.6); },
  fanfare8(S) { [523, 659, 784, 1047].forEach((f, i) => S.tone(f, f, 0.05, i * 0.08, i === 3 ? 0.35 : 0.08, 'square')); },
  // ---------- 筆ペン：紙の上を線が走る ----------
  pen(S) { S.noise(0.1, 0, 0.12, 3600, 1.2, 0.01); S.noise(0.08, 0.11, 0.16, 3000, 1.2, 0.01); },
  kyu(S) { S.noise(0.1, 0, 0.22, 2600, 2, 0.02, 4200); },
  // ---------- 水墨画：筆が紙をすべる・墨のにじみ ----------
  sa(S) { S.noise(0.12, 0, 0.18, 1800, 0.6); },
  nijimi(S) { S.noise(0.1, 0, 0.6, 420, 0.6, 0.18, 300, 'lowpass'); },
  // ---------- 淡彩：水 ----------
  mizu(S) { S.tone(1300, 520, 0.09, 0, 0.12); S.tone(1700, 760, 0.05, 0.13, 0.1); },
  fuwa(S) { S.noise(0.1, 0, 0.22, 700, 0.5); S.tone(300, 260, 0.03, 0, 0.25); },
  // ---------- フェルト：針を刺す・糸を引く ----------
  hari(S) { S.noise(0.08, 0, 0.02, 4800, 3); S.noise(0.08, 0.05, 0.3, 1400, 1.2, 0.04, 2600); },
  ito(S) { S.noise(0.08, 0, 0.36, 1100, 1.4, 0.06, 2400); S.tone(220, 260, 0.02, 0, 0.3, 'triangle'); },
  // ---------- 段ボール：紙の箱のこもった音 ----------
  posu(S) { S.noise(0.18, 0, 0.07, 500, 0.9); S.tone(150, 110, 0.08, 0, 0.12, 'triangle'); },
  hako(S) { S.tone(120, 80, 0.14, 0, 0.18, 'triangle'); S.noise(0.12, 0, 0.09, 320, 0.8); },
  // ---------- 蒔絵：漆の箱・ふた・金の粉 ----------
  kotsu(S) { S.tone(1600, 1500, 0.07, 0, 0.08, 'triangle'); S.tone(800, 760, 0.05, 0, 0.1); },
  futa(S) { S.noise(0.08, 0, 0.32, 900, 0.9, 0.05, 700); S.tone(620, 600, 0.05, 0.28, 0.14, 'triangle'); },
  kinpun(S) { [3520, 4186, 3951, 4699, 3729, 5274].forEach((f, i) => S.tone(f, f, 0.03, i * 0.06, 0.35)); },
  // ---------- ステンドグラス：ガラスの澄んだ音 ----------
  chin(S) { S.tone(2637, 2637, 0.06, 0, 0.7); S.tone(3951, 3951, 0.025, 0.01, 0.5); },
  garasu(S) { [2093, 2637, 3136].forEach((f, i) => S.tone(f, f, 0.05, i * 0.07, 0.8)); },
  // ---------- セロハン：かさかさ・光 ----------
  kasha(S) { S.noise(0.14, 0, 0.06, 4200, 1.5); S.noise(0.1, 0.05, 0.06, 5200, 1.5); },
  hikari(S) { S.tone(880, 1760, 0.04, 0, 0.5); S.tone(1320, 2640, 0.03, 0.08, 0.5); },
  // ---------- 紙 ----------
  kasa(S) { S.noise(0.16, 0, 0.09, 3000, 1.2); },
  land(S) { S.tone(220, 120, 0.12, 0, 0.22, 'triangle'); },
  // ---------- 札が出る時（画材ごと。話のいちばん盛り上がる所） ----------
  ponpon(S) { S.tone(380, 300, 0.1, 0, 0.1, 'triangle'); S.tone(520, 420, 0.1, 0.16, 0.12, 'triangle'); S.noise(0.06, 0.16, 0.04, 1100, 1); S.tone(1046, 1046, 0.03, 0.3, 0.5); },   // はんこ：ぽん・ぽん
  chokin(S) { S.noise(0.14, 0, 0.04, 5600, 3); S.tone(3300, 3000, 0.03, 0, 0.06, 'triangle'); S.noise(0.08, 0.1, 0.25, 2600, 0.8, 0.05, 1800); },   // 切り絵：ちょきん・ひらり
  kirarin(S) { [1318.5, 1568, 2093, 2637].forEach((f, i) => S.tone(f, f, 0.04, i * 0.07, 0.5)); },   // ゆるかわ：きらりん
  shizuku(S) { [[1400, 600, 0], [1700, 760, 0.14], [1200, 520, 0.3]].forEach(([a, b, d]) => S.tone(a, b, 0.07, d, 0.12)); },   // 淡彩：しずく
  hakoake(S) { S.tone(140, 90, 0.1, 0, 0.16, 'triangle'); S.noise(0.08, 0, 0.08, 400, 0.8); S.noise(0.08, 0.16, 0.1, 2600, 1.2); },   // 段ボール：ふたを開ける
  // ---------- 図柄の世界の音 ----------
  suzu(S) { [2093, 2637, 3136, 2349, 2794].forEach((f, i) => S.tone(f, f * 0.995, 0.045, i * 0.045, 0.7)); S.noise(0.05, 0, 0.12, 6000, 2); },   // 鈴：からん
  taiko(S) { S.tone(110, 60, 0.22, 0, 0.35, 'sine'); S.noise(0.12, 0, 0.06, 300, 0.8); },   // 太鼓：どん
  fue(S) { S.tone(1568, 1760, 0.05, 0, 0.35, 'triangle'); S.tone(1760, 1568, 0.04, 0.32, 0.3, 'triangle'); },   // 笛：ぴー
  kachi(S) { S.tone(900, 700, 0.1, 0, 0.06, 'triangle'); S.noise(0.1, 0, 0.03, 2200, 1.5); },   // 獅子の歯：かちっ
  puru(S) { S.tone(340, 240, 0.1, 0, 0.12, 'triangle'); S.tone(300, 220, 0.08, 0.1, 0.12, 'triangle'); S.tone(260, 200, 0.06, 0.2, 0.14, 'triangle'); },   // 餅：ぷるん
  kashiwade(S) { for (const d of [0, 0.2]) S.noise(0.16, d, 0.05, 1300, 0.7); },   // 柏手：ぱん・ぱん
  // 環境音（仮）：録音の素材が決まるまで、ごく小さく
  kaze(S) { S.noise(0.025, 0, 0.6, 700, 0.4, 0.2, 900); },
  nami(S) { S.noise(0.025, 0, 0.8, 500, 0.4, 0.3, 380, 'lowpass'); },
  zawa(S) { S.noise(0.02, 0, 0.6, 1100, 0.5, 0.2); },
};
// いちばん大きい所をそろえる倍率（検査 S が測って、ずれていれば止める。値は 試作/tests の測定で決めた）
export const GAIN = { paper: 0.81, chime: 1.1, hangi: 0.63, baren: 3.17, hyoshigi: 0.87, pon: 0.83, inniku: 1.48, hasami: 1.6, nori: 1.67, poyon: 0.84, pyon: 1.06, pop: 1.01, pico: 2.03, coin8: 2.05, jump8: 2.12, hit8: 1.2, fanfare8: 2.04, pen: 1.69, kyu: 1.74, sa: 1.1, nijimi: 3.92, mizu: 1.13, fuwa: 1.41, hari: 2.74, ito: 3.29, posu: 1.06, hako: 0.83, kotsu: 0.97, futa: 2.09, kinpun: 2.25, chin: 1.28, garasu: 1.12, kasha: 1.29, hikari: 2.27, kasa: 1.14, land: 0.87, suzu: 1.01, taiko: 0.47, fue: 2.09, kachi: 1.12, puru: 1.1, kashiwade: 1.05, kaze: 1.18, nami: 2.61, zawa: 1.38, ponpon: 1.04, chokin: 1.44, kirarin: 1.61, shizuku: 1.44, hakoake: 1.07 };
export const NAMES = Object.keys(SND);
export const AMBIENT = ['kaze', 'nami', 'zawa'];   // 環境音（仮の小さな音。ピークをそろえる対象から外す）
const clampP = (p) => (Number.isFinite(p) ? Math.min(2, Math.max(0.5, p)) : 1);
// 音を組み立てる（鳴らす時も、検査で測る時も同じ）。a＝AudioContext か OfflineAudioContext
export function render(a, dest, name, p, t0) { SND[name](kit(a, dest, t0, clampP(p), GAIN[name] || 1)); }
// 鳴らす。検査は window.__sndLog に [名前, 鳴ったか] を残してもらう
export function play(name, p) {
  const has = Object.prototype.hasOwnProperty.call(SND, name), a = ctx(), ok = has && !!a && on;
  if (Array.isArray(window.__sndLog)) window.__sndLog.push([name, ok]);
  if (!ok) return;
  try { render(a, out, name, p, a.currentTime); } catch (e) { /* 音が出なくても使える */ }
}
