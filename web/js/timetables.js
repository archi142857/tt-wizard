// TT Wizard 저장한 시간표 — 백엔드 세션. 화면(app.js)의 '내 시간표'(SNUTT 처럼 분반을 직접 골라 만드는 시간표)와
// 탐색 결과의 '저장하기'가 쓰는 자료 형식과 다루는 함수. 화면·기기 저장은 하지 않는다(순수 함수. 받은 것을 고치지 않고 새로 돌려준다).
//
// 저장 형식(학기마다 목록 하나. app.js 가 store.set(semKey("timetables"), serialize(list)) 처럼 기기에 둔다. 서버로 보내지 않는다.
//   기기에 두는 열쇠는 STORE_KEYS, 첫 탭 고르기는 hasTimetables, 칸 색 설정은 colorMode)
//   시간표 { v: 1, id, sem: "2026-2", title, created, updated(ISO 시각), primary?: true(학기마다 하나, '대표 시간표'),
//            source: "manual" | "search", from?: {home, mode}(탐색에서 저장했을 때의 출발·이동 기준), items: [항목, ...] }
//   강좌 항목 { course: 교과목번호, no: 강좌번호, name, instructor, credit, cls,   ← 과목이 편람에서 사라져도 보이게 적어 둔다
//              base: 저장(또는 '편람대로')할 때의 편람 수업 [[요일, 시작, 끝, 건물, 강의실], ...],
//              own?: 사용자가 정한 수업(강의실 미정에 고른 건물, 바꾼 시간·장소). 있으면 편람 대신 이것을 쓴다,
//              alts?: 같은 시간·건물의 다른 분반 키들(탐색 결과는 이런 분반을 하나로 묶어 찾는다), color }
//   직접 넣은 일정 { custom: id, title, meetings: [[요일, 시작, 끝, 건물, ""], ...], memo?, color }
//   요일 0 = 월, 시각은 자정부터 센 분. 건물은 campus.json 의 지점 id(모르면 ""). color 는 0~7(COLORS 개. 화면의 item-0 ~ item-7)
//
// 편람과 맞추기: 강좌 항목은 편람을 따른다(SNUTT 와 같다). 편람은 하루 네 번 새로 받으니, 화면은 그릴 때 reconcile 로
//   지금 편람과 견준다. 저장할 때 본 편람(base)과 달라졌으면 changed(새 편람 값을 쓰고 '편람 바뀜'), 편람에서 사라졌으면
//   gone(적어 둔 값을 쓴다. 과목째 사라졌는지 분반만 사라졌는지는 missing). own 이 있으면 편람이 바뀌어도 own 을 쓰고 changed 만 알린다.
//   acknowledge 로 base 를 지금 편람에 맞추면 알림이 꺼진다.
//
// 동선 확인하기: toSections 로 엔진이 읽는 분반 모양을 만들어 engine.checkRoute 에 넘긴다(탐색 결과와 같은 비용·경로).
//
// 이미지로 내보내기·불러오기: 화면이 그린 시간표 그림(PNG)에 addTimetableToPng 로 시간표 자료를 파일 안의 텍스트 칸(iTXt)에 넣는다.
//   그림에는 보이지 않는다. 불러올 때 readTimetableImage 가 그 칸만 읽고(OCR 이 아니다) timetableFromImage 가 새 시간표로 만든다(아래 '이미지 파일에 담기').

export const VERSION = 1;
export const TITLE_MAX = 30; // 시간표 이름 글자 수
export const PER_SEMESTER_MAX = 50; // 학기마다 둘 수 있는 시간표 수(기기 저장 공간을 아끼려고)
export const COLORS = 8; // 항목 색 수(디자인 규칙의 item-0 ~ item-7)
export const DEFAULT_TITLE = "시간표"; // 새 시간표 이름은 '시간표 n'(디자인 규칙)

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
 * 같은 학기 안에서 겹치지 않는 이름. base 가 비어 있으면 base, 아니면 'base (n)'(n = 2 부터 비는 번호. 디자인 규칙의 복사본 '시간표 1 (2)'.
 * SNUTT 는 (1) 부터). copy 면 base 가 비어 있어도 번호를 붙인다. base 끝의 ' (n)' 은 떼고 붙인다. 번호를 붙여도 TITLE_MAX 자를 넘지 않게 base 를 줄인다.
 */
