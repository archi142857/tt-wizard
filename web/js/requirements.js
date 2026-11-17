// 졸업 요건 미리 보기 · 성적 계산 · 학기 학점 상한 — 폰 안에서만 계산한다(서버 없음).
// 자료 꼴은 docs/requirements.md (web/data/requirements/: index.json, common.json, course_map.json, programs/<id>.json).
// 원칙: 확인된 줄만 '충족/남음'으로 단정하고, 나머지는 '확인 필요'와 까닭을 낸다. 학교 졸업 사정을 대신하지 않는다.
// tests/test_requirements.py 가 node 로 확인한다.

import { fitRank } from "./engine.js"; // 덜 걷는 순(디자인 128판)

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
const dist = (v, y) => (y < v.entry_years[0] ? v.entry_years[0] - y : y > v.entry_years[1] ? y - v.entry_years[1] : 0);

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
  if (program.version_key === "selection") {
    // 연합·연계전공은 조사 자료에 2025~2026 선발 판뿐이라(1차 조사) 그 전 선발 학생은 판이 없었다(사용자 11/16 '아예 없는 것도 있냐'). 있던 학번을 모르는 과정(exists_for null)만
    // 가장 가까운 판으로 보고 reason "nearest"(판 이름이 '… 선발 · 2025~2026년 선발 규정'으로 알린다, update128)
    const got = pickVersion(program, selectionYear ?? entryYear);
    if (got.version || program.exists_for || !(program.versions || []).length) return got;
    const y = Number(selectionYear ?? entryYear);
    const near = (program.versions || []).slice().sort((a, b) => dist(a, y) - dist(b, y) || b.entry_years[0] - a.entry_years[0])[0];
    return near && Number.isFinite(y) ? { version: near, reason: "nearest" } : got;
  }
  if (majorEntryYear != null) {
    // 전공 진입 칸을 없애서(프론트엔드 ui121b) 화면은 학번+1 을 준다. 본과 진입(예과 2년 뒤)으로 갈리는 과정(수의학과 본과)은 학번+2 로 고친다(백엔드 update117)
    const y = Number(entryYear), m = Number(majorEntryYear);
    const late = (program.versions || []).some((v) => /본과 진입/.test(v.basis || ""));
    const byMajor = pickVersion(program, late && Number.isFinite(y) && m === y + 1 ? y + 2 : majorEntryYear);
    if (byMajor.version && /^전공 진입/.test(byMajor.version.basis || "")) return byMajor;
  }
  return pickVersion(program, entryYear);
}

/**
 * 판의 요건 줄 가운데 이 학번에 걸리는 것만 둔 판(update128). 전공 진입·교과 개편·졸업 시기로 고르는 판은 2025 앞뒤 학번이 같이 걸려서
 * 교양 줄을 입학 연도로 나눠 둔다(줄의 entry_years: 새 교양 [2025, …] · 옛 학번 [2019, 2024], 교양은 늘 입학 연도 규정).
 * 학번을 모르면 가장 새 학번 줄. 나눈 줄이 없으면 그 판 그대로
 */
export function rowsForEntry(version, entryYear) {
  const rows = (version && version.requirements) || [];
  if (!rows.some((r) => r.entry_years)) return version;
  const y = Number(entryYear);
  const top = Math.max(...rows.filter((r) => r.entry_years).map((r) => r.entry_years[1]));
  const ok = (r) => !r.entry_years || (Number.isFinite(y) && y > 0 ? r.entry_years[0] <= y && y <= r.entry_years[1] : r.entry_years[1] === top);
  return { ...version, requirements: rows.filter(ok) };
}

// ---------------------------------------------------------------- 같은 과목

/** 같은 과목으로 볼 번호 묶음: 학교 교양 대응표(2024 → 2025 → 2026), 이름·번호가 바뀐 과목(course_map.same, 백엔드 update131 scripts/same_courses.py)과
 *  요건의 alt_codes. 번호 → 대표 번호. 돌려주는 함수에 now(번호 → 지금 열리는 {code, name})·ended(번호 → 마지막 개설 학기) 지도를 붙인다(rowView 의 과목 메타) */
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
  // 이름·번호가 바뀐 과목(사용자 11/17 '통계 인공지능 개론 및 실습은 통계학개론 및 실습에서 이름이 바뀐 거라'): 학과 자료의 짝 + 편람에서 번호만 바뀐 짝
  for (const x of (courseMap && courseMap.same) || []) for (let i = 1; i < (x.codes || []).length; i++) join(x.codes[0], x.codes[i]);
  for (const p of programs) {
    for (const v of p.versions || []) {
      for (const r of v.requirements || []) {
        for (const c of r.courses || []) for (const a of c.alt_codes || []) join(c.code, a);
      }
    }
  }
  const same = (code) => (parent.has(code) ? find(code) : code);
  same.now = new Map(Object.entries((courseMap && courseMap.now) || {}));
  same.ended = new Map(Object.entries((courseMap && courseMap.ended) || {}));
  return same;
}

