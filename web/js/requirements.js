// 졸업 요건 미리 보기 · 성적 계산 · 학기 학점 상한 — 폰 안에서만 계산한다(서버 없음).
// 자료 꼴은 docs/requirements.md (web/data/requirements/: index.json, common.json, course_map.json, programs/<id>.json).
// 원칙: 확인된 줄만 '충족/남음'으로 단정하고, 나머지는 '확인 필요'와 까닭을 낸다. 학교 졸업 사정을 대신하지 않는다.
// tests/test_requirements.py 가 node 로 확인한다.

export const ROLES = ["single", "parallel", "double", "minor"]; // 단일 · 다른 전공과 병행 · 복수전공 · 부전공
export const GRADE_POINTS = {
  "A+": 4.3, "A0": 4.0, "A-": 3.7, "B+": 3.3, "B0": 3.0, "B-": 2.7,
  "C+": 2.3, "C0": 2.0, "C-": 1.7, "D+": 1.3, "D0": 1.0, "D-": 0.7, "F": 0.0,
};
const NO_CREDIT = new Set(["F", "U"]);
const MAJOR_CLS = new Set(["전필", "전선"]);
const OUTSIDE = new Set(["exchange", "domestic", "transfer"]); // 다른 학교에서 얻은 학점(평점에 넣지 않음)

// ---------------------------------------------------------------- 학기·판

/** "2025-1" < "2025-S"(여름) < "2025-2" < "2025-W"(겨울) < "2026-1" 차례의 수 */
export function termOrder(term) {
  const m = /^(\d{4})-(1|S|2|W)$/.exec(String(term || ""));
  if (!m) return -1;
  return Number(m[1]) * 4 + { 1: 0, S: 1, 2: 2, W: 3 }[m[2]];
}

export const isRegularTerm = (term) => /-(1|2)$/.test(String(term || ""));

/** 입학 연도에 맞는 판. 없으면 { version: null, reason } */
export function pickVersion(program, entryYear) {
  const y = Number(entryYear);
  const [lo, hi] = program.exists_for || [2019, 2026];
  if (!Number.isFinite(y) || y < lo || y > hi) return { version: null, reason: "no_data" };
  const v = (program.versions || []).find((x) => x.entry_years[0] <= y && y <= x.entry_years[1]);
  return v ? { version: v, reason: null } : { version: null, reason: "no_data" };
}

// ---------------------------------------------------------------- 같은 과목

/** 같은 과목으로 볼 번호 묶음: 학교 교양 대응표(2024 → 2025 → 2026)와 요건의 alt_codes. 번호 → 대표 번호 */
export function buildSameCourse(courseMap, programs = []) {
  const parent = new Map();
  const find = (a) => {
    while (parent.has(a) && parent.get(a) !== a) a = parent.get(a);
    return a;
  };
  const join = (a, b) => {
    if (!a || !b) return;
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const row of (courseMap && courseMap.rows) || []) {
    const codes = ["2024", "2025", "2026"].map((y) => row[y] && row[y].code).filter(Boolean);
    for (let i = 1; i < codes.length; i++) join(codes[0], codes[i]);
  }
  for (const p of programs) {
    for (const v of p.versions || []) {
      for (const r of v.requirements || []) {
        for (const c of r.courses || []) for (const a of c.alt_codes || []) join(c.code, a);
      }
    }
  }
  return (code) => (parent.has(code) ? find(code) : code);
}

// ---------------------------------------------------------------- 들은 과목 정리

/**
 * 사용자가 확인한 기록 → 셀 과목.
 * 기록: { code, name, credits, cls, dept, term, status, grade?, source?, toBachelor? }
 *   status: "taken"(들음) | "failed"(학점 못 받음: F·U) | "dropped"(안 들음: W·드랍) | "retake"(재수강한 수강)
 *   grade: "A+"…"F" | "S" | "U" (성적 계산기에서만, 없어도 된다)
 *   source: "snu"(기본) | "exchange" | "domestic" | "transfer", toBachelor: 대학원 과목을 학사 졸업학점에 넣을지
 * 결과: courses(셀 것, earned 학점 포함) · replaced(재수강으로 빠진 옛 수강) · duplicates(재수강 표시 없이 두 번) · dropped
 */
