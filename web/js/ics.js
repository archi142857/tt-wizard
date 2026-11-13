// 시간표 → 캘린더 파일(.ics, RFC 5545) — 백엔드 update102(사용자 11/13 '다 구현해'). docs/calendar.md
// 학기 기간과 수업 없는 날은 웹 자료 data/calendar.json(data/calendar/terms.json). 화면은 만든 글을 파일로 내려받거나(웹)
// 앱 연결 TTW_APP.shareFile({ text, name, mime: "text/calendar" }) 로 공유 시트에 넘긴다. 기기 캘린더에 직접 쓰지 않는다(권한 없음).

const CRLF = "\r\n";
export const TZID = "Asia/Seoul";
export const MIME = "text/calendar";

/** 학기 기간: { start, end, skip: Set("YYYY-MM-DD"), names: Map(날짜 → 이름), makeup } 또는 null(그 학기 자료가 없다) */
export function termInfo(calendar, term) {
  const t = calendar && calendar.terms && calendar.terms[term];
  if (!t || !t.start || !t.end) return null;
  const names = new Map((t.no_class || []).map((d) => [d.date, d.name]));
  return { term, start: t.start, end: t.end, skip: new Set(names.keys()), names, makeup: t.makeup || null };
}

const day0 = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoDay = (dt) => dt.toISOString().slice(0, 10);
const compact = (s) => s.replace(/-/g, "");
const engineDay = (dt) => (dt.getUTCDay() + 6) % 7; // 엔진 요일: 0 = 월 … 6 = 일
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;

/** 글 칸 이스케이프(RFC 5545 3.3.11): 역슬래시·쉼표·쌍반점·줄 바꿈 */
export function escapeText(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** 한 줄 75 옥텟(UTF-8)으로 접기. 이어지는 줄은 공백 하나로 시작하고, 글자 가운데서 자르지 않는다 */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", len = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > limit) { out.push(cur); cur = ch; len = n; limit = 74; } else { cur += ch; len += n; }
  }
  out.push(cur);
  return out.join(CRLF + " ");
}

/** 화면의 강의실 이름과 같은 꼴(app.js roomLabel): 301동 118호, 강의실이 글이면 그대로, 강의실이 없으면 동만 */
export function placeOf(m) {
  if (!m || !m.building) return "";
  if (!m.room) return `${m.building}동`;
  return /^[A-Za-z]?\d/.test(m.room) ? `${m.building}동 ${m.room}호` : `${m.building}동 ${m.room}`;
}

/** 엔진 분반(parseCourses 의 section) → 일정 항목 */
export function itemsFromSections(sections) {
  return (sections || []).map((s) => ({
    key: s.key || `${s.courseId}-${s.no}`, title: s.name || s.courseId,
    detail: [s.courseId, s.no ? `${s.no}분반` : ""].filter(Boolean).join(" · "), meetings: s.meetings || [],
  }));
}

const utcStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * 일정 항목들 → .ics 글. items = [{ key, title, detail?, meetings: [{ day, start, end, building?, room?, place? }] }](itemsFromSections).
 * 수업마다 학기 첫날 뒤 첫 그 요일부터 종강일까지 매주 되풀이(RRULE WEEKLY, UNTIL 은 종강일 23:59:59 한국 시각),
 * 수업 없는 날은 EXDATE 로 뺀다. 보강 기간은 종강 뒤라 들어가지 않는다. 시간이 없는 수업은 넣지 않는다.
 * opts: { name(캘린더 이름), now(Date, 시험용), place(m) } → { text, events, skipped }
 */
export function buildIcs(items, info, { name = null, now = new Date(), place = placeOf } = {}) {
  if (!info) throw new Error("학기 기간 자료가 없다");
  const start = day0(info.start), end = day0(info.end);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TT Wizard//Timetable//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name || `TT Wizard ${info.term}`)}`, `X-WR-TIMEZONE:${TZID}`,
    "BEGIN:VTIMEZONE", `TZID:${TZID}`, "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900",
    "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE"];
  const stamp = utcStamp(now);
  const until = `${compact(isoDay(end))}T145959Z`; // 종강일 23:59:59 KST
  let events = 0, skipped = 0;
  for (const it of items || []) {
    for (const m of it.meetings || []) {
      if (!Number.isInteger(m.day) || !(m.end > m.start)) { skipped++; continue; }
      const first = new Date(start);
      while (engineDay(first) !== m.day) first.setUTCDate(first.getUTCDate() + 1);
      if (first > end) { skipped++; continue; }
      const ex = [];
      for (const dt = new Date(first); dt <= end; dt.setUTCDate(dt.getUTCDate() + 7)) {
        if (info.skip.has(isoDay(dt))) ex.push(`${compact(isoDay(dt))}T${hhmm(m.start)}`);
      }
      const where = m.place || place(m);
      lines.push("BEGIN:VEVENT",
        `UID:${escapeText(`${info.term}-${it.key}-${m.day}-${m.start}`)}@ttwizard.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${compact(isoDay(first))}T${hhmm(m.start)}`,
        `DTEND;TZID=${TZID}:${compact(isoDay(first))}T${hhmm(m.end)}`,
        `RRULE:FREQ=WEEKLY;UNTIL=${until}`);
      if (ex.length) lines.push(`EXDATE;TZID=${TZID}:${ex.join(",")}`);
      lines.push(`SUMMARY:${escapeText(it.title)}`);
      if (where) lines.push(`LOCATION:${escapeText(where)}`);
      if (it.detail) lines.push(`DESCRIPTION:${escapeText(it.detail)}`);
      lines.push("END:VEVENT");
      events++;
    }
  }
  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join(CRLF) + CRLF, events, skipped };
}

/** 내려받을 파일 이름: 'TT Wizard 2026-2 시간표 1.ics'(경로·제어 글자 뺌) */
export function icsFileName(term, title = "") {
  const base = `TT Wizard ${term}${title ? " " + title : ""}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80);
  return `${base}.ics`;
}
