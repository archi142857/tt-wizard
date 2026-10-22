// TT Wizard 저장한 시간표 — 백엔드 세션. 화면(app.js)의 '내 시간표'(SNUTT 처럼 분반을 직접 골라 만드는 시간표)와
// 탐색 결과의 '저장하기'가 쓰는 자료 형식과 다루는 함수. 화면·기기 저장은 하지 않는다(순수 함수. 받은 것을 고치지 않고 새로 돌려준다).
//
// 저장 형식(학기마다 목록 하나. app.js 가 store.set(semKey("timetables"), serialize(list)) 처럼 기기에 둔다. 서버로 보내지 않는다)
//   시간표 { v: 1, id, sem: "2026-2", title, created, updated(ISO 시각), primary?: true(학기마다 하나, '대표 시간표'),
//            source: "manual" | "search", from?: {home, mode}(탐색에서 저장했을 때의 출발·이동 기준), items: [항목, ...] }
//   강좌 항목 { course: 교과목번호, no: 강좌번호, name, instructor, credit, cls,   ← 과목이 편람에서 사라져도 보이게 적어 둔다
//              base: 저장(또는 '편람대로')할 때의 편람 수업 [[요일, 시작, 끝, 건물, 강의실], ...],
//              own?: 사용자가 정한 수업(강의실 미정에 고른 건물, 바꾼 시간·장소). 있으면 편람 대신 이것을 쓴다,
//              alts?: 같은 시간·건물의 다른 분반 키들(탐색 결과는 이런 분반을 하나로 묶어 찾는다), color }
//   직접 넣은 일정 { custom: id, title, meetings: [[요일, 시작, 끝, 건물, ""], ...], memo?, color }
//   요일 0 = 월, 시각은 자정부터 센 분. 건물은 campus.json 의 지점 id(모르면 ""). color 는 0 부터의 차례(팔레트는 화면이 정한다)
//
// 편람과 맞추기: 강좌 항목은 편람을 따른다(SNUTT 와 같다). 편람은 하루 네 번 새로 받으니, 화면은 그릴 때 reconcile 로
//   지금 편람과 견준다. 저장할 때 본 편람(base)과 달라졌으면 changed(새 편람 값을 쓰고 '편람 바뀜'), 편람에서 사라졌으면
//   gone(적어 둔 값을 쓴다). own 이 있으면 편람이 바뀌어도 own 을 쓰고 changed 만 알린다. acknowledge 로 base 를 지금 편람에 맞추면 알림이 꺼진다.
//
// 동선 확인하기: toSections 로 엔진이 읽는 분반 모양을 만들어 engine.checkRoute 에 넘긴다(탐색 결과와 같은 비용·경로).

export const VERSION = 1;
export const TITLE_MAX = 30; // 시간표 이름 글자 수
export const PER_SEMESTER_MAX = 50; // 학기마다 둘 수 있는 시간표 수(기기 저장 공간을 아끼려고)

// ---------------------------------------------------------------- 수업

const tuple = (m) => [m.day, m.start, m.end, m.building || "", m.building ? m.room || "" : ""];
const meeting = ([day, start, end, building, room]) => ({ day, start, end, building: building || "", room: room || "" });
/** 수업 목록을 견주는 글(차례 상관없음). app.js 의 sigOf 와 같은 규칙 */
const sig = (ms) => ms.map((m) => `${m.day},${m.start},${m.end},${m.building || ""},${m.room || ""}`).sort().join(";");
const validTuple = (t) => Array.isArray(t) && Number.isInteger(t[0]) && t[0] >= 0 && t[0] < 7
  && Number.isFinite(t[1]) && Number.isFinite(t[2]) && t[1] >= 0 && t[2] > t[1] && t[2] <= 24 * 60;
const tuples = (list) => (Array.isArray(list) ? list.filter(validTuple).map((t) => [t[0], t[1], t[2], String(t[3] || ""), t[3] ? String(t[4] || "") : ""]) : []);
const overlaps = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;

/** 항목의 열쇠: 강좌는 '교과목번호-강좌번호'(엔진의 분반 key 와 같다), 직접 넣은 일정은 그 id */
export const itemKey = (it) => (it.custom ? it.custom : `${it.course}-${it.no}`);

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------- 시간표 만들기·이름

