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

/**
 * 판 고르기(화면이 학번·전공 진입·선발 학기를 받은 뒤): version_key 가 selection 이면 다전공 선발 연도로,
 * 전공 진입 연도로 갈리는 판(basis '전공 진입 …')이면 전공 진입 연도로, 그 밖은 입학 연도로. 모르는 값은 입학 연도로 대신한다.
 */
export function pickVersionFor(program, { entryYear, majorEntryYear = null, selectionYear = null } = {}) {
  if (program.version_key === "selection") return pickVersion(program, selectionYear ?? entryYear);
  if (majorEntryYear != null) {
    const byMajor = pickVersion(program, majorEntryYear);
    if (byMajor.version && /^전공 진입/.test(byMajor.version.basis || "")) return byMajor;
  }
  return pickVersion(program, entryYear);
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
 * 들은 과목 기록 → 셀 과목. 디자인 124판(사용자 11/13 "드랍 여부만 받을 수 있으면 되고"): 학생은 드랍만 고른다.
 * 기록: { code, name, credits, cls, dept, level, term, dropped?, grade?, source?, toBachelor?, manual? }
 *   dropped: 드랍(안 들음). 옛 꼴 status "dropped" 와 성적 W 도 같다
 *   grade: "A+"…"F" | "S" | "U"(성적 계산기). F·U 면 학점 못 받음(옛 꼴 status "failed" 도 같다)
 *   같은 과목(번호가 같거나 대응표·대체 번호로 이어진 과목)을 다시 들었으면 앞 것은 저절로 재수강으로 뺀다(묻지 않는다).
 *   번호가 다른 대체 과목을 둘 다 들었으면 substituted 에 남겨 그 과목이 걸린 요건 줄을 '확인 필요'로 한다(evaluateProgram)
 *   source: "snu"(기본) | "exchange" | "domestic" | "transfer", toBachelor: 대학원 과목을 학사 졸업학점에 넣을지
 * 결과: courses(셀 것, earned 학점, index = 기록 차례) · replaced(재수강으로 빠진 앞 수강, by = 다시 들은 학기)
 *       · substituted([{key, codes}]) · dropped(why: dropped | graduate_not_counted) · duplicates(옛 꼴, 늘 빈 목록)
 */
export function tidyRecords(records, sameCourse = (c) => c) {
  const dropped = [], groups = new Map();
  (records || []).forEach((r0, index) => {
    const r = { ...r0, index, key: sameCourse(r0.code) };
    if (r.dropped || r.status === "dropped" || r.grade === "W") { dropped.push({ ...r, why: "dropped" }); return; }
    if (isGraduate(r) && !r.toBachelor) { dropped.push({ ...r, why: "graduate_not_counted" }); return; }
    if (!groups.has(r.key)) groups.set(r.key, []);
    groups.get(r.key).push(r);
  });
  const courses = [], replaced = [], substituted = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => termOrder(a.term) - termOrder(b.term) || a.index - b.index);
    const last = list[list.length - 1];
    const earlier = list.slice(0, -1);
    const codes = [...new Set(list.map((x) => x.code))];
    if (earlier.length) replaced.push(...earlier.map((x) => ({ ...x, by: last.term, byCode: last.code })));
    if (codes.length > 1) substituted.push({ key, codes });
    const failed = last.status === "failed" || NO_CREDIT.has(last.grade);
    courses.push({ ...last, earned: failed ? 0 : Number(last.credits) || 0, failed, substituted: codes.length > 1 });
  }
  return { courses, replaced, substituted, dropped, duplicates: [] };
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

export const SUBSTITUTED = "대체 과목을 둘 다 들음";
export const SHARED_COURSE = "여러 요건에 걸린 과목";
const TYPE_NAME = { major_required: "전공필수", major_elective: "전공선택", major_choose: "지정 과목", double: "복수전공", minor: "부전공",
  thesis: "졸업 논문", distribution: "분배 이수", ge: "교양", other: "기타 조건" };