export function tidyRecords(records, sameCourse = (c) => c) {
  const dropped = [], groups = new Map();
  for (const r0 of records || []) {
    const r = { ...r0, key: sameCourse(r0.code) };
    if (r.status === "dropped" || r.grade === "W") { dropped.push(r); continue; }
    if (isGraduate(r) && !r.toBachelor) { dropped.push({ ...r, why: "graduate_not_counted" }); continue; }
    if (!groups.has(r.key)) groups.set(r.key, []);
    groups.get(r.key).push(r);
  }
  const courses = [], replaced = [], duplicates = [];
  for (const list of groups.values()) {
    list.sort((a, b) => termOrder(a.term) - termOrder(b.term));
    const last = list[list.length - 1];
    const earlier = list.slice(0, -1);
    if (earlier.length) {
      if (list.some((x) => x.status === "retake")) replaced.push(...earlier);
      else duplicates.push(list.map((x) => x.code));
    }
    const failed = last.status === "failed" || NO_CREDIT.has(last.grade);
    courses.push({ ...last, earned: failed ? 0 : Number(last.credits) || 0, failed });
  }
  return { courses, replaced, duplicates, dropped };
}

/** 대학원 과목(편람 이수과정이 학사가 아닌 것). 학사 졸업학점에 넣을지는 학생이 고른다(toBachelor) */
export const isGraduate = (r) => Boolean(r.level) && r.level !== "학사";

// ---------------------------------------------------------------- 묶음

/** 전공 요건 줄(교양 줄 빼고)에 적힌 과목 번호 */
function requirementCodes(version) {
  const s = new Set();
  for (const r of (version && version.requirements) || []) {
    if (r.type === "ge") continue;
    for (const c of r.courses || []) {
      s.add(c.code);
      for (const a of c.alt_codes || []) s.add(a);
    }
  }
  return s;
}

/** 이 과목이 이 과정의 전공 과목인가: 교양이 아니고, 전공 요건 목록에 있거나 개설 학과가 같고 교과구분이 전필·전선(번호 앞자리가 정해진 과정은 그것까지) */
export function isMajorCourse(course, program, version, sameCourse = (c) => c) {
  if (course.cls === "교양") return false;
  const key = course.key || sameCourse(course.code);
  const codes = requirementCodes(version);
  if (codes.has(course.code) || [...codes].some((c) => sameCourse(c) === key)) return true;
  if (!MAJOR_CLS.has(course.cls)) return false;
  if (!(program.depts || []).includes(course.dept)) return false;
  const pre = program.code_prefixes || [];
  return pre.length === 0 || pre.some((p) => String(course.code).startsWith(p));
}

/**
 * 학점 합: 교양 · 전공(과정마다) · 교직 · 일반선택 · 전체. 한 과목은 전체 학점에 한 번만.
 * picks: [{ program, version, role }] (첫째가 주전공). 겹쳐 인정은 주전공·복수전공 사이 공통 과목 수를 센다.
 */
