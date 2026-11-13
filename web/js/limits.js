// 수강 제한 알림 — 폰 안에서만 계산한다(서버 없음). 백엔드 update105, 디자인 121·123판, 프론트엔드 ②.
// 자료: data/limits.json(scripts/course_limits.py 가 수강편람 비고에서 읽은 단계 규칙 + 수강신청 일정표, docs/limits.md).
// 들어가는 것: 분반 규칙 + 내 학과·학번(저장 꼴 {major: {id, entry}, others: [{kind, id, term}], year, grade}) + 학과 목록(catalog.json)
//              + 오늘(한국 시각) + 그 학기 일정표. 나오는 것: 태그 종류·태그 글·대상 글이나 비고 원문. 화면은 받은 글만 그린다.
// 원칙(법무 11/13): 읽어 낸 규칙이라 단정하지 않는다. 확실할 때만 태그(수강 제한·학번 제한·날짜), 모르는 조건이 하나라도 있으면
// 태그 없이 비고 원문. ® 만 있는 분반은 중립 '수강반 제한'. 막는 쪽은 분명할 때만(헷갈리면 태그를 달지 않는다).
// tests/test_limits.py 가 node 로 확인한다.

export const LABELS = { limit: "수강 제한", year: "학번 제한", mark: "수강반 제한" };
// 과목·항목 시트의 분반 목록 위 안내(디자인 123판, 법무 11/13)
export const NOTICE = "수강 제한이 있을 수 있어요. 신청 전에 수강신청 사이트에서 확인해 주세요.";
export const NOTICE_DATE = "수강 제한이 있을 수 있고 날짜는 바뀔 수 있어요. 신청 전에 수강신청 사이트에서 확인해 주세요.";
export const SCHEDULE_NOTE = "일정은 바뀔 수 있어요";

// ---------------------------------------------------------------- 날짜 (한국 시각)