/** 요건 줄 이름(짧게): 자료 글의 앞부분('전공필수 15과목 46학점' → '전공필수', '외국어진행강좌(…) 3과목' → '외국어진행강좌'), 길거나 숫자로 시작하면 종류 이름 */
export function rowName(req) {
  let t = String((req && req.text) || "").replace(/^\[\d-\d\]\s*/, "").replace(/^\[([^\]]{1,8})\]\s*/, "$1 ").split(/[:：(（—]/)[0];
  t = t.replace(/[A-Z]?\d{3,4}\.[0-9A-Z]+/g, " ").replace(/\d.*$/, "").replace(/[\s,·→]+$/, "").trim();
  t = t.replace(/\s+(?:는|은|이|가|을|를|의|와|과|및)$/, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 14) return TYPE_NAME[req && req.type] || "요건";
  return t;
}

/**
 * 요건 줄마다 충족(met) · 남음(remaining) · 확인 필요(check, reason).
 * 디자인 124판: 대체 관계 과목을 둘 다 들었거나(tidyRecords 의 substituted) 들은 과목 하나가 셀 수 있는 줄 여럿에 걸리면 그 줄은 확인 필요.
 * 다만 한 줄의 과목 목록이 다른 줄 목록 안에 다 들면(큰 요건 안의 작은 요건: '과학 16학점' 안의 '생물학 1·2') 두 줄에 같이 세는 것이 규정이라 그대로 둔다.
 */
export function evaluateProgram(program, version, courses, { role = "single", sameCourse = (c) => c } = {}) {
  const got = new Map(); // 대표 번호 → 과목
  for (const c of courses) if (!c.failed) got.set(c.key || sameCourse(c.code), c);
  const rows = [], hitsOf = new Map(); // 대표 번호 → 그 과목을 센 줄들(셀 수 있는 줄만)
  const keysOf = new Map(); // 줄 → 목록 과목의 대표 번호들
  for (const r of version.requirements || []) {
    if ((r.applies_to || []).length && !r.applies_to.includes(role)) continue;
    const row = { id: r.id, type: r.type, name: rowName(r), text: r.text, status: r.status, note: r.note || null, src: r.src || [] };
    const why = autoReason(r);
    const matched = [], missing = [];
    for (const c of r.courses || []) {
      const keys = [c.code, ...(c.alt_codes || [])].map(sameCourse);
      const hit = keys.map((k) => got.get(k)).find(Boolean);
      if (hit) {
        matched.push({ code: c.code, name: c.name, credits: Number(hit.earned) || 0, term: hit.term, key: hit.key || sameCourse(hit.code),
          substituted: Boolean(hit.substituted) });
      } else {
        missing.push({ code: c.code, name: c.name, credits: c.credits ?? null });
      }
    }
    row.have = { count: matched.length, credits: matched.reduce((s, x) => s + x.credits, 0), codes: matched.map((x) => x.code) };
    row.need = { count: r.min_count, credits: r.min_credits };
    row.taken = matched;
    row.all = (r.courses || []).map((c) => ({ code: c.code, name: c.name, credits: c.credits ?? null }));
    keysOf.set(row, new Set((r.courses || []).flatMap((c) => [c.code, ...(c.alt_codes || [])].map(sameCourse))));
    if (why) {
      row.state = "check";
      row.reason = why;
      if (missing.length) row.left = missing; // 확인 필요 줄이지만 목록에서 아직 안 들은 과목(추천의 '아마 필요')
    } else {
      const okCount = r.min_count == null || row.have.count >= r.min_count;
      const okCredits = r.min_credits == null || row.have.credits >= r.min_credits;
      row.state = okCount && okCredits ? "met" : "remaining";
      if (row.state === "remaining") row.missing = missing; // 몇 중 몇이면 고를 수 있는 남은 과목들
      for (const m of matched) hitsOf.set(m.key, [...(hitsOf.get(m.key) || []), row]);
    }
    rows.push(row);
  }
  const toCheck = (row, reason) => {
    if (row.state === "check") return;
    row.left = row.missing || (row.all || []).filter((c) => !row.have.codes.includes(c.code));
    delete row.missing;
    row.state = "check";
    row.reason = reason;
  };
  for (const row of rows) if ((row.taken || []).some((m) => m.substituted)) toCheck(row, SUBSTITUTED);
  const inside = (a, b) => [...keysOf.get(a)].every((k) => keysOf.get(b).has(k));
  for (const list of hitsOf.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        if (!inside(a, b) && !inside(b, a)) { toCheck(a, SHARED_COURSE); toCheck(b, SHARED_COURSE); }
      }
    }
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
        s.reasons.push({ program: program.id, row: r.id, name: r.name || r.text, text: r.text, strength });
        out.set(k, s);
      }
    }
  }
  return [...out.values()].sort((a, b) => STRENGTH[a.strength] - STRENGTH[b.strength] || String(a.course.id).localeCompare(String(b.course.id)));
}