/** 이름 다듬기: 앞뒤 공백을 빼고 TITLE_MAX 자까지 */
export function cleanTitle(title) {
  return String(title ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

/**
 * 같은 학기 안에서 겹치지 않는 이름. base 가 비어 있으면 base, 아니면 'base (n)'(n = 1 부터 비는 번호. SNUTT 복사본 이름과 같은 꼴).
 * copy 면 base 가 비어 있어도 번호를 붙인다. base 끝의 ' (n)' 은 떼고 붙인다. 번호를 붙여도 TITLE_MAX 자를 넘지 않게 base 를 줄인다.
 */
export function uniqueTitle(base, titles, { copy = false } = {}) {
  const root = cleanTitle(base).replace(/\s\(\d+\)$/, "") || "시간표";
  const taken = new Set(titles);
  if (!copy && !taken.has(root)) return root;
  for (let n = 1; ; n++) {
    const suffix = ` (${n})`;
    const name = root.slice(0, TITLE_MAX - suffix.length).trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}

/** 이름을 쓸 수 있나: null 이면 된다. "empty" 비었다, "duplicate" 같은 학기에 같은 이름이 있다 */
export function titleProblem(title, list, selfId = null) {
  const t = cleanTitle(title);
  if (!t) return "empty";
  if (list.some((x) => x.id !== selfId && x.title === t)) return "duplicate";
  return null;
}

/** 새 시간표. 학기의 첫 시간표면 대표로 한다. list 가 꽉 찼으면 null */
export function createTimetable(list, sem, { title = "", source = "manual", from = null, items = [], now = new Date() } = {}) {
  if (list.length >= PER_SEMESTER_MAX) return null;
  const at = now.toISOString();
  const t = { v: VERSION, id: newId("t"), sem, title: uniqueTitle(title || "시간표", list.map((x) => x.title)), created: at, updated: at, source, items };
  if (!list.some((x) => x.primary)) t.primary = true;
  if (from) t.from = { ...from };
  return t;
}

/** 이름 바꾸기. 쓸 수 없는 이름이면 {problem} */
export function renameTimetable(t, title, list, now = new Date()) {
  const problem = titleProblem(title, list, t.id);
  return problem ? { problem } : { t: { ...t, title: cleanTitle(title), updated: now.toISOString() } };
}

/** 복사본(이름 '원래 이름 (n)', 대표는 옮기지 않는다). list 가 꽉 찼으면 null */
export function copyTimetable(t, list, now = new Date()) {
  if (list.length >= PER_SEMESTER_MAX) return null;
  const at = now.toISOString();
  const { primary, ...rest } = t;
  return { ...rest, id: newId("t"), title: uniqueTitle(t.title, list.map((x) => x.title), { copy: true }), created: at, updated: at,
    items: t.items.map((it) => ({ ...it })) };
}

/** 지우고 남은 목록. 대표를 지웠으면 가장 최근에 고친 것이 대표가 된다 */
export function deleteTimetable(list, id) {
  const gone = list.find((x) => x.id === id);
  const rest = list.filter((x) => x.id !== id);
  if (gone && gone.primary && rest.length) {
    const next = rest.reduce((a, b) => (b.updated > a.updated ? b : a));
    return rest.map((x) => (x === next ? { ...x, primary: true } : x));
  }
  return rest;
}

/** 대표 시간표 바꾸기(학기마다 하나) */
export function setPrimary(list, id) {
  return list.map((x) => {
    const { primary, ...rest } = x;
    return x.id === id ? { ...rest, primary: true } : rest;
  });
}

// ---------------------------------------------------------------- 항목 넣고 빼기

/** 다른 항목이 쓰지 않는 가장 작은 색 번호 */
function freeColor(items) {
  const used = new Set(items.map((it) => it.color));
  let c = 0;
  while (used.has(c)) c++;
  return c;
}

/** 항목의 지금 수업(편람을 견주지 않은 값: own, 없으면 base. 직접 넣은 일정은 meetings) */
const savedMeetings = (it) => (it.custom ? it.meetings : it.own || it.base).map(meeting);

/** 강좌 분반 → 항목. section 은 engine.parseCourses 의 분반, meetings 를 주면 그것이 사용자가 정한 수업(own) */
export function sectionItem(course, section, { meetings = null, alts = null } = {}) {
  const base = section.meetings.map(tuple);
  const own = meetings && sig(meetings) !== sig(section.meetings) ? meetings.map(tuple) : null;
  const it = { course: course.id, no: section.no, name: course.name, instructor: section.instructor || "", credit: course.credit ?? 0, cls: course.cls || "", base };
  if (own) it.own = own;
  if (alts && alts.length) it.alts = [...alts];
  return it;
}

/** 직접 넣은 일정 → 항목. meetings: [{day, start, end, building}] */
export function customItem({ title, meetings, memo = "" }) {
  const it = { custom: newId("c"), title: cleanTitle(title) || "일정", meetings: tuples(meetings.map(tuple)) };
  if (memo) it.memo = String(memo);
  return it;
}

/** 항목마다 지금 쓰는 수업: byId(지금 편람)를 주면 reconcile 기준, 아니면 적어 둔 값(own, 없으면 base) */
function currentMeetings(t, byId) {
  if (byId) return new Map(reconcile(t, byId).map((r) => [r.key, r.meetings]));
  return new Map(t.items.map((it) => [itemKey(it), savedMeetings(it)]));
}

/**
 * meetings([{day, start, end}])와 시간이 겹치는 항목의 열쇠들. except(그 열쇠)와 course(같은 과목의 다른 분반)는 빼고 본다.
 * byId 를 주면 지금 편람 기준(편람이 바뀐 항목은 바뀐 시간으로). 화면이 항목의 시간을 바꾸기 전에 물어볼 때도 쓴다
 */
export function overlapsWith(t, meetings, { except = null, course = null, byId = null } = {}) {
  const now = currentMeetings(t, byId);
  return t.items.filter((it) => itemKey(it) !== except && !(course && it.course === course)
    && now.get(itemKey(it)).some((a) => meetings.some((b) => overlaps(a, b)))).map(itemKey);
}

/**
 * 항목 넣기. 시간이 겹치는 항목이 있으면 넣지 않고 {t, overlaps: [겹치는 항목 열쇠]} 를 돌려준다(화면이 '덮어쓸까요?'를 묻는다).
 * force 면 겹치는 항목을 빼고 넣는다(SNUTT 와 같다). 같은 열쇠의 항목이 이미 있으면 바꿔 넣는다(분반을 다시 고른 것).
 * 같은 과목의 다른 분반이 있으면 그것과 바꾼다(한 과목에 분반 하나). byId(지금 편람)를 주면 겹침을 지금 편람 기준으로 본다
 */
export function addItem(t, item, { force = false, byId = null, now = new Date() } = {}) {
  const key = itemKey(item);
  const hit = overlapsWith(t, savedMeetings(item), { except: key, course: item.course || null, byId });
  if (hit.length && !force) return { t, overlaps: hit };
  const prev = t.items.find((it) => itemKey(it) === key || (item.course && it.course === item.course));
  const keep = t.items.filter((it) => it !== prev && !hit.includes(itemKey(it)));
  const added = { ...item, color: prev && prev.color !== undefined ? prev.color : freeColor(keep) };
  return { t: { ...t, items: [...keep, added], updated: now.toISOString() }, overlaps: [] };
}

/** 항목 빼기 */
export function removeItem(t, key, now = new Date()) {
  return { ...t, items: t.items.filter((it) => itemKey(it) !== key), updated: now.toISOString() };
}

/** 항목 고치기(이름·메모·색·사용자가 정한 수업 등). patch 의 값으로 덮는다(undefined 인 칸은 지운다) */
export function updateItem(t, key, patch, now = new Date()) {
  return {
    ...t,
    updated: now.toISOString(),
    items: t.items.map((it) => {
      if (itemKey(it) !== key) return it;
      const out = { ...it, ...patch };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete out[k];
      return out;
    }),
  };
}

/** 학점 합(직접 넣은 일정은 0) */
export const credits = (t) => t.items.reduce((sum, it) => sum + (it.custom ? 0 : Number(it.credit) || 0), 0);

// ---------------------------------------------------------------- 탐색 결과에서

/**
 * 탐색 결과 하나(engine.search 의 ranked[i]) → 시간표의 항목들. byId: 교과목번호 → 과목(지금 편람).
 * 탐색에 넘긴 분반 수업이 편람과 다르면(사용자가 강의실·시간을 정해 둔 분반) own 으로 적는다. 같은 시간·건물 분반(twins)은 alts 로.
 */
export function itemsFromRanked(ev, byId) {
  const items = [];
  for (const s of ev.sections) {
    const c = byId.get(s.courseId);
    const cat = c && c.sections.find((x) => x.key === s.key);
    const course = c || { id: s.courseId, name: s.name, credit: 0, cls: "" };
    const section = cat || s;
    const it = sectionItem(course, section, { meetings: s.meetings, alts: (s.twins || []).map((x) => x.key) });
    it.color = items.length;
    items.push(it);
  }
  return items;
}

/** 목록에서 이 탐색 결과와 같은 시간표(같은 분반들, 같은 수업)를 찾는다. 없으면 null(화면의 '저장됨') */
export function findSaved(list, ev, byId) {
  const want = itemsFromRanked(ev, byId).map((it) => `${itemKey(it)}=${sig(savedMeetings(it))}`).sort().join("|");
  return list.find((t) => !t.items.some((it) => it.custom)
    && t.items.map((it) => `${itemKey(it)}=${sig(savedMeetings(it))}`).sort().join("|") === want) || null;
}

// ---------------------------------------------------------------- 편람과 맞추기

/**
 * 지금 편람(byId)과 견준 항목들: [{key, item, meetings, state, live}].
 *   state  "same" 그대로 | "changed" 저장할 때 본 편람과 달라졌다 | "gone" 편람에 없다 | "custom" 직접 넣은 일정
 *   meetings 그릴 수업({day, start, end, building, room}): own > 지금 편람 > 적어 둔 base
 *   live   지금 편람의 분반(없으면 null). live.status 가 "폐강대상" 이면 화면이 태그를 단다
 */
export function reconcile(t, byId) {
  return t.items.map((it) => {
    const key = itemKey(it);
    if (it.custom) return { key, item: it, meetings: it.meetings.map(meeting), state: "custom", live: null };
    const c = byId.get(it.course);
    const live = (c && c.sections.find((s) => s.no === it.no)) || null;
    const base = it.base.map(meeting);
    const state = !live ? "gone" : sig(live.meetings) === sig(base) ? "same" : "changed";
    const meetings = it.own ? it.own.map(meeting) : live ? live.meetings.map((m) => ({ ...m })) : base;
    return { key, item: it, meetings, state, live };
  });
}

/** '편람 바뀜'을 본 것으로: base 를 지금 편람 값으로(own 은 그대로). 편람에 없는 항목은 그대로 */
export function acknowledge(t, byId, now = new Date()) {
  let touched = false;
  const items = t.items.map((it) => {
    if (it.custom) return it;
    const c = byId.get(it.course);
    const live = c && c.sections.find((s) => s.no === it.no);
    if (!live || sig(live.meetings) === sig(it.base.map(meeting))) return it;
    touched = true;
    return { ...it, base: live.meetings.map(tuple) };
  });
  return touched ? { ...t, items, updated: now.toISOString() } : t;
}

/**
 * 엔진이 읽는 분반 모양(동선 확인하기 = engine.checkRoute, 시간표 칸 그리기): [{key, courseId, no, name, instructor, custom, meetings}]
 * 수업은 reconcile 의 meetings(own > 지금 편람 > base). 직접 넣은 일정은 courseId 가 없다
 */
export function toSections(t, byId) {
  return reconcile(t, byId).map(({ key, item, meetings }) => (item.custom
    ? { key, courseId: null, no: "", name: item.title, instructor: "", custom: true, meetings }
    : { key, courseId: item.course, no: item.no, name: item.name, instructor: item.instructor, custom: false, meetings }));
}

// ---------------------------------------------------------------- 기기에 두기

/** 기기에 둘 값(JSON 으로 그대로 쓸 수 있는 배열) */
export function serialize(list) {
  return list.map((t) => (t._newer ? t._raw : t));
}

/**
 * 기기에서 읽은 값 → 시간표 목록. 모양이 어긋난 시간표·항목은 버린다(나머지는 살린다).
 * 이 판보다 새 판(v > VERSION)이 적은 것은 고치지 않고 그대로 두었다가(_newer) serialize 때 그대로 돌려준다(앱을 되돌려도 지워지지 않게).
 */
export function parseList(raw, sem) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || typeof r.id !== "string") continue;
    if (Number(r.v) > VERSION) { out.push({ id: r.id, sem: r.sem, title: String(r.title || ""), items: [], _newer: true, _raw: r }); continue; }
    const items = [];
    for (const it of Array.isArray(r.items) ? r.items : []) {
      if (!it || typeof it !== "object") continue;
      const color = Number.isInteger(it.color) && it.color >= 0 ? it.color : undefined;
      if (typeof it.custom === "string") {
        const x = { custom: it.custom, title: cleanTitle(it.title) || "일정", meetings: tuples(it.meetings) };
        if (it.memo) x.memo = String(it.memo);
        if (color !== undefined) x.color = color;
        items.push(x);
        continue;
      }
      if (typeof it.course !== "string" || typeof it.no !== "string") continue;
      const x = { course: it.course, no: it.no, name: String(it.name || it.course), instructor: String(it.instructor || ""),
        credit: Number(it.credit) || 0, cls: String(it.cls || ""), base: tuples(it.base) };
      if (Array.isArray(it.own)) x.own = tuples(it.own);
      if (Array.isArray(it.alts) && it.alts.length) x.alts = it.alts.map(String);
      if (color !== undefined) x.color = color;
      items.push(x);
    }
    const t = { v: VERSION, id: r.id, sem: typeof r.sem === "string" ? r.sem : sem, title: cleanTitle(r.title) || "시간표",
      created: String(r.created || ""), updated: String(r.updated || r.created || ""), source: r.source === "search" ? "search" : "manual", items };
    if (r.primary === true) t.primary = true;
    if (r.from && typeof r.from === "object") t.from = { home: String(r.from.home ?? ""), mode: String(r.from.mode ?? "") };
    out.push(t);
  }
  // 대표는 하나만(여럿이면 앞의 것)
  let seen = false;
  return out.map((t) => {
    if (!t.primary) return t;
    if (!seen) { seen = true; return t; }
    const { primary, ...rest } = t;
    return rest;
  });
}