/** 한국 시각의 오늘 "YYYY-MM-DD" */
export function kstToday(now = new Date()) {
  const t = new Date(now.getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

const md = (iso) => {
  const [, m, d] = String(iso).split("-").map(Number);
  return `${m}월 ${d}일`;
};

/** "2026-10-12T14:54+09:00" → "10월 12일 14:54" */
function mdhm(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[2])}월 ${Number(m[3])}일 ${m[4]}:${m[5]}` : null;
}

/** 시트 안내 둘째 줄: "수강편람 비고 · 10월 12일 14:54 기준"(자료 시각을 모르면 "수강편람 비고") */
export function sourceText(data) {
  const at = mdhm(data && data.read_at);
  return at ? `수강편람 비고 · ${at} 기준` : "수강편람 비고";
}

/** 자료 출처 '수강신청' 줄: "서울대학교 수강신청 사이트(8월 1일 기준)". 일정표가 없으면 null */
export function scheduleSourceText(data) {
  const s = data && data.schedule;
  if (!s || !s.collected) return null;
  return `${(data && data.schedule_source) || "서울대학교 수강신청 사이트"}(${md(s.collected)} 기준)`;
}

// ---------------------------------------------------------------- 학생

/**
 * 저장한 학과·학번 → 계산에 쓰는 꼴. 학과를 안 넣었으면 null(규칙이 있는 분반은 원문만 보인다).
 * id 는 학과 목록의 과정(p-…)이나 학과(부)(u-…, 전공을 아직 안 정함). others 의 kind "major" 는 자유전공학부의 주전공.
 */
export function studentFrom(profile, catalog) {
  if (!profile || !profile.major || !profile.major.id || !catalog) return null;
  const programs = catalog.programs || {};
  const entry = (id) => {
    if (!id) return null;
    if (programs[id]) return { unit: programs[id].unit, program: id };
    return String(id).startsWith("u-") ? { unit: id, program: null } : null;
  };
  const main = entry(profile.major.id);
  if (!main) return null;
  const others = (profile.others || []).map((o) => ({ kind: o.kind, ...entry(o.id) })).filter((o) => o.unit);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  return {
    main: [main, ...others.filter((o) => o.kind === "major")], // 주전공(자유전공학부의 주전공 포함)
    all: [main, ...others],
    grade: num(profile.grade),
    year: num(profile.year),
    programUnit: (pid) => (programs[pid] ? programs[pid].unit : null),
  };
}

/** 대상 하나({name, role, units|programs})에 드는가: true · false · null(모름: 전공을 아직 안 정했는데 그 학과의 전공으로 묶임) */
function inItem(item, student) {
  const pool = item.role === "main" ? student.main : student.all;
  if (item.units) return pool.some((e) => item.units.includes(e.unit));
  if (item.programs) {
    if (pool.some((e) => e.program && item.programs.includes(e.program))) return true;
    const units = item.programs.map(student.programUnit);
    if (pool.some((e) => !e.program && units.includes(e.unit))) return null;
    return false;
  }
  return null;
}

/** 규칙 하나 → "yes" · "who"(학과·단과대로 막힘) · "year"(학년·학번으로 막힘) · "unknown" */
export function check(allow, student) {
  if (allow == null) return "yes";
  let who = "yes";
  if (allow.who && allow.who.length) {
    const r = allow.who.map((w) => inItem(w, student));
    who = r.includes(true) ? "yes" : r.includes(null) ? "unknown" : "who";
  }
  if (who !== "who" && allow.except && allow.except.length) {
    const r = allow.except.map((w) => inItem(w, student));
    if (r.includes(true)) who = "who";
    else if (r.includes(null) && who === "yes") who = "unknown";
  }
  if (who === "who") return "who";
  let year = "yes";
  const g = student.grade, y = student.year;
  const need = (cond, value, ok) => {
    if (!cond) return;
    if (value == null) year = year === "year" ? "year" : "unknown";
    else if (!ok(value)) year = "year";
  };
  need(allow.grades, g, (v) => allow.grades.includes(v));
  need(allow.grade_min != null, g, (v) => v >= allow.grade_min);
  need(allow.years, y, (v) => allow.years.includes(v));
  need(allow.year_min != null, y, (v) => v >= allow.year_min);
  need(allow.year_max != null, y, (v) => v <= allow.year_max);
  if (year === "year") return "year"; // 학과는 몰라도 학년·학번으로는 분명히 막힘
  if (who === "unknown" || year === "unknown") return "unknown";
  return "yes"; // 초수강 조건은 처음 듣는 것으로 본다
}

// ---------------------------------------------------------------- 단계와 오늘

/** 규칙의 시간 칸: 본 수강신청 1~N일차 + 변경기간(일차 규칙), 날짜 구간들 + 변경기간(날짜 규칙), 늘(단계 없는 규칙) */
function slotsOf(rule, schedule) {
  const stages = rule.stages || [];
  const change = schedule && schedule.change ? { kind: "change", from: schedule.change[0], to: schedule.change[1] } : { kind: "change", from: null, to: null };
  if (stages.some((s) => s.dates)) {
    const seen = new Map();
    for (const s of stages) if (s.dates) seen.set(s.dates.join("~"), { kind: "dates", from: s.dates[0], to: s.dates[1] });
    return [...[...seen.values()].sort((a, b) => (a.from < b.from ? -1 : 1)), change];
  }
  if (stages.some((s) => s.days || s.change)) {
    const days = (schedule && schedule.days) || {};
    let n = Math.max(6, ...Object.keys(days).map(Number));
    for (const s of stages) if (s.days) n = Math.max(n, s.days[0], s.days[1] || 0);
    const out = [];
    for (let i = 1; i <= n; i++) out.push({ kind: "day", n: i, from: days[i] || null, to: days[i] || null });
    return [...out, change];
  }
  return [{ kind: "always", from: null, to: null }];
}

/** 그 칸에 걸리는 단계. 여럿이면 가장 늦게 시작한 단계('5일차부터'와 '6일차부터' 가 겹치면 6일차부터), 없으면 밑 규칙, 그것도 없으면 null(제한 없음) */
function stageAt(rule, slot) {
  let best = null, bestKey = -Infinity;
  for (const s of rule.stages || []) {
    if (s.rest) continue;
    let key = null;
    if (!s.days && !s.change && !s.dates) key = -1; // 늘
    else if (slot.kind === "day" && s.days && s.days[0] <= slot.n && slot.n <= (s.days[1] ?? Infinity)) key = s.days[0];
    else if (slot.kind === "change" && s.change) key = 1000;
    else if (slot.kind === "change" && s.through_change && s.days) key = s.days[0];
    else if (slot.kind === "dates" && s.dates && s.dates[0] === slot.from && s.dates[1] === slot.to) key = 0;
    if (key !== null && key > bestKey) [best, bestKey] = [s, key];
  }
  return best || (rule.stages || []).find((s) => s.rest) || null;
}

/**
 * 오늘의 칸: 이미 시작한 칸 가운데 마지막(일차 사이 주말·본 수강신청과 변경기간 사이에는 앞 칸이 이어진다. 그래서 날짜 태그는
 * 열리는 날 전날까지 보인다). 시작한 칸이 없거나 일정을 모르면 첫 칸(수강신청 전). 변경기간이 끝난 뒤는 마지막 칸
 */
function currentSlot(slots, today) {
  let cur = 0;
  if (!today) return cur;
  slots.forEach((s, i) => { if (s.from && s.from <= today) cur = i; });
  return cur;
}

/** 열리는 칸의 태그 글: '8월 10일부터'(일정표의 날짜) · '5일차부터'·'변경기간부터'(일정표가 없을 때) */
function opensText(slot) {
  if (slot.from) return `${md(slot.from)}부터`;
  if (slot.kind === "day") return `${slot.n}일차부터`;
  if (slot.kind === "change") return "변경기간부터";
  return null;
}

// ---------------------------------------------------------------- 분반·과목 태그

/** 분반 규칙 찾기: data.sections["<교과목번호>-<강좌번호>"] → data.rules[i]. 다른 학기 자료면 null */
export function limitOf(data, courseId, sectionNo, term = null) {
  if (!data || !data.sections || (term && data.term && data.term !== term)) return null;
  const i = data.sections[`${courseId}-${sectionNo}`];
  return i == null ? null : data.rules[i] || null;
}

/**
 * 분반 하나의 태그.
 * → { tag: "limit"|"year"|"date"|"mark"|null, label, text, note, opens }
 *   label: 태그 글('수강 제한'·'학번 제한'·'8월 10일부터'·'5일차부터'·'변경기간부터'·'수강반 제한')
 *   text: 태그 옆 대상 글('4일차까지 1학년만', '물리·천문학부만'). 태그가 수강반 제한이거나 없으면 null
 *   note: 태그 없이 분반 행에 보일 비고 원문(앞의 ® 를 뺀 것, 개인 메일은 가림). 보일 것이 없으면 null
 *   opens: 날짜 태그일 때 열리는 날("2026-08-10") 또는 일차 차례(과목 묶기에 씀)
 */
export function sectionTag(rule, student, { today = null, schedule = null } = {}) {
  const none = { tag: null, label: null, text: null, note: null, opens: null };
  if (!rule) return none;
  if (rule.kind === "mark") return { ...none, tag: "mark", label: LABELS.mark };
  if (rule.kind !== "rule" || !student) return { ...none, note: rule.note || null };
  const slots = slotsOf(rule, schedule);
  const c = currentSlot(slots, today);
  const states = slots.map((slot) => {
    const st = stageAt(rule, slot);
    return { slot, stage: st, state: st ? check(st.allow, student) : "yes" };
  });
  const now = states[c];
  if (now.state === "yes") return none;
  if (now.state === "unknown") return { ...none, note: rule.note || null };
  const text = now.stage.until || now.stage.text;
  for (let k = c + 1; k < states.length; k++) {
    if (states[k].state === "unknown") return { ...none, note: rule.note || null };
    if (states[k].state === "yes") {
      const label = opensText(states[k].slot);
      if (!label) return { ...none, note: rule.note || null };
      return { ...none, tag: "date", label, text, opens: states[k].slot.from || `#${String(k).padStart(3, "0")}` };
    }
  }
  const rest = states.slice(c).map((s) => s.stage && s.stage.text);
  const same = rest.every((t) => t === rest[0]);
  const tag = now.state === "year" ? "year" : "limit";
  return { ...none, tag, label: LABELS[tag], text: same ? now.stage.text : text };
}

/**
 * 과목 행의 태그: 모든 분반이 막히면 수강 제한(모두 학번 때문이면 학번 제한), 모두 막혔거나 뒤에 열리면 가장 이른 날.
 * 하나라도 지금 열려 있거나 모르는 분반(원문·수강반 제한)이 있으면 null. results 는 그 과목 모든 분반의 sectionTag 답
 */
export function courseTag(results) {
  if (!results || !results.length) return null;
  if (results.some((r) => !r || !["limit", "year", "date"].includes(r.tag))) return null;
  const dates = results.filter((r) => r.tag === "date");
  if (!dates.length) {
    const tag = results.every((r) => r.tag === "year") ? "year" : "limit";
    return { tag, label: LABELS[tag] };
  }
  const first = dates.reduce((a, b) => (String(b.opens) < String(a.opens) ? b : a));
  return { tag: "date", label: first.label };
}

/** 그 시트에 날짜 태그가 하나라도 있으면 NOTICE_DATE, 아니면 NOTICE */
export const noticeFor = (results) => ((results || []).some((r) => r && r.tag === "date") ? NOTICE_DATE : NOTICE);