/**
 * 추천 차례(엔진의 추천 점수). order "req"(요건 순, 기본): 강도 → 내 시간표에 들어가는지 → 늘어나는 비용(걷는 분 + 지각, 학교 오는 요일).
 * order "walk"(덜 걷는 순, 디자인 124판): 들어가는지 → 늘어나는 비용 → 강도. 둘 다 '아마 필요'(확인 필요 줄의 과목)는 맨 아래.
 * fit = engine gapFit(대표 시간표, 추천 과목들) 결과. 없으면 강도만으로.
 */
export function rankSuggestions(suggestions, fit = null, { order = "req" } = {}) {
  const byId = new Map(((fit && fit.fits) || []).map((f) => [f.course.id, f]));
  const maybe = (x) => (x.strength === "maybe" ? 1 : 0);
  const cost = (a, b) => (a.fit ? 0 : 1) - (b.fit ? 0 : 1)
    || (a.fit && b.fit ? a.fit.add.cost - b.fit.add.cost || a.fit.add.days - b.fit.add.days : 0);
  return (suggestions || []).map((s) => ({ ...s, fit: byId.get(s.course.id) || null }))
    .sort((a, b) => maybe(a) - maybe(b) || (order === "walk"
      ? cost(a, b) || STRENGTH[a.strength] - STRENGTH[b.strength]
      : STRENGTH[a.strength] - STRENGTH[b.strength] || cost(a, b))
      || String(a.course.id).localeCompare(String(b.course.id)));
}

/** 과목 추가 행의 요건 태그: 채우는 요건 이름(가장 센 줄), 확인 필요 줄의 과목이면 '아마 필요'(디자인 124판) */
export function suggestionTag(s) {
  if (!s) return null;
  if (s.strength === "maybe") return "아마 필요";
  const best = (s.reasons || []).filter((r) => r.strength === s.strength)[0] || (s.reasons || [])[0];
  return best ? best.name : null;
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

// ---------------------------------------------------------------- 졸업 요건 탭 값 (디자인 124판, update106)
// 화면은 아래 함수가 주는 글을 그대로 그린다(글을 짓지 않는다). 계산은 위 함수들, 여기는 그 결과를 화면 꼴로 묶는다.

const SEASON_NAME = { 1: "1학기", S: "여름학기", 2: "2학기", W: "겨울학기" };
const monthDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : null;
};

/** "2026-2" → "2026년 2학기", "2026-S" → "2026년 여름학기" */
export function termName(term) {
  const m = /^(\d{4})-(1|S|2|W)$/.exec(String(term || ""));
  return m ? `${m[1]}년 ${SEASON_NAME[m[2]]}` : String(term || "");
}

/** 다음 정규 학기: 2026-1·2026-S → 2026-2, 2026-2·2026-W → 2027-1(요건 보기의 '다음 학기 추천') */
export function nextRegularTerm(term) {
  const m = /^(\d{4})-(1|S|2|W)$/.exec(String(term || ""));
  if (!m) return null;
  return m[2] === "1" || m[2] === "S" ? `${m[1]}-2` : `${Number(m[1]) + 1}-1`;
}

/** 그 학기 편람이 웹 자료에 있는지(semesters.json 의 list) */
export const hasCoursebook = (semesters, term) => Boolean(semesters && (semesters.list || []).some((x) => x[0] === term));

