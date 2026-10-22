// 送る予定をスマホのカレンダーに入れるファイル（.ics・RFC 5545）。予定の時刻ちょうどに知らせる（VALARM）。
// 予定に入るのは：題（束の名前と人数）・時刻・束のリンク（URL 欄とメモ欄）。相手の名前は、リンクの # の中にしか入らない。
const p2 = (n) => String(n).padStart(2, '0');
const stampOf = (d) => d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
const localOf = (d) => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + 'T' + p2(d.getHours()) + p2(d.getMinutes()) + '00';
// 文字の値の書き方（バックスラッシュ・セミコロン・カンマ・改行）
export const escText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// 1行は75バイトまで。続きは「改行＋空白1つ」で次の行へ。日本語の1字の途中では切らない
export function fold(lineText) {
  const enc = new TextEncoder(), out = [];
  let cur = '', len = 0, max = 75;
  for (const ch of lineText) {
    const n = enc.encode(ch).length;
    if (len + n > max) { out.push(cur); cur = ''; len = 0; max = 74; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
// at は 'YYYY-MM-DDTHH:MM'（bundle.js が検査済み）。時刻はタイムゾーンを書かない（端末の時刻のまま。殻の icsText と同じ）
export function icsFor({ at, title, url, note }) {
  if (!/^https?:\/\/[A-Za-z0-9._~:/#=%-]+$/.test(url)) throw new Error('リンクの形がちがう');
  const [y, mo, d] = at.slice(0, 10).split('-').map(Number), [h, mi] = at.slice(11).split(':').map(Number);
  const start = new Date(y, mo - 1, d, h, mi), end = new Date(y, mo - 1, d, h, mi + 15), now = new Date();
  const uid = stampOf(now) + '-' + Math.floor(Math.random() * 1e9).toString(36) + '@ai-naiseika-cards';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ai-naiseika//cards-yotei//JA', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    'UID:' + uid, 'DTSTAMP:' + stampOf(now), 'DTSTART:' + localOf(start), 'DTEND:' + localOf(end),
    'SUMMARY:' + escText(title), 'DESCRIPTION:' + escText(note + '\n' + url), 'URL:' + url,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escText(title), 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