export function uniqueTitle(base, titles, { copy = false } = {}) {
  const root = cleanTitle(base).replace(/\s\(\d+\)$/, "") || "시간표";
  const taken = new Set(titles);
  if (!copy && !taken.has(root)) return root;
  for (let n = 2; ; n++) {
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

/** 새 시간표의 기본 이름 '시간표 n'(n = 1 부터 이 학기에 비는 번호). 학기에 시간표가 없을 때 화면이 미리 보여 줄 이름도 이것이다 */
export function nextTitle(list) {
  const taken = new Set(list.map((x) => x.title));
  let n = 1;
  while (taken.has(`${DEFAULT_TITLE} ${n}`)) n++;
  return `${DEFAULT_TITLE} ${n}`;
}

/** 새 시간표. 이름을 안 주면 '시간표 n', 주면 그 이름(겹치면 '이름 (2)'부터). 학기의 첫 시간표면 대표로 한다. list 가 꽉 찼으면 null */
export function createTimetable(list, sem, { title = "", source = "manual", from = null, items = [], now = new Date() } = {}) {
  if (list.length >= PER_SEMESTER_MAX) return null;
  const at = now.toISOString();
  const name = cleanTitle(title) ? uniqueTitle(title, list.map((x) => x.title)) : nextTitle(list);
  const t = { v: VERSION, id: newId("t"), sem, title: name, created: at, updated: at, source, items };
  if (!list.some((x) => x.primary)) t.primary = true;
  if (from) t.from = { ...from };
  return t;
}

/** 이름 바꾸기. 쓸 수 없는 이름이면 {problem} */
export function renameTimetable(t, title, list, now = new Date()) {
  const problem = titleProblem(title, list, t.id);
  return problem ? { problem } : { t: { ...t, title: cleanTitle(title), updated: now.toISOString() } };
}

/** 복사본(이름 '원래 이름 (2)'부터 비는 번호, 대표는 옮기지 않는다). list 가 꽉 찼으면 null */
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

/** 새 항목의 색: 다른 항목이 쓰지 않는 가장 작은 번호(0~7). 여덟 색을 다 쓰고 있으면 가장 적게 쓰인 색(같으면 작은 번호) */
function freeColor(items) {
  const count = Array(COLORS).fill(0);
  for (const it of items) if (Number.isInteger(it.color) && it.color >= 0 && it.color < COLORS) count[it.color]++;
  return count.indexOf(Math.min(...count));
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
 * 항목 넣기 → {t, overlaps, removed}.
 *   시간이 겹치는 항목이 있으면 넣지 않는다: t 는 받은 그대로, overlaps 에 겹치는 항목 열쇠(넣었으면 늘 빈 배열).
 *   force 면 겹치는 항목을 빼고 넣는다(SNUTT 와 같다. 디자인 규칙은 묻지 않고 force 로 넣은 뒤 되돌리기를 보여 준다).
 *   같은 열쇠의 항목이 이미 있으면 바꿔 넣고, 같은 과목의 다른 분반이 있으면 그것과 바꾼다(한 과목에 분반 하나, 색은 그대로).
 *   removed: 이번에 빠진 항목들(겹쳐서 뺀 것 + 바꿔 넣느라 뺀 것. 겹쳐서 뺀 것만 보려면 course 가 넣은 항목과 다른 것).
 *   되돌리기는 받기 전의 t 를 다시 쓰면 된다(함수는 받은 t 를 고치지 않는다).
 * byId(지금 편람)를 주면 겹침을 지금 편람 기준으로 본다
 */
export function addItem(t, item, { force = false, byId = null, now = new Date() } = {}) {
  const key = itemKey(item);
  const hit = overlapsWith(t, savedMeetings(item), { except: key, course: item.course || null, byId });
  if (hit.length && !force) return { t, overlaps: hit, removed: [] };
  const prev = t.items.find((it) => itemKey(it) === key || (item.course && it.course === item.course));
  const keep = t.items.filter((it) => it !== prev && !hit.includes(itemKey(it)));
  const removed = t.items.filter((it) => !keep.includes(it));
  const added = { ...item, color: prev && prev.color !== undefined ? prev.color : freeColor(keep) };
  return { t: { ...t, items: [...keep, added], updated: now.toISOString() }, overlaps: [], removed };
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
    it.color = freeColor(items);
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
 * 지금 편람(byId)과 견준 항목들: [{key, item, meetings, state, live, missing}].
 *   state  "same" 그대로 | "changed" 저장할 때 본 편람과 달라졌다 | "gone" 편람에 없다 | "custom" 직접 넣은 일정
 *   missing state 가 gone 일 때 "course"(과목째 사라짐: '없는 과목') | "section"(과목은 있고 분반만 사라짐: '없는 분반'), 아니면 null
 *   meetings 그릴 수업({day, start, end, building, room}): own > 지금 편람 > 적어 둔 base
 *   live   지금 편람의 분반(없으면 null). live.status 가 "폐강대상" 이면 화면이 태그를 단다
 */
export function reconcile(t, byId) {
  return t.items.map((it) => {
    const key = itemKey(it);
    if (it.custom) return { key, item: it, meetings: it.meetings.map(meeting), state: "custom", live: null, missing: null };
    const c = byId.get(it.course);
    const live = (c && c.sections.find((s) => s.no === it.no)) || null;
    const base = it.base.map(meeting);
    const state = !live ? "gone" : sig(live.meetings) === sig(base) ? "same" : "changed";
    const meetings = it.own ? it.own.map(meeting) : live ? live.meetings.map((m) => ({ ...m })) : base;
    return { key, item: it, meetings, state, live, missing: live ? null : c ? "section" : "course" };
  });
}

/**
 * '편람 바뀜'을 본 것으로: base 를 지금 편람 값으로(own 은 그대로). 편람에 없는 항목은 그대로. 바뀐 것이 없으면 받은 t 를 그대로 돌려준다.
 * key 를 주면 그 항목만(디자인 규칙: 항목 시트를 닫을 때 그 항목만), 안 주면 모든 항목. 셋째 값에 Date 만 줘도 된다(예전 꼴)
 */
export function acknowledge(t, byId, opts = {}) {
  const { key = null, now = new Date() } = opts instanceof Date ? { now: opts } : opts;
  let touched = false;
  const items = t.items.map((it) => {
    if (it.custom || (key && itemKey(it) !== key)) return it;
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

/**
 * 기기에 두는 열쇠(app.js 의 store 이름. 앞에 "ttw." 이 붙는다). 학기마다인 것은 semKey(이름) = "이름@학기".
 *   timetables 학기마다 시간표 목록(serialize 값) · timetable 학기마다 지금 보고 있는 시간표 id
 *   timetableColor 기기 하나: 시간표 칸 색 "item"(항목마다 item-0~7, 처음) | "cls"(교과구분별)
 *   openSem 기기 하나: 마지막에 연 학기(첫 탭을 학기 목록을 받기 전에 고르려고. 프론트엔드가 정했다)
 */
export const STORE_KEYS = { list: "timetables", current: "timetable", color: "timetableColor", open: "openSem" };

/** 기기에 둔 칸 색 설정 → "item" | "cls"(처음이거나 모르는 값이면 "item") */
export const colorMode = (raw) => (raw === "cls" ? "cls" : "item");

/**
 * 이 학기에 이 판이 읽는 시간표가 있나(앱을 켤 때 첫 탭: 있으면 내 시간표, 없으면 탐색). raw 는 기기에서 읽은 값 그대로
 * (store.get(semKey("timetables", openSem), [])). 새 판이 적은 것(_newer)은 세지 않는다:
 * parseList(raw).filter((t) => !t._newer).length > 0 과 같고 항목은 읽지 않는다. index.html 머리의 스크립트도 같은 판단을 한다(판 숫자 1 을 적어 둠)
 */
export const hasTimetables = (raw) => Array.isArray(raw)
  && raw.some((r) => !!r && typeof r === "object" && typeof r.id === "string" && !(Number(r.v) > VERSION));

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
      const color = Number.isInteger(it.color) && it.color >= 0 ? it.color % COLORS : undefined;
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

// ---------------------------------------------------------------- 이미지 파일에 담기 (사용자 10/23: "이미지 자체에 텍스트로 입력하라는 게 아니라 파일 자체에")
//
// PNG 는 그림 말고도 글 조각(chunk)을 담을 수 있다. 시간표 그림을 내보낼 때 끝(IEND) 앞에 iTXt 조각 하나를 넣는다:
//   열쇠 IMAGE_KEY, 압축 없음, 글 = imagePayload(t) 의 JSON(UTF-8). 그림을 보는 프로그램은 이 조각을 그냥 지나친다.
// 넣는 것: 학기, 이름, 항목(강좌의 교과목번호·강좌번호·과목명·교수·학점·구분·편람 수업 base·사용자가 정한 수업 own·같은 시간 분반 alts·색,
//   직접 넣은 일정의 이름·시간·장소·색). 넣지 않는 것: 메모(그림에 안 보이는 사사로운 글), 시간표 id·만든 때·대표 표시·탐색 기준.
// 이 조각은 파일을 그대로 옮길 때만 남는다. 메신저가 '사진'으로 보내며 다시 압축하거나(JPEG 로 바뀐다) 화면을 캡처하면 사라진다.

export const IMAGE_KEY = "TTWizard"; // iTXt 열쇠(라틴 글자 1~79자)
export const IMAGE_VERSION = 1; // 이미지에 넣는 자료의 판. 뜻을 바꾸면 올린다(옛 앱은 새 판을 'newer' 로 알린다)
const IMAGE_MAX = 256 * 1024; // 읽을 때 이보다 긴 글은 버린다(학기에 50개 × 넉넉한 항목도 수십 KB)
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable = null;
/** PNG 조각의 CRC-32(ISO 3309, 다항식 0xEDB88320) */
function crc32(bytes, start = 0, end = bytes.length) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const isPng = (b) => b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);
const asBytes = (data) => (data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data)
  : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null);

/** PNG 조각들 [{type, at(조각 시작), size(조각 전체 길이), data: [시작, 끝), crcOk}]. 모양이 어긋나면 null */
function pngChunks(b) {
  if (!isPng(b)) return null;
  const out = [];
  for (let i = 8; i < b.length;) {
    if (i + 12 > b.length) return null;
    const len = u32(b, i);
    if (len > b.length - i - 12) return null;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    out.push({ type, at: i, size: len + 12, data: [i + 8, i + 8 + len], crcOk: crc32(b, i + 4, i + 8 + len) === u32(b, i + 8 + len) });
    i += len + 12;
    if (type === "IEND") return out;
  }
  return null; // IEND 가 없다
}

/** iTXt 조각의 열쇠(글은 읽지 않는다). 모양이 어긋나면 null */
function itxtKey(b, [start, end]) {
  let k = start;
  while (k < end && k - start < 80 && b[k] !== 0) k++;
  return k < end && b[k] === 0 && k > start ? String.fromCharCode(...b.subarray(start, k)) : null;
}

/** iTXt 조각의 [열쇠, 글]. 압축한 iTXt 는 글을 null 로(우리는 압축하지 않는다). 글이 UTF-8 이 아니면 던진다 */
function readITXt(b, [start, end]) {
  const zero = (from) => { for (let i = from; i < end; i++) if (b[i] === 0) return i; return -1; };
  const k = zero(start);
  if (k < 0 || k + 2 >= end) return null;
  const key = String.fromCharCode(...b.subarray(start, k));
  if (b[k + 1] !== 0) return [key, null]; // 압축됨
  const lang = zero(k + 3);
  const trans = lang < 0 ? -1 : zero(lang + 1);
  if (trans < 0) return null;
  return [key, new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(trans + 1, end))];
}

/** 이미지에 넣을 자료(JSON 으로 쓸 수 있는 값). 메모는 빼고 화면에 보이는 것과 시간표를 똑같이 다시 만드는 데 필요한 것만 */
export function imagePayload(t) {
  return { app: "ttwizard", v: IMAGE_VERSION, sem: t.sem, title: t.title, items: t.items.map(({ memo, ...it }) => it) };
}

/**
 * PNG(화면이 그린 시간표 그림) 끝에 시간표 자료를 넣은 새 PNG 를 돌려준다(받은 것은 고치지 않는다). 전에 넣은 TTWizard 조각이 있으면 바꾼다.
 * png: Uint8Array | ArrayBuffer (canvas.toBlob → blob.arrayBuffer()). PNG 가 아니면 null
 */
export function addTimetableToPng(png, t) {
  const b = asBytes(png);
  const parts = b && pngChunks(b);
  if (!parts || parts[parts.length - 1].type !== "IEND") return null;
  const enc = new TextEncoder();
  const body = [...enc.encode(IMAGE_KEY), 0, 0, 0, 0, 0, ...enc.encode(JSON.stringify(imagePayload(t)))]; // 열쇠·0·압축 안 함·방법 0·언어 ""·0·번역 열쇠 ""·0·글
  const chunk = new Uint8Array(12 + body.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, body.length);
  chunk.set([105, 84, 88, 116], 4); // "iTXt"
  chunk.set(body, 8);
  dv.setUint32(8 + body.length, crc32(chunk, 4, 8 + body.length));
  const keep = parts.filter((c) => !(c.type === "iTXt" && itxtKey(b, c.data) === IMAGE_KEY));
  const iend = keep[keep.length - 1];
  const size = 8 + keep.reduce((n, c) => n + c.size, 0) + chunk.length;
  const out = new Uint8Array(size);
  out.set(b.subarray(0, 8), 0);
  let at = 8;
  for (const c of keep) {
    if (c === iend) { out.set(chunk, at); at += chunk.length; }
    out.set(b.subarray(c.at, c.at + c.size), at);
    at += c.size;
  }
  return out;
}

/**
 * 고른 이미지 파일의 내용 → { payload } 또는 { problem }.
 *   problem: "not-png"(PNG 가 아니다. jpeg 이면 "jpeg": 메신저가 사진으로 다시 압축했을 때) | "no-data"(PNG 인데 시간표 자료가 없다)
 *            | "broken"(자료 조각이 깨졌다) | "newer"(더 새 판 앱이 만든 이미지)
 */
export function readTimetableImage(data) {
  const b = asBytes(data);
  if (!b) return { problem: "not-png" };
  if (!isPng(b)) return { problem: b.length > 2 && b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : "not-png" };
  const parts = pngChunks(b);
  if (!parts) return { problem: "broken" };
  for (const c of parts) {
    if (c.type !== "iTXt" || itxtKey(b, c.data) !== IMAGE_KEY) continue;
    let kv;
    try { kv = readITXt(b, c.data); } catch { kv = null; }
    if (!c.crcOk || !kv || kv[1] === null || kv[1].length > IMAGE_MAX) return { problem: "broken" };
    let payload;
    try { payload = JSON.parse(kv[1]); } catch { return { problem: "broken" }; }
    if (!payload || typeof payload !== "object" || payload.app !== "ttwizard" || typeof payload.sem !== "string" || !Array.isArray(payload.items)) return { problem: "broken" };
    if (!Number.isInteger(payload.v) || payload.v < 1) return { problem: "broken" };
    if (payload.v > IMAGE_VERSION) return { problem: "newer" };
    return { payload };
  }
  return { problem: "no-data" };
}

/**
 * 읽은 자료 → 새 시간표(목록에 넣기 전, 학기는 payload.sem). list 는 그 학기의 목록(이름 겹침·50개 확인).
 * 이름은 그대로, 겹치면 '이름 (2)'. 항목은 기기에서 읽을 때(parseList)와 같은 규칙으로 다듬고, 직접 넣은 일정은 새 id. 꽉 찼으면 null
 */
export function timetableFromImage(payload, list, { now = new Date() } = {}) {
  const [clean] = parseList([{ v: VERSION, id: "image", sem: payload.sem, title: payload.title, items: payload.items }], payload.sem);
  if (!clean) return null;
  const items = clean.items.map((it) => (it.custom ? { ...it, custom: newId("c") } : it));
  return createTimetable(list, payload.sem, { title: cleanTitle(payload.title), items, now });
}

// ---------------------------------------------------------------- 홈 화면 위젯 (10/30 사용자: 다음 수업·오늘 수업·주간 시간표 "셋 다 만들고")
//
// 안드로이드 위젯 셋은 앱이 꺼져 있어도 그려야 해서, 화면(app.js)이 대표 시간표를 위젯이 읽는 자료(widgetData)로 바꿔 앱 연결에 넘기고
// (TTW_APP.updateWidgets) 앱이 기기 안(SharedPreferences)에 둔다. 위젯은 그 자료만 보고 시각에 맞춰 그린다(docs/app.md '홈 화면 위젯'). 서버로 보내지 않는다.
//
// 자료 { v: 1, colors: "item" | "cls"(칸 색 설정), home: 출발·도착 지점 id(걷기를 셀 때 쓴 것, 모르면 ""), terms: [학기, ...] }.
//   같은 시간표면 같은 글이 되게 만든 시각은 넣지 않는다(앱 연결·앱이 같은 자료를 거른다)
//   학기 { sem, label: "2026년 2학기", title: 대표 시간표 이름, from, to: "YYYY-MM-DD"(위젯이 이 학기를 보이는 날들, termDates),
//          days: 월~일 일곱 칸 [[수업, ...], ...](시작 시각 차례), untimed: 시간이 정해지지 않은 항목 수 }
//   수업 { name, place: "301동 118호"(강의실 미정이면 ""), b: 건물 id(이동시간 지점 "301", 강의실 미정이면 ""), start, end: 자정부터 분,
//          color: 0~7, cls: "req"|"elec"|"gen"|"etc", walk: 앞 자리에서 걷는 분(반올림. 모르면 null),
//          from: "home"(그날 첫 위치 확정 수업 = 출발 지점에서) | "class"(앞 수업에서), late: 앞 수업에서 오면 늦는 분(반올림. 늦지 않으면 0) }
//   b·home 은 동선 지도 위젯이 길을 그리는 데 쓴다(10/30 update70)
//   걷는 시간은 동선 탐색(engine.evaluate)과 같은 규칙이다: 강의실 미정 수업은 자리를 옮기지 않고 그 앞의 쉬는 시간을 다음 이동에 보탠다.

export const WIDGET_VERSION = 1;
const TERM_NAMES = { 1: "1학기", S: "여름학기", 2: "2학기", W: "겨울학기" };
// 위젯이 학기를 보이는 날들(학사 일정 자료가 없어 어림. 1학기 3월~6월 21일, 여름 6월 22일~8월, 2학기 9월~12월 21일, 겨울 12월 22일~2월)
const TERM_DAYS = { 1: ["03-01", "06-21"], S: ["06-22", "08-31"], 2: ["09-01", "12-21"], W: ["12-22", "02-"] };
const CLS_KEYS = { 전필: "req", 전선: "elec", 교양: "gen" }; // app.js 의 CLS_GROUPS 와 같다(그 밖은 etc)
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; // 기기 시각의 날짜

/** 학기 → { from, to }(위젯이 그 학기를 보이는 첫날·끝날, "YYYY-MM-DD"). 겨울학기는 다음 해 2월 끝날까지. 모르는 꼴이면 null */
export function termDates(sem) {
  const m = /^(\d{4})-([12SW])$/.exec(String(sem || ""));
  if (!m) return null;
  const y = Number(m[1]), [a, b] = TERM_DAYS[m[2]];
  if (m[2] !== "W") return { from: `${y}-${a}`, to: `${y}-${b}` };
  const leap = (y + 1) % 4 === 0 && ((y + 1) % 100 !== 0 || (y + 1) % 400 === 0);
  return { from: `${y}-${a}`, to: `${y + 1}-${b}${leap ? 29 : 28}` };
}

/** 학기 이름 '2026년 2학기'(app.js 의 semesterLabel 과 같다) */
export function termLabel(sem) {
  const [y, k] = String(sem || "").split("-");
  return TERM_NAMES[k] ? `${y}년 ${TERM_NAMES[k]}` : "";
}

/** 위젯에 넘길 학기들: 끝나지 않은 학기(to 가 오늘 이후)를 시작 차례로 셋까지. 화면은 이 학기들의 대표 시간표를 widgetData 에 넘긴다 */
export function widgetSemesters(sems, now = new Date()) {
  const today = ymd(now);
  return [...new Set(sems)].map((sem) => [sem, termDates(sem)]).filter(([, d]) => d && d.to >= today)
    .sort((a, b) => (a[1].from < b[1].from ? -1 : a[1].from > b[1].from ? 1 : 0)).slice(0, 3).map(([sem]) => sem);
}

/** 강의실 표기(app.js roomLabel 과 같은 꼴, 직접 입력 표시는 뺀다): 301동 118호, 호수가 글자면 301동 강당, 건물만 알면 301동 */
function placeOf(m) {
  if (!m.building) return "";
  if (!m.room) return `${m.building}동`;
  return /^[A-Za-z]?\d/.test(m.room) ? `${m.building}동 ${m.room}호` : `${m.building}동 ${m.room}`;
}

/** 하루 수업들(시작 차례) → 위젯의 수업. 걷는 시간·늦음은 engine.evaluate 와 같은 차례로 잰다 */
function widgetDay(list, { name, place, minutes, home }) {
  list.sort((x, y) => x.m.start - y.m.start || x.m.end - y.m.end);
  let prevLoc = home || "", prevEnd = null, placed = false, spare = 0;
  return list.map(({ e, m }) => {
    const it = e.item;
    const x = { name: String(name(e) || ""), place: m.building ? String(place(m) || "") : "", b: String(m.building || ""), start: m.start, end: m.end,
      color: Number.isInteger(it.color) && it.color >= 0 ? it.color % COLORS : 0, cls: it.custom ? "etc" : CLS_KEYS[it.cls] || "etc",
      walk: null, from: placed ? "class" : "home", late: 0 };
    if (!m.building) { // 강의실 미정: 자리를 옮기지 않고 쉬는 시간만 다음 이동에 보탠다
      if (placed) spare += m.start - prevEnd;
      prevEnd = m.end;
      return x;
    }
    const t = minutes && prevLoc ? Number(minutes(prevLoc, m.building)) : NaN;
    if (Number.isFinite(t)) {
      x.walk = Math.round(t);
      if (placed) {
        const slack = spare + m.start - prevEnd - t;
        if (slack < 0) x.late = Math.max(0, Math.round(-slack));
      }
    }
    prevLoc = m.building;
    prevEnd = m.end;
    placed = true;
    spare = 0;
    return x;
  });
}

/**
 * 위젯 자료(위 머리의 꼴). terms = [{ t: 대표 시간표, entries }] — entries 는 화면이 그리는 항목(reconcile 이나 ttEntries 결과, 학기마다).
 * opts: name(entry) 화면의 과목명, place(meeting) 강의실 표기, minutes(a, b) 걷는 분(TravelMatrix.minutes, 없으면 걷기를 적지 않는다),
 *       home 출발 지점 id, colors 칸 색 설정("item" | "cls")
 */
export function widgetData(terms, { name = (e) => (e.item.custom ? e.item.title : e.item.name), place = placeOf, minutes = null, home = "",
  colors = "item" } = {}) {
  const out = [];
  for (const term of terms || []) {
    const { t, entries } = term || {};
    const dates = t && termDates(t.sem);
    if (!dates) continue;
    const days = [[], [], [], [], [], [], []];
    let untimed = 0;
    for (const e of entries || []) {
      const ms = (e.meetings || []).filter((m) => Number.isInteger(m.day) && m.day >= 0 && m.day < 7 && m.end > m.start);
      if (!ms.length) { untimed += 1; continue; }
      for (const m of ms) days[m.day].push({ e, m });
    }
    out.push({ sem: t.sem, label: termLabel(t.sem), title: String(t.title || ""), from: dates.from, to: dates.to,
      days: days.map((list) => widgetDay(list, { name, place, minutes, home })), untimed });
  }
  return { v: WIDGET_VERSION, colors: colorMode(colors), home: String(home || ""), terms: out };
}

/** 출발 지점(app.js 와 같은 규칙): 둔 값이 지금 자료의 지점이면 그것, 없는 기숙사 동(919 → 919A~D)이면 첫 기숙사 동, 아니면 자료의 첫 출발 후보 */
function homeOf(saved, campus) {
  const homes = (campus.homes || []).map(([b]) => b), ids = campus.ids || [];
  if (typeof saved === "string" && saved && (homes.includes(saved) || ids.includes(saved))) return saved;
  const dorms = new Set((campus.dorms || []).map(([b]) => b));
  const dorm = homes.find((b) => dorms.has(b));
  if (typeof saved === "string" && dorms.has(saved) && dorm) return dorm;
  return homes[0] || ids[0] || "";
}

/**
 * 기기에 둔 값만으로 위젯 자료를 만든다: 앱 연결(app/src/native.js)이 화면을 기다리지 않고 앱을 켤 때·내릴 때 부른다(10/30).
 *   get(key)  기기에 둔 값('ttw.' 를 뗀 열쇠, JSON 을 푼 값. 없으면 undefined), keys  둔 열쇠들('ttw.' 를 뗀 것)
 *   campus    data/campus.json(없으면 걷기를 적지 않는다), travel(campus, mode)  이동 행렬(engine.js 의 TravelMatrix.fromCampus)
 * 학기마다 'timetables@학기' 의 대표 시간표를 적어 둔 수업(own·base)으로 쓴다(편람과 맞추지 않는다. 화면이 updateWidgets 를 부르면 그쪽이 편람과 맞춘 값).
 * 출발 지점 'home'·이동 기준 'mode'·칸 색 'timetableColor' 는 화면이 둔 값, 없으면 화면의 처음 값(자료의 첫 출발 후보, 경사 반영, 항목 색).
 */
export function widgetDataFromStore({ get, keys = [], campus = null, travel = null, now = new Date() }) {
  const sems = keys.map((k) => /^timetables@(\d{4}-[12SW])$/.exec(k)).filter(Boolean).map((m) => m[1]);
  const terms = [];
  for (const sem of widgetSemesters(sems, now)) {
    const t = parseList(get(`${STORE_KEYS.list}@${sem}`), sem).find((x) => x.primary && !x._newer);
    if (t) terms.push({ t, entries: reconcile(t, new Map()) });
  }
  let minutes = null, home = "";
  if (campus && Array.isArray(campus.ids) && typeof travel === "function") {
    const matrix = travel(campus, campus.slope && get("mode") !== "flat" ? "slope" : "flat");
    minutes = (a, b) => matrix.minutes(a, b);
    home = homeOf(get("home"), campus);
  }
  return widgetData(terms, { minutes, home, colors: get(STORE_KEYS.color) });
}