/** 이름 맞대기(띄어쓰기·가운뎃점·쌍점·괄호는 빼고) */
const plainName = (s) => String(s || "").replace(/[\s·:()\-]/g, "");
/** 목록 과목 c 를 다른 이름의 과목(hit, 이름·번호가 바뀐 과목·대체 번호)으로 들었으면 그 이름 */
const tookName = (c, hit) => (hit && hit.code !== c.code && hit.name && plainName(hit.name) !== plainName(c.name) ? hit.name : null);
/** '…으로'·'…로': 끝 글자 받침(ㄹ 받침과 받침 없음은 '로'). 숫자는 읽는 소리로(0·3·6 '으로') */
export function josaRo(word) {
  const s = String(word || "").replace(/[\s)\]>」』"'.]+$/u, "");
  const ch = s.charAt(s.length - 1);
  const k = ch.charCodeAt(0) - 0xac00;
  if (k >= 0 && k < 11172) return k % 28 === 0 || k % 28 === 8 ? "로" : "으로";
  return /[036]/.test(ch) ? "으로" : "로";
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
 *   checked: true(졸업 요건 시트에서 체크한 과목, 학기·성적 없음)는 같은 과목의 다른 기록이 있으면 세지 않는다
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
  for (const [key, list0] of groups) {
    // 졸업 요건 시트에서 체크한 기록(checked: 학기·성적 모름, 11/16)은 같은 과목을 시간표·직접 넣은 기록으로 들었으면 세지 않는다
    // (재수강·대체 과목으로 잘못 보지 않게). 체크만 있으면 하나만 센다
    const real = list0.filter((x) => !x.checked);
    const list = real.length ? real : list0.slice(-1);
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

/** 요건 줄 하나에 적힌 과목(줄의 courses, 분야 extra.groups·갈래 extra.paths 의 courses) */
function rowCourses(r) {
  const e = r.extra || {};
  return [...(r.courses || []), ...[...(e.groups || []), ...(e.paths || [])].flatMap((g) => g.courses || [])];
}

/** 요건 줄(교양 줄이면 ge = true, 아니면 전공 쪽)에 적힌 과목 번호 */
function requirementCodes(version, ge = false) {
  const s = new Set();
  for (const r of (version && version.requirements) || []) {
    if ((r.type === "ge") !== ge) continue;
    for (const c of rowCourses(r)) {
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

const ROW_STOP = new Set(["표", "총", "합"]); // 줄 이름이 될 수 없는 앞말 → 종류 이름
const ROW_MAP = { "등록": "등록 학기", "학기당": "학기당 수강 학점", "유형별": "유형별 과목군" }; // 너무 짧은 앞말
/**
 * 요건 줄 이름(짧게). 자료에 이름(name)이 있으면 그것(requirements_import.py ROW_NAMES), 없으면 자료 글의 앞부분
 * ('전공필수 15과목 46학점' → '전공필수', '외국어진행강좌(…) 3과목' → '외국어진행강좌'), 길거나 숫자로 시작하면 종류 이름.
 * update117(프론트엔드 11/15 '줄 이름 정리'): '표 1 …'의 표 번호, 낱말에 붙은 숫자('제2외국어')는 살리고 띄어 쓴 숫자부터 자름, 따옴표·끝 마침표·물음표,
 * 끝 토씨(' 중'·'…에서'·'전공은'), 줄임말(전선 → 전공선택, 전필 → 전공필수), 졸업 논문 줄의 학과 이름 앞말, 복수전공·부전공 전체 줄은 '… 전체 학점'
 */
export function rowName(req) {
  if (req && typeof req.name === "string" && req.name.trim()) return req.name.trim();
  const text = String((req && req.text) || ""), type = req && req.type;
  const head = text.replace(/^\[\d-\d\]\s*/, "").replace(/^표\s*\d+\s*/, "").replace(/^\[([^\]]{1,8})\]\s*/, "$1 ").split(/[:：(（—]/)[0];
  let t = head.replace(/[A-Z]?\d{3,4}\.[0-9A-Z]+/g, " ").replace(/(^|\s)[\d?？].*$/, "").replace(/[?？].*$/, "");
  t = t.replace(/^['"‘’“”\s]+/, "").replace(/[\s,·→.'"‘’“”]+$/, "").trim(); // 「」는 짝이라 그대로
  t = t.replace(/^(.+?(?:과목|전공|학점))(?:은|는)\s.+$/, "$1"); // '교양 체육 과목은 졸업학점' → '교양 체육 과목'
  for (let i = 0; i < 2; i++) t = t.replace(/\s+(?:는|은|이|가|을|를|의|와|과|및|중|에서|에)$/, "").trim();
  t = t.replace(/(\S)에서$/, "$1").replace(/(전공|과목|교과목|영역|학점)(?:은|는)$/, "$1");
  t = t.replace(/(^|\s)전선(?=\s|$)/g, "$1전공선택").replace(/(^|\s)전필(?=\s|$)/g, "$1전공필수").replace(/\s+/g, " ").trim();
  if (type === "thesis") t = t.replace(/^\S.*?(학위논문연구|학사논문연구)$/, "$1"); // '생명과학학위논문연구' → '학위논문연구'
  const whole = type === "double" ? "복수전공" : type === "minor" ? "부전공" : null;
  if (whole && /[:：]/.test(text) && text.split(/[:：]/)[0].includes(whole) && (t === whole || t.length > 14 || /^(타|다른)\s/.test(t))) return `${whole} 전체 학점`;
  if (ROW_MAP[t]) return ROW_MAP[t];
  if (!t || t.length > 14 || ROW_STOP.has(t)) return TYPE_NAME[type] || "요건";
  return t;
}

/**
 * 요건 줄마다 충족(met) · 남음(remaining) · 확인 필요(check, reason).
 * 디자인 124판: 대체 관계 과목을 둘 다 들었거나(tidyRecords 의 substituted) 들은 과목 하나가 셀 수 있는 줄 여럿에 걸리면 그 줄은 확인 필요.
 * 다만 한 줄의 과목 목록이 다른 줄 목록 안에 다 들면(큰 요건 안의 작은 요건: '과학 16학점' 안의 '생물학 1·2') 두 줄에 같이 세는 것이 규정이라 그대로 둔다.
 */
export function evaluateProgram(program, version, courses, { role = "single", sameCourse = (c) => c, areas = null, entryYear = null } = {}) {
  version = rowsForEntry(version, entryYear); // 입학 연도로 나눈 교양 줄(update128)
  const got = new Map(); // 대표 번호 → 과목
  for (const c of courses) if (!c.failed) got.set(c.key || sameCourse(c.code), c);
  const rows = [], hitsOf = new Map(); // 대표 번호 → 그 과목을 센 줄들(셀 수 있는 줄만)
  const keysOf = new Map(); // 줄 → 목록 과목의 대표 번호들
  const later = []; // 분야·갈래 줄: 다른 줄을 다 센 뒤 센다(다른 줄이 센 과목을 알아야 해서)
  for (const r of version.requirements || []) {
    if ((r.applies_to || []).length && !r.applies_to.includes(role)) continue;
    const row = { id: r.id, type: r.type, name: rowName(r), text: r.text, status: r.status, note: r.note || null, src: r.src || [] };
    if (r.same_as) { // 공통 '졸업 평점'과 같은 줄(update127, 학과의 '전체·전공 평점 2.0 이상'): gradView 가 그 줄 값을 그대로 쓴다
      Object.assign(row, { state: "check", reason: SAME_GPA, sameAs: r.same_as, have: { count: 0, credits: 0, codes: [] }, need: { count: null, credits: null },
        taken: [], all: [] });
      rows.push(row);
      continue;
    }
    const kind = structuredKind(r);
    if (kind) {
      later.push([row, r, kind]);
      rows.push(row);
      continue;
    }
    const why = autoReason(r);
    const matched = [], missing = [];
    for (const c of r.courses || []) {
      const keys = [c.code, ...(c.alt_codes || [])].map(sameCourse);
      const hit = keys.map((k) => got.get(k)).find(Boolean);
      if (hit) {
        matched.push({ code: c.code, name: c.name, credits: Number(hit.earned) || 0, term: hit.term, key: hit.key || sameCourse(hit.code),
          substituted: Boolean(hit.substituted), checked: Boolean(hit.checked), took: tookName(c, hit) });
      } else {
        missing.push({ code: c.code, name: c.name, credits: c.credits ?? null });
      }
    }
    row.have = { count: matched.length, credits: matched.reduce((s, x) => s + x.credits, 0), codes: matched.map((x) => x.code) };
    // 학점으로만 적었지만 목록을 다 들어야 하는 줄('필수전선 6학점: 이론 1·2, 국악분석')은 과목 수도 기준으로: '2과목 남음'(update129)
    const list = r.courses || [];
    const allOf = r.min_count == null && r.min_credits != null && list.length > 0 && list.every((c) => c.credits != null)
      && list.reduce((s, c) => s + Number(c.credits), 0) === r.min_credits;
    row.need = { count: allOf ? list.length : r.min_count, credits: r.min_credits };
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
  const inside = (a, b) => [...a].every((k) => b.has(k));
  for (const list of hitsOf.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [keysOf.get(list[i]), keysOf.get(list[j])];
        if (!inside(a, b) && !inside(b, a)) { toCheck(list[i], SHARED_COURSE); toCheck(list[j], SHARED_COURSE); }
      }
    }
  }
  for (const [row, r, kind] of later) {
    const mine = new Set(rowCourses(r).flatMap((c) => [c.code, ...(c.alt_codes || [])].map(sameCourse)));
    // 이 줄과 다른 줄이 함께 센 과목 가운데 다시 세도 되는지 모르는 것: 종류가 다른 줄(전필로 쓴 과목을 분야 전선에서 다시 세는지 같은 것.
    // bio-dist 'note: 전필로 쓴 4과목은 다시 세지 않는다')이나, 한쪽 목록이 다른 쪽을 다 품지 않는 줄이 센 과목
    const apart = (o) => KIND[o.type] !== KIND[r.type] || (!inside(mine, keysOf.get(o)) && !inside(keysOf.get(o), mine));
    const shared = new Set([...hitsOf].filter(([, list]) => list.some(apart)).map(([k]) => k));
    if (kind === "groups") evaluateGroups(r, row, got, shared, sameCourse, areas);
    else if (kind === "sum") evaluateSum(r, row, courses, { program, version, role, sameCourse });
    else evaluatePaths(r, row, got, sameCourse, version);
    if (row.state !== "check" && (row.taken || []).some((m) => m.substituted)) {
      row.left = row.missing || [];
      delete row.missing;
      Object.assign(row, { state: "check", reason: SUBSTITUTED });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- 분야·갈래 줄(11/16 졸업 요건 체크박스, 프론트엔드 요청)

const GROUP_KEYS = new Set(["groups", "not_counted", "min_groups", "min_areas", "min_in_one_group", "group"]);
// 줄 종류의 갈래: 같은 갈래끼리는 목록이 품고 품기면 함께 센다(전선 총학점과 분야별 전선). 갈래가 다르면 함께 센 과목을 '겹침'으로 본다
const KIND = { major_required: "required", major_elective: "elective", distribution: "elective", major_choose: "elective", ge: "ge",
  double: "double", minor: "minor", thesis: "thesis", other: "other" };
const NO_LIST = "과목 목록이 없는 조건";
export const COND = "조건부 요건"; // 기준은 채웠지만 학생이 아는 조건(입학 때 TEPS 점수, 진단평가 면제 등)에 따라 더 필요할 수 있다(update127)
export const SAME_GPA = "졸업 평점과 같은 조건";

/** 분야(extra.groups)·갈래(extra.paths)로 셀 수 있는 줄인가: 자료가 '확인'이고 extra 에 그 둘과 셈에 쓰는 값만 있다(다른 문장형 조건이 섞이면 그대로 '확인 필요') */
function structuredKind(r) {
  if (r.status !== "확인") return null;
  if (r.sum && typeof r.sum === "object" && (r.min_credits != null || Object.keys(r.sum.by_role || {}).length)) return "sum"; // 학점 합 줄(update127)
  const e = r.extra;
  if (!e) return null;
  const keys = Object.keys(e);
  if (Array.isArray(e.groups) && e.groups.length && keys.every((k) => GROUP_KEYS.has(k))) return "groups";
  if (Array.isArray(e.paths) && e.paths.length && keys.length === 1 && r.min_count != null) return "paths";
  return null;
}

/** 분야·갈래의 과목: courses, 없으면 codes(줄의 과목에서 이름·학점을 찾고 없으면 번호만). 목록이 없으면(번호 앞자리·이름만) null */
function listOf(g, own, areas = null) {
  if (Array.isArray(g.courses)) return g.courses;
  if (Array.isArray(g.codes)) return g.codes.map((code) => own.get(code) || areaCourse(areas, code) || { code, name: null, credits: null });
  // 번호 앞자리가 곧 영역인 교양(update127): 앞자리로 센다(prefixHits). 영역 과목 표(ge_areas.json, update128)가 있으면 그 영역의 과목을 목록으로(시트에 영역마다 과목)
  if (Array.isArray(g.prefixes) && g.prefixes.length) return areaList(areas, g.prefixes);
  return null;
}

/** 영역 과목 표(data/requirements/ge_areas.json `{areas: {'C10.': {name, courses}}}`)에서 앞자리들의 과목(번호 한 번씩). 표가 없으면 빈 목록 */
export function areaList(areas, prefixes) {
  const out = [], seen = new Set();
  for (const p of prefixes || []) {
    for (const c of ((areas && areas.areas && areas.areas[p]) || {}).courses || []) {
      if (seen.has(c.code)) continue;
      seen.add(c.code);
      out.push(c);
    }
  }
  return out;
}
function areaCourse(areas, code) {
  const a = areas && areas.areas && areas.areas[`${String(code).split(".")[0]}.`];
  return (a && (a.courses || []).find((c) => c.code === code)) || null;
}

/**
 * 번호 앞자리 분야(g.prefixes, update127)에 드는 들은 과목. 번호나 대표 번호가 앞자리로 시작하면 든다: 2025 새 교양(C10·F21·V10…)은 번호로,
 * 옛 교양(041·L0545…)은 대표 번호(교양 대응표의 2024 번호)로도 봐서 옛 학번이 새 번호로 들은 같은·대체 과목은 옛 영역에 든다(학부대학 '입학년도 이수규정 기준',
 * 인문대학 공지 2026-08-07). 대응이 없는 새 과목은 옛 영역에 들지 않고 교양 학점으로만 센다. skip(셀 수 없는 대표 번호)·have(이미 센 것)는 뺀다
 */
function prefixHits(g, got, skip, have) {
  const pre = g.prefixes || [];
  const out = [];
  if (!pre.length) return out;
  for (const [key, hit] of got) {
    if (have.has(key) || (skip && skip.has(key))) continue;
    if (!pre.some((p) => String(hit.code).startsWith(p) || String(key).startsWith(p))) continue;
    out.push({ code: hit.code, name: hit.name || null, credits: Number(hit.earned) || 0, term: hit.term ?? null, key,
      substituted: Boolean(hit.substituted), checked: Boolean(hit.checked) });
  }
  return out;
}

/** 목록에서 들은 과목(대표 번호 한 번씩). skip: 세지 않는 대표 번호 */
function takenIn(list, got, sameCourse, skip = null) {
  const out = [], seen = new Set();
  for (const c of list) {
    const keys = [c.code, ...(c.alt_codes || [])].map(sameCourse);
    if (skip && keys.some((k) => skip.has(k))) continue;
    const k = keys.find((x) => got.has(x));
    if (!k) continue;
    const hit = got.get(k);
    const key = hit.key || sameCourse(hit.code);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: c.code, name: c.name, credits: Number(hit.earned) || 0, term: hit.term ?? null, key,
      substituted: Boolean(hit.substituted), checked: Boolean(hit.checked), took: tookName(c, hit) });
  }
  return out;
}

const sumCredits = (xs) => xs.reduce((s, x) => s + x.credits, 0);
const notTaken = (list, taken) => (list || []).filter((c) => !taken.some((x) => x.code === c.code))
  .map((c) => ({ code: c.code, name: c.name, credits: c.credits ?? null }));

/** 분야 기준 글: '1과목 이상'·'3학점 이상'·'2과목·6학점 이상'. 기준이 없으면 null */
function needText(g) {
  const parts = [g.min_count != null ? `${g.min_count}과목` : null, g.min_credits != null ? `${g.min_credits}학점` : null].filter(Boolean);
  return parts.length ? `${parts.join("·")} 이상` : null;
}

/** 기준(min_count·min_credits)에 모자란 것: 학점 먼저. 다 찼으면 null */
function shortOf(min, xs, per = 3) {
  return leftOf({ credits: min.min_credits ?? null, count: min.min_count ?? null }, { credits: sumCredits(xs), count: xs.length }, per);
}

/**
 * 기준 need {credits, count}에 모자란 것 {unit, left}. 다 찼으면 null. 둘 다 모자라면 남은 과목 수가 남은 학점을 채우는 데 드는 과목 수
 * (한 과목 per 학점으로 쳐서 올림)보다 적지 않을 때 과목으로 센다(update129, 사용자 11/17 '3학점이면 강의 하나로 착각할 수 있으니까': '6학점 남음'보다 '2과목 남음')
 */
function leftOf(need, have, per = 3) {
  const credits = need.credits != null ? Math.max(0, need.credits - have.credits) : 0;
  const count = need.count != null ? Math.max(0, need.count - have.count) : 0;
  if (count > 0 && count >= Math.ceil(credits / per)) return { unit: "과목", left: count };
  if (credits > 0) return { unit: "학점", left: credits };
  return null;
}

/** 아직 안 들은 과목 한 과목의 학점(가장 큰 것, 모르면 3). 남은 학점이 적어도 몇 과목인지 셀 때 */
function perCourse(list) {
  const xs = (list || []).map((c) => Number(c.credits) || 0).filter((x) => x > 0);
  return xs.length ? Math.max(...xs) : 3;
}

/**
 * 분야 줄(extra.groups). got: 대표 번호 → 들은 과목, shared: 다른 줄과 함께 센 과목(그 줄 목록이 이 줄을 다 품지 않는 것).
 * 분야마다 엄격(shared 와 두 분야에 함께 든 과목을 빼고)·느슨(다 넣고)으로 센다. 과목 목록이 없는 분야(번호 앞자리·이름만)는
 * 엄격엔 못 채움, 느슨엔 채움으로 본다. 조건: 줄의 min_count·min_credits(분야 과목을 한 번씩 모아), 분야마다 제 기준
 * (min_groups·min_areas 가 없으면 기준이 있는 분야 모두), min_groups·min_areas(채운 분야 수, 기준이 없는 분야는 1과목 이상),
 * min_in_one_group(한 분야에서 그만큼). not_counted 는 세지 않는다.
 * 엄격으로 다 채우면 met, 느슨으로도 모자라면 remaining, 그 사이는 확인 필요(목록 없는 분야가 있으면 그 까닭, 아니면 SHARED_COURSE).
 * update127(사용자 11/16 '조사 안 된 것들 다 목록으로'): 분야의 prefixes(번호 앞자리가 곧 영역인 교양)는 prefixHits 로 센다.
 * area(교양 영역 분야)는 추천 과목에 넣지 않고(수백 과목) 줄 기준이 목록을 넘는지 보지 않는다. cond(조건부 분야: '입학 때 TEPS 900점 이하이면 영어 1과목')는
 * 기준·겹침에 넣지 않고, 다른 기준을 다 채웠는데 그 분야를 못 채웠으면 확인 필요(COND, because = cond 글).
 * also(덧붙은 조건 분야: '그중 중급 이상 1과목'·'권장과목(★) 1과목')는 다른 분야와 겹쳐도 되는 부분 조건이라 겹침·합에 넣지 않고, 못 채우면 남음
 * row.groups = [{name, need, value: {kind: met|left|check|count, text}, codes}](시트의 분야 소제목 값. count 는 기준 없는 분야의 들은 수)
 */
function evaluateGroups(r, row, got, shared, sameCourse, areas = null) {
  const e = r.extra;
  const own = new Map((r.courses || []).map((c) => [c.code, c]));
  const skip = new Set((e.not_counted || []).flatMap((c) => [c.code, ...(c.alt_codes || [])].map(sameCourse)));
  const minGroups = e.min_groups ?? e.min_areas ?? null;
  const oneGroup = e.min_in_one_group ?? null;
  const lists = e.groups.map((g) => listOf(g, own, areas));
  const hits = e.groups.map((g, i) => {
    const listed = lists[i] ? takenIn(lists[i], got, sameCourse, skip) : [];
    return listed.concat(prefixHits(g, got, skip, new Set(listed.map((x) => x.key))));
  });
  const inGroups = new Map(); // 대표 번호 → 그 과목이 든 분야 수(조건부 분야는 빼고)
  e.groups.forEach((g, i) => {
    if (g.cond || g.also) return;
    for (const k of new Set(hits[i].map((x) => x.key))) inGroups.set(k, (inGroups.get(k) || 0) + 1);
  });
  const every = e.groups.map((g, i) => {
    const list = lists[i];
    const taken = hits[i];
    const strict = taken.filter((x) => !shared.has(x.key) && (inGroups.get(x.key) || 0) < 2);
    const hasMin = g.min_count != null || g.min_credits != null;
    const okStrict = list ? (hasMin ? !shortOf(g, strict) : strict.length > 0) : false;
    const okLoose = list ? (hasMin ? !shortOf(g, taken) : taken.length > 0) : true;
    return { g, list, taken, strict, hasMin, okStrict, okLoose };
  });
  const groups = every.filter((G) => !G.g.cond && !G.g.also), conds = every.filter((G) => G.g.cond), alsos = every.filter((G) => G.g.also);
  const wide = (G) => Boolean(G.g.area) || (G.g.prefixes || []).length > 0; // 교양 영역: 추천에 안 넣고 목록 끝을 따지지 않는다
  // 교양 영역을 세는 줄(min_areas, 분야가 모두 교양 영역)은 '영역'으로 센다: '1영역 남음'·'1 / 3영역'·'3영역 중 2영역'(프론트엔드 11/17, 디자인 s1-screens)
  const word = e.min_areas != null || (groups.length > 0 && groups.every((G) => G.g.area)) ? "영역" : "분야";
  const perOf = (G) => perCourse(notTaken(G.list, G.taken)); // 그 분야에서 아직 안 들은 과목 한 과목의 학점
  const union = (pick) => {
    const m = new Map();
    for (const G of groups) for (const x of pick(G)) m.set(x.key, x);
    return [...m.values()];
  };
  const loose = union((G) => G.taken), strict = union((G) => G.strict);
  const unlisted = groups.some((G) => !G.list);
  // 줄 기준(학점·과목 수)이 분야 목록을 다 들어도 닿지 않으면 목록 밖 과목까지 세는 기준이다(부전공 21학점 가운데 물리화학 1 같은 것): 셀 수 없다
  const capacity = union((G) => (G.list || []).map((c) => ({ key: sameCourse(c.code), credits: Number(c.credits) || 0 })));
  const beyond = !groups.some(wide) && ((r.min_credits != null && sumCredits(capacity) < r.min_credits) || (r.min_count != null && capacity.length < r.min_count));
  const totalUnknown = unlisted || beyond;
  const counted = groups.filter((G) => G.hasMin || !G.list); // min_groups 가 없을 때 저마다 채워야 하는 분야
  const fields = (ok) => (minGroups != null ? groups.filter(ok).length : counted.filter(ok).length);
  const fieldsNeed = minGroups != null ? minGroups : counted.length;
  const most = (pick) => Math.max(0, ...groups.filter((G) => G.list).map((G) => pick(G).length));
  const pass = (isLoose) => {
    const all = isLoose ? loose : strict;
    if (totalUnknown ? !isLoose && (r.min_credits != null || r.min_count != null) : shortOf(r, all)) return false;
    if (fields((G) => (isLoose ? G.okLoose : G.okStrict)) < fieldsNeed) return false;
    if (oneGroup != null && !(isLoose && unlisted) && most((G) => (isLoose ? G.taken : G.strict)) < oneGroup) return false;
    return true;
  };
  const strictOk = pass(false), looseOk = pass(true);
  row.state = strictOk ? "met" : looseOk ? "check" : "remaining";
  if (row.state === "check") row.reason = totalUnknown && !groups.some((G) => G.list && G.okLoose && !G.okStrict) ? NO_LIST : SHARED_COURSE;
  const condMiss = conds.find((G) => !G.list || !G.okLoose); // 목록 없는 조건부 분야는 늘 학생이 확인
  if (row.state === "met" && condMiss) Object.assign(row, { state: "check", reason: COND, because: condMiss.g.cond });
  const alsoMiss = alsos.filter((G) => G.list && !G.okLoose);
  if (alsoMiss.length && row.state !== "remaining") { // 덧붙은 조건을 못 채우면 나머지가 다 찼어도 남음
    const sh = shortOf(alsoMiss[0].g, alsoMiss[0].taken, perOf(alsoMiss[0])) || { unit: "과목", left: 1 };
    Object.assign(row, { state: "remaining", alsoShort: { ...sh, name: alsoMiss[0].g.name || "" } });
    delete row.reason;
    delete row.because;
  }
  const shown = row.state === "met" ? strict : loose;
  row.have = { count: shown.length, credits: sumCredits(shown), codes: shown.map((x) => x.code) };
  row.need = { count: r.min_count ?? null, credits: r.min_credits ?? null };
  row.taken = loose;
  row.all = [];
  row.groups = every.map((G) => {
    let value;
    if (G.g.cond) value = G.list && G.okLoose ? { kind: "met", text: "충족" } : { kind: "check", text: "확인 필요" };
    else if (G.g.also && !G.list) value = { kind: "check", text: "확인 필요" };
    else if (!G.list) value = { kind: "check", text: "확인 필요" };
    else if (!G.hasMin) value = { kind: "count", text: `${G.taken.length}과목` };
    else if (G.okStrict) value = { kind: "met", text: "충족" };
    else if (!G.okLoose) {
      const sh = shortOf(G.g, G.taken, perOf(G));
      value = { kind: "left", unit: sh.unit, left: sh.left, text: `${sh.left}${sh.unit} 남음` };
    } else value = { kind: "check", text: "확인 필요" };
    // 시트의 분야(update128, 사용자 11/16 '영역이 나뉘면 영역 다 나눠줘야지… 최대한 정보를 다 넣어'): 영역 과목 목록(들은 것 먼저), 조건부·덧붙은 조건 글
    const took = new Set(G.taken.map((x) => x.key));
    const list = (G.list || []).slice().sort((a, b) => Number(took.has(sameCourse(b.code))) - Number(took.has(sameCourse(a.code))));
    const extra = G.taken.filter((x) => !list.some((c) => sameCourse(c.code) === x.key)).map((x) => ({ code: x.code, name: x.name, credits: x.credits }));
    return { name: G.g.name || G.g.field || "", need: needText(G.g), value, codes: G.taken.map((x) => x.code), courses: [...extra, ...list],
      ...(G.g.cond ? { cond: G.g.cond } : {}), ...(G.g.also ? { also: true } : {}), ...(G.g.area ? { area: true } : {}) };
  });
  // 남은 과목(추천): 줄 기준이 모자라면 모든 분야의, 아니면 못 채운 분야의 안 들은 과목(교양 영역 분야는 빼고)
  const rowShort = totalUnknown ? null : shortOf(r, loose);
  const open = rowShort ? groups.filter((G) => G.list && !wide(G)) : groups.filter((G) => G.list && !G.okLoose && !wide(G));
  const left = [];
  for (const G of open) for (const c of notTaken(G.list, G.taken)) if (!left.some((x) => x.code === c.code)) left.push(c);
  // 센 값 {have, need, unit}(줄 앞 동그라미·시트 상태 칸, 프론트엔드 141판). 충족은 엄격, 그 밖은 느슨하게 센 것으로
  const met = row.state === "met";
  const inG = (G) => (met ? G.strict : G.taken), okG = (G) => (met ? G.okStrict : G.okLoose), all = met ? strict : loose;
  const totals = (unit) => {
    if (totalUnknown) return null;
    if (unit === "학점" && r.min_credits != null) return { have: sumCredits(all), need: r.min_credits, unit };
    if (unit === "과목" && r.min_count != null) return { have: all.length, need: r.min_count, unit };
    return null;
  };
  // 분야마다 기준: 모두 과목 수뿐(또는 모두 학점뿐)이면 분야마다 기준까지만 더하고(생물다양성 1과목 남음 → 2 / 3과목), 아니면 채운 분야 수
  const byFields = () => {
    if (minGroups != null) return { have: fields(okG), need: minGroups, unit: word };
    if (!counted.length) return null;
    const only = (a, b) => counted.every((G) => G.list && G.g[a] != null && G.g[b] == null);
    if (only("min_count", "min_credits")) {
      return { have: counted.reduce((s, G) => s + Math.min(inG(G).length, G.g.min_count), 0), need: counted.reduce((s, G) => s + G.g.min_count, 0), unit: "과목" };
    }
    if (only("min_credits", "min_count")) {
      return { have: counted.reduce((s, G) => s + Math.min(sumCredits(inG(G)), G.g.min_credits), 0), need: counted.reduce((s, G) => s + G.g.min_credits, 0), unit: "학점" };
    }
    return { have: counted.filter(okG).length, need: counted.length, unit: word };
  };
  const inOne = () => (oneGroup != null ? { have: most(inG), need: oneGroup, unit: "과목" } : null);
  if (row.state === "remaining") {
    // 남은 것(update129, 사용자 11/17 '4분야 중 3분야를 수강해야 하는데 1분야만 수강했잖아… 3학점이면 강의 하나로 착각할 수 있으니까').
    // 줄 학점·과목 수만 보면 과목 수를 적게 짐작하는 조건(영역·분야 수, 분야마다 기준, 덧붙은 조건, 한 분야에서 몇 과목)이 남았으면 그 조건을 보인다.
    // 그 조건을 채우는 데 드는 과목 수보다 줄 학점·과목 수가 더 많은 과목을 요구하면 둘 다 보인다('1영역 · 5학점 남음')
    const onlyAlso = Boolean(row.alsoShort);
    row.missing = onlyAlso ? [] : left;
    delete row.alsoShort;
    const per = perCourse(groups.flatMap((G) => notTaken(G.list, G.taken)));
    const courses = (sh) => (sh.unit === "학점" ? Math.ceil(sh.left / per) : sh.left); // 적어도 몇 과목
    const tot = totalUnknown ? null : shortOf(r, loose, per);
    const totCourses = tot ? Math.max(r.min_count != null ? Math.max(0, r.min_count - loose.length) : 0,
      r.min_credits != null ? Math.ceil(Math.max(0, r.min_credits - sumCredits(loose)) / per) : 0) : 0;
    const lacking = counted.filter((G) => G.list && !G.okLoose);
    const shorts = lacking.map((G) => shortOf(G.g, G.taken, perOf(G))).filter(Boolean);
    const also = alsos.find((G) => G.list && !G.okLoose);
    const done = fields((G) => G.okLoose);
    let s = null; // 남은 조건 {unit, left, text?, courses(적어도 몇 과목), summary, progress}
    if (minGroups != null && done < minGroups) {
      const k = minGroups - done;
      s = { unit: word, left: k, courses: k, summary: `${minGroups}${word} 중 ${done}${word} · ${k}${word} 남음`, progress: byFields() };
    } else if (minGroups == null && shorts.length) {
      // 분야마다 모자란 것: 단위가 같으면 더하고(생물다양성 1과목 → '1과목 남음'), 다르면 분야 수로
      // 교양 영역마다 한 과목씩 남았으면 영역 수로('문화 해석과 상상 3 · 역사적 탐구 3'에서 하나만 들으면 '6학점' 말고 '2영역 남음')
      const oneEach = word === "영역" && lacking.every((G) => !G.taken.length) && shorts.every((x) => courses(x) === 1);
      const unit = oneEach ? word : shorts.every((x) => x.unit === shorts[0].unit) ? shorts[0].unit : null;
      const k = unit && !oneEach ? shorts.reduce((t, x) => t + x.left, 0) : lacking.length, u = unit || word;
      s = { unit: u, left: k, courses: shorts.reduce((t, x) => t + courses(x), 0),
        summary: `${lacking.map((G) => G.g.name || G.g.field).filter(Boolean).join(" · ")} · ${k}${u} 남음`, progress: byFields() };
    } else if (also) {
      const sh = shortOf(also.g, also.taken, perOf(also)) || { unit: "과목", left: 1 };
      s = { ...sh, courses: courses(sh), summary: `${also.g.name || ""} · ${sh.left}${sh.unit} 남음`, progress: null };
    } else if (oneGroup != null && most((G) => G.taken) < oneGroup) {
      const k = oneGroup - most((G) => G.taken);
      s = { unit: "과목", left: k, text: `한 분야에서 ${k}과목 남음`, courses: k, summary: null, progress: inOne() };
    }
    if (s && also && !s.summary?.startsWith(`${also.g.name || ""} · `)) { // 덧붙은 조건도 남았으면 합 글에(전에는 빠졌다): '… · 중급 이상 1과목 포함'
      const sh = shortOf(also.g, also.taken, perOf(also)) || { unit: "과목", left: 1 };
      s.summary = `${s.summary || s.text || `${s.left}${s.unit} 남음`} · ${also.g.name || "덧붙은 조건"} ${sh.left}${sh.unit} 포함`;
    }
    if (s && (!tot || s.courses >= totCourses)) {
      row.short = { unit: s.unit, left: s.left, ...(s.text ? { text: s.text } : {}) };
      if (s.summary) row.summaryText = s.summary;
      row.progress = s.progress || totals(r.min_credits != null ? "학점" : "과목") || byFields();
    } else if (s) { // 줄 학점(과목 수)이 더 많은 과목을 요구: 값은 그것으로, 남은 조건은 합 글에
      const head = s.text ? s.text.replace(/ 남음$/, "") : `${s.left}${s.unit}`;
      const [need, have] = tot.unit === "학점" ? [r.min_credits, sumCredits(loose)] : [r.min_count, loose.length];
      // 어느 영역·분야에서 들을지가 남았으면 값에도 함께('1영역 · 5학점 남음'). 분야 과목 수·덧붙은 조건은 줄 학점을 채우다 같이 채워져 값에서는 뺀다('1과목 · 4학점' 말고 '4학점')
      const spread = s.unit === "영역" || s.unit === "분야";
      row.short = { unit: tot.unit, left: tot.left, ...(spread ? { text: `${head} · ${tot.left}${tot.unit} 남음` } : {}) };
      row.summaryText = `${s.summary || head} · ${need}${tot.unit} 중 ${have}${tot.unit}`;
      row.progress = totals(tot.unit);
    } else if (tot) {
      row.short = tot;
      row.progress = totals(tot.unit);
    } else {
      const k = Math.max(1, (oneGroup || 1) - most((G) => G.taken));
      row.short = { unit: "과목", left: k, text: `한 분야에서 ${k}과목 남음` };
      row.progress = inOne();
    }
    if (onlyAlso && !row.progress) row.progress = byFields();
  } else {
    if (row.state === "check" && left.length) row.left = left;
    row.progress = totals(r.min_credits != null ? "학점" : "과목") || byFields() || inOne();
  }
}

/**
 * 학점 합 줄(r.sum, update127): 교양 N학점 이상(of: "ge", 교과구분 교양), 전공 학점·전공선택 학점(of: "major", 이 과정의 전공 과목, cls 로 전필·전선을 가름),
 * 교직 22학점(of: "cls", cls: ["교직"]). after: 그만큼 뺀 나머지(자유 선택 = 교양 합 − 영역 학점). by_role: 단일·병행·복수 기준이 다를 때.
 * floor·cond: 학생이 아는 조건에 따라 기준이 낮아지면(진단평가 면제 46 → 최소 36) floor 이상 기준 미만은 확인 필요(because = cond).
 * 과목 목록은 없다(row.all·taken 빈 목록). 센 값은 학점
 */
function evaluateSum(r, row, courses, { program, version, role, sameCourse }) {
  const s = r.sum;
  const pick = (c) => {
    if (c.failed) return false;
    if (s.of === "ge") return c.cls === "교양";
    if (s.of === "cls") return (s.cls || []).includes(c.cls);
    if (s.of === "major") return isMajorCourse(c, program, version, sameCourse) && (!s.cls || s.cls.includes(c.cls));
    return true;
  };
  const xs = courses.filter(pick);
  const have = Math.max(0, xs.reduce((t, c) => t + (Number(c.earned) || 0), 0) - (Number(s.after) || 0));
  const need = s.by_role && s.by_role[role] != null ? s.by_role[role] : r.min_credits;
  row.have = { count: xs.length, credits: have, codes: [] };
  row.need = { count: null, credits: need ?? null };
  // 센 과목을 시트에 보인다(update128 '최대한 정보를'): 교양 학점·전공 학점의 과목들. 자유 선택(after)은 영역 몫을 뺀 나머지라 과목을 가르지 않는다
  const shown = s.after ? [] : xs.map((c) => ({ code: c.code, name: c.name || c.code, credits: Number(c.earned) || 0, term: c.term ?? null, key: c.key || sameCourse(c.code),
    checked: Boolean(c.checked) }));
  row.taken = shown;
  row.all = shown.map((c) => ({ code: c.code, name: c.name, credits: c.credits }));
  if (need == null) {
    Object.assign(row, { state: "check", reason: "기준 수가 없는 조건", progress: null });
    return;
  }
  row.progress = { have, need, unit: "학점" };
  if (have >= need) row.state = "met";
  else if (s.floor != null && have >= s.floor) Object.assign(row, { state: "check", reason: COND, because: s.cond || null });
  else Object.assign(row, { state: "remaining", short: { unit: "학점", left: need - have } });
}

/**
 * 갈래 줄(extra.paths, '(1)·(2)·(3) 중 택 1'): 한 갈래의 과목을 다 들으면 그 갈래를 채운다. 채운 갈래가 min_count 이상이면 met.
 * 아니면 remaining(남은 과목이 가장 적은 갈래로 'N과목 남음'). 같은 판에 기준 없는 갈래 줄(대체 허용, bio-ge-alt)이 있고
 * 그 갈래를 다 들었으면 확인 필요. row.paths = [{name, value}](시트의 갈래 소제목 값)
 */
function evaluatePaths(r, row, got, sameCourse, version) {
  const own = new Map((r.courses || []).map((c) => [c.code, c]));
  const paths = r.extra.paths.map((p) => {
    const list = listOf(p, own) || [];
    const taken = takenIn(list, got, sameCourse);
    const missing = notTaken(list, taken);
    return { p, list, taken, missing, done: list.length > 0 && missing.length === 0 };
  });
  const done = paths.filter((x) => x.done);
  const all = new Map();
  for (const x of paths) for (const m of x.taken) all.set(m.key, m);
  row.taken = [...all.values()];
  row.all = [];
  row.need = { count: r.min_count, credits: null };
  row.have = { count: row.taken.length, credits: sumCredits(row.taken), codes: row.taken.map((x) => x.code) };
  row.paths = paths.map((x) => ({ name: x.p.name, value: x.done ? { kind: "met", text: "충족" }
    : { kind: "left", unit: "과목", left: x.missing.length, text: `${x.missing.length}과목 남음` }, codes: x.taken.map((m) => m.code) }));
  const near = paths.filter((x) => x.list.length).sort((a, b) => a.missing.length - b.missing.length || b.taken.length - a.taken.length)[0];
  // 센 값(줄 앞 동그라미·시트 상태 칸): 다 들은 갈래, 아니면 남은 과목이 가장 적은 갈래의 과목 수
  const shown = done[0] || near;
  row.progress = shown ? { have: shown.taken.length, need: shown.list.length, unit: "과목" } : null;
  if (done.length >= r.min_count) {
    row.state = "met";
    row.summaryText = done.map((x) => x.p.name).join(" · ");
    return;
  }
  const altDone = (version.requirements || []).some((o) => o !== r && o.extra && Array.isArray(o.extra.paths) && o.min_count == null
    && o.extra.paths.some((p) => { const list = listOf(p, new Map()) || []; return list.length > 0 && takenIn(list, got, sameCourse).length === list.length; }));
  if (altDone || !near) {
    row.state = "check";
    row.reason = "여러 갈래·문장형 조건";
    if (near) row.left = near.missing;
    return;
  }
  row.state = "remaining";
  if (r.min_count > 1) { // 갈래를 둘 이상 채워야 하면(과학 '이론+실험 중 2과목', update127) 아직 못 채운 갈래 가운데 가까운 것부터 모자란 수만큼 더한다
    const want = r.min_count - done.length;
    const nearest = paths.filter((x) => !x.done && x.list.length)
      .sort((a, b) => a.missing.length - b.missing.length || b.taken.length - a.taken.length).slice(0, want);
    const miss = [];
    for (const x of nearest) for (const c of x.missing) if (!miss.some((m) => m.code === c.code)) miss.push(c);
    row.missing = miss;
    row.short = { unit: "과목", left: miss.length };
    row.summaryText = `${nearest.map((x) => x.p.name).join(" · ")} · ${miss.length}과목 남음`;
    const sizes = (xs) => xs.reduce((t, x) => t + x.list.length, 0);
    row.progress = { have: sizes(done) + nearest.reduce((t, x) => t + x.taken.length, 0), need: sizes(done) + sizes(nearest), unit: "과목" };
    return;
  }
  row.missing = near.missing;
  row.short = { unit: "과목", left: near.missing.length };
  row.summaryText = `${near.p.name} · ${near.missing.length}과목 남음`;
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
  // 덜 걷는 순(디자인 128판): 걷기 주 +n분 → 등교 +n일 → 강의실 미정 → 줄 없음(engine.fitRank 와 같다)
  const cost = (a, b) => { const x = fitRank(a.fit), y = fitRank(b.fit); return x[0] - y[0] || x[1] - y[1]; };
  return (suggestions || []).map((s) => ({ ...s, fit: byId.get(s.course.id) || null }))
    .sort((a, b) => maybe(a) - maybe(b) || (order === "walk"
      ? cost(a, b) || STRENGTH[a.strength] - STRENGTH[b.strength]
      : STRENGTH[a.strength] - STRENGTH[b.strength] || cost(a, b))
      || String(a.course.id).localeCompare(String(b.course.id)));
}

/**
 * 작년 편람으로 짜기(앱 previewExplore, 11/17 사용자 '동선 탐색의 결과화면으로')에 담을 과목. suggestions = suggestCourses 결과, picks = 거기 준 [{ program, rows }].
 * 요건 순(rankSuggestions: need → choose → maybe)으로 보며 담는다:
 *  - 그 과목이 채우는 줄 가운데 아직 남은 줄이 있을 때만(줄의 기준 need 에서 들은 것 have 를 뺀 과목 수·학점을 담을 때마다 줄인다.
 *    기준이 없으면 줄의 남은 양 row.short, 그것도 없으면 목록을 다)
 *  - 학기 학점 상한(cap)을 넘지 않게(exempt: 상한 밖 과목 번호 term_limit.exempt_codes 는 학점을 세지 않는다)
 *  - 담은 과목끼리 시간표가 하나라도 나오게(fits(courses): 앱은 engine.countFeasible. 겹쳐서 안 되는 과목은 건너뛴다)
 * 돌려주는 것: 담을 과목(편람 과목 그대로) 차례대로
 */
export function planTerm(suggestions, picks, { cap = 18, exempt = [], fits = () => true } = {}) {
  const left = new Map(); // 'program|row' → { count, credits }(null 은 그 단위의 기준 없음)
  for (const { program, rows } of picks || []) {
    for (const r of rows || []) {
      const n = r.need || {}, h = r.have || {};
      let a = n.count != null || n.credits != null
        ? { count: n.count != null ? n.count - (h.count || 0) : null, credits: n.credits != null ? n.credits - (h.credits || 0) : null } : null;
      if (!a && r.short && r.short.left > 0) a = r.short.unit === "학점" ? { count: null, credits: r.short.left } : { count: r.short.left, credits: null };
      if (a) left.set(`${program.id}|${r.id}`, a);
    }
  }
  const open = (k) => { const a = left.get(k); return !a || (a.count != null && a.count > 0) || (a.credits != null && a.credits > 0); };
  const free = new Set(exempt || []), out = [];
  let credits = 0;
  for (const s of rankSuggestions(suggestions)) {
    const c = s.course, cr = Number(c.credit) || 0, counted = free.has(c.id) ? 0 : cr;
    const keys = [...new Set((s.reasons || []).map((r) => `${r.program}|${r.row}`))];
    if (!keys.some(open)) continue; // 채우는 줄이 다 찼다
    if (credits + counted > cap || !fits([...out, c])) continue;
    out.push(c);
    credits += counted;
    for (const k of keys) {
      const a = left.get(k);
      if (!a) continue;
      if (a.count != null) a.count -= 1;
      if (a.credits != null) a.credits -= cr;
    }
  }
  return out;
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
 * 학기 평점(byTerm)은 재이수로 조정되기 전 그 학기 성적이고 계절은 뺀다. finalTerms 면 재수강으로 빠진 앞 수강을 학기 평점에서 뺀다
 * (11/16 사용자 '평점 계산도 재수강한 과목은 반영하지 말고').
 * 직전 두 학기(lastTwoRegular, 다음 학기 21학점 판단)는 finalTerms 와 상관없이 학사 규정대로 재수강으로 무효가 된 성적도 넣는다
 * (2026학년도 2학기 수강신청 안내 '직전 2개 학기 성적 중 재수강으로 무효가 된 성적도 평점계산에 합산', 계절·S/U 제외). retakes = 그런 성적 수.
 * isMajor(course) 를 주면 전공 평점도 낸다. 졸업은 전체·전공 모두 2.0 이상.
 */
export function gpa(records, { sameCourse = (c) => c, isMajor = null, finalTerms = false } = {}) {
  const tidy = tidyRecords(records, sameCourse);
  const final = tidy.courses.filter(graded);
  const all = average(final);
  const major = isMajor ? average(final.filter(isMajor)) : null;
  const gone = new Set(tidy.replaced.map((x) => x.index)); // 재수강으로 빠진 앞 수강(기록 차례)
  const terms = {}, shown = {}, voided = {};
  (records || []).forEach((r, i) => {
    if (!graded(r) || (isGraduate(r) && !r.toBachelor)) return;
    (terms[r.term] = terms[r.term] || []).push(r);
    if (gone.has(i)) voided[r.term] = (voided[r.term] || 0) + 1;
    if (!finalTerms || !gone.has(i)) (shown[r.term] = shown[r.term] || []).push(r);
  });
  const sorted = (o) => Object.entries(o).sort((a, b) => termOrder(a[0]) - termOrder(b[0]));
  const byTerm = Object.fromEntries(sorted(shown).map(([t, l]) => [t, average(l)]));
  const regular = sorted(terms).map(([t]) => t).filter(isRegularTerm);
  const lastTwo = regular.slice(-2);
  const lastTwoRegular = lastTwo.length
    ? { terms: lastTwo, ...average(lastTwo.flatMap((t) => terms[t])), retakes: lastTwo.reduce((s, t) => s + (voided[t] || 0), 0) }
    : { terms: [], gpa: null, credits: 0, retakes: 0 };
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
/** 그 학기 편람이 있나(semesters.json 의 list). 앱이 작년 편람으로 미리 짜려고 넣은 [학기, 파일, 작년 학기] 칸(셋째 칸)은 편람이 아니다 */
export const hasCoursebook = (semesters, term) => Boolean(semesters && (semesters.list || []).some((x) => x[0] === term && !x[2]));

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
  const [a, b] = version.entry_years || [];
  const range = a === b ? `${a}` : `${a}~${b}`;
  if (selected && selectionTerm) {
    // 선발 연도의 판이 없어 가까운 판으로 본 것(pickVersionFor reason nearest)은 그 판을 붙인다: '2023년 1학기 선발 · 2025~2026년 선발 규정'
    const y = Number(String(selectionTerm).slice(0, 4));
    const off = program && program.version_key === "selection" && Number.isFinite(y) && (y < a || y > b);
    return off ? `${termName(selectionTerm)} 선발 · ${range}년 선발 규정` : `${termName(selectionTerm)} 선발`;
  }
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
    case COND: return (row && row.because) || "조건에 따라 더 들어야 할 수 있어요.";
    case SAME_GPA: return "공통의 졸업 평점과 같은 조건이에요.";
    default: return (row && row.because) || null;
  }
}

/**
 * 출처 위치를 짧게(디자인 127판): 자료의 locator(조사 메모) 가운데 쪽과 표만 → '3쪽'·'표 2'·'9쪽 표 1'. 없으면 ''.
 * 쪽은 인쇄 쪽('p.17', '31쪽')을 먼저, 없으면 PDF 쪽('PDF 21–22쪽'). 표는 첫 '표 N'·'[표N]'
 */
export function shortLocator(locator) {
  const s = String(locator || "");
  const range = (a, b) => (b && b !== a ? `${a}–${b}쪽` : `${a}쪽`);
  const printed = s.replace(/PDF\s*\d+(?:\s*[–~-]\s*\d+)?\s*쪽/g, " ");
  let page = null, m;
  if ((m = /p\.\s*(\d+)(?:\s*[–~-]\s*(\d+))?/.exec(printed))) page = range(m[1], m[2]);
  else if ((m = /(\d+)(?:\s*[–~-]\s*(\d+))?\s*쪽/.exec(printed))) page = range(m[1], m[2]);
  else if ((m = /PDF\s*(\d+)(?:\s*[–~-]\s*(\d+))?\s*쪽/.exec(s))) page = range(m[1], m[2]);
  // 첫 '표 N'('표 035.001' 같은 과목 번호와 '별표 15과목'의 별표는 빼고. 뒤 보기 정규식은 옛 사파리가 못 읽어 쓰지 않는다)
  const tables = [...s.matchAll(/(.?)표\s*(\d{1,2})(?![\d.])/g)].filter((x) => x[1] !== "별");
  return [page, tables.length ? `표 ${tables[0][2]}` : null].filter(Boolean).join(" ");
}

/**
 * 요건 시트의 출처 줄(디자인 127판): [{text: '출처: 〈문서 이름〉 · 〈쪽·표〉', url, locator(짧은 위치, 없으면 ''), detail(조사 메모 그대로)}].
 * 쪽·표를 모르면 '출처: 〈문서 이름〉' 만. 같은 문서·같은 위치는 한 번
 */
export function sourceTexts(program, src = []) {
  const out = [], seen = new Set();
  for (const k of src || []) {
    const s = ((program && program.sources) || {})[k];
    if (!s) continue;
    const title = String(s.title).replace(/\s+—\s+/g, " ");
    const locator = shortLocator(s.locator);
    const text = `출처: ${title}${locator ? ` · ${locator}` : ""}`;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, url: s.url || null, locator, detail: s.locator || null });
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
  if (row.state === "remaining" && row.short) {
    const { unit, left, text } = row.short;
    return { kind: "left", unit, left, text: text || `${left}${unit} 남음` };
  }
  if (row.state === "remaining") {
    // 학점과 과목 수가 다 모자라면 과목 수로 채워지는 줄은 과목으로('미대 공통 전필 2과목(6학점)'에서 1과목 들으면 '1과목 남음', update129)
    const sh = leftOf(row.need, row.have, perCourse(row.missing));
    if (sh) return { kind: "left", unit: sh.unit, left: sh.left, text: `${sh.left}${sh.unit} 남음` };
  }
  return { kind: "check", text: "확인 필요" };
}

function rowSummary(row, value) {
  if (row.summaryText != null) return { summary: row.summaryText, strong: value.kind === "left" ? value.text : null };
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

/** 들은 과목 줄의 메타: '3학점 · 2025년 1학기', 학기를 모르면(요건 시트에서 체크한 과목) '3학점 · 체크' */
function takenMeta(t) {
  const base = t.term ? `${t.credits}학점 · ${termName(t.term)}` : t.checked ? `${t.credits}학점 · 체크` : `${t.credits}학점`;
  return t.took ? `${base} · ${t.took}${josaRo(t.took)} 수강` : base; // 이름이 바뀐 과목으로 들었으면(update131. 11/17 사용자 '들음 말고 수강으로')
}

/** 안 들은 목록 과목의 메타: 학점, 지금 다른 이름으로 열리면 '지금은 …', 더 안 열리면 '마지막 개설 …'(update131, sameCourse.now·ended).
 *  지금 이름은 이 학생의 셈에서 두 번호가 정말 이어질 때만(과정의 alt_codes 로만 이어진 짝은 그 과정을 골랐을 때) */
function courseMeta(c, same) {
  const credits = c.credits != null ? `${c.credits}학점` : null;
  const n = same && same.now && same.now.get(c.code);
  if (n && same(n.code) === same(c.code)) return { meta: [credits, `지금은 ${n.name}`].filter(Boolean).join(" · "), now: n };
  const last = same && same.ended && same.ended.get(c.code);
  if (last) return { meta: [credits, `마지막 개설 ${termName(last)}`].filter(Boolean).join(" · "), ended: last };
  return { meta: credits };
}

/**
 * 센 값과 기준 {have, need, unit}(줄 앞 동그라미의 호 = have ÷ need, 시트 상태 칸 '12 / 18학점'. 프론트엔드 141판, update121).
 * 과목 목록 줄은 남은 단위(값 글과 같은 것), 아니면 학점 → 과목. 분야·갈래 줄은 그 셈이 정한 값(evaluateGroups·evaluatePaths).
 * 기준 수가 없는 줄, 과목 목록이 없는 확인 필요 줄(센 것이 늘 0), 학생이 '이 요건을 채웠어요'로 채운 줄(byChecks)은 null
 */
function rowProgress(row, value) {
  if (row.byChecks) return null;
  if (row.progress !== undefined) return row.progress;
  if (row.state === "check" && !(row.all || []).length) return null;
  const { need, have } = row;
  if (!need || !have) return null;
  const unit = value.kind === "left" && value.unit ? value.unit : need.credits != null ? "학점" : need.count != null ? "과목" : null;
  if (unit === "학점" && need.credits > 0) return { have: have.credits, need: need.credits, unit };
  if (unit === "과목" && need.count > 0) return { have: have.count, need: need.count, unit };
  return null;
}

/**
 * 요건 줄 하나 → 화면 값. {id, name, value: {kind: left|met|check, text}, aria, progress, byChecks?, sheet: {title, meta, summary, strong,
 * courses: [{code, name, credits, taken, meta, took?, now?, ended?}], groups, paths, because, link, sources, checked, detail}}.
 * took: 다른 이름의 같은 과목으로 들었으면 그 이름(메타 '… · 통계 인공지능 개론 및 실습으로 수강'), now: 안 들은 과목이 지금은 다른 이름으로 열리면 {code, name}
 * (메타 '3학점 · 지금은 …'), ended: 더 안 열리면 마지막 개설 학기(메타 '3학점 · 마지막 개설 2025년 1학기'). 지금 이름·안 열림은 opts.sameCourse 가 있을 때만(update131)
 * 남음·충족은 summary·courses·sources, 확인 필요는 because·link(학과 졸업요건)·checked 를 쓴다.
 * groups: 분야 줄(extra.groups)의 분야마다 [{name, need, value, codes}], paths: 갈래 줄(extra.paths)의 갈래마다 [{name, value, codes}](아니면 null)
 * progress: rowProgress. byChecks: 과목 목록이 없는 확인 필요 줄을 학생이 체크해서 충족으로 본 줄(gradView rowChecks)
 */
export function rowView(row, { program, title = null, label = null, entryYear = null, sameCourse = null } = {}) {
  const value = rowValue(row);
  const { summary, strong } = row.byChecks ? { summary: null, strong: null } : rowSummary(row, value);
  const courses = (row.all || []).map((c) => {
    const t = (row.taken || []).find((x) => x.code === c.code);
    return t ? { code: c.code, name: c.name, credits: t.credits, taken: true, meta: takenMeta(t), ...(t.took ? { took: t.took } : {}) }
      : { code: c.code, name: c.name, credits: c.credits, taken: false, ...courseMeta(c, sameCourse) };
  });
  const checked = program && program.checked_on ? `${monthDay(program.checked_on)} 기준` : null;
  return {
    id: row.id, name: row.name || rowName(row), value, aria: `${row.name || rowName(row)}, ${value.text}`, progress: rowProgress(row, value),
    ...(row.byChecks ? { byChecks: true } : {}),
    sheet: { title: row.name || rowName(row), meta: [title || (program && program.program), label].filter(Boolean).join(" · "),
      summary, strong, courses, groups: row.groups || null, paths: row.paths || null,
      because: value.kind === "check" ? reasonText(row, { entryYear }) : null, ...(row.reason === COND ? { cond: true } : {}),
      link: deptLink(program), sources: sourceTexts(program, row.src), checked, detail: row.text || null },
  };
}

/**
 * 요건 보기 전체(디자인 124판 '졸업 요건 탭').
 * picks: [{program, version, role, title?, entryYear?, selectionTerm?, newer?, own?, geOnly?}](첫째가 주전공. version 은 화면이 고른 판, 없으면 pickVersionFor.
 *   own 은 학번으로 고른 자기 판: 더 새 판을 고른 주전공의 교양 줄은 own 에서(update128). geOnly 는 전공을 아직 안 정함: 공통 묶음만)
 * records: 들은 과목 기록(tidyRecords 꼴. 요건 시트에서 체크한 과목은 checked: true, 교양 줄 과목이면 이수 구분을 교양으로 본다),
 * grades: gpa(records, {isMajor}) 결과(성적을 안 넣었으면 null), common: common.json,
 * gpaChecks: {all, major}(시트에서 켠 '전체·전공 평점 2.0 이상'. 성적을 다 넣지 않았을 때 둘 다 켜면 졸업 평점 충족, byChecks)
 * rowChecks: {'묶음 id|요건 id': true}(시트의 '이 요건을 채웠어요', 141판 ⑥. 공통 묶음은 'common|…'). 과목 목록이 없어 확인 필요인 줄만 충족으로 보고 byChecks.
 *   목록이 있는 줄(분야·갈래 포함)은 과목 체크로 세니 그대로, 졸업 학점·졸업 평점 줄도 그대로
 * → {total, bundles: [{kind: "common"|"program", id, title, label, choices, rows: [rowView]}], missing: [자료가 없는 과정 id]}.
 * 공통: 졸업 학점 · 졸업 평점 · 주전공 판의 교양 줄. 주전공 묶음에는 교양 줄을 다시 넣지 않는다
 */
export function gradView({ picks = [], records = [], grades = null, common = null, sameCourse = (c) => c, gpaChecks = null, rowChecks = null, areas = null } = {}) {
  const geCodes = new Set(picks.flatMap((p) => [...requirementCodes(p.version || pickVersionFor(p.program, { entryYear: p.entryYear }).version, true),
    ...requirementCodes(p.own || null, true)]));
  for (const a of Object.values((areas && areas.areas) || {})) for (const c of a.courses || []) geCodes.add(c.code); // 영역 목록에서 체크한 교양 과목(update128)
  const geKeys = new Set([...geCodes].map(sameCourse));
  const marked = (records || []).map((r) => (r.checked && !r.cls && geKeys.has(sameCourse(r.code)) ? { ...r, cls: "교양" } : r));
  const tidy = tidyRecords(marked, sameCourse);
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
  let byChecks = false;
  if (!grades || !grades.all || grades.all.gpa == null || !(grades.graduation && grades.graduation.complete)) {
    if (gpaChecks && gpaChecks.all && gpaChecks.major) [gpaRow.state, byChecks] = ["met", true]; // 시트의 '전체·전공 평점 2.0 이상' 둘 다(11/16)
    else Object.assign(gpaRow, { state: "check", because: "성적을 다 넣지 않았어요." });
  } else if (grades.all.gpa < gpaMin) {
    Object.assign(gpaRow, { state: "check", because: `전체 평점이 ${gpaMin.toFixed(1)}보다 낮아요.` });
  } else if (grades.major && grades.major.gpa != null && grades.major.gpa < gpaMin) {
    Object.assign(gpaRow, { state: "check", because: `전공 평점이 ${gpaMin.toFixed(1)}보다 낮아요.` });
  } else {
    gpaRow.state = "met";
  }
  const gv = rowView(gpaRow, { title: "공통" });
  gv.byChecks = byChecks;
  if (gpaRow.state === "met" && !byChecks) gv.sheet.summary = `전체 ${grades.all.gpa.toFixed(2)}${grades.major && grades.major.gpa != null ? ` · 전공 ${grades.major.gpa.toFixed(2)}` : ""}`;
  commonRows.push(gv);
  const bundles = [{ kind: "common", id: "common", title: "공통", label: null, choices: [], rows: commonRows }];
  counted.forEach((p, i) => {
    const role = p.role || "single";
    const label = versionLabel(p.program, p.version, { role, selectionTerm: p.selectionTerm });
    const title = p.title || p.program.program;
    let rows = evaluateProgram(p.program, p.version, tidy.courses, { role, sameCourse, areas, entryYear: p.entryYear });
    // 더 새 판을 고른 주전공(versionChoices. 화면이 own 으로 자기 판을 준다): 교양은 늘 입학 연도 규정이라 교양 줄은 자기 판에서 센다(update128)
    const own = i === 0 && p.own && p.own !== p.version ? p.own : null;
    const ownGe = own ? (own.requirements || []).filter((x) => x.type === "ge") : [];
    if (own) {
      const ge = evaluateProgram(p.program, { ...own, requirements: ownGe }, tidy.courses, { role, sameCourse, areas, entryYear: p.entryYear });
      rows = [...rows.filter((r) => r.type !== "ge"), ...ge];
    }
    const opts = { program: p.program, title, label, entryYear: p.entryYear, sameCourse };
    const raw = new Map([...(p.version.requirements || []), ...ownGe].map((x) => [x.id, x]));
    const mine = [];
    for (const r of rows) {
      const toCommon = i === 0 && r.type === "ge";
      // '이 요건을 채웠어요'(rowChecks): 과목 목록이 없어 앱이 셀 수 없는 확인 필요 줄만(목록이 생긴 줄의 옛 체크는 쓰지 않는다)
      // 조건부 요건(COND: 입학 TEPS 같은 학생이 아는 조건)은 목록이 있어도 학생이 채웠다고 할 수 있다(update128)
      if (rowChecks && rowChecks[`${toCommon ? "common" : p.program.id}|${r.id}`] === true && r.state === "check"
        && (r.reason === COND || !rowCourses(raw.get(r.id) || {}).length)) {
        Object.assign(r, { state: "met", byChecks: true });
      }
      if (r.sameAs === "grad-gpa") { // 학과의 '전체·전공 평점 2.0 이상' 줄은 공통 졸업 평점 값을 그대로(update127)
        Object.assign(r, { state: gpaRow.state, because: gpaRow.because || null, byChecks: byChecks || undefined });
        delete r.reason;
      }
      if (toCommon) commonRows.push(rowView(r, { ...opts, title: "공통" }));
      else mine.push(rowView(r, opts));
    }
    const choices = versionChoices(p.program, p.version, { newer: p.newer, entryYear: p.entryYear, role, selectionTerm: p.selectionTerm })
      .map((c) => ({ label: c.label, entry_years: c.version.entry_years }));
    if (!p.geOnly) bundles.push({ kind: "program", id: p.program.id, title, label, choices, rows: mine }); // 전공을 아직 안 정했으면(geOnly) 공통만(update128)
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
