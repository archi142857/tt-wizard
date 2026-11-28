// 로그인·기기 간 동기화·친구 시간표의 순수 함수 — 백엔드 update110(사용자 11/14 '로그인이랑 친구 시간표도 지금 작업 시작하라고', 16일 데모데이).
// 서버(Firebase)를 부르지 않는다: 합치기·올릴 꼴·친구에게 보이는 사본·닉네임. Firebase 연결은 account.js. 설계는 공유 폴더 `계정_동기화_설계안.md` 5~7절, docs/account.md.
//
// 기기 자료가 먼저다(로컬 우선). 서버는 사본이고, 합치는 단위는 시간표 하나(같은 id 면 updated 가 늦은 쪽).
// 지운 시간표는 서버에 '지움 표시'(deleted, 내용 없음)로 남겨 다른 기기에서도 지운다. 지난번 맞출 때 서버에 있던 id(known)로
// '이 기기에서 지운 것'과 '다른 기기에서 새로 만든 것'을 가른다.
// 서버에 올리지 않는 것: 강좌 항목의 교수 이름(instructor, 기기에서 편람으로 채운다: 화면은 timetables.reconcile 이 지금 편람의 이름을 쓴다), 출발 지점 설정(from: 사는 곳을 짐작할 수 있다).
// 친구에게 보이는 것: 학기마다 대표 시간표의 강좌(과목명·시간·강의실)와 직접 넣은 일정의 제목·시간. 메모·장소는 안 보인다.
// '친구에게 숨기기'(hidden) 항목은 시간만 간다(이름·과목 번호·강의실·색 없이 { hidden: true, meetings: [{ day, start, end }] }, 친구 화면의 회색 칸.
// 디자인 130판·사용자 11/14 '숨길 과목은 회색 박스로', update112). '친구에게 보이기'를 끈 시간표(shareOff)는 아무것도 안 간다.

import { parseList, uniqueTitle } from "./timetables.js";

export const NICK_MIN = 2;
export const NICK_MAX = 12;
/** 닉네임에 쓰는 글자: 한글·영문·숫자·밑줄(가운데 공백 하나까지) */
const NICK_RE = /^[0-9A-Za-z가-힣_]+(?: [0-9A-Za-z가-힣_]+)?$/;
/** 남에게 보이는 글이라 거르는 말(작게 시작한다. 신고가 오면 늘린다) */
export const BANNED = ["관리자", "운영자", "admin", "서울대", "snu", "ttwizard", "tt wizard", "씨발", "시발", "병신", "개새", "좆", "섹스", "sex", "fuck", "shit"];

/** 닉네임 문제(없으면 null): "short" | "long" | "chars" | "banned" */
export function nickProblem(nick) {
  const s = String(nick ?? "").trim();
  if ([...s].length < NICK_MIN) return "short";
  if ([...s].length > NICK_MAX) return "long";
  if (!NICK_RE.test(s)) return "chars";
  const low = s.toLowerCase().replace(/[\s_]/g, "");
  if (BANNED.some((w) => low.includes(w.replace(/\s/g, "")))) return "banned";
  return null;
}

// ---------------------------------------------------------------- 계정 번호
// 계정마다 숫자 여섯 자리 번호(000000~999999, 0으로 시작해도 된다. 사용자 11/18) 하나. 닉네임을 바꿔도 번호는 그대로다.
// 친구는 '닉네임#번호'로 찾는다. 닉네임이 지금 닉네임과 같아야 하고 번호만으로는 찾지 못한다(사용자 11/17 법무 채팅 '닉네임 + 번호로 친구추가
// 되게 하고, 현재 닉네임과 다르면 초대 발송이 안되는 걸로'). 2026-11-17 전의 '닉네임#네 자리'도 그때 만든 초대 링크가 열리도록 읽는다.

