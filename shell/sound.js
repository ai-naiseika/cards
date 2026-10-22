// 音：合成だけ（音のファイルなし）。最初に画面にふれてから鳴らす。BGM は無し（最初は切の方針。試作では作らない）
// 触った時の音は素材の音（表現の体系 3.3）。意味の音（おみくじの紙）は、どの表現でも同じ
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
function tone(f0, f1, vol, delay, dur, type = 'sine') {
  const a = ctx(); if (!a || !on) return;
  try {
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* 同上 */ }
}
function noise(vol, delay, dur, freq, q) {
  const a = ctx(); if (!a || !on) return;
  try {
    const n = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + delay;
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(out); s.start(t);
  } catch (e) { /* 同上 */ }
}
const SND = {
  tap() { tone(1400, 1100, 0.03, 0, 0.06); },
  poyon() { tone(520, 300, 0.12, 0, 0.32); tone(260, 180, 0.05, 0.03, 0.4, 'triangle'); },   // ゆるかわ：ぽよん
  pop() { tone(300, 900, 0.1, 0, 0.18); tone(900, 620, 0.07, 0.12, 0.3); },
  land() { tone(220, 120, 0.12, 0, 0.22, 'triangle'); },
  paper() { noise(0.18, 0, 0.12, 2400, 0.8); noise(0.12, 0.1, 0.1, 3200, 0.9); },
  // 触った時の素材の音（表現ごと）
  kasa() { noise(0.16, 0, 0.09, 3000, 1.2); },                                   // 紙
  pon() { tone(380, 300, 0.12, 0, 0.12, 'triangle'); noise(0.08, 0, 0.04, 900, 1); },  // はんこを押す
  pico() { tone(1320, 1320, 0.05, 0, 0.06, 'square'); tone(1760, 1760, 0.05, 0.06, 0.07, 'square'); },   // 8bit
  sa() { noise(0.12, 0, 0.18, 1800, 0.6); },                                      // 筆
  fuwa() { noise(0.1, 0, 0.22, 700, 0.5); tone(300, 260, 0.03, 0, 0.25); },     // フェルト
  posu() { noise(0.18, 0, 0.07, 500, 0.9); tone(150, 110, 0.08, 0, 0.12, 'triangle'); },   // 段ボール
  kotsu() { tone(1600, 1500, 0.07, 0, 0.08, 'triangle'); tone(800, 760, 0.05, 0, 0.1); },  // 漆
  chin() { tone(2637, 2637, 0.06, 0, 0.7); tone(3951, 3951, 0.025, 0.01, 0.5); },          // ガラス
  kasha() { noise(0.14, 0, 0.06, 4200, 1.5); noise(0.1, 0.05, 0.06, 5200, 1.5); },        // セロハン
  // 図柄の意味の音（どの表現でも同じ）
  suzu() { [2093, 2637, 3136, 2349, 2794].forEach((f, i) => tone(f, f * 0.995, 0.045, i * 0.045, 0.7)); noise(0.05, 0, 0.12, 6000, 2); },   // 鈴：からん
  taiko() { tone(110, 60, 0.22, 0, 0.35, 'sine'); noise(0.12, 0, 0.06, 300, 0.8); },                                                  // 太鼓：どん
  fue() { tone(1568, 1760, 0.05, 0, 0.35, 'triangle'); tone(1760, 1568, 0.04, 0.32, 0.3, 'triangle'); },                              // 笛：ぴー
  kaze() { noise(0.1, 0, 0.6, 900, 0.4); noise(0.06, 0.15, 0.5, 1600, 0.5); },                                                       // 風：ひゅう
  puru() { tone(340, 240, 0.1, 0, 0.12, 'triangle'); tone(300, 220, 0.08, 0.1, 0.12, 'triangle'); tone(260, 200, 0.06, 0.2, 0.14, 'triangle'); },   // 餅：ぷるん
  chime() { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, f, 0.05, i * 0.09, 0.9)); },
};
export function play(name) { if (Object.prototype.hasOwnProperty.call(SND, name)) SND[name](); }