export function creditSummary(courses, picks, { sameCourse = (c) => c, rules = null } = {}) {
  const out = { total: 0, ge: 0, teaching: 0, general: 0, outside: 0, majors: {}, shared: [], minorShared: [] };
  for (const p of picks) out.majors[p.program.id] = 0;
  for (const c of courses) {
    const n = Number(c.earned) || 0;
    out.total += n;
    if (OUTSIDE.has(c.source)) out.outside += n;
    if (c.cls === "교양") { out.ge += n; continue; }
    if (c.cls === "교직") { out.teaching += n; continue; }
    const hits = picks.filter((p) => isMajorCourse(c, p.program, p.version, sameCourse));
    if (!hits.length) { out.general += n; continue; }
    for (const p of hits) out.majors[p.program.id] += n;
    if (hits.length > 1) {
      const minor = hits.some((p) => p.role === "minor");
      (minor ? out.minorShared : out.shared).push(c.code);
    }
  }
  const lim = (rules && rules.multi_overlap && rules.multi_overlap.max_courses) || 3;
  out.overlap = { count: out.shared.length, limit: lim, over: out.shared.length > lim, minor: out.minorShared.length > 0 };
  const grad = (picks[0] && picks[0].version && picks[0].version.credits && picks[0].version.credits.grad) || 130;
  const ratio = (rules && rules.transfer_credit_ratio_max) || 0.5;
  out.outsideOver = out.outside > ratio * grad;
  return out;
}

// ---------------------------------------------------------------- 요건 줄

function autoReason(r) {
  if (r.status !== "확인") return `자료 ${r.status}`;
  if (!(r.courses || []).length) return "과목 목록이 없는 조건";
  if (r.min_count == null && r.min_credits == null) return "기준 수가 없는 조건";
  if (r.extra) return "여러 갈래·문장형 조건";
  return null;
}