/** 번호 꼴: 숫자 여섯 자리(예전 네 자리와는 길이로 가른다) */
export const NUMBER_RE = /^[0-9]{6}$/;
export const isNumber = (tag) => NUMBER_RE.test(String(tag ?? ""));

/**
 * 친구 찾기 칸·초대 링크의 글 → { nick, tag }. 꼴이 아니면 null.
 *   '영표#482193', ' 영표 # 482193 ' → { nick: '영표', tag: '482193' }
 *   '영표#0420'                    → { nick: '영표', tag: '0420' }(예전 초대 링크)
 *   '482193'·'#482193'(닉네임 없음) → null
 */
export function parseHandle(text) {
  const m = /^\s*(.+?)\s*#\s*([0-9]{6}|[0-9]{4})\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const bad = nickProblem(m[1]);
  if (bad === "chars" || bad === "short" || bad === "long") return null;
  if (m[2].length === 6 && !isNumber(m[2])) return null;
  return { nick: m[1], tag: m[2] };
}

/** 찾는 열쇠(대소문자·공백 차이 없이): 'TT Wizard#482193' → 'ttwizard#482193'. 서버 handles 문서 이름이고 규칙의 keyOf 와 같다 */
export function handleKey(nick, tag) {
  return `${String(nick).toLowerCase().replace(/\s/g, "")}#${tag}`;
}

/** 새 번호 하나(겹치는지는 서버가 본다). 기기의 암호 난수가 있으면 그것으로 */
export function randomNumber(rand = null) {
  let x;
  if (rand) x = rand();
  else if (globalThis.crypto && globalThis.crypto.getRandomValues) x = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  else x = Math.random();
  return String(Math.min(999999, Math.floor(x * 1000000))).padStart(6, "0");
}

// ---------------------------------------------------------------- 서버에 올릴 꼴

// Firestore 는 배열 안의 배열을 못 둔다: 수업 [요일, 시작, 끝, 동, 호]는 서버에서 { day, start, end, building, room } 으로
const toObj = (ms) => (Array.isArray(ms) ? ms.map((m) => (Array.isArray(m) ? { day: m[0], start: m[1], end: m[2], building: m[3] || "", room: m[4] || "" } : m)) : ms);
const toTuple = (ms) => (Array.isArray(ms) ? ms.map((m) => (m && !Array.isArray(m) && typeof m === "object" ? [m.day, m.start, m.end, m.building || "", m.room || ""] : m)) : ms);
const MEETING_KEYS = ["base", "own", "meetings"];
const mapMeetings = (it, f) => { const x = { ...it }; for (const k of MEETING_KEYS) if (k in x) x[k] = f(x[k]); return x; };

/** 시간표 → 서버 문서: 교수 이름과 출발 지점 설정을 뺀다. 새 판이 적은 것(_newer)은 그 원본 그대로 */
export function toServer(t) {
  if (t._newer) return { ...t._raw, items: (t._raw.items || []).map((it) => mapMeetings(it, toObj)) };
  const { from, primary, ...rest } = t;
  const doc = { ...rest, primary: !!primary, items: (t.items || []).map((it) => { const { instructor, ...x } = it; return mapMeetings(x, toObj); }) };
  return doc;
}

/** 서버 문서 → 시간표(parseList 로 꼴을 고른다). 기기의 같은 시간표가 있으면 그 출발 지점 설정과 교수 이름을 이어 쓴다 */
export function fromServer(doc, local = null) {
  const raw = { ...doc, items: (doc.items || []).map((it) => mapMeetings(it, toTuple)) };
  if (!raw.primary) delete raw.primary;
  delete raw.deleted;
  const [t] = parseList([raw], doc.sem);
  if (!t) return null;
  if (local && local.from) t.from = { ...local.from };
  if (local && !t._newer) {
    const names = new Map((local.items || []).filter((it) => !it.custom).map((it) => [`${it.course}-${it.no}`, it.instructor]));
    t.items = t.items.map((it) => (it.custom || it.instructor ? it : { ...it, instructor: names.get(`${it.course}-${it.no}`) || "" }));
  }
  return t;
}