/** 입학 뒤 몇 번째 정규 학기인가(봄 입학으로 본다): 2025학번의 2027-1 은 5. termCreditLimit 의 who.term */
export function nthRegularTerm(entryYear, term) {
  const m = /^(\d{4})-(1|S|2|W)$/.exec(String(term || ""));
  if (!m || !Number.isFinite(Number(entryYear))) return null;
  const n = (Number(m[1]) - Number(entryYear)) * 2 + (m[2] === "1" || m[2] === "S" ? 1 : 2);
  return n >= 1 ? n : null;
}

/**
 * 묶음 제목 옆 판 이름: '2025~2026학번 규정', 전공 진입 연도로 고르는 판은 '2024~2026년 진입 규정',
 * 복수·부전공과 선발 연도로 고르는 과정은 선발 학기 '2026년 1학기 선발'(모르면 '2025~2026년 선발 규정')
 */
export function versionLabel(program, version, { role = "single", selectionTerm = null } = {}) {
  if (!version) return null;
  const selected = role === "double" || role === "minor" || (program && program.version_key === "selection");
  if (selected && selectionTerm) return `${termName(selectionTerm)} 선발`;
  const [a, b] = version.entry_years || [];
  const range = a === b ? `${a}` : `${a}~${b}`;
  if (program && program.version_key === "selection") return `${range}년 선발 규정`;
  return /진입/.test(version.basis || "") ? `${range}년 진입 규정` : `${range}학번 규정`;
}

/**
 * 고를 수 있는 판: 자기 판 + (학과가 허락하면) 더 새 판. newer = catalog.json programs[id].newer
 * ({mode: "any"|"latest", entry_max, roles}). 둘 이상이면 판 이름이 선택칸(디자인 124판)
 */
export function versionChoices(program, version, { newer = null, entryYear = null, role = "single", selectionTerm = null } = {}) {
  if (!version) return [];
  const own = { version, label: versionLabel(program, version, { role, selectionTerm }) };
  if (!newer || (newer.roles && !newer.roles.includes(role)) || (newer.entry_max != null && Number(entryYear) > newer.entry_max)) return [own];
  const later = (program.versions || []).filter((v) => v.entry_years[0] > version.entry_years[1])
    .sort((x, y) => x.entry_years[0] - y.entry_years[0]);
  const pick = newer.mode === "latest" ? later.slice(-1) : later;
  return [own, ...pick.map((v) => ({ version: v, label: versionLabel(program, v, { role: "single" }) }))];
}

/**
 * 들은 과목 보기: 학기마다(새 학기 먼저) 제목·센 학점('18학점', 이번 학기는 '18학점 · 듣는 중')과 과목 줄.
 * 줄: {index(기록 차례), code, name, credits, counted, why(null|dropped|failed|retake|graduate), meta}.
 * meta 는 '전필 · 3학점', 직접 넣은 과목은 '직접 추가 · 교양 · 1학점', 재수강으로 빠진 앞 수강은 끝에 '2026년 2학기에 재수강해서 빠짐'.
 * total 은 머리의 '들은 학점'(드랍·F·U·재수강 앞 것을 뺀 값)
 */
export function takenTerms(records, { sameCourse = (c) => c, currentTerm = null } = {}) {
  const tidy = tidyRecords(records, sameCourse);
  const why = new Map();
  for (const d of tidy.dropped) why.set(d.index, { why: d.why === "dropped" ? "dropped" : "graduate" });
  for (const r of tidy.replaced) why.set(r.index, { why: "retake", by: r.by });
  for (const c of tidy.courses) if (c.failed) why.set(c.index, { why: "failed" });
  const terms = new Map();
  (records || []).forEach((r, index) => {
    const w = why.get(index) || null;
    const credits = Number(r.credits) || 0;
    let meta = `${r.cls ? r.cls + " · " : ""}${credits}학점`;
    if (r.manual) meta = `직접 추가 · ${meta}`;
    if (w && w.why === "retake") meta += ` · ${termName(w.by)}에 재수강해서 빠짐`;
    if (!terms.has(r.term)) terms.set(r.term, []);
    terms.get(r.term).push({ index, code: r.code, name: r.name || r.code, credits, counted: !w, why: w ? w.why : null, meta });
  });
  const list = [...terms.entries()].sort((a, b) => termOrder(b[0]) - termOrder(a[0])).map(([term, rows]) => {
    const sum = rows.filter((x) => x.counted).reduce((s, x) => s + x.credits, 0);
    const current = term === currentTerm;
    return { term, label: termName(term), credits: sum, current, text: `${sum}학점${current ? " · 듣는 중" : ""}`, rows };
  });
  return { total: tidy.courses.reduce((s, c) => s + (Number(c.earned) || 0), 0), terms: list, tidy };
}