/** 요건 줄마다 충족(met) · 남음(remaining) · 확인 필요(check) */
export function evaluateProgram(program, version, courses, { role = "single", sameCourse = (c) => c } = {}) {
  const got = new Map(); // 대표 번호 → 과목
  for (const c of courses) if (!c.failed) got.set(c.key || sameCourse(c.code), c);
  const rows = [];
  for (const r of version.requirements || []) {
    if ((r.applies_to || []).length && !r.applies_to.includes(role)) continue;
    const row = { id: r.id, type: r.type, text: r.text, status: r.status, note: r.note || null };
    const why = autoReason(r);
    const matched = [], missing = [];
    for (const c of r.courses || []) {
      const keys = [c.code, ...(c.alt_codes || [])].map(sameCourse);
      const hit = keys.map((k) => got.get(k)).find(Boolean);
      (hit ? matched : missing).push(hit ? { code: c.code, name: c.name, credits: Number(hit.earned) || 0 } : { code: c.code, name: c.name, credits: c.credits ?? null });
    }
    row.have = { count: matched.length, credits: matched.reduce((s, x) => s + x.credits, 0), codes: matched.map((x) => x.code) };
    row.need = { count: r.min_count, credits: r.min_credits };
    if (why) {
      row.state = "check";
      row.reason = why;
      if (missing.length) row.left = missing; // 확인 필요 줄이지만 목록에서 아직 안 들은 과목(추천의 '아마 필요')
    } else {
      const okCount = r.min_count == null || row.have.count >= r.min_count;
      const okCredits = r.min_credits == null || row.have.credits >= r.min_credits;
      row.state = okCount && okCredits ? "met" : "remaining";
      if (row.state === "remaining") row.missing = missing; // 몇 중 몇이면 고를 수 있는 남은 과목들
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- 다음 학기 추천

const STRENGTH = { need: 0, choose: 1, maybe: 2 };

/** 남은 줄의 과목이 하나하나 다 필요한가(남은 과목을 다 들어야 기준에 닿으면 need, 몇 중 몇이면 choose) */
function rowStrength(r) {
  const left = r.missing || [];
  if (r.need && r.need.count != null) return r.need.count >= (r.have ? r.have.count : 0) + left.length ? "need" : "choose";
  if (r.need && r.need.credits != null && left.every((m) => m.credits != null)) {
    const sum = left.reduce((x, m) => x + Number(m.credits), 0);
    return r.need.credits >= (r.have ? r.have.credits : 0) + sum ? "need" : "choose";
  }
  return "choose";
}

/**
 * 남은 요건을 채우는 다음 학기 과목. picks = [{ program, rows }](rows 는 evaluateProgram 결과), courses = 다음 학기 편람(engine parseCourses).
 * 강도: need(남은 과목을 다 들어야 하는 줄), choose(몇 중 몇 줄의 후보), maybe('확인 필요' 줄이지만 과목 목록이 있는 것).
 * 들은 과목은 줄의 남은 과목에 없으니 저절로 빠진다. 같은 과목이 여러 줄에 걸리면 이유를 모으고 가장 센 강도를 쓴다.
 */
export function suggestCourses(picks, courses, { sameCourse = (c) => c } = {}) {
  const offered = new Map();
  for (const c of courses || []) offered.set(sameCourse(c.id), c);
  const out = new Map();
  for (const { program, rows } of picks || []) {
    for (const r of rows || []) {
      let list, strength;
      if (r.state === "remaining") [list, strength] = [r.missing || [], rowStrength(r)];
      else if (r.state === "check" && r.left) [list, strength] = [r.left, "maybe"];
      else continue;
      for (const m of list) {
        const c = offered.get(sameCourse(m.code));
        if (!c) continue;
        const k = sameCourse(c.id);
        const s = out.get(k) || { course: c, strength, reasons: [] };
        if (STRENGTH[strength] < STRENGTH[s.strength]) s.strength = strength;
        s.reasons.push({ program: program.id, row: r.id, text: r.text, strength });
        out.set(k, s);
      }
    }
  }
  return [...out.values()].sort((a, b) => STRENGTH[a.strength] - STRENGTH[b.strength] || String(a.course.id).localeCompare(String(b.course.id)));
}

/**
 * 추천 차례(엔진의 추천 점수): 강도 → 내 시간표에 들어가는지 → 들어가면 늘어나는 비용(걷는 분 + 지각, 학교 오는 요일).
 * fit = engine gapFit(대표 시간표, 추천 과목들) 결과. 없으면 강도만으로.
 */
export function rankSuggestions(suggestions, fit = null) {
  const byId = new Map(((fit && fit.fits) || []).map((f) => [f.course.id, f]));
  return (suggestions || []).map((s) => ({ ...s, fit: byId.get(s.course.id) || null }))
    .sort((a, b) => STRENGTH[a.strength] - STRENGTH[b.strength] || (a.fit ? 0 : 1) - (b.fit ? 0 : 1)
      || (a.fit && b.fit ? a.fit.add.cost - b.fit.add.cost || a.fit.add.days - b.fit.add.days : 0)
      || String(a.course.id).localeCompare(String(b.course.id)));
}

// ---------------------------------------------------------------- 성적 계산

function average(list) {
  let pts = 0, cr = 0;
  for (const x of list) {
    const n = Number(x.credits) || 0;
    pts += GRADE_POINTS[x.grade] * n;
    cr += n;
  }
  return { gpa: cr ? Math.round((pts / cr) * 100) / 100 : null, credits: cr, points: Math.round(pts * 100) / 100 };
}

const graded = (x) => Object.prototype.hasOwnProperty.call(GRADE_POINTS, x.grade) && !OUTSIDE.has(x.source) && x.status !== "dropped";

/**
 * 평점평균. 학교 규칙: A+ 4.3 … F 0, S·U·W 는 빼고, 재수강은 나중 성적, 다른 학교 학점은 평점에 넣지 않음.
 * 학기 평점(학기당 학점 늘리기 기준)은 재이수로 조정되기 전 그 학기 성적이고 계절은 뺀다.
 * isMajor(course) 를 주면 전공 평점도 낸다. 졸업은 전체·전공 모두 2.0 이상.
 */
export function gpa(records, { sameCourse = (c) => c, isMajor = null } = {}) {
  const tidy = tidyRecords(records, sameCourse);
  const final = tidy.courses.filter(graded);
  const all = average(final);
  const major = isMajor ? average(final.filter(isMajor)) : null;
  const terms = {};
  for (const r of records || []) {
    if (!graded(r) || (isGraduate(r) && !r.toBachelor)) continue;
    (terms[r.term] = terms[r.term] || []).push(r);
  }
  const byTerm = Object.fromEntries(Object.entries(terms).sort((a, b) => termOrder(a[0]) - termOrder(b[0])).map(([t, l]) => [t, average(l)]));
  const regular = Object.keys(byTerm).filter(isRegularTerm);
  const lastTwo = regular.slice(-2);
  const lastTwoRegular = lastTwo.length ? { terms: lastTwo, ...average(lastTwo.flatMap((t) => terms[t])) } : { terms: [], gpa: null, credits: 0 };
  const ungraded = tidy.courses.filter((c) => !OUTSIDE.has(c.source) && !graded(c) && c.grade !== "S" && c.grade !== "U").length;
  const okAll = all.gpa == null ? null : all.gpa >= 2.0;
  const okMajor = major == null || major.gpa == null ? null : major.gpa >= 2.0;
  return { all, major, byTerm, lastTwoRegular, ungraded,
    graduation: { all: okAll, major: okMajor, complete: ungraded === 0 } };
}

/** 목표 전체 평점에 닿으려면 앞으로 들을 학점에서 평균 몇이 필요한가(4.3 을 넘으면 닿지 못함) */
export function gradeNeeded(current, plannedCredits, target) {
  const cr = Number(current.credits) || 0, pts = Number(current.points) || 0, n = Number(plannedCredits) || 0;
  if (n <= 0) return { need: null, reachable: (cr ? pts / cr : 0) >= target };
  const need = (target * (cr + n) - pts) / n;
  return { need: Math.round(need * 100) / 100, reachable: need <= 4.3 };
}

// ---------------------------------------------------------------- 학기당 수강 학점 상한

const matches = (rule, who) => (rule.match || []).some((m) => who.some((w) => String(w || "").startsWith(m)));
const inYears = (rule, year) => (rule.entry_min == null || year >= rule.entry_min) && (rule.entry_max == null || year <= rule.entry_max);

/**
 * 학기당 취득학점 상한. who = { college, unit, program, entryYear, programYear?, term (입학 뒤 몇 번째 정규학기, 1부터),
 * gpaLastTwo?(직전 2개 정규학기 평점), warning?(직전 학기 학사경고) }.
 * 2026-2 기초교양 수강편람 표. 의학과·수의학과(본과)는 본과 진입 연도(programYear, 없으면 입학 + 2)로 본다.
 */
export function termCreditLimit(limits, who) {
  const names = [who.program, who.unit, who.college];
  const entry = Number(who.entryYear);
  let base = limits.default, why = "기본";
  for (const r of limits.units || []) {
    const y = r.year === "program" ? Number(who.programYear || entry + 2) : entry;
    if (matches(r, names) && inYears(r, y)) { base = r.limit; why = r.match.join("·"); break; }
  }
  let limit = base;
  for (const r of limits.first_terms || []) {
    if (matches(r, names) && inYears(r, entry) && Number(who.term) >= 1 && Number(who.term) <= r.terms) {
      if (r.limit > limit) { limit = r.limit; why = `${r.match.join("·")} 입학 뒤 첫 ${r.terms}학기`; }
      break;
    }
  }
  const plus = limits.plus;
  if (plus && base <= plus.base_max && who.gpaLastTwo != null && who.gpaLastTwo >= plus.gpa_min && limit < plus.limit) {
    limit = plus.limit; why = `직전 2개 학기 평점 ${plus.gpa_min} 이상`;
  }
  if (who.warning && limits.warning_limit != null && limit > limits.warning_limit) {
    limit = limits.warning_limit; why = "직전 학기 학사경고";
  }
  return { limit, base, why, exempt: new Set(limits.exempt_codes || []) };
}

/** 고른 과목들의 학점 합(상한 밖 과목은 뺀다)과 상한 안인지 */
export function withinLimit(courses, lim) {
  const sum = courses.filter((c) => !lim.exempt.has(c.code)).reduce((s, c) => s + (Number(c.credits) || 0), 0);
  return { credits: sum, ok: sum <= lim.limit };
}