const newer = (a, b) => String(a || "") > String(b || "");

/**
 * 기기 시간표들과 서버 문서들을 합친다.
 *   local  = { sem: [시간표, ...] }(parseList 결과), remote = [서버 문서(지움 표시 { id, sem, deleted: true, updated } 포함)],
 *   known  = 지난번 맞춘 뒤 서버에 있던 시간표 id 들(처음이면 빈 것), now = 지움 표시에 적을 때(ISO)
 * → { local: { sem: 새 목록 }(바뀐 학기만), upload: [올릴 문서], known: [이제 서버에 있는 id] }
 * 학기마다 대표는 하나: 둘 이상이면 늦게 고친 쪽, 없으면 가장 늦게 고친 시간표(지운 뒤 deleteTimetable 과 같다).
 * 서버에서 새로 온 시간표의 이름이 기기 것과 겹치면 '이름 (2)'.
 */
export function mergeTimetables(local, remote, known = [], now = new Date().toISOString()) {
  const wasKnown = new Set(known);
  const remoteById = new Map((remote || []).filter((d) => d && typeof d.id === "string").map((d) => [d.id, d]));
  const out = {}, changed = new Set(), upload = [], nowKnown = new Set();
  const localIds = new Set();
  for (const [sem, list] of Object.entries(local || {})) {
    out[sem] = [];
    for (const t of list || []) {
      localIds.add(t.id);
      const r = remoteById.get(t.id);
      if (!r) { // 서버에 없다: 올린다
        out[sem].push(t);
        upload.push(toServer(t));
        nowKnown.add(t.id);
      } else if (r.deleted) { // 다른 기기에서 지웠다. 그 뒤에 이 기기에서 고쳤으면 살린다
        if (newer(t.updated, r.updated)) { out[sem].push(t); upload.push(toServer(t)); nowKnown.add(t.id); } else changed.add(sem);
      } else if (newer(r.updated, t.updated)) { // 서버가 새것
        const x = fromServer(r, t);
        if (x && x.sem === sem) out[sem].push(x);
        else if (x) { (out[x.sem] ||= []).push(x); changed.add(x.sem); }
        changed.add(sem);
        nowKnown.add(t.id);
      } else {
        out[sem].push(t);
        if (newer(t.updated, r.updated) || r.sem !== t.sem) upload.push(toServer(t));
        nowKnown.add(t.id);
      }
    }
  }
  for (const r of remoteById.values()) {
    if (localIds.has(r.id) || r.deleted) continue;
    if (wasKnown.has(r.id)) { // 이 기기에서 지웠다 → 서버에도 지움 표시
      upload.push({ id: r.id, sem: r.sem, deleted: true, updated: now });
      continue;
    }
    const x = fromServer(r, null); // 다른 기기에서 만든 것
    if (!x) continue;
    const list = (out[x.sem] ||= []);
    x.title = uniqueTitle(x.title, list.map((y) => y.title));
    list.push(x);
    changed.add(x.sem);
    nowKnown.add(x.id);
  }
  // 학기마다 대표 하나
  for (const [sem, list] of Object.entries(out)) {
    const primaries = list.filter((t) => t.primary);
    const pool = (primaries.length ? primaries : list).filter((t) => !t._newer);
    const keep = pool.length ? pool.reduce((a, b) => (newer(b.updated, a.updated) ? b : a)) : null;
    if (!keep) continue;
    if (primaries.length === 1 && primaries[0] === keep) continue;
    out[sem] = list.map((t) => {
      if (t === keep) return t.primary ? t : { ...t, primary: true };
      if (!t.primary) return t;
      const { primary, ...rest } = t;
      return rest;
    });
    changed.add(sem);
  }
  const result = {};
  for (const sem of changed) result[sem] = out[sem] || [];
  return { local: result, upload, known: [...nowKnown] };
}