/** 확인 필요 줄의 까닭 한 줄(시트 본문). entryYear 를 주면 '2025학번 내규가 공개되지 않았어요.' 처럼 학번을 넣는다 */
export function reasonText(row, { entryYear = null } = {}) {
  const y = entryYear ? `${entryYear}학번 ` : "";
  switch (row && row.reason) {
    case "자료 미확인": return `${y}내규가 공개되지 않았어요.`;
    case "자료 부분": return `${y}세부 규정이 공개 자료에 다 나오지 않았어요.`;
    case "자료 충돌": return "공개된 자료끼리 내용이 달라요.";
    case "과목 목록이 없는 조건": return "정해진 과목 목록이 없는 요건이라 계산하지 않았어요.";
    case "기준 수가 없는 조건": return "몇 과목·몇 학점인지 정해지지 않은 요건이에요.";
    case "여러 갈래·문장형 조건": return "여러 갈래로 나뉘는 조건이라 계산하지 않았어요.";
    case SUBSTITUTED: return "대체 관계인 과목을 둘 다 들었어요. 어느 쪽으로 셀지 학과에 확인해 주세요.";
    case SHARED_COURSE: return "들은 과목 하나가 여러 요건에 걸려 있어요. 어느 요건으로 셀지 학과에 확인해 주세요.";
    default: return (row && row.because) || null;
  }
}

/** 요건 시트의 출처 줄: [{text: '출처: 동물생명공학전공 졸업요건 학부과정(2022년도)', url, locator}] (같은 문서는 한 번) */
export function sourceTexts(program, src = []) {
  const out = [], seen = new Set();
  for (const k of src || []) {
    const s = ((program && program.sources) || {})[k];
    if (!s || seen.has(s.title)) continue;
    seen.add(s.title);
    out.push({ text: `출처: ${String(s.title).replace(/\s+—\s+/g, " ")}`, url: s.url || null, locator: s.locator || null });
  }
  return out;
}

const CENTRAL = /^https?:\/\/(?:www\.)?snu\.ac\.kr\/|^https?:\/\/sugang\.snu\.ac\.kr/;
/** '학과 졸업요건' 링크: 과정 출처 가운데 학과 누리집의 졸업요건·내규 페이지(없으면 교과과정 페이지, 그것도 없으면 null) */
export function deptLink(program) {
  const all = Object.values((program && program.sources) || {}).filter((s) => s.url && !CENTRAL.test(s.url));
  const best = all.find((s) => /졸업|내규|이수규정|요건/.test(s.title)) || all.find((s) => /교과과정|교육과정|커리큘럼/.test(s.title)) || all[0];
  return best ? best.url : null;
}

function rowValue(row) {
  if (row.state === "met") return { kind: "met", text: "충족" };
  if (row.state === "remaining") {
    const { need, have } = row;
    if (need.credits != null && have.credits < need.credits) return { kind: "left", unit: "학점", left: need.credits - have.credits, text: `${need.credits - have.credits}학점 남음` };
    if (need.count != null && have.count < need.count) return { kind: "left", unit: "과목", left: need.count - have.count, text: `${need.count - have.count}과목 남음` };
  }
  return { kind: "check", text: "확인 필요" };
}

function rowSummary(row, value) {
  const { need, have } = row;
  if (value.kind === "left") {
    const [total, got] = value.unit === "학점" ? [need.credits, have.credits] : [need.count, have.count];
    return { summary: `${total}${value.unit} 중 ${got}${value.unit} · ${value.text}`, strong: value.text };
  }
  if (value.kind === "met") {
    if (need.credits != null) return { summary: `${need.credits}학점 중 ${have.credits}학점`, strong: null };
    if (need.count != null) return { summary: `${need.count}과목 중 ${have.count}과목`, strong: null };
  }
  return { summary: null, strong: null };
}