// ---------------------------------------------------------------- 친구에게 보이는 사본

const plain = (ms) => (ms || []).map((m) => ({ day: m[0], start: m[1], end: m[2], building: String(m[3] || ""), room: String(m[4] || "") }));

/**
 * 시간표 → 친구에게 보이는 항목: 강좌 {course, no, name, meetings(정한 수업, 없으면 편람 수업), color}, 직접 넣은 일정 {title, meetings(시간만), color},
 * 숨긴 항목 {hidden: true, meetings: [{ day, start, end }]}(무엇인지 알 수 있는 것은 없이 시간만, 회색 칸).
 * meetings = [{ day, start, end, building, room }](Firestore 에 그대로 둘 수 있는 꼴. 일정은 building·room 이 "")
 */
export function friendItems(t) {
  const out = [];
  for (const it of (t && t.items) || []) {
    if (it.hidden) {
      const ms = plain(it.custom ? it.meetings : it.own || it.base).map(({ day, start, end }) => ({ day, start, end }));
      if (ms.length) out.push({ hidden: true, meetings: ms });
      continue;
    }
    const color = Number.isInteger(it.color) ? { color: it.color } : {};
    if (it.custom) out.push({ title: it.title, meetings: plain(it.meetings).map((m) => ({ ...m, building: "", room: "" })), ...color });
    else out.push({ course: it.course, no: it.no, name: it.name, meetings: plain(it.own || it.base), ...color });
  }
  return out;
}

/** 학기 차례 값(새 학기일수록 크다): 해 × 4 + 1학기 0 · 여름학기 1 · 2학기 2 · 겨울학기 3(app.js semRank 와 같다). 모르는 꼴은 -1 */
export function semOrder(sem) {
  const m = /^(\d{4})-([12SW])$/.exec(String(sem ?? ""));
  return m ? Number(m[1]) * 4 + { 1: 0, S: 1, 2: 2, W: 3 }[m[2]] : -1;
}

/** 친구 시간표 차례(account.friendTimetables): 새 학기가 앞(2026-W > 2026-2 > 2026-S > 2026-1 > 2025-W …), 모르는 꼴은 뒤.
 *  11/20 사용자 '이거 순서 왜 이럼'(글자 차례라 2026-S 가 2026-2 앞에 왔다, 프론트엔드 ui153 이 화면에서 먼저 맞춤) */
export const newerSemFirst = (a, b) => semOrder(b && b.sem) - semOrder(a && a.sem) || String(b && b.sem).localeCompare(String(a && a.sem));

/** 학기마다 올릴 친구 사본: { sem: { sem, items, updated, look? } 또는 null(지운다) }. lists = { sem: [시간표] }.
 *  시간표 이름(title)은 올리지 않는다(update157. 법무 11/28: 친구 화면이 쓰지 않고 처리방침과 '친구에게 보이는 것'에도 없는 값이라 필요한 것만 보내기).
 *  look: 올리는 기기에서 보이는 테마('light'·'dark'·이벤트 테마 id 'xmas' 등, update141. 11/20 사용자 '친구 시간표는 친구의 테마로 보여줘야 함. 내 테마로 적용하지 말고').
 *  친구 화면이 이 테마의 칸 색으로 격자를 그린다. 낱말이 아니면 넣지 않는다(옛 판 사본처럼 보는 사람의 테마) */
export function friendCopies(lists, now = new Date().toISOString(), look = "") {
  const out = {}, lk = typeof look === "string" && /^[a-z]{1,16}$/.test(look) ? { look } : {};
  for (const [sem, list] of Object.entries(lists || {})) {
    const t = (list || []).find((x) => x.primary && !x._newer);
    out[sem] = t && !t.shareOff ? { sem, items: friendItems(t), updated: t.updated || now, ...lk } : null;
  }
  return out;
}