/**
 * 요건 줄 하나 → 화면 값. {id, name, value: {kind: left|met|check, text}, aria, sheet: {title, meta, summary, strong,
 * courses: [{code, name, credits, taken, meta}], because, link, sources, checked, detail}}.
 * 남음·충족은 summary·courses·sources, 확인 필요는 because·link(학과 졸업요건)·checked 를 쓴다
 */
export function rowView(row, { program, title = null, label = null, entryYear = null } = {}) {
  const value = rowValue(row);
  const { summary, strong } = rowSummary(row, value);
  const courses = (row.all || []).map((c) => {
    const t = (row.taken || []).find((x) => x.code === c.code);
    return t ? { code: c.code, name: c.name, credits: t.credits, taken: true, meta: `${t.credits}학점 · ${termName(t.term)}` }
      : { code: c.code, name: c.name, credits: c.credits, taken: false, meta: c.credits != null ? `${c.credits}학점` : null };
  });
  const checked = program && program.checked_on ? `${monthDay(program.checked_on)} 기준` : null;
  return {
    id: row.id, name: row.name || rowName(row), value, aria: `${row.name || rowName(row)}, ${value.text}`,
    sheet: { title: row.name || rowName(row), meta: [title || (program && program.program), label].filter(Boolean).join(" · "),
      summary, strong, courses, because: value.kind === "check" ? reasonText(row, { entryYear }) : null,
      link: deptLink(program), sources: sourceTexts(program, row.src), checked, detail: row.text || null },
  };
}

/**
 * 요건 보기 전체(디자인 124판 '졸업 요건 탭').
 * picks: [{program, version, role, title?, entryYear?, selectionTerm?, newer?}](첫째가 주전공. version 은 화면이 고른 판, 없으면 pickVersionFor)
 * records: 들은 과목 기록(tidyRecords 꼴), grades: gpa(records, {isMajor}) 결과(성적을 안 넣었으면 null), common: common.json
 * → {total, bundles: [{kind: "common"|"program", id, title, label, choices, rows: [rowView]}], missing: [자료가 없는 과정 id]}.
 * 공통: 졸업 학점 · 졸업 평점 · 주전공 판의 교양 줄. 주전공 묶음에는 교양 줄을 다시 넣지 않는다
 */
export function gradView({ picks = [], records = [], grades = null, common = null, sameCourse = (c) => c } = {}) {
  const tidy = tidyRecords(records, sameCourse);
  const total = tidy.courses.reduce((s, c) => s + (Number(c.earned) || 0), 0);
  const ready = picks.map((p) => ({ ...p, version: p.version || pickVersionFor(p.program, {
    entryYear: p.entryYear, selectionYear: p.selectionTerm ? Number(String(p.selectionTerm).slice(0, 4)) : null }).version }));
  const missing = ready.filter((p) => !p.version).map((p) => p.program.id);
  const counted = ready.filter((p) => p.version);
  const sums = creditSummary(tidy.courses, counted.map((p) => ({ program: p.program, version: p.version, role: p.role || "single" })),
    { sameCourse, rules: common });
  const main = counted[0] || null;
  const commonRows = [];
  const grad = (main && main.version.credits && main.version.credits.grad) || (common && common.graduation && common.graduation.credits_min) || 130;
  const credit = { id: "grad-credits", name: "졸업 학점", state: total >= grad ? "met" : "remaining", need: { credits: grad, count: null },
    have: { credits: total, count: null, codes: [] }, src: (main && main.version.credits && main.version.credits.src) || [], all: [], taken: [] };
  if (sums.outsideOver) Object.assign(credit, { state: "check", because: "다른 학교에서 얻은 학점이 졸업 학점의 절반을 넘어요." });
  commonRows.push(rowView(credit, { program: main && main.program, title: "공통" }));
  const gpaMin = (common && common.graduation && common.graduation.gpa_min) || 2.0;
  const gpaRow = { id: "grad-gpa", name: "졸업 평점", need: { credits: null, count: null }, have: { credits: 0, count: 0, codes: [] }, src: [], all: [], taken: [] };
  if (!grades || !grades.all || grades.all.gpa == null || !(grades.graduation && grades.graduation.complete)) {
    Object.assign(gpaRow, { state: "check", because: "성적을 다 넣지 않았어요." });
  } else if (grades.all.gpa < gpaMin) {
    Object.assign(gpaRow, { state: "check", because: `전체 평점이 ${gpaMin.toFixed(1)}보다 낮아요.` });
  } else if (grades.major && grades.major.gpa != null && grades.major.gpa < gpaMin) {
    Object.assign(gpaRow, { state: "check", because: `전공 평점이 ${gpaMin.toFixed(1)}보다 낮아요.` });
  } else {
    gpaRow.state = "met";
  }
  const gv = rowView(gpaRow, { title: "공통" });
  if (gpaRow.state === "met") gv.sheet.summary = `전체 ${grades.all.gpa.toFixed(2)}${grades.major && grades.major.gpa != null ? ` · 전공 ${grades.major.gpa.toFixed(2)}` : ""}`;
  commonRows.push(gv);
  const bundles = [{ kind: "common", id: "common", title: "공통", label: null, choices: [], rows: commonRows }];
  counted.forEach((p, i) => {
    const role = p.role || "single";
    const label = versionLabel(p.program, p.version, { role, selectionTerm: p.selectionTerm });
    const title = p.title || p.program.program;
    const rows = evaluateProgram(p.program, p.version, tidy.courses, { role, sameCourse });
    const opts = { program: p.program, title, label, entryYear: p.entryYear };
    const mine = [];
    for (const r of rows) {
      if (i === 0 && r.type === "ge") commonRows.push(rowView(r, { ...opts, title: "공통" }));
      else mine.push(rowView(r, opts));
    }
    const choices = versionChoices(p.program, p.version, { newer: p.newer, entryYear: p.entryYear, role, selectionTerm: p.selectionTerm })
      .map((c) => ({ label: c.label, entry_years: c.version.entry_years }));
    bundles.push({ kind: "program", id: p.program.id, title, label, choices, rows: mine });
  });
  return { total, bundles, missing, credits: sums };
}

/** 졸업 요건 탭 맨 아래 기준 줄: '2025학년도 자료 · 11월 12일 기준'(index.json 의 data_year·checked_on) */
export function basisText(index) {
  if (!index) return null;
  const day = monthDay(index.checked_on);
  return [index.data_year ? `${index.data_year}학년도 자료` : null, day ? `${day} 기준` : null].filter(Boolean).join(" · ") || null;
}

/**
 * 과목 추가의 학기 학점 줄(디자인 124판): '18학점까지 ▾ · 12학점 남음', 넘으면 '3학점 넘음'(over).
 * 정규 학기는 termCreditLimit 의 상한을 처음 값으로 고를 수 있는 값(choices: 기본·학기 예외·평점 3.3 이상 21), 계절학기는 9·6 글자만.
 * credits = 그 학기 시간표의 학점(상한 밖 과목은 뺀 withinLimit 의 credits), chosen = 사용자가 고른 값(없으면 처음 값)
 */
export function limitLine({ common, who = {}, term, credits = 0, chosen = null }) {
  const m = /-(S|W)$/.exec(String(term || ""));
  const line = (cap, choices) => ({ value: cap, label: `${cap}학점까지`, choices: choices.map((c) => ({ value: c, label: `${c}학점까지` })),
    rest: credits > cap ? `${credits - cap}학점 넘음` : `${cap - credits}학점 남음`, over: credits > cap });
  if (m) {
    const s = (common && common.seasonal) || { summer: 9, winter: 6 };
    return { ...line(m[1] === "S" ? s.summer : s.winter, []), why: "계절학기" };
  }
  const limits = common.term_limit;
  const lim = termCreditLimit(limits, { ...who, term: who.term ?? nthRegularTerm(who.entryYear, term) });
  const plus = limits.plus && lim.base <= limits.plus.base_max ? [limits.plus.limit] : [];
  const choices = [...new Set([lim.base, lim.limit, ...plus])].filter((x) => x != null).sort((a, b) => a - b);
  const value = chosen != null && choices.includes(Number(chosen)) ? Number(chosen) : lim.limit;
  return { ...line(value, choices), why: lim.why };
}
