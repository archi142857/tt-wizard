// TT Wizard 화면(디자인 규칙 v3.5). 자료(data/*.json)는 scripts/export_web.py 가 만들고, 탐색은 engine.js 가 브라우저에서 한다.
// 앱은 아래 탭 셋이다(10/22, 테마는 10/23 오후): 내 시간표(저장한 시간표, 과목 추가), 탐색(입력, 결과), 테마(테마 고르기). 정보(정보 → 자료 출처·
// 개발자 정보·오픈소스 라이선스)는 탭과 같은 층의 따로 된 묶음이고(10/23) 전체 화면 지도가 그 위에 뜬다. 화면만 방문 기록(pushState)을 남기고 탭 바꾸기와 시트(<dialog>)는 남기지 않는다.
// 화면 문구는 디자인 규칙 '문구'를 따른다(문장은 해요체 한 줄, 그 밖에는 명사구).
import { DAY_KO, parseCourses, TravelMatrix, search, countFeasible, routeLine, whyNone, meetsRules } from "./engine.js";
import { indexCourses as indexSearch, searchCourses, splitMarks, normKey } from "./search.js";
import * as T from "./timetables.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 어디서 도는지: 웹, 설치한 PWA, 스토어 앱(Capacitor 의 android·ios)
// 앱마다 다른 것(설치 안내, 서비스 워커와 새 버전 알림, 외부 링크, 햅틱)은 이 값으로만 가른다. CSS 는 html[data-shell] 을 본다.
// 스토어 앱은 안드로이드·iOS 모두 Capacitor 다(10/1 update34, TWA 는 쓰지 않는다). 앱 연결 스크립트(js/native.js, 백엔드 몫)가
// 이 파일보다 먼저 돌며 자료 받기, 안드로이드 뒤로 가기(열린 시트 닫기 → 이전 화면 → 앱 내리기), <html data-platform> 을 맡는다
const capacitor = window.Capacitor;
const SHELL = capacitor?.isNativePlatform?.() ? (capacitor.getPlatform?.() === "android" ? "android" : "ios")
  : (matchMedia("(display-mode: standalone)").matches || navigator.standalone) ? "pwa" : "web";
const IN_APP = SHELL === "android" || SHELL === "ios"; // 스토어 앱: 서비스 워커·설치 안내·새 버전 알림 없음, 외부 링크는 Capacitor Browser
document.documentElement.dataset.shell = SHELL;

// ---------------------------------------------------------------- 설정

const APP_VERSION = "0.9.0";
// 정보 화면 링크. 주소가 정해지면 넣는다(비어 있으면 그 행을 보이지 않는다)
const PRIVACY_URL = ""; // 개인정보 처리방침 공개 페이지(스토어에 적는 주소와 같게)
// 개발자 정보(10/23 사용자가 정한 글. 처리방침의 개인정보 보호책임자·스토어 연락처와 같다). 메일은 누르면 메일 앱이 제목을 채워 연다
const DEV_NAME = "동물생명공학전공 25학번 이영표";
const DEV_MAIL = "sanger.lee138@gmail.com";
const DEV_MAIL_HREF = `mailto:${DEV_MAIL}?subject=${encodeURIComponent("TT Wizard 문의")}`;
const REVIEW_URL = { android: "", ios: "" }; // 스토어 앱 페이지(스토어 앱에서만 '리뷰 남기기')
const CATALOG_URL = "https://sugang.snu.ac.kr/"; // 수강편람 누리집(자료 출처, 시트의 '수강편람' 링크)
const RESULTS_STEP = 8; // 폰 검색 결과: 처음 개수이자 '더 보기' 한 번에 더 보이는 개수
// 넓은 화면 결과 카드(검색 결과, 과목 둘러보기)는 더 보기 없이 다 보인다(10/2 사용자). 처음엔 FEED_STEP 개를 그리고 끝의 FEED_LEAD 개 행
// 가운데 하나가 보이면 다음 FEED_STEP 개를 이어 붙인다(결과 2천 개를 한 번에 그리지 않게, 한 글자 칠 때 16개만. 카드 안 스크롤은 style.css)
const FEED_STEP = 16, FEED_LEAD = 6;
// 후보 카드: 처음 목록에 올리는 수이자 '더 보기' 한 번에 붙는 수(넓은 화면의 2·3열이 꽉 차는 수). 목록 제목의 찾은 수도 이만큼씩 는다
// (10/4 사용자: 더 보기와 더 찾기를 하나로, 개수도 하나로)
const RANKS_STEP = 6;
// 처음 찾는 조합 수(24). 6개만 목록에 올리고 나머지는 찾아 둔다(아래 '순위'). RANKS_STEP 의 배수라 찾아 둔 것이 늘 한 번 누를 몫으로 떨어진다
const TOP_K = RANKS_STEP * 4;
// 워커를 못 쓰는 브라우저에서 화면 스레드로 계산할 때: 조합 수 어림(과목마다 분반 묶음 수를 곱한 것)이 이보다 크면
// 스피너를 먼저 띄우고 계산한다(계산하는 동안에는 500ms 뒤에 스피너를 그릴 수 없다)
const HEAVY = 100000;
const LONG_MS = 10000; // 계산이 이보다 길어질 것 같으면 진행 정도와 '취소'를 보인다
const TERMS = { 1: "1학기", S: "여름학기", 2: "2학기", W: "겨울학기" };
const TERM_ORDER = ["1", "S", "2", "W"]; // 한 해 안의 학기 순서(학기 선택칸)
// 추가 설정의 점심시간(아래 '추가 설정'): 길이는 30·60·90분, 시간대는 시작 10:00~14:00 · 끝 11:00~15:00 을 30분 단위로, 처음 값 11:00~14:00
const LUNCH_MINS = [30, 60, 90];
const LUNCH_FROM = 600, LUNCH_TO = 900, LUNCH_STEP = 30;
const LUNCH_WIN = { start: 660, end: 840 };
// 조합이 없는 까닭(엔진의 cause)마다 오류 줄과 태그. 추가 설정 때문일 때도 시간 겹침과 같은 자리, 같은 모양이고 말만 까닭을 따른다
const NONE_TEXT = { overlap: "겹치지 않는 조합이 없어요", freeDays: "공강 요일에 맞는 조합이 없어요", lunch: "점심시간에 맞는 조합이 없어요", rules: "추가 설정에 맞는 조합이 없어요" };
const NONE_TAG = { overlap: "시간 겹침", freeDays: "공강 요일", lunch: "점심시간", rules: "추가 설정" };
// 교과구분 색 묶음. 색은 style.css 의 cls-* 토큰, 메타 줄에는 원래 이름(일선, 교직)을 쓰고 색 묶음만 '기타'
const CLS_GROUPS = [["전필", "req"], ["전선", "elec"], ["교양", "gen"], ["기타", "etc"]];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = matchMedia("(pointer: coarse)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)"); // 마우스: 지도 확대·축소 버튼, 휠, 끌기

const state = {
  campus: null, routes: null, routesLoading: null, travel: {},
  current: "", semesters: [], semester: "", semesterMeta: {}, cache: new Map(), loading: false, loaded: false,
  courses: [], byId: new Map(),
  // 담은 과목 [{id, excluded: Set<분반 키>, name, cls, credit, dept}]. 이름 등은 자료에서 사라진 과목을 보이려고 함께 저장한다
  picks: [],
  overrides: {}, // 분반 키 → {rooms, meet, base} 직접 넣은 강의실·시간(아래 '직접 넣은 강의실·시간')
  home: "", homeOther: "", homeDorm: "", mode: "slope", // 출발·도착의 처음 값은 자료(campus.homes)의 첫 항목이다(지금은 정문)
  rules: { freeDays: [], lunch: null, win: { ...LUNCH_WIN } }, // 추가 설정: 공강 요일, 점심시간(없음이면 null), 점심을 껐다 켜도 남는 시간대
  // 오류: noSections 는 주요 버튼을 누른 뒤, overlap·general 은 조합이 없을 때(담을 때 바로, 또는 주요 버튼을 누른 뒤). cause = 조합이 없는 까닭(overlap·freeDays·lunch·rules)
  errors: { noSections: new Set(), overlap: new Set(), cause: "overlap", general: null },
  result: null, rank: 0, day: 0, reveal: false,
};

// ---------------------------------------------------------------- 작은 도구

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function svg(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

// 아이콘: 2px 선, 둥근 끝, 채움 없음(디자인 규칙 '아이콘')
const I = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  out: '<path d="M8 16L16 8M9.5 8H16v6.5"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  more: '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="3.2"/>',
  edit: '<path d="M4.5 19.5l.9-4.1L15.7 5.1a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.6 18.6z"/><path d="M13.6 7.2l3.2 3.2"/>', // 연필(시간표 목록 시트의 이름 입력칸. 누르는 것이 아니라 고칠 수 있다는 표시)
};
const icon = (paths, size = 24) => svg(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);
const HOME_PIN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7v9H4z"></path></svg>';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
const pad2 = (n) => String(n).padStart(2, "0");
const hm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const range = (a, b, step = 1) => { const out = []; for (let x = a; x <= b; x += step) out.push(x); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// 되살린 저장소로 새로 여는 중(아래 '스토어 앱의 저장소 되살리기'): 켤 때 읽은 빈 값으로 되살린 값을 덮지 않게 그 뒤로는 쓰지 않는다
let reopening = false;
const store = {
  get(k, d) { try { const v = localStorage.getItem("ttw." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (reopening) return; try { localStorage.setItem("ttw." + k, JSON.stringify(v)); } catch { /* 저장이 안 돼도 화면은 돈다(알리지 않는다) */ } },
  del(k) { if (reopening) return; try { localStorage.removeItem("ttw." + k); } catch { /* 무시 */ } },
};
// 담은 과목·직접 넣은 강의실과 시간은 학기마다 따로 둔다(같은 교과목번호·분반 번호라도 학기마다 다른 강좌다)
const semKey = (k, sem = state.semester) => `${k}@${sem}`;

/** 알림 영역(role=status, role=alert)에 읽을 문구. 같은 문구도 다시 읽히게 비웠다가 채운다. */
const liveTimers = {};
function announce(text, kind = "status") {
  // 시트(모달 dialog)가 열려 있으면 그 밖은 inert 라 화면의 알림 영역은 읽히지 않는다. 열린 시트 안에 알림 영역이 있으면 그것을 쓴다(과목 시트, 추가 설정 시트)
  const sheet = document.querySelector("dialog[open]");
  const el = (sheet && sheet.querySelector(`[data-live="${kind}"]`)) || $(kind);
  el.textContent = "";
  clearTimeout(liveTimers[kind]);
  liveTimers[kind] = setTimeout(() => { el.textContent = text; }, 60);
}

// ---------------------------------------------------------------- 표기 (디자인 규칙 '형식')

const fmtCredit = (x) => (x === null || x === undefined || x === "" ? "" : `${+x}학점`);
function dateParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? { mo: +m[2], d: +m[3], t: `${m[4]}:${m[5]}` } : null;
}
const asofShort = (iso) => { const p = dateParts(iso); return p ? `${p.mo}월 ${p.d}일 기준` : ""; };
const asofLong = (iso) => { const p = dateParts(iso); return p ? `${p.mo}월 ${p.d}일 ${p.t} 기준` : ""; };

function buildingLabel(b) {
  if (!b) return "강의실 미정";
  if (b === "GATE") return "정문";
  return `${b}동`;
}
// 기숙사 동(update40 자료): campus.json 의 dorms = [[동, 종류]]. ids 에 없는 동은 이동시간 지점이 아니라 고를 수도, 지도 번호로 쓸 수도 없다:
// 10/3(update44)부터 919 가 그렇다(919A~D 네 동으로 나뉘었고, 919 는 화면이 건물 번호로 그리지 않게 dorms 에만 남는다)
const DORM_NAME = { 학부: "학부생활관", 대학원: "대학원생활관", 글로벌: "글로벌생활관", 가족: "가족생활관", BK: "BK국제관" }; // 지도에 쓰는 이름(자료의 건물 이름 대신 종류로)
const dormKind = (b) => ((state.campus?.dorms || []).find(([id]) => id === b) || [])[1] || "";
const isDorm = (b) => !!dormKind(b);
/** 지도에 쓰는 건물 이름(많이 확대했을 때 번호 아래). */
const buildingName = (b) => DORM_NAME[dormKind(b)] || ((state.campus?.buildings || {})[b] || [])[0] || "";
/** 출발·도착 이름: 기숙사 동은 어느 동이든 '기숙사'(어느 동인지는 입력 화면 선택칸과 결과 화면 조건 줄만 밝힌다), 정문, 그 밖은 건물. */
function placeLabel(b) {
  if (isDorm(b)) return "기숙사";
  const home = (state.campus?.homes || []).find(([id]) => id === b);
  return home ? home[1] : buildingLabel(b);
}
/** 강의실: 301동 118호, 호수가 글자면 301동 강당, 건물만 알면 301동, 직접 넣은 건물은 301동 (직접 입력). */
function roomLabel(m) {
  if (!m.building) return "강의실 미정";
  if (m.manual) return `${m.building}동 (직접 입력)`;
  if (!m.room) return `${m.building}동`;
  return /^[A-Za-z]?\d/.test(m.room) ? `${m.building}동 ${m.room}호` : `${m.building}동 ${m.room}`;
}
const daysLabel = (days) => days.map((d) => DAY_KO[d]).join("·");

/** 분반 표기는 어디서나 061(나민애). 교수가 없으면 061(교수 미정). 번호와 교수를 따로 칠할 때는 sectionParts(이어 붙이면 같다). */
function instructorOf(s) {
  return String(s.instructor || "").trim() || "교수 미정";
}
function sectionParts(s) {
  return [String(s.no), `(${instructorOf(s)})`];
}
function sectionLabel(s) {
  return sectionParts(s).join("");
}

/** 시간표 칸처럼 좁은 곳에 쓰는 과목명: 끝의 부제 괄호를 뺀다. '글로벌 공학기술 교류 특강 2 (국제 물류)' → '… 특강 2' */
function shortName(name) {
  const s = String(name || "").replace(/\s*\([^()]*\)\s*$/, "");
  return s || name;
}

function clsKey(cls) {
  const g = CLS_GROUPS.find(([n]) => n === cls);
  return g ? g[1] : "etc";
}
const clsColor = (cls) => `var(--cls-${clsKey(cls)})`;
const clsFill = (cls) => `var(--cls-${clsKey(cls)}-bg)`;
/** 결과 화면 칸(.tt-block)의 글자색: 그 교과구분 칸 색의 글자색(디자인 80판. 기본 테마는 text·text2, 크리스마스의 짙은 칸(전필·전선)은 흰 과목명과 옅은 같은 색 강의실) */
const clsInk = (cls) => ({ "--fill-fg": `var(--cls-${clsKey(cls)}-fg)`, "--fill-fg2": `var(--cls-${clsKey(cls)}-fg2)` });

// ---------------------------------------------------------------- 직접 넣은 강의실·시간
// state.overrides[분반 키] = { rooms, meet, base }
//   rooms: {수업 번호: 건물}            편람의 강의실이 미정인 수업에 고른 건물(값 자리의 선택칸)
//   meet:  [[요일, 시작, 끝, 건물, 호]]  직접 넣은 수업 전체: 편람에 시간이 없는 분반에 넣은 시간이거나, 편람에 있는 시간·장소를 바꾼 것(10/5 사용자).
//          호는 편람의 건물을 그대로 둔 수업에 남고, 10/23 부터는 직접 넣을 수도 있다(입력 줄의 호실. 걷는 시간은 건물로 계산한다)
//   base:  meet 를 넣을 때의 편람 값(sigOf). 편람에 시간이 없던 분반이면 ""
// 예전에 저장한 times: [[요일, 시작, 끝, 건물]](시간 미정 분반에 넣은 시간)는 읽을 때 meet(base "")로 옮긴다

/** 수업 목록을 견주는 글(요일·시각·건물·호. 차례는 상관없다) */
const sigOf = (ms) => ms.map((m) => `${m.day},${m.start},${m.end},${m.building || ""},${m.room || ""}`).sort().join(";");
const meetOf = ([day, start, end, building, room]) => ({ day, start, end, building: building || "", room: room || "" });

/** 저장해 둔 직접 입력. 모양이 어긋난 것은 버린다 */
function readOverrides(sem) {
  const raw = store.get(semKey("overrides", sem), {});
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const ok = (t) => Array.isArray(t) && Number.isInteger(t[0]) && t[0] >= 0 && t[0] < 7 && Number.isFinite(t[1]) && Number.isFinite(t[2]) && t[2] > t[1];
  for (const [key, o] of Object.entries(raw)) {
    if (!o || typeof o !== "object") continue;
    const v = {};
    if (o.rooms && typeof o.rooms === "object" && Object.keys(o.rooms).length) v.rooms = { ...o.rooms };
    const list = Array.isArray(o.meet) ? o.meet : Array.isArray(o.times) ? o.times : null;
    if (list) {
      v.meet = list.filter(ok).map(([d, a, b, bd, room]) => [d, a, b, String(bd || ""), bd ? String(room || "") : ""]);
      v.base = Array.isArray(o.meet) && typeof o.base === "string" ? o.base : "";
      if (!v.meet.length && !v.base) { delete v.meet; delete v.base; } // 넣은 시간이 하나도 없다
    }
    if (v.rooms || v.meet) out[key] = v;
  }
  return out;
}

/**
 * 이 분반에 지금 쓰는 직접 입력(수업 목록). 없으면 null.
 * 편람에 시간이 없을 때 넣어 둔 시간(base "")은 편람에 시간이 생기면 쓰지 않는다(전부터 그랬다: 모르던 것을 채운 값이라 편람을 따른다. 저장해 둔 값은 남는다).
 * 편람에 있던 시간·장소를 바꾼 것은 편람이 달라져도 그대로 쓰고 '편람 바뀜'을 단다(catalogMoved).
 */
function ownMeetings(s) {
  const o = state.overrides[s.key];
  if (!o || !o.meet || (!o.base && s.meetings.length)) return null;
  return o.meet.map((t) => { const m = meetOf(t); m.manual = !!m.building && !m.room; return m; });
}

/** 직접 넣은 강의실·시간을 반영한 수업 목록. */
function effMeetings(s) {
  const own = ownMeetings(s);
  if (own) return own;
  const o = state.overrides[s.key];
  return s.meetings.map((m, i) => (!m.building && o && o.rooms && o.rooms[i] ? { ...m, building: o.rooms[i], room: "", manual: true } : m));
}

/** 편람에 있는 시간·장소를 바꿔 둔 분반인가(편람에 시간이 없는 분반에 넣은 시간은 '바꾼 것'이 아니다). */
const isChanged = (s) => s.meetings.length > 0 && !!ownMeetings(s);
/** 바꿔 둔 뒤에 편람 값이 달라졌나(바꿀 때의 편람 값과 지금 편람 값이 다르다). 과목 시트를 닫으면 본 것으로 친다(courseSheetClosed). */
const catalogMoved = (s) => isChanged(s) && state.overrides[s.key].base !== sigOf(s.meetings);

/** 직접 넣은 수업이 편람 값과 같은가. 내 쪽 호가 비어 있으면 건물까지만 견준다(편람의 호를 그대로 쓴다). 호를 적었으면 호까지 같아야 같다 */
function sameAsCatalog(mine, cat) {
  const loose = (ms) => ms.map((m) => `${m.day},${m.start},${m.end},${m.building || ""}`).sort().join(";");
  return loose(mine) === loose(cat)
    && mine.every((m) => !m.room || cat.some((c) => c.day === m.day && c.start === m.start && c.end === m.end && c.building === m.building && c.room === m.room));
}

/**
 * 분반의 수업을 groups([{days, start, end, building, room}])로 바꿔 둔다. 같은 수업을 두 번 넣었으면 하나로.
 * 편람 값과 같아졌으면(편람에 시간이 없는 분반이면 넣은 시간을 다 뺐으면) 직접 입력이 아니다: 지운다.
 */
function setOwn(s, groups) {
  const prev = state.overrides[s.key];
  const base = ownMeetings(s) ? prev.base || "" : sigOf(s.meetings);
  const seen = new Set(), meet = [];
  for (const g of groups) {
    for (const day of g.days) {
      const t = [day, g.start, g.end, g.building || "", g.building ? g.room || "" : ""];
      if (seen.has(t.join(","))) continue;
      seen.add(t.join(","));
      meet.push(t);
    }
  }
  meet.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  if (sameAsCatalog(meet.map(meetOf), s.meetings)) delete state.overrides[s.key];
  else state.overrides[s.key] = { meet, base };
}

/**
 * 편람을 새로 받은 뒤: 바꿔 둔 값이 새 편람 값과 같아졌으면 직접 입력을 조용히 지운다(알리지 않는다).
 * 다르면 그대로 두고 과목 행과 분반에 '편람 바뀜'을 단다(catalogMoved).
 */
function pruneOverrides() {
  let any = false;
  for (const p of state.picks) {
    for (const s of (state.byId.get(p.id) || { sections: [] }).sections) {
      const o = state.overrides[s.key];
      if (!o || !o.meet || !s.meetings.length || !sameAsCatalog(o.meet.map(meetOf), s.meetings)) continue;
      delete o.meet;
      delete o.base;
      if (!o.rooms) delete state.overrides[s.key];
      any = true;
    }
  }
  if (any) saveOverrides();
}

/** 강의실이나 시간이 아직 미정인 분반(직접 넣은 것까지 본다). */
function isUndecided(s) {
  const ms = effMeetings(s);
  return !ms.length || ms.some((m) => !m.building);
}

/** 같은 시각·장소 수업을 한 줄로: [{days, start, end, building, room, indices}] */
function meetingGroups(meetings) {
  const groups = new Map();
  meetings.forEach((m, i) => {
    const k = `${m.start}|${m.end}|${m.building}|${m.room}`;
    if (!groups.has(k)) groups.set(k, { days: [], start: m.start, end: m.end, building: m.building, room: m.room, indices: [] });
    const g = groups.get(k);
    g.days.push(m.day);
    g.indices.push(i);
  });
  return [...groups.values()].sort((a, b) => a.days[0] - b.days[0] || a.start - b.start);
}

const natKey = (b) => b.split(/(\d+)/).map((x) => (/^\d+$/.test(x) ? x.padStart(5, "0") : x)).join("");
let buildingOpts = null, dormOpts = null;
/** 고를 수 있는 기숙사 동: 이동시간 지점(ids)인 동을 번호순으로, 번호만(사는 사람은 번호로 찾는다). [[동, '919A동']]
 *  919동은 919A~D 네 동이 따로다(10/3 자료). 옛 자료(dorms 없음)면 빈 목록이라 예전처럼 기숙사 = 919 하나이고 선택칸이 없다. */
function dormOptions() {
  if (!dormOpts) {
    const ids = new Set(state.campus.ids);
    dormOpts = (state.campus.dorms || []).filter(([b]) => ids.has(b))
      .sort(([a], [b]) => natKey(a).localeCompare(natKey(b)))
      .map(([b]) => [b, buildingLabel(b)]);
  }
  return dormOpts;
}
/** 고를 수 있는 건물: 이동시간 자료(경로·경사)가 있는 강의 건물. 출발 후보(기숙사·정문)와 기숙사 동은 뺀다(기숙사는 '기숙사'에서 고른다). [[건물, '301동 제1공학관']] */
function buildingOptions() {
  if (!buildingOpts) {
    const skip = new Set((state.campus.homes || []).map(([id]) => id).concat("GATE"));
    buildingOpts = state.campus.ids
      .filter((b) => !skip.has(b) && !isDorm(b))
      .sort((a, b) => natKey(a).localeCompare(natKey(b)))
      .map((b) => { const name = (state.campus.buildings[b] || [""])[0]; return [b, `${b}동${name ? " " + name : ""}`]; });
  }
  return buildingOpts;
}

function buildingSelect(value, attrs) {
  const opts = buildingOptions();
  // 전에 넣어 둔 건물이 목록에서 빠졌어도(기숙사 동) 고른 값은 그대로 보인다
  const kept = value && !opts.some(([b]) => b === value) ? [[value, buildingLabel(value)]] : [];
  const el = h("select", attrs, h("option", { value: "" }, "미정"), kept.concat(opts).map(([b, text]) => h("option", { value: b }, text)));
  el.value = value || "";
  return el;
}

// ---------------------------------------------------------------- 불러오기

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// 학기 목록(semesters.json)을 받았다: 공유받은 시간표 링크가 기다린다(못 받으면 다시 시도해 받을 때까지)
let semKnown = null;
const semReady = new Promise((res) => { semKnown = res; });

async function startApp() {
  hideBanner();
  state.loading = true;
  renderLoadState();
  try {
    const [campus, index] = await Promise.all([getJson("data/campus.json"), getJson("data/semesters.json").catch(() => null)]);
    state.campus = campus;
    buildingOpts = dormOpts = null;
    state.current = (index && index.current) || (campus.meta || {}).semester || "";
    state.semesters = index && index.list && index.list.length ? index.list : [[state.current, "courses.json"]];
    semKnown(); // 받은 시간표 링크가 그 학기 편람을 받을 수 있다(coursesFor)
    migrateStore(state.current);
    // 출발·도착: 지난번 값, 처음에는 자료의 첫 출발 후보(homes 차례가 곧 세그먼트 차례다: 정문 · 기숙사. 차례와 처음 값을 여기에 따로 적지 않는다)
    const homes = (campus.homes || []).map(([b]) => b);
    const known = (b) => homes.includes(b) || campus.ids.includes(b);
    const saved = store.get("home", ""), savedDorm = store.get("homeDorm", "");
    // 저장된 값이 지금 자료에 없는 기숙사 동이면(919 → 919A~D, 10/3 update44) 기숙사를 고른 채 처음 동(homes 의 기숙사 동, 919A)으로 옮긴다.
    // 정문으로 떨어뜨리면 그 사람의 걷는 시간이 다 달라진다. 묻지도 않는다(10/3 디자인: 선택칸에 동이 보여 한 번에 바꾼다).
    // 없는 기숙사 동 = 기숙사 동 목록(dorms)에는 남아 있거나(919) 기숙사 동으로 골라 두었던 값인데 이동시간 지점(ids)이 아닌 것
    const dormHome = homes.find(isDorm) || "";
    const lostDorm = (b) => !!b && !!dormHome && !known(b) && (isDorm(b) || b === savedDorm);
    state.homeOther = store.get("homeOther", "");
    state.homeDorm = lostDorm(savedDorm) ? dormHome : savedDorm;
    state.home = known(saved) ? saved : lostDorm(saved) ? dormHome : homes[0] || campus.ids[0];
    if (lostDorm(saved)) store.set("home", state.home);
    if (lostDorm(savedDorm)) store.set("homeDorm", state.homeDorm);
    state.mode = campus.slope ? store.get("mode", "slope") : "flat";
    renderSettings();
    // 지난번에 보던 학기로 연다. 그사이 새 학기가 올라왔으면 새 학기로
    const last = store.get("semester", null);
    const sem = last && last.current === state.current && state.semesters.some(([x]) => x === last.id) ? last.id : state.current;
    if (!(await loadSemester(sem))) return;
  } catch {
    state.loading = false;
    renderLoadState();
    showBanner("과목 자료를 불러오지 못했어요", startApp);
    return;
  }
  const y = store.get("scroll", 0);
  if (y > 0 && screen === "input") requestAnimationFrame(() => window.scrollTo(0, y));
  loadRoutes();
}

/** 학기 선택 전에 저장한 담은 과목·직접 입력을 지금 학기 몫으로 옮긴다. */
function migrateStore(cur) {
  for (const k of ["picks", "overrides"]) {
    const old = store.get(k, null);
    if (old !== null && store.get(`${k}@${cur}`, null) === null) store.set(`${k}@${cur}`, old);
    if (old !== null) store.del(k);
  }
}

function readPicks(sem) {
  const raw = store.get(semKey("picks", sem), []);
  return (Array.isArray(raw) ? raw : []).filter((p) => p && p.id).map((p) => ({
    id: p.id, excluded: new Set(p.excluded || []), name: p.name || "", cls: p.cls || "", credit: p.credit ?? null, dept: p.dept || "",
  }));
}
const snapshot = (c) => ({ name: c.name, cls: c.cls, credit: c.credit, dept: c.dept });

function savePicks() {
  store.set(semKey("picks"), state.picks.map((p) => ({ id: p.id, excluded: [...p.excluded], name: p.name, cls: p.cls, credit: p.credit, dept: p.dept })));
}
function saveOverrides() {
  store.set(semKey("overrides"), state.overrides);
}

/** 학기 편람을 불러와 검색·담은 과목을 그 학기로 바꾼다. 그사이 다른 학기를 고르면 늦게 온 쪽은 버린다. */
let loadSeq = 0;
async function loadSemester(sem) {
  const seq = ++loadSeq;
  const entry = state.semesters.find(([x]) => x === sem) || state.semesters[0];
  sem = entry[0];
  state.semester = sem;
  store.set(T.STORE_KEYS.open, sem);
  readMine(sem);
  state.loaded = false;
  state.loading = true;
  state.courses = [];
  state.byId = new Map();
  state.semesterMeta = {};
  state.picks = readPicks(sem);
  state.overrides = readOverrides(sem);
  state.rules = readRules(sem);
  dropExplore();
  clearErrors();
  state.errors.noSections = new Set();
  syncRules();
  renderTerm();
  renderLoadState();
  renderResults();
  renderPicked();
  mineChanged();
  if (addActive()) renderAdd(); // 넓은 화면 과목 추가에서 시간표 목록 시트로 학기를 바꿨다(그 학기 편람을 받는 동안 '불러오는 중')
  let cj = state.cache.get(sem);
  try {
    if (!cj) {
      cj = await getJson(`data/${entry[1]}`);
      state.cache.set(sem, cj);
    }
  } finally {
    if (seq === loadSeq) state.loading = false;
  }
  if (seq !== loadSeq) return false;
  state.semesterMeta = cj.meta || {};
  state.courses = parseCourses(cj);
  indexCourses();
  state.loaded = true;
  for (const p of state.picks) { const c = state.byId.get(p.id); if (c) Object.assign(p, snapshot(c)); }
  savePicks();
  pruneOverrides();
  checkOverlap(); // 지난번에 담아 둔 과목끼리 겹치거나 추가 설정에 맞는 조합이 없으면 열자마자 보인다
  syncRules();
  renderTerm();
  renderLoadState();
  renderResults();
  renderPicked();
  mineChanged(); // 편람과 견줘 다시 그린다(편람 바뀜, 없는 과목)
  if (addActive()) renderAdd(); // 편람이 들어왔다(폰의 과목 추가 시트를 연 채로 기다렸을 수도 있다)
  return true;
}

async function switchSemester(sem) {
  if (!state.semesters.some(([x]) => x === sem)) { renderTerm(); return; }
  if (sem === state.semester && (state.loaded || state.loading)) return;
  cancelCompute();
  store.set("semester", { id: sem, current: state.current });
  hideBanner();
  try {
    await loadSemester(sem);
  } catch {
    if (state.semester !== sem) return; // 그사이 다른 학기를 골랐다
    renderLoadState();
    showBanner("이 학기 자료를 불러오지 못했어요", () => switchSemester(sem));
  }
}

function loadRoutes() {
  if (!state.routesLoading) {
    state.routesLoading = fetch("data/routes.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => {
        state.routes = j;
        if (j && state.result) { if (screen === "result") renderDay(); if (screen === "map") renderFullMap(); }
        return j;
      });
  }
  return state.routesLoading;
}

// ---------------------------------------------------------------- 학기 줄, 배너, 불러오는 중

/** 연도·학기를 따로 고른다(편람이 있는 학기만). 연도는 목록 순서(최근 먼저), 학기는 한 해 안의 순서. */
function renderTerm() {
  fillTerm($("year"), $("term"));
  $("past-tag").hidden = !state.current || state.semester === state.current;
  $("asof").textContent = state.loaded ? asofShort(state.semesterMeta.updated) : "";
  if ($("tt-list-sheet").open) refillTtList();
}
/** 연도·학기 선택칸 둘(탐색 학기 줄, 내 시간표의 시간표 목록 시트)을 지금 학기로 채운다. 고를 수 없는 학기(자료를 받기 전)면 숨긴다. */
function fillTerm(ySel, tSel, sem = state.semester) {
  const ids = state.semesters.map(([id]) => id).filter((id) => /^\d{4}-[12SW]$/.test(id));
  const ok = ids.includes(sem);
  ySel.hidden = tSel.hidden = !ok;
  if (ok) {
    const [y, t] = sem.split("-");
    const years = [...new Set(ids.map((id) => id.split("-")[0]))];
    if (ySel.dataset.key !== years.join()) {
      ySel.replaceChildren(...years.map((v) => h("option", { value: v }, `${v}년`)));
      ySel.dataset.key = years.join();
    }
    const terms = TERM_ORDER.filter((k) => ids.includes(`${y}-${k}`));
    if (tSel.dataset.key !== `${y}:${terms.join()}`) {
      tSel.replaceChildren(...terms.map((k) => h("option", { value: k }, TERMS[k])));
      tSel.dataset.key = `${y}:${terms.join()}`;
    }
    ySel.value = y;
    tSel.value = t;
    fitSelect(ySel);
    fitSelect(tSel);
  }
}

/** 연도를 바꾸면 같은 학기로, 그해에 그 학기가 없으면 그해의 가장 늦은 학기로. */
function onYearChange(ySel) {
  const term = termInYear(ySel.value, state.semester);
  if (term) switchSemester(`${ySel.value}-${term}`); else renderTerm();
}
const termInYear = (y, from) => {
  const t = String(from || "").split("-")[1], has = (k) => state.semesters.some(([x]) => x === `${y}-${k}`);
  return has(t) ? t : [...TERM_ORDER].reverse().find(has);
};

/** 선택칸 폭을 고른 항목 글자에 맞춘다(화살표가 글자 바로 뒤에 오게). CSS field-sizing 은 글자 폭을 모자라게 잡아서 직접 잰다. */
const canvas = document.createElement("canvas").getContext("2d");
function fitSelect(sel) {
  if (sel.hidden) return;
  const cs = getComputedStyle(sel);
  canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : "";
  sel.style.width = `${Math.ceil(canvas.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2)}px`;
}
const fitTerm = () => { for (const id of ["year", "term", "browse-select", "add-browse-select"]) fitSelect($(id)); };
if (document.fonts) document.fonts.addEventListener("loadingdone", fitTerm);
window.addEventListener("resize", fitTerm);

function renderLoadState() {
  const q = $("q");
  q.disabled = !state.loaded;
  q.placeholder = state.loading ? "불러오는 중" : "과목명, 교과목번호, 교수";
  $("q-spinner").hidden = !state.loading;
  updateRun();
}

let bannerRetry = null;
function showBanner(text, retry) {
  $("banner-text").textContent = text;
  bannerRetry = retry;
  $("banner").hidden = false;
  announce(text, "alert");
}
function hideBanner() {
  $("banner").hidden = true;
  bannerRetry = null;
}

// ---------------------------------------------------------------- 검색

// 찾는 규칙과 줄 세우기는 search.js(백엔드, docs/search.md): 줄임말·초성 섞기·치는 중인 글자·영문 자판·학과 줄임·특별 낱말
let searchIndex = [];
function indexCourses() {
  state.byId = new Map(state.courses.map((c) => [c.id, c]));
  searchIndex = indexSearch(state.courses);
}

/** 검색창 값 그대로(끝의 띄어쓰기로 다 친 낱말을 안다) → { hits: [{ c, kind, marks }] } 좋은 순 */
function findCourses(raw) {
  return searchCourses(searchIndex, raw);
}

/** 강조 범위([[시작, 끝), ...])를 굵게 */
function marked(text, ranges) {
  return splitMarks(text, ranges).map((p) => (p.mark ? h("b", {}, p.text) : p.text));
}

const isPicked = (id) => state.picks.some((p) => p.id === id);

/** 담기 버튼과 그 행. 누르는 영역은 행 전체(style.css), 담은 과목의 행은 어두운 바탕에 '✓ 담음'.
 *  담은 과목이 조합을 막으면 버튼 앞에 그 까닭을 단다: 시간이 겹치면 '시간 겹침', 추가 설정 때문이면 '공강 요일'·'점심시간'·'추가 설정'. */
function setAddButton(b, name, picked) {
  const clash = picked && state.errors.overlap.has(b.dataset.id) ? NONE_TAG[state.errors.cause] : "";
  b.classList.toggle("is-on", picked);
  const row = b.closest(".result");
  if (row) {
    row.classList.toggle("is-picked", picked);
    const tag = row.querySelector(".r-clash");
    if (clash && !tag) b.before(h("span", { class: "tag danger r-clash", "aria-hidden": "true" }, clash));
    else if (clash) tag.textContent = clash;
    else if (tag) tag.remove();
  }
  b.setAttribute("aria-label", `${name} ${picked ? "담음" : "담기"}${clash ? `, ${clash}` : ""}`);
  b.replaceChildren(...(picked ? [icon(I.check, 16), "담음"] : ["담기"]));
}

function resultRow({ c, marks }) {
  const title = marked(c.name, marks.name);
  // 메타: 학과 · 교과구분 · 학점. 교수·교과목번호로 찾았으면 학과 자리에 그것을 보인다
  const first = marks.prof ? marked(marks.prof.name, marks.prof.ranges) : marks.id ? marked(c.id, marks.id) : c.dept ? marked(c.dept, marks.dept) : null;
  const rest = [c.cls, fmtCredit(c.credit)].filter(Boolean).join(" · ");
  const btn = h("button", { type: "button", class: "btn-add", "data-id": c.id });
  const row = h("li", { class: "result" },
    h("div", { class: "r-body" }, h("span", { class: "r-title" }, title), h("span", { class: "r-meta" }, first ? [first, rest ? ` · ${rest}` : ""] : rest)),
    btn);
  setAddButton(btn, c.name, isPicked(c.id));
  return row;
}

// 넓은 화면 두 칸(style.css 의 같은 조건): 오른쪽 칸 폭의 스낵바, 자료를 받은 뒤 늘 있는 결과 카드(검색 전에는 최근 검색어와 과목 둘러보기)
const twoPane = matchMedia("(min-width: 42.5em), (horizontal-viewport-segments: 2)");
// 폰의 과목 추가 시트(넓은 화면은 화면 'add' 인 내 시간표의 오른쪽 칸. 아래 '과목 추가'). 과목 추가가 열려 있다 = 그 칸이거나 이 시트
const addSheet = $("add-sheet");
const addActive = () => screen === "add" || addSheet.open;

/** 넓은 화면 목록: items 를 FEED_STEP 개씩 이어 붙인다(끝의 FEED_LEAD 개 행 가운데 하나라도 보이면 다음). 다시 부르면 앞의 것은 멈춘다.
 *  보이는지는 화면 기준으로 보되 카드 안 스크롤에 가려진 행은 안 보이는 것으로 친다(IntersectionObserver 가 조상의 잘림을 따진다).
 *  끝의 여러 행을 보는 것은 스크롤 막대를 끌거나 End 로 한 번에 끝까지 가도(그 사이 행을 건너뛰어도) 멈추지 않게 하려고. */
const feeds = new Map();
function feedList(list, items, row) {
  stopFeed(list);
  let shown = 0;
  const io = new IntersectionObserver((es) => { if (feeds.get(list) === io && es.some((e) => e.isIntersecting)) more(); });
  feeds.set(list, io);
  const more = () => {
    io.disconnect();
    const next = items.slice(shown, shown + FEED_STEP);
    shown += next.length;
    list.append(...next.map(row));
    if (shown < items.length) for (const el of [...list.children].slice(-FEED_LEAD)) io.observe(el);
  };
  list.replaceChildren();
  more();
}
function stopFeed(list) {
  feeds.get(list)?.disconnect();
  feeds.delete(list);
}

// 넓은 화면 검색 전 왼쪽: 과목 둘러보기(10/2 디자인, 최근 검색어로 카드를 채우던 것 대신). 목록 머리의 선택칸(교양 전체·학과)이 곧 목록
// 제목이고, 행은 검색 결과 행과 같다(강조 없이 학과 · 교과구분 · 학점). 학사 과목만(대학원 과목은 검색으로). 교양 전체는 가나다,
// 학과는 전필 → 전선 → 교양 → 그 밖이고 같은 묶음은 가나다. 고른 목록은 이 기기에 기억하고, 그 학기에 없는 학과면 교양 전체
const collator = new Intl.Collator("ko");
const CLS_ORDER = { 전필: 0, 전선: 1, 교양: 2 };
const clsRank = (c) => CLS_ORDER[c.cls] ?? 3;
const NO_MARKS = {};
// 넓은 화면 과목 추가 칸의 검색 전 자리에도 같은 둘러보기를 둔다(10/23 사용자가 시안 가를 골랐다. 아래 renderAddBrowse): 선택칸과 고른 목록(browseKey)은 탐색과 같고
// 행은 분반 행이다
let browseKey = String(store.get("browse", "교양") || "교양"), browseData = null, browseDepts = [], browseDeptsOf = null, browseDrawn = "";
function browseCourses() {
  const list = state.courses.filter((c) => c.program === "학사" && (browseKey === "교양" ? c.cls === "교양" : c.dept === browseKey));
  return list.sort((a, b) => (browseKey === "교양" ? 0 : clsRank(a) - clsRank(b)) || collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}
/** 둘러보기 선택칸(탐색, 넓은 화면 과목 추가 칸): fresh 면(그 칸이 이 학기 자료로 처음 그린다) 목록을 새로 만들고, 고른 값을 맞춘다 */
function fillBrowseSelect(sel, fresh) {
  if (browseDeptsOf !== state.courses) {
    browseDeptsOf = state.courses;
    browseDepts = [...new Set(state.courses.filter((c) => c.program === "학사").map((c) => c.dept).filter(Boolean))].sort(collator.compare);
  }
  if (fresh) sel.replaceChildren(h("option", { value: "교양" }, "교양 전체"), h("optgroup", { label: "학과" }, browseDepts.map((d) => h("option", { value: d }, d))));
  if (browseKey !== "교양" && !browseDepts.includes(browseKey)) browseKey = "교양"; // 학기를 바꿔 그 학과가 없으면(기억은 그대로 둔다)
  sel.value = browseKey;
  fitSelect(sel);
}
/** 둘러보기를 보이거나 숨긴다. 학기(자료)나 고른 목록이 바뀌었을 때만 목록을 새로 그리고 true(그대로면 행과 스크롤 자리를 둔다). */
function renderBrowse(show) {
  $("browse").hidden = !show;
  if (!show) return false;
  const fresh = browseData !== state.courses;
  if (fresh) { browseData = state.courses; browseDrawn = ""; }
  fillBrowseSelect($("browse-select"), fresh);
  if (browseDrawn === browseKey) return false;
  browseDrawn = browseKey;
  feedList($("browse-list"), browseCourses(), (c) => resultRow({ c, marks: NO_MARKS }));
  return true;
}

// 최근 검색어: 담기로 이어졌거나 Enter 로 낸(결과가 있는) 검색어. 학기와 상관없이 이 기기에 10개까지, 같은 말(띄어쓰기·대소문자 무시)은 하나로
const RECENT_MAX = 10;
let recent = (() => {
  const v = store.get("recent", []);
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, RECENT_MAX) : [];
})();
function saveRecent(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!text) return;
  const k = normKey(text);
  recent = [text, ...recent.filter((x) => normKey(x) !== k)].slice(0, RECENT_MAX);
  store.set("recent", recent);
}
function setRecent(list) {
  recent = list;
  if (recent.length) store.set("recent", recent); else store.del("recent");
}

/** 검색 전 카드: 최근 검색어 칩(누르면 그 말로 검색, ×로 하나 지우기). 하나도 없으면 두지 않는다(빈 상태 문장 없음, 10/2 디자인).
 *  목록이 그대로면 다시 만들지 않는다(키보드 초점이 칩에 있을 때 다시 그려 초점을 잃지 않게). */
let drawnRecent = "";
function renderIdle(show) {
  const has = show && recent.length > 0;
  $("recent").hidden = !has;
  const key = has ? JSON.stringify(recent) : "";
  if (key === drawnRecent) return;
  drawnRecent = key;
  $("recent-list").replaceChildren(...(has ? recent : []).map((text) => h("li", { class: "chip" },
    h("button", { type: "button", class: "chip-q", "data-q": text }, h("span", {}, text)),
    h("button", { type: "button", class: "chip-x", "data-del": text, "aria-label": `${text} 지우기` }, icon(I.x, 16)))));
}
/** 검색창이나 그 아래 카드(최근 검색어·결과)에 초점이 있다. */
const searchFocused = () => document.activeElement === $("q") || $("results").contains(document.activeElement);

// 넓은 화면은 결과 카드가 스크롤 칸이다(style.css). 새 검색은 맨 위부터, 검색을 지우면 둘러보던 자리로 돌아간다
let resultsShown = RESULTS_STEP, lastQuery = "", countTimer = null, browseTop = 0;
function renderResults({ more = false } = {}) {
  const raw = $("q").value;
  const box = $("results"), list = $("results-list");
  const wide = twoPane.matches;
  // 카드 스크롤 자리는 화면을 바꾸기 전에 읽고 쓴다(바꾼 뒤에 하면 그 자리에서 레이아웃을 다시 계산해 타자가 느려진다)
  if (raw.trim() && state.loaded) {
    if (!lastQuery && !$("browse").hidden) browseTop = box.scrollTop;
    if (wide && raw !== lastQuery && box.scrollTop) box.scrollTop = 0;
  }
  $("q-clear").hidden = !raw;
  if (!raw.trim() || !state.loaded) {
    const fromSearch = lastQuery !== "";
    lastQuery = "";
    clearTimeout(countTimer);
    stopFeed(list);
    list.replaceChildren();
    $("results-empty").hidden = $("results-more").hidden = true;
    // 넓은 화면은 자료를 받은 뒤 카드를 늘 둔다(최근 검색어 + 과목 둘러보기). 폰은 빈 검색창에 초점이 있고 최근 검색어가 있을 때만.
    // 불러오는 중에는 두지 않는다(검색창의 '불러오는 중'과 스피너)
    const idle = state.loaded && (wide || (searchFocused() && recent.length > 0));
    box.hidden = !idle;
    renderIdle(idle);
    const redrawn = renderBrowse(wide && state.loaded);
    if (fromSearch) box.scrollTop = redrawn ? 0 : browseTop;
    return;
  }
  renderIdle(false);
  renderBrowse(false);
  const fresh = raw !== lastQuery;
  if (fresh) { resultsShown = RESULTS_STEP; lastQuery = raw; }
  const found = findCourses(raw);
  box.hidden = false;
  $("results-empty").hidden = found.hits.length > 0;
  if (wide) {
    feedList(list, found.hits, resultRow);
    $("results-more").hidden = true;
  } else {
    const before = more ? list.children.length : 0;
    stopFeed(list);
    list.replaceChildren(...found.hits.slice(0, resultsShown).map((hit) => resultRow(hit)));
    $("results-more").hidden = found.hits.length <= resultsShown;
    if (more) { list.children[before]?.querySelector("button")?.focus(); return; }
  }
  clearTimeout(countTimer);
  countTimer = setTimeout(() => announce(found.hits.length ? `결과 ${found.hits.length}개` : "검색 결과 없음"), 500);
}

function syncAddButtons() {
  for (const b of document.querySelectorAll("#results-list .btn-add, #browse-list .btn-add")) {
    const c = state.byId.get(b.dataset.id);
    if (c) setAddButton(b, c.name, isPicked(c.id));
  }
}

// ---------------------------------------------------------------- 담은 과목

/** 담은 과목·분반·직접 입력이 바뀐 뒤: 저장하고, 그 조합에 대한 오류와 결과를 비운 뒤 겹침을 다시 본다. 새로 겹치게 됐으면 true. */
function changed() {
  const had = state.errors.overlap.size > 0;
  cancelCompute();
  savePicks();
  saveOverrides();
  clearErrors();
  dropExplore();
  return checkOverlap() && !had;
}

function clearErrors() {
  state.errors.overlap = new Set();
  state.errors.cause = "overlap";
  state.errors.general = null;
}

/** 조합이 없다: 막는 과목(가장 작은 묶음)과 까닭을 적어 둔다. 추가 설정 때문이면(rules) 오류 줄 옆에 '추가 설정' 버튼이 붙는다. */
function setNone(cause, courseIds) {
  state.errors.overlap = new Set(courseIds);
  state.errors.cause = cause;
  state.errors.general = { text: NONE_TEXT[cause], rules: cause !== "overlap" };
}

/**
 * 켠 분반으로 겹치지 않는 조합이 하나도 없으면 시간표 만들기를 누르기 전에, 담을 때 바로 알린다(10/1 사용자).
 * 서로 막는 과목(가장 작은 묶음)에 '시간 겹침'(담은 과목 행과 검색 결과 행), 담은 과목 제목 아래 '겹치지 않는 조합이 없어요'.
 * 추가 설정(공강 요일·점심시간) 때문에 없을 때도 같은 자리, 같은 모양이고 말만 까닭을 따른다(NONE_TEXT·NONE_TAG). 추가 설정을 바꿀 때도 본다.
 * 50ms 안에 판단이 안 서면(분반이 아주 많을 때) 넘어가고, 그때는 시간표 만들기에서 워커가 알린다. 조합이 없으면 true.
 */
function checkOverlap() {
  if (!state.loaded) return false;
  const live = collectCourses().courses;
  const rules = activeRules();
  if (!live.length || (live.length < 2 && !rules)) return false; // 과목이 하나면 겹칠 것이 없다. 조건이 걸려 있으면 하나여도 본다
  const r = countFeasible(live, { limit: 1, budgetMs: 50, rules });
  if (r.count > 0 || !r.exact) return false;
  const why = whyNone(live, rules);
  if (!why) return false;
  setNone(why.cause, why.courseIds);
  return true;
}

function addCourse(id) {
  const c = state.byId.get(id);
  if (!c || isPicked(id)) return;
  state.picks.push({ id, excluded: new Set(), ...snapshot(c) });
  const clash = changed();
  renderPicked({ added: id });
  if (clash) announce(`${c.name} 담았어요. ${state.errors.general.text}`, "alert");
  else announce(`${c.name} 담았어요`);
}

function removeCourse(id, { fromList = false } = {}) {
  const i = state.picks.findIndex((p) => p.id === id);
  if (i < 0) return;
  const p = state.picks[i];
  const c = state.byId.get(id);
  const saved = {}; // 되돌리면 분반 선택과 직접 넣은 강의실·시간까지 돌아온다
  for (const s of c ? c.sections : []) {
    if (state.overrides[s.key]) { saved[s.key] = state.overrides[s.key]; delete state.overrides[s.key]; }
  }
  const row = $("picked-list").querySelector(`li[data-id="${CSS.escape(id)}"]`);
  const keyboard = Boolean(row && row.querySelector(":focus-visible"));
  const sib = row && (row.nextElementSibling || row.previousElementSibling);
  const nextId = sib ? sib.dataset.id : null;
  state.picks.splice(i, 1);
  changed();
  renderPickedHead();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    renderPicked();
    if (fromList && keyboard && !focusRow(nextId, ".remove")) $("q").focus();
  };
  // 뺀 행은 150ms 동안 사라지고, 숫자는 바로 바뀐다
  if (row && !reduceMotion.matches) {
    row.classList.add("is-leaving");
    row.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, 250);
  } else finish();
  syncAddButtons();
  const name = p.name || (c && c.name) || id;
  announce(`${name} 뺐어요`);
  showSnackbar("과목을 뺐어요", "되돌리기", () => {
    if (isPicked(id)) return;
    state.picks.splice(Math.min(i, state.picks.length), 0, p);
    Object.assign(state.overrides, saved);
    changed();
    renderPicked();
    syncAddButtons();
    focusRow(id, ".course-hit");
  });
}

function focusRow(id, sel) {
  if (!id) return false;
  const el = $("picked-list").querySelector(`li[data-id="${CSS.escape(id)}"] ${sel}`);
  if (el) el.focus({ preventScroll: false });
  return Boolean(el);
}

/** 태그는 한 행에 두 개까지, 위험(조합이 없는 까닭) → 주의(편람 바뀜, 폐강 대상) → 중립(미정) 순. [[종류, 글]] */
function courseTags(p, c) {
  const on = c.sections.filter((s) => !p.excluded.has(s.key));
  const tags = [];
  if (state.errors.overlap.has(c.id)) tags.push(["danger", NONE_TAG[state.errors.cause]]);
  if (c.sections.some(catalogMoved)) tags.push(["warning", "편람 바뀜"]); // 과목 시트를 닫으면 사라지는 태그라 폐강 대상보다 앞에 둔다
  if (on.some((s) => s.status === "폐강대상")) tags.push(["warning", "폐강 대상"]);
  if (on.some(isUndecided)) tags.push(["", "미정"]);
  return tags.slice(0, 2);
}

function courseRow(p, isNew) {
  const c = state.loaded ? state.byId.get(p.id) : null;
  const name = c ? c.name : p.name || p.id;
  const cls = c ? c.cls : p.cls;
  let meta, tags = [], error = "";
  if (c) {
    const on = c.sections.filter((s) => !p.excluded.has(s.key)).length;
    meta = [c.cls, fmtCredit(c.credit), `분반 ${on}/${c.sections.length}`].filter(Boolean).join(" · ");
    tags = courseTags(p, c);
    if (!on && state.errors.noSections.has(c.id)) error = "켠 분반이 없어요";
  } else {
    // 자료를 불러오기 전이거나, 이번 자료에서 사라진 과목(지우지 않고 '없는 과목', 계산에서는 빠진다)
    meta = [cls, fmtCredit(p.credit)].filter(Boolean).join(" · ") || p.id;
    if (state.loaded) tags = [["danger", "없는 과목"]];
  }
  const errId = error ? `err-${uid(p.id)}` : null;
  const hit = h("button", {
    type: "button", class: "course-hit", "data-open": p.id, "aria-describedby": errId, "aria-disabled": state.loaded ? null : "true",
    "aria-label": [name, meta, ...tags.map(([, t]) => t)].join(", "),
  },
  h("span", { class: "dot", "aria-hidden": "true", style: { background: clsColor(cls) } }),
  h("span", { class: "c-body" },
    h("span", { class: "c-title" }, name),
    h("span", { class: "c-meta" }, meta),
    error ? h("span", { class: "c-error", id: errId }, error) : null));
  return h("li", { class: `course${isNew ? " is-new" : ""}`, "data-id": p.id },
    hit,
    tags.length ? h("span", { class: "tags", "aria-hidden": "true" }, tags.map(([k, t]) => h("span", { class: k ? `tag ${k}` : "tag" }, t))) : null,
    h("button", { type: "button", class: "icon-btn remove", "data-remove": p.id, "aria-label": `${name} 빼기` }, icon(I.x, 20)));
}

/** 담은 과목 제목 옆: 과목 수와 총 학점(이번 자료에 없는 과목은 빼고 센다). */
function renderPickedHead() {
  const n = state.picks.length;
  $("picked-count").textContent = n ? String(n) : "";
  let sum = 0;
  for (const p of state.picks) {
    const c = state.loaded ? state.byId.get(p.id) : null;
    if (state.loaded && !c) continue;
    sum += Number((c ? c.credit : p.credit) || 0);
  }
  sum = Math.round(sum * 10) / 10;
  $("picked-credits").textContent = n && sum ? `총 ${sum}학점` : "";
}

function renderPicked({ added = "" } = {}) {
  const n = state.picks.length;
  renderPickedHead();
  $("picked-empty").hidden = n > 0;
  $("picked-legend").hidden = n === 0; // 점 색 풀이는 담은 과목이 있을 때만
  $("picked-list").replaceChildren(...state.picks.map((p) => courseRow(p, p.id === added)));
  renderPickedError();
  syncAddButtons(); // 검색 결과 행의 '시간 겹침'도 같이
  updateRun();
  if (sheetId && $("course-sheet").open) refreshSheetHead();
}

function renderPickedError() {
  const g = state.errors.general;
  $("picked-error").hidden = !g;
  $("picked-error-text").textContent = g ? g.text : "";
  $("picked-retry").hidden = !(g && g.retry);
  $("picked-rules").hidden = !(g && g.rules); // 추가 설정 때문에 조합이 없으면 그 시트를 여는 버튼
  if (g) $("run").setAttribute("aria-describedby", "picked-error-text");
  else $("run").removeAttribute("aria-describedby");
}

// ---------------------------------------------------------------- 과목 시트

let sheetId = null;
// 분반 키 → 그 분반의 펼침과 입력 줄: wide = 편람에 시간이 있는 분반을 펼쳤다(수업 칩이 보인다), open = 입력 줄이 열려 있다,
// at = 고치는 칩 번호(더할 때는 -1), days·sh·sm·eh·em·b·room = 입력 줄의 값(요일은 하나), b0·room0 = 고치는 수업의 원래 건물과 호, error = "" | "time"
const edits = new Map();

function editState(key) {
  if (!edits.has(key)) edits.set(key, { wide: false, open: false, at: -1, days: [], sh: 9, sm: 0, eh: 10, em: 15, b: "", room: "", b0: "", room0: "", error: "" });
  return edits.get(key);
}

function openCourseSheet(id, opener) {
  sheetId = id;
  renderCourseSheet();
  openSheet($("course-sheet"), opener);
}

const sheetPick = () => state.picks.find((p) => p.id === sheetId);

/** 편람의 교과목명만: 우리 자료는 부제를 끝에 ' (부제)'로 붙여 둔다(ttwizard/parse_sugang.py). 부제 안에 괄호가 있어도 짝을 맞춰 뗀다.
 *  교과목명에 든 괄호('수영 1(평영)', 앞에 띄어쓰기가 없다)와 쌍점('대학 글쓰기 2: 과학기술글쓰기')은 이름의 일부라 그대로 둔다. */
function catalogName(name) {
  const s = String(name || "").trim();
  if (!s.endsWith(")")) return s;
  let depth = 0;
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i] === ")") depth += 1;
    else if (s[i] === "(" && --depth === 0) return s[i - 1] === " " ? s.slice(0, i).trim() || s : s;
  }
  return s;
}

/**
 * 에브리타임에서 찾을 과목명: 우리가 붙인 부제 괄호를 빼고(catalogName), 쌍점이 있으면 그 앞까지만('대학 글쓰기 2: 과학기술글쓰기' → '대학 글쓰기 2').
 * 앞부분만 넣으면 찾아진다는 것은 사용자가 확인했다(10/5: '대학글쓰기 2' → '대학 글쓰기 2: …'. 띄어쓰기가 달라도 된다). 쌍점 뒤까지 넣은 긴 이름이 그대로
 * 찾아지는지는 확인하지 못했다(에브리타임은 프로그램으로 열지 않는다). 앞부분이 같은 강의가 여럿이면 결과가 길어지지만('고급영어: 산문'·'고급영어: 발표' …) 빈 화면보다 낫다
 */
function searchName(name) {
  const s = catalogName(name);
  const i = s.search(/[:：]/);
  const head = i > 0 ? s.slice(0, i).trim() : "";
  return head.length >= 2 ? head : s;
}

/**
 * 강의평(10/5 사용자: "강의 후기 보기 누르면 에브리타임 내에 수강평으로 넘어가게"): 에브리타임 강의실 검색 화면의 주소. 강의평은 거기서 강의를 한 번 더 눌러야 나온다
 * (에브리타임의 강의 번호를 편람에서 알 수 없어 바로 가지 못한다). 별점·후기는 가져오지 않는다(에브리타임 약관. 바깥 링크만 건다).
 * 주소에는 검색어 하나와 찾을 칸 하나만 넣을 수 있다. 늘 과목명으로 찾는다(10/22 밤 사용자: "그 강의평 연결은 과목 이름으로 통일하자". 교수가 여럿이면
 * 한 화면에서 견줄 수 있다. 교수가 한 사람이고 과목명으로 찾으면 결과가 긴 과목을 교수명으로 찾던 것은 뺐다)
 */
function reviewUrl(name) {
  return `https://everytime.kr/lecture/search?keyword=${encodeURIComponent(searchName(name))}&condition=name`;
}

function renderCourseSheet() {
  const p = sheetPick();
  if (!p) return;
  const c = state.byId.get(p.id);
  $("cs-title").textContent = c ? c.name : p.name || p.id;
  $("cs-meta").textContent = [p.id, c ? c.dept : p.dept, fmtCredit(c ? c.credit : p.credit)].filter(Boolean).join(" · ");
  $("cs-review").href = reviewUrl(c ? c.name : p.name || p.id); // 이번 자료에 없는 과목에도 둔다(과목명은 남아 있다)
  setCatalogLink($("cs-catalog"), p.id, "");
  const body = $("cs-body");
  if (!c) {
    body.replaceChildren(h("p", {}, "이번 자료에 없는 과목이에요"));
    return;
  }
  body.replaceChildren(
    h("div", { class: "list-head" },
      h("span", { id: "cs-count" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", id: "cs-all", "data-act": "all" }), "전체 선택")),
    h("ul", { class: "list secs" }, c.sections.map((s) => { const li = h("li", { class: "sec", "data-key": s.key }); fillSec(li, p, s); return li; })));
  refreshSheetHead();
}

function refreshSheetHead() {
  const p = sheetPick();
  const c = p && state.byId.get(p.id);
  if (!c || !$("cs-count")) return;
  const on = c.sections.filter((s) => !p.excluded.has(s.key)).length;
  $("cs-count").textContent = `분반 ${on}/${c.sections.length}`;
  const all = $("cs-all");
  all.checked = on === c.sections.length;
  all.indeterminate = on > 0 && on < c.sections.length;
}

/** 수업 칩과 편람 값 줄의 글: '화·목 11:00~12:15 · 28동 303호'(같은 시각·장소의 요일은 한 묶음). 직접 고른 건물은 건물만('301동'). */
const groupText = (g) => `${daysLabel(g.days)} ${hm(g.start)}~${hm(g.end)} · ${roomLabel({ building: g.building, room: g.room })}`;

/**
 * 분반 행 하나: 체크박스와 001(이주훈) / 요일·시각 · 강의실 / 태그.
 * - 편람에 시간이 있는 분반은 행 끝의 펼침 화살표를 누르면 둘째 줄 대신 수업이 칩으로 놓인다(10/5 사용자: "이미 강의 시간이랑 강의 장소 지정되어 있어도
 *   바꿀 수 있게"). 칩을 누르면 그 수업을 고치는 입력 줄, ×는 빼기, 시간 추가는 더하기. 바꾼 분반은 접으면 '직접 입력', 펼치면 편람 값과 되돌리기.
 *   행의 다른 곳을 누르면 전처럼 분반이 켜지고 꺼진다(값 자리를 버튼으로 만들지 않았다: 켜고 끄기가 훨씬 잦다)
 * - 편람의 강의실이 미정인 수업은 전처럼 값 자리의 선택칸으로 건물을 고른다
 * - 편람에 시간이 없는 분반은 '시간 미정'과 시간 추가. 넣은 시간은 칩으로 늘 보인다(화살표 없음)
 * 입력 줄은 연 것 바로 아래에 둔다: 칩을 고칠 때는 칩 아래(시간 추가보다 위), 더할 때는 시간 추가 아래.
 */
function fillSec(li, p, s) {
  const on = !p.excluded.has(s.key);
  const st = editState(s.key);
  const hasCat = s.meetings.length > 0;
  const altered = isChanged(s); // 편람의 시간·장소를 바꿔 둔 분반
  const eff = effMeetings(s);
  const groups = meetingGroups(eff);
  const wide = hasCat && st.wide;
  // 추가 설정(공강 요일·점심시간) 때문에 쓰지 않는 분반: 체크는 켠 그대로 두고 끈 분반처럼 흐리게 한다(켠 것과 조건이 막은 것을 섞지 않는다)
  const rules = on ? activeRules() : null;
  const unit = [{ meetings: eff }];
  const out = !!rules && !meetsRules(unit, rules);
  li.className = on && !out ? "sec" : "sec off";
  const editId = `edit-${uid(s.key)}`;
  const adding = st.open && st.at < 0;
  const addButton = () => h("button", { type: "button", class: "btn-text small", "data-act": "add-time", "aria-expanded": String(adding), "aria-controls": adding ? editId : null },
    icon(I.plus, 16), "시간 추가");
  const when = (g) => `${daysLabel(g.days)} ${hm(g.start)}~${hm(g.end)}`;
  const dot = () => h("span", { "aria-hidden": "true" }, "·");

  const parts = [h("label", { class: "sec-pick" },
    h("input", { type: "checkbox", checked: on, "data-act": "toggle" }),
    h("span", { class: "sec-title" }, s.no, h("span", { class: "prof" }, `(${instructorOf(s)})`)))];
  if (hasCat) {
    parts.push(h("button", { type: "button", class: "icon-btn sec-more", "data-act": "more", "aria-expanded": String(wide), "aria-label": `${sectionLabel(s)} 시간·장소 바꾸기` }, icon(I.down, 20)));
  }

  // 태그는 둘까지: 추가 설정 때문에 쓰지 않는 까닭(흐린데 까닭이 안 보이면 안 되니 맨 앞) → 주의(편람 바뀜은 시트를 닫으면 사라지니 폐강 대상보다 앞) → 중립(직접 입력)
  const tags = [];
  if (out) {
    const byDay = !meetsRules(unit, { freeDays: rules.freeDays }), byLunch = !meetsRules(unit, { lunch: rules.lunch });
    tags.push(["", byDay && byLunch ? NONE_TAG.rules : byDay ? NONE_TAG.freeDays : NONE_TAG.lunch]);
  }
  if (catalogMoved(s)) tags.push(["warning", "편람 바뀜"]);
  if (s.status === "폐강대상") tags.push(["warning", "폐강 대상"]);

  const rows = [], extra = [];
  if (hasCat && !wide) {
    // 접힌 분반: 수업마다 한 줄. 편람의 강의실이 미정인 수업은 값 자리를 눌러 건물을 고른다(바꿔 둔 분반은 바꾼 값 그대로)
    const unknown = (g) => g.indices.filter((i) => !s.meetings[i].building);
    const pending = altered ? [] : groups.filter((g) => unknown(g).length);
    let manual = altered;
    for (const g of groups) {
      if (!pending.includes(g)) {
        rows.push(h("div", { class: "sec-when" }, h("span", {}, when(g)), dot(), h("span", {}, roomLabel({ building: g.building, room: g.room }))));
        continue;
      }
      if (g.building) manual = true;
      rows.push(h("div", { class: "sec-when" }, h("span", {}, when(g)), dot(),
        h("span", { class: "sec-value" }, g.building ? buildingLabel(g.building) : "강의실 미정", icon(I.down, 16),
          buildingSelect(g.building, {
            "data-act": "room", "data-idx": unknown(g).join(","),
            "aria-label": pending.length > 1 ? `${s.no} ${daysLabel(g.days)} 강의실` : `${s.no} 강의실`,
          }))));
    }
    if (!groups.length) rows.push(h("div", { class: "sec-when" }, h("span", {}, "시간 미정"))); // 수업을 다 뺐다
    if (manual) tags.push(["", "직접 입력"]);
  } else {
    if (!groups.length && !hasCat) rows.push(h("div", { class: "sec-when" }, h("span", {}, "시간 미정"), addButton()));
    if (groups.length) {
      extra.push(meetingChips(chipMeetings(eff), st, editId));
      if (st.open && st.at >= 0) extra.push(timeEditor(st, editId));
    }
    if (groups.length || hasCat) extra.push(h("div", { class: "sec-tools" }, addButton()));
    if (adding) extra.push(timeEditor(st, editId));
    // 바꾼 분반을 펼치면 맨 아래에 편람 값과 되돌리기(펼친 동안에는 직접 입력 태그 대신 이 줄이 알린다)
    if (altered) {
      extra.push(h("div", { class: "sec-orig" },
        h("span", {}, `편람 ${meetingGroups(s.meetings).map(groupText).join(", ")}`),
        h("button", { type: "button", class: "btn-text small", "data-act": "revert" }, "되돌리기")));
    }
  }
  if (tags.length) rows.push(h("div", { class: "tags" }, tags.slice(0, 2).map(([k, t]) => h("span", { class: k ? `tag ${k}` : "tag" }, t))));
  li.replaceChildren(...parts, ...rows, ...extra);
}

/** 수업 칩(10/23 사용자: 넣은 분반의 칩도 "요일별로 따로"): 수업 하나가 칩 하나다. 요일·시각 차례. 접힌 줄(sec-when)은 전처럼 같은 시각·장소를 한 줄로 묶는다 */
const chipMeetings = (ms) => ms.map((m) => ({ day: m.day, start: m.start, end: m.end, building: m.building || "", room: m.building ? m.room || "" : "" }))
  .sort((a, b) => a.day - b.day || a.start - b.start || a.end - b.end);
const chipText = (m) => `${DAY_KO[m.day]} ${hm(m.start)}~${hm(m.end)} · ${roomLabel({ building: m.building, room: m.room })}`;
const toGroups = (list) => list.map((m) => ({ days: [m.day], start: m.start, end: m.end, building: m.building, room: m.room }));
const sameMeeting = (a, b) => a.day === b.day && a.start === b.start && a.end === b.end && a.building === b.building && a.room === b.room;
function meetingChips(list, st, editId) {
  return h("div", { class: "chips" }, list.map((m, i) => {
    const text = chipText(m), editing = st.open && st.at === i;
    return h("span", { class: editing ? "chip is-editing" : "chip" },
      h("button", { type: "button", class: "chip-q", "data-act": "edit-chip", "data-i": String(i), "aria-expanded": String(editing), "aria-controls": editing ? editId : null,
        "aria-label": `${text} 바꾸기` }, h("span", {}, text)),
      h("button", { type: "button", class: "chip-x", "data-act": "del-chip", "data-i": String(i), "aria-label": `${text} 빼기` }, icon(I.x, 16)));
  }));
}

/** 수업을 더하거나 고치는 입력 줄: 요일(월–토 가운데 하나), 시작·끝(시·분 선택, 24시간, 5분 단위), 건물(기본 미정)과 호실.
 *  누름 버튼 없이 고르는 대로 바로 들어간다(10/23 사용자: '바꾸기'를 눌러야 하는 줄 몰라 세 번 놓쳤다 → "걍 빼버려"). 더할 때는 요일을 고르는 순간 그 수업이 생기고
 *  그 칩을 고치는 줄이 된다. 호실은 건물을 고르면 나온다(10/23 사용자: 고른 건물의 호실이 안 보인다). type="time" 은 쓰지 않는다(AM/PM).
 *  끝 시각이 시작보다 빠르면 시각 줄 아래 '끝 시각이 시작보다 빨라요'이고 그동안은 반영하지 않는다 */
function timeEditor(st, id) {
  const errId = `${id}-err`;
  const sel = (key, from, to, step, label) => {
    const values = range(from, to, step);
    if (!values.includes(st[key])) values.push(st[key]); // 눈금 밖의 편람 값도 그대로 보인다
    const el = h("select", { class: "select", "data-edit": key, "aria-label": label }, values.sort((a, b) => a - b).map((v) => h("option", { value: String(v) }, pad2(v))));
    el.value = String(st[key]);
    if (st.error === "time" && (key === "eh" || key === "em")) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", errId); }
    return el;
  };
  const picker = buildingSelect(st.b, { class: "select", "data-edit": "b", "aria-label": "건물" });
  const room = st.b ? h("input", { class: "text-input room-input", type: "text", "data-edit": "room", value: st.room || "", maxlength: "12", autocomplete: "off",
    autocapitalize: "off", spellcheck: "false", enterkeyhint: "done", placeholder: "호실", "aria-label": "호실" }) : null;
  const error = (kind, text) => (st.error === kind ? h("p", { class: "error-line", id: errId }, text) : null);
  const colon = () => h("span", { "aria-hidden": "true" }, ":");
  return h("div", { class: "sec-edit", id },
    h("fieldset", {}, h("legend", { class: "sr-only" }, "요일"),
      h("div", { class: "days" }, range(0, st.days.includes(6) ? 6 : 5).map((d) => h("label", {},
        h("input", { type: "radio", name: `${id}-day`, value: String(d), checked: st.days.includes(d), "data-edit": "day", "aria-label": `${DAY_KO[d]}요일` }), DAY_KO[d])))),
    // 좁아서 한 줄에 안 들어가면 시작과 끝 사이에서만 줄을 바꾼다(09:00 ~ / 10:15)
    h("div", { class: "time-row" },
      h("span", { class: "time-part" }, sel("sh", 6, 23, 1, "시작 시"), colon(), sel("sm", 0, 55, 5, "시작 분"), h("span", { "aria-hidden": "true" }, "~")),
      h("span", { class: "time-part" }, sel("eh", 6, 23, 1, "끝 시"), colon(), sel("em", 0, 55, 5, "끝 분"))),
    error("time", "끝 시각이 시작보다 빨라요"),
    h("div", { class: "place-row" }, picker, room));
}
/**
 * 입력 줄에서 바꾼 칸을 상태에 넣고, 반영할 수업 목록을 돌려준다(아직 반영할 수 없으면 null: 시각이 거꾸로이거나 더하는 중에 요일을 아직 안 골랐다).
 * 건물을 바꾸면 호실은 비운다(편람의 건물로 돌아오면 편람의 호실)
 */
function editedList(st, list, x) {
  const k = x.dataset.edit;
  if (k === "day") st.days = [Number(x.value)];
  else if (k === "b") { st.b = x.value; st.room = st.b && st.b === st.b0 ? st.room0 : ""; }
  else if (k === "room") st.room = x.value.trim().slice(0, 12);
  else st[k] = Number(x.value);
  const a = st.sh * 60 + st.sm, b = st.eh * 60 + st.em;
  st.error = b <= a ? "time" : "";
  if (st.error || !st.days.length) return null;
  const m = { day: st.days[0], start: a, end: b, building: st.b, room: st.b ? st.room || "" : "" };
  const next = list.slice();
  if (st.at >= 0) next[st.at] = m; else next.push(m);
  return { next, m };
}
/**
 * 반영한 뒤 입력 줄이 고칠 칩(st.at): 반영한 수업, 없으면 호실만 다른 수업(고친 값이 편람과 같아져 저장하지 않고 편람의 호실이 붙었다. 그 호실을 입력 줄에도).
 * 둘 다 없으면(같은 수업이 이미 있어 하나로 합쳐졌다 말고는 없다) 입력 줄을 닫는다
 */
function followChip(st, list, m) {
  let i = list.findIndex((x) => sameMeeting(x, m));
  if (i < 0) {
    i = list.findIndex((x) => x.day === m.day && x.start === m.start && x.end === m.end && x.building === m.building);
    if (i >= 0) Object.assign(st, { room: list[i].room, b0: list[i].building, room0: list[i].room });
  }
  st.at = i;
  if (i < 0) st.open = false;
}
/** 바꾼 칸에 다시 초점을 줄 선택자(입력 줄을 다시 그린 뒤) */
const editFocus = (x) => `[data-edit="${x.dataset.edit}"]${x.dataset.edit === "day" ? `[value="${x.value}"]` : ""}`;

function refillSec(li, focusSel) {
  const p = sheetPick();
  const c = p && state.byId.get(p.id);
  const s = c && c.sections.find((x) => x.key === li.dataset.key);
  if (!s) return;
  fillSec(li, p, s);
  if (focusSel) li.querySelector(focusSel)?.focus();
}

function sectionsChanged() {
  changed();
  refreshSheetHead();
  renderPicked();
}

$("cs-body").addEventListener("change", (e) => {
  const t = e.target;
  const p = sheetPick();
  const c = p && state.byId.get(p.id);
  if (!c) return;
  const li = t.closest(".sec");
  if (t.dataset.act === "all") {
    p.excluded = t.checked ? new Set() : new Set(c.sections.map((s) => s.key));
    sectionsChanged();
    for (const row of $("cs-body").querySelectorAll(".sec")) refillSec(row); // 흐림과 태그가 추가 설정에도 달려 있어 행을 다시 그린다
  } else if (t.dataset.act === "toggle") {
    if (t.checked) p.excluded.delete(li.dataset.key); else p.excluded.add(li.dataset.key);
    const had = li.contains(document.activeElement); // 체크박스를 눌렀거나 키보드로 바꿨으면 다시 그린 뒤에도 초점이 그 칸에 남는다
    sectionsChanged();
    refillSec(li, had ? 'input[data-act="toggle"]' : null);
  } else if (t.dataset.act === "room") {
    const key = li.dataset.key;
    const o = { ...(state.overrides[key] || {}) };
    const rooms = { ...(o.rooms || {}) };
    for (const i of t.dataset.idx.split(",")) { if (t.value) rooms[i] = t.value; else delete rooms[i]; }
    if (Object.keys(rooms).length) o.rooms = rooms; else delete o.rooms;
    if (o.rooms || o.meet) state.overrides[key] = o; else delete state.overrides[key];
    changed();
    renderPicked();
    refillSec(li, `select[data-idx="${t.dataset.idx}"]`);
  } else if (t.dataset.edit && t.dataset.edit !== "room") { // 호실은 아래 input 에서(치는 대로)
    const s = c.sections.find((x) => x.key === li.dataset.key);
    if (s) applySecEdit(li, s, t);
  }
});
/** 과목 시트의 입력 줄을 바로 반영한다(editedList). 반영하면 칩이 바뀐 자리를 찾아 그 칩의 입력 줄로 둔다 */
function applySecEdit(li, s, x, { light = false } = {}) {
  const st = editState(s.key);
  const r = editedList(st, chipMeetings(effMeetings(s)), x);
  if (r) {
    setOwn(s, toGroups(r.next));
    changed();
    renderPicked();
    followChip(st, chipMeetings(effMeetings(s)), r.m);
  }
  if (light && r && st.at >= 0) { relabelChip(li, st.at, chipMeetings(effMeetings(s))[st.at]); return; } // 호실을 치는 중: 다시 그리지 않는다(화상 키보드가 닫히지 않게)
  refillSec(li, editFocus(x));
}
/** 칩 하나의 글만 고친다(호실을 치는 동안) */
function relabelChip(li, i, m) {
  const b = li.querySelector(`.chip-q[data-i="${i}"]`), x = li.querySelector(`.chip-x[data-i="${i}"]`);
  if (!b || !m) return;
  const text = chipText(m);
  b.firstElementChild.textContent = text;
  b.setAttribute("aria-label", `${text} 바꾸기`);
  x?.setAttribute("aria-label", `${text} 빼기`);
}
$("cs-body").addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.edit !== "room" || e.isComposing) return;
  const p = sheetPick(), c = p && state.byId.get(p.id), li = t.closest(".sec");
  const s = c && li && c.sections.find((x) => x.key === li.dataset.key);
  if (s) applySecEdit(li, s, t, { light: true });
});

$("cs-body").addEventListener("click", (e) => {
  const actEl = e.target.closest("[data-act]");
  const act = actEl && actEl.dataset.act;
  const li = e.target.closest(".sec");
  const p = sheetPick();
  const c = p && state.byId.get(p.id);
  const s = c && li && c.sections.find((x) => x.key === li.dataset.key);
  if (!s) return;
  const st = editState(s.key);
  const applied = () => { changed(); renderPicked(); };
  if (act === "more") {
    st.wide = !st.wide;
    if (!st.wide) { st.open = false; st.error = ""; }
    refillSec(li, '[data-act="more"]');
  } else if (act === "add-time") {
    // 더할 때는 요일을 비워 둔다(시각과 건물은 지난번 값, 호실은 빈칸). 요일을 고르면 생긴다
    Object.assign(st, { open: !(st.open && st.at < 0), at: -1, days: [], b0: "", room0: "", room: "", error: "" });
    refillSec(li, '[data-act="add-time"]');
  } else if (act === "edit-chip") {
    const i = Number(actEl.dataset.i), m = chipMeetings(effMeetings(s))[i];
    if (!m) return;
    if (st.open && st.at === i) Object.assign(st, { open: false, error: "" });
    else {
      Object.assign(st, { open: true, at: i, days: [m.day], sh: Math.floor(m.start / 60), sm: m.start % 60, eh: Math.floor(m.end / 60), em: m.end % 60,
        b: m.building, room: m.room, b0: m.building, room0: m.room, error: "" });
    }
    refillSec(li, `[data-act="edit-chip"][data-i="${i}"]`);
  } else if (act === "del-chip") {
    const list = chipMeetings(effMeetings(s));
    list.splice(Number(actEl.dataset.i), 1);
    setOwn(s, toGroups(list));
    Object.assign(st, { open: false, error: "" });
    applied();
    refillSec(li, '[data-act="add-time"]');
  } else if (act === "revert") { // 묻지 않고 편람 값으로(다시 바꾸면 된다)
    delete state.overrides[s.key];
    Object.assign(st, { open: false, error: "" });
    applied();
    refillSec(li, '[data-act="more"]');
  } else if (!e.target.closest("label, select, button, input, a, .sec-edit, .chips, .sec-tools, .sec-orig")) {
    // 행 어디를 눌러도 분반이 켜지고 꺼진다(강의실·시간을 넣는 자리와 펼침 화살표는 빼고)
    li.querySelector('input[data-act="toggle"]')?.click();
  }
});

/** 과목 시트를 닫았다: 편람 값이 달라진 것은 본 것으로 치고(그 뒤로는 '편람 바뀜'을 달지 않는다. 또 달라지면 다시 단다), 펼친 분반과 입력 줄은 접는다. */
function courseSheetClosed() {
  for (const st of edits.values()) Object.assign(st, { wide: false, open: false, error: "" });
  const p = sheetPick();
  const c = p && state.byId.get(p.id);
  if (!c) return;
  let seen = false;
  for (const s of c.sections) {
    if (!catalogMoved(s)) continue;
    state.overrides[s.key].base = sigOf(s.meetings);
    seen = true;
  }
  if (seen) { saveOverrides(); renderPicked(); }
}

// ---------------------------------------------------------------- 시트 (과목, 추가 설정, 이동시간 계산 방법, 홈 화면에 추가, 묻는 시트)

function openSheet(d, opener) {
  for (const x of document.querySelectorAll("dialog[open]")) x.close(); // 시트 위에 시트를 띄우지 않는다
  d.returnTo = opener || document.activeElement;
  d.style.transform = d.style.margin = "";
  d.showModal();
  d.scrollTop = 0;
  d.classList.remove("is-scrolled");
  // 추가 설정 시트는 조합이 없어지면 머리에 오류 줄이 생긴다. 가운데 대화상자(폭 600px부터)는 높이가 달라지면 위아래로 반씩 움직이므로,
  // 열 때의 아래 끝을 붙잡아 둔다: 폰의 아래 시트처럼 위쪽만 늘어나고 누르던 칸은 제자리다
  if (d.id === "rules-sheet" && matchMedia("(min-width: 37.5em)").matches) {
    d.style.margin = `auto auto max(5dvh, calc(50dvh - ${d.getBoundingClientRect().height / 2}px))`;
  }
}

/** 완료·닫기, 바깥 누르기, 아래로 끌기: 200ms 에 내려가며 닫힌다. Esc·Android 뒤로 가기(cancel)는 브라우저가 바로 닫는다. */
function closeSheet(d) {
  if (!d || !d.open || d.closing) return; // d 가 없으면(스낵바 [다시 시도]로 다시 저장할 때) 닫을 시트가 없다
  if (reduceMotion.matches || !d.animate) { d.close(); return; }
  d.closing = true;
  // 묻는 팝업은 어느 폭에서나 가운데, 폰의 과목 추가 시트는 600~679px 에서도 아래 시트
  const bottom = d === addSheet || (!d.classList.contains("ask") && !matchMedia("(min-width: 37.5em)").matches);
  const opts = { duration: 200, easing: "cubic-bezier(0.3, 0, 0.8, 0.15)", fill: "forwards" }; // dur-exit, ease-exit
  const from = d.style.transform || "translateY(0)";
  const anims = [d.animate([{ transform: from, opacity: 1 }, { transform: bottom ? "translateY(100%)" : "translateY(16px)", opacity: bottom ? 1 : 0 }], opts)];
  try { anims.push(d.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, pseudoElement: "::backdrop" })); } catch { /* 안 되는 브라우저는 바탕이 바로 사라진다 */ }
  anims[0].finished.catch(() => null).then(() => {
    d.close();
    for (const a of anims) a.cancel();
    d.style.transform = "";
    d.closing = false;
  });
}

function enableSheetDrag(d) {
  const head = d.querySelector(".sheet-head");
  let y0 = null, t0 = 0, dy = 0, dragging = false, pid = null;
  head.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || matchMedia("(min-width: 37.5em)").matches || d.classList.contains("ask")) return; // 가운데 대화상자·팝업은 끌지 않는다
    y0 = e.clientY; t0 = e.timeStamp; dy = 0; dragging = false; pid = e.pointerId;
  });
  head.addEventListener("pointermove", (e) => {
    if (y0 === null || e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - y0);
    if (!dragging && dy > 8) { dragging = true; head.setPointerCapture(pid); }
    if (dragging) d.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (y0 === null || e.pointerId !== pid) return;
    y0 = null;
    if (!dragging) return;
    const speed = dy / Math.max(1, e.timeStamp - t0);
    if (dy > 96 || (dy > 32 && speed > 0.5)) closeSheet(d);
    else if (d.animate && !reduceMotion.matches) {
      d.animate([{ transform: d.style.transform }, { transform: "translateY(0)" }], { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      d.style.transform = "";
    } else d.style.transform = "";
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

// 시트 머리는 위에 붙어 있다(sticky). 키보드로 거슬러 올라올 때 초점 받은 것이 그 밑에 가리지 않게 머리 높이 + 8px(초점 테두리 몫)만큼 스크롤 여백을 둔다
// (WCAG 2.2 SC 2.4.11, 기법 C43). 머리 높이는 과목명 줄 수, 글자 크기, 추가 설정 시트의 오류 줄에 따라 달라서 재어서 넣는다(아래쪽 8px 은 style.css)
const sheetHeads = new ResizeObserver((entries) => {
  for (const { target } of entries) target.parentElement.style.scrollPaddingTop = `${Math.ceil(target.getBoundingClientRect().height) + 8}px`;
});
/** 시트 하나에 닫기·바깥 누르기·닫힐 때 초점 돌리기·붙은 머리 선·끌어 닫기를 붙인다(index.html 의 시트들과, 나중에 만드는 개발자 메뉴 시트) */
function wireSheet(d) {
  d.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { closeSheet(d); return; }
    if (e.target === d && d !== addSheet) { // 바깥(::backdrop) 누르기. 폰의 과목 추가 시트는 바깥이 시간표를 보는 자리라 닫지 않는다
      const r = d.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) closeSheet(d);
    }
  });
  d.addEventListener("close", () => {
    if (d.open || (d === addSheet && addConverting)) return; // 닫힌 뒤 바로 다시 열었다, 과목 추가 시트가 넓은 화면의 칸으로 옮겨 갔다(초점은 그 칸에)
    const opener = d.returnTo;
    d.returnTo = null;
    const live = d.querySelector("[data-live]");
    if (live) live.textContent = ""; // 다음에 열 때 지난 알림이 다시 읽히지 않게
    const id = sheetId;
    if (d.id === "course-sheet") { courseSheetClosed(); sheetId = null; }
    if (d.id === "item-sheet") itemSheetClosed();
    // 연 요소로 초점을 돌린다. 그사이 사라졌으면(다시 그린 과목 행, 원인이 풀려 숨은 오류 줄 옆 '추가 설정') 그 자리를 잇는 것으로
    const key = d.id === "item-sheet" ? itemSheet.key : d.id === "custom-sheet" ? custom.key : "";
    // 내 시간표의 항목 시트는 연 행(또는 격자의 칸)을 다시 그렸으면 같은 항목의 것으로, 항목을 뺐으면 '과목 추가'로
    const sel = !key ? "" : opener && opener.dataset.key ? `#wk [data-key="${CSS.escape(key)}"]` : `#items [data-item="${CSS.escape(key)}"]`;
    const again = (...sels) => sels.some((x) => { const el = x && document.querySelector(x); if (el) el.focus({ preventScroll: true }); return !!el; });
    if (opener && opener.isConnected && !opener.closest("[hidden]")) opener.focus({ preventScroll: true });
    else if (d.id === "course-sheet") focusRow(id, ".course-hit");
    else if (d.id === "rules-sheet") $("open-rules").focus({ preventScroll: true });
    else if (d.id === "item-sheet" || d.id === "custom-sheet") again(sel, '#items [data-add="course"]');
    else if (d === addSheet) again('#items [data-add="course"]'); // 넣고 빼는 동안 항목 목록을 다시 그렸다
  });
  // 내용이 붙어 있는 머리 밑으로 올라가 있는 동안 머리 아래에 선을 긋는다(잘린 글자가 머리의 글자에 붙어 보이지 않게). 맨 위에서는 없다
  d.addEventListener("scroll", () => d.classList.toggle("is-scrolled", d.scrollTop > 0), { passive: true });
  if (d !== addSheet) enableSheetDrag(d); // 과목 추가 시트는 55%·90% 두 높이라 따로(아래 '폰의 과목 추가 시트')
  const head = d.querySelector(":scope > .sheet-head");
  if (head) sheetHeads.observe(head);
}
for (const d of document.querySelectorAll("dialog.sheet")) wireSheet(d);

// ---------------------------------------------------------------- 조건

const segItem = (name, value, label, checked) => h("label", {}, h("input", { type: "radio", name, value, checked }), label);

/** 출발·도착이 어느 세그먼트인지: 기숙사 동이면 'dorm'(동은 아래 선택칸에서), 정문 같은 출발 후보면 그 건물, 나머지는 'other'. */
function homeSeg(b) {
  if (isDorm(b)) return "dorm";
  return (state.campus.homes || []).some(([x]) => x === b) ? b : "other";
}

/** 세그먼트 아래 선택칸은 한 자리다(10/2 디자인): '기숙사'면 동(이름 '기숙사 동'), '다른 건물'이면 건물(이름 '건물'), '정문'이면 없다.
 *  세그먼트 라디오는 다시 그리지 않아서, 선택칸이 나타나거나 바뀌어도 초점은 고른 라디오에 남는다. */
function syncHomeSelect() {
  const seg = homeSeg(state.home), sel = $("home-select");
  const kind = seg === "dorm" ? (dormOptions().length > 1 ? "dorm" : "") : seg === "other" ? "other" : "";
  if (kind && sel.dataset.kind !== kind) {
    sel.replaceChildren(...(kind === "dorm" ? dormOptions() : buildingOptions()).map(([b, text]) => h("option", { value: b }, text)));
    sel.setAttribute("aria-label", kind === "dorm" ? "기숙사 동" : "건물");
    sel.dataset.kind = kind;
  }
  sel.hidden = !kind;
  if (kind) sel.value = state.home;
}

function renderSettings() {
  const homes = state.campus.homes || [];
  const seg = homeSeg(state.home);
  // 세그먼트는 자료의 출발 후보 차례 그대로(10/3: 정문 | 기숙사) + 다른 건물. 출발 후보의 기숙사(919A)가 기숙사 동 묶음의 세그먼트다
  $("home-seg").replaceChildren(
    ...homes.map(([b, label]) => { const v = isDorm(b) ? "dorm" : b; return segItem("home", v, label, v === seg); }),
    segItem("home", "other", "다른 건물", seg === "other"));
  $("home-seg").hidden = false;
  delete $("home-select").dataset.kind; // 자료를 새로 받았으면 목록도 새로
  syncHomeSelect();
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === state.mode;
    r.disabled = r.value === "slope" && !state.campus.slope;
  }
}

/** 출발·도착을 바꾼다. 기숙사 동과 다른 건물은 마지막에 고른 것을 따로 기억해, 세그먼트를 오가도 그대로다. */
function setHome(b) {
  cancelCompute();
  state.home = b;
  store.set("home", b);
  const seg = homeSeg(b);
  if (seg === "dorm") { state.homeDorm = b; store.set("homeDorm", b); }
  else if (seg === "other") { state.homeOther = b; store.set("homeOther", b); }
  dropExplore();
  syncHomeSelect();
}

$("home-seg").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "dorm") {
    const first = (state.campus.homes || []).map(([b]) => b).find(isDorm); // 처음에는 자료의 기숙사 출발 후보(919A동)
    setHome(dormOptions().some(([b]) => b === state.homeDorm) ? state.homeDorm : first);
  } else if (v === "other") {
    const opts = buildingOptions().map(([b]) => b);
    setHome(opts.includes(state.homeOther) ? state.homeOther : opts[0]);
  } else setHome(v);
});
$("home-select").addEventListener("change", (e) => setHome(e.target.value));
document.querySelector('input[name="mode"]').closest("fieldset").addEventListener("change", (e) => {
  if (e.target.name !== "mode") return;
  cancelCompute();
  state.mode = e.target.value;
  store.set("mode", state.mode);
  dropExplore();
});

// ---------------------------------------------------------------- 추가 설정 (공강 요일·점심시간)
// 조건 카드 맨 아래의 '추가 설정' 행을 누르면 시트가 열린다(10/5 사용자: "추가 설정 탭 하나 만들어서 공강 요일 고르는 옵션이랑 점심시간 지정하는
// 옵션도 넣어줘". 자리는 디자인의 세 안을 그림으로 보고 골랐다). 건 조건은 행 오른쪽과 결과 화면 조건 줄에 짧게 쓴다('금 공강 · 점심 60분').
// 엔진에는 rules = {freeDays: [요일(0 = 월)], lunch: {start, end, minutes}} 로 넘긴다(engine.js '조건'). 둘 다 꼭 지키는 조건이라 어기는 조합은 아예 빠진다.
// state.rules = {freeDays, lunch(없음이면 null), win(점심을 껐다 켜도 남는 시간대)}. 담은 과목처럼 학기마다 따로 기억한다
// (공강 요일은 그 학기 과목에 달린 것이라, 새 학기에 남아 있으면 까닭 모르게 조합이 준다)

function readRules(sem) {
  const r = store.get(semKey("rules", sem), null) || {};
  const win = (w) => !!w && [w.start, w.end].every((x) => Number.isInteger(x) && x % LUNCH_STEP === 0)
    && w.start >= LUNCH_FROM && w.start <= LUNCH_TO - 60 && w.end >= LUNCH_FROM + 60 && w.end <= LUNCH_TO && w.end > w.start;
  const lunch = win(r.lunch) && LUNCH_MINS.includes(r.lunch.minutes) && r.lunch.end - r.lunch.start >= r.lunch.minutes
    ? { start: r.lunch.start, end: r.lunch.end, minutes: r.lunch.minutes } : null;
  return {
    freeDays: Array.isArray(r.freeDays) ? [...new Set(r.freeDays.filter((d) => Number.isInteger(d) && d >= 0 && d < 7))].sort((a, b) => a - b) : [],
    lunch,
    win: lunch ? { start: lunch.start, end: lunch.end } : win(r.win) ? { start: r.win.start, end: r.win.end } : { ...LUNCH_WIN },
  };
}
function saveRules() {
  const r = state.rules;
  if (r.freeDays.length || r.lunch || r.win.start !== LUNCH_WIN.start || r.win.end !== LUNCH_WIN.end) store.set(semKey("rules"), r);
  else store.del(semKey("rules")); // 건 것이 없고 시간대도 처음 값이면 남기지 않는다
}

/** 엔진에 넘기는 조건. 건 것이 없으면 null(결과는 조건이 없을 때와 같다). */
function activeRules(r = state.rules) {
  if (!r.freeDays.length && !r.lunch) return null;
  return { freeDays: [...r.freeDays], lunch: r.lunch ? { ...r.lunch } : null };
}

/** 건 조건을 짧게: ['금 공강', '점심 60분']. 요일은 붙여 쓰고('월금 공강', '월화수목 등교'와 짝), 시간대를 통째로 비우면 '점심 12:00~13:00'. */
function rulesParts(rules) {
  const out = [];
  if (!rules) return out;
  if (rules.freeDays && rules.freeDays.length) out.push(`${[...rules.freeDays].sort((a, b) => a - b).map((d) => DAY_KO[d]).join("")} 공강`);
  const l = rules.lunch;
  if (l) out.push(l.minutes >= l.end - l.start ? `점심 ${hm(l.start)}~${hm(l.end)}` : `점심 ${l.minutes}분`);
  return out;
}

/** 덩이를 ' · '로 잇되 줄은 덩이 사이, 가운뎃점 앞에서만 바꾼다(줄 끝에 점이 남지 않게 점을 뒤 덩이에 붙인다. 덩이 하나가 줄보다 길 때만 그 안에서 바뀐다: style.css 의 .nw). */
const dotted = (parts) => parts.flatMap((t, i) => (i ? [" ", h("span", { class: "nw" }, `· ${t}`)] : [h("span", { class: "nw" }, t)]));

/** 고를 수 있는 공강 요일: 월–금, 그리고 켠 분반에 토·일 수업이 있거나 이미 골라 둔 요일(결과 화면 요일 탭과 같은 기준). */
function ruleDays() {
  const days = new Set([0, 1, 2, 3, 4, ...state.rules.freeDays]);
  for (const p of state.picks) {
    for (const s of (state.byId.get(p.id) || { sections: [] }).sections) {
      if (!p.excluded.has(s.key)) for (const m of effMeetings(s)) days.add(m.day);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** 추가 설정 때문에 조합이 없으면 그 까닭(freeDays·lunch·rules), 아니면 "". */
const rulesCause = () => (state.errors.general && state.errors.general.rules ? state.errors.cause : "");

/** 시트의 칸을 만든다(열 때 한 번). 그 뒤로는 값만 맞춘다(syncRules): 칸을 다시 만들지 않아 초점과 자리가 그대로다. */
function renderRulesSheet() {
  const r = state.rules;
  const opts = (from, to) => range(from, to, LUNCH_STEP).map((m) => h("option", { value: String(m) }, hm(m)));
  const mins = r.lunch ? r.lunch.minutes : 0;
  $("rules-body").replaceChildren(
    h("fieldset", { id: "rules-days" }, h("legend", { class: "field-label" }, "공강 요일"),
      h("div", { class: "days" }, ruleDays().map((d) => h("label", {},
        h("input", { type: "checkbox", value: String(d), checked: r.freeDays.includes(d), "data-rule": "day", "aria-label": `${DAY_KO[d]}요일` }), DAY_KO[d])))),
    h("fieldset", { id: "rules-lunch" }, h("legend", { class: "field-label" }, "점심시간"),
      h("div", { class: "seg" }, [0, ...LUNCH_MINS].map((v) => h("label", {},
        h("input", { type: "radio", name: "lunch", value: String(v), checked: v === mins, "data-rule": "lunch" }), v ? `${v}분` : "없음"))),
      // 시간대 줄: 없음일 때도 자리는 남긴다(아래에서 올라온 시트라 줄이 생기면 누르던 세그먼트가 손가락 밑에서 밀린다). 좁으면 시작과 끝 사이에서만 줄을 바꾼다
      h("div", { class: "time-row lunch-win", id: "lunch-win" },
        h("span", { class: "time-part" }, h("select", { class: "select", id: "lunch-start", "data-rule": "start", "aria-label": "점심시간대 시작" }, opts(LUNCH_FROM, LUNCH_TO - 60)), h("span", { "aria-hidden": "true" }, "~")),
        h("span", { class: "time-part" }, h("select", { class: "select", id: "lunch-end", "data-rule": "end", "aria-label": "점심시간대 끝" }, opts(LUNCH_FROM + 60, LUNCH_TO)), h("span", {}, "사이")))));
  syncRules();
}

/** 건 조건을 화면에 맞춘다: 조건 카드의 행, 열려 있는 시트의 시간대 줄과 머리의 오류 줄. */
function syncRules() {
  const r = state.rules;
  // 조건은 학기 몫이라 학기를 알기 전(처음 자료를 받는 중, 받지 못했을 때)에는 행을 두지 않는다: 눌러도 열 수 없는 행이 보이지 않게
  $("open-rules").hidden = !state.semester;
  const ruleParts = rulesParts(activeRules());
  $("rules-sum").replaceChildren(...dotted(ruleParts));
  $("rules-hint").hidden = ruleParts.length > 0; // 정한 것이 없을 때만 '공강 · 점심시간'(무엇을 정하는 곳인지)
  // 조합이 없는 까닭이 추가 설정이면 시트 머리(제목 아래)에도 같은 오류 줄을 두고 까닭인 칸에 잇는다. 머리에 두면 줄이 생겨도 그 아래의 칸은 제자리다.
  // 시간이 겹쳐서 없을 때는 두지 않는다(까닭이 이 시트에 없다)
  const cause = rulesCause(), err = $("rules-error");
  err.textContent = cause ? state.errors.general.text : "";
  err.hidden = !cause;
  const win = $("lunch-win");
  if (!win) return; // 시트를 아직 연 적이 없다
  const tie = (id, on) => { if (on) $(id).setAttribute("aria-describedby", "rules-error"); else $(id).removeAttribute("aria-describedby"); };
  tie("rules-days", cause === "freeDays" || cause === "rules");
  tie("rules-lunch", cause === "lunch" || cause === "rules");
  win.classList.toggle("is-off", !r.lunch);
  const w = r.lunch || r.win;
  $("lunch-start").value = String(w.start);
  $("lunch-end").value = String(w.end);
}

/** 조건이 바뀌었다: 저장하고, 만들어 둔 결과를 지우고, 조합이 있는지 그 자리에서 다시 본다. 새로 막히게 됐거나 까닭이 달라졌으면 시트 안의 알림 영역으로 읽는다. */
function rulesChanged() {
  const before = rulesCause() ? state.errors.general.text : "";
  saveRules();
  cancelCompute();
  clearErrors();
  dropExplore();
  checkOverlap();
  syncRules();
  renderPicked();
  const now = rulesCause() ? state.errors.general.text : "";
  if (now && now !== before) announce(now, "alert");
}

$("rules-body").addEventListener("change", (e) => {
  const t = e.target, k = t.dataset.rule, r = state.rules;
  if (!k) return;
  if (k === "day") {
    const d = Number(t.value);
    r.freeDays = t.checked ? [...new Set([...r.freeDays, d])].sort((a, b) => a - b) : r.freeDays.filter((x) => x !== d);
  } else if (k === "lunch") {
    const m = Number(t.value);
    if (!m) r.lunch = null; // 시간대(r.win)는 남는다
    else {
      let { start, end } = r.win;
      if (end - start < m) { end = Math.min(LUNCH_TO, start + m); start = end - m; } // 시간대가 고른 길이보다 짧으면 끝을 늘린다(끝이 15:00 에 걸리면 시작을 당긴다)
      r.win = { start, end };
      r.lunch = { start, end, minutes: m };
    }
  } else if (r.lunch) { // 시간대의 시작·끝. 고른 길이보다 짧아지면 다른 쪽 끝을 밀어 맞춘다(오류 줄 없이)
    const m = r.lunch.minutes;
    let start = k === "start" ? Number(t.value) : r.lunch.start, end = k === "end" ? Number(t.value) : r.lunch.end;
    if (end - start < m) {
      if (k === "start") { end = Math.min(LUNCH_TO, start + m); start = end - m; }
      else { start = Math.max(LUNCH_FROM, end - m); end = start + m; }
    }
    r.win = { start, end };
    r.lunch = { start, end, minutes: m };
  }
  rulesChanged();
});

// 열 때 칸을 새로 만든다: 닫혀 있는 동안 과목·분반이 바뀌어 요일 칸(토·일)과 오류 줄이 달라졌을 수 있다
function openRules(e) {
  if (!state.semester) return; // 학기를 아직 모른다(행은 감춰 둔다: syncRules)
  renderRulesSheet();
  openSheet($("rules-sheet"), e.currentTarget);
}
$("open-rules").addEventListener("click", openRules);
$("picked-rules").addEventListener("click", openRules); // 오류 줄 옆의 '추가 설정'

// ---------------------------------------------------------------- 시간표 만들기

function travelFor(mode) {
  if (!state.travel[mode]) state.travel[mode] = TravelMatrix.fromCampus(state.campus, mode);
  return state.travel[mode];
}

/** 시간·건물이 모두 같은 분반은 동선이 같으므로 하나로 묶어 탐색하고, 나머지는 '같은 시간·건물' 분반으로 보여 준다. */
function groupSections(sections) {
  const groups = new Map();
  for (const s of sections) {
    const sig = s.meetings.map((m) => `${m.day},${m.start},${m.end},${m.building}`).sort().join(";");
    if (!groups.has(sig)) groups.set(sig, { ...s, twins: [] });
    else groups.get(sig).twins.push(s);
  }
  return [...groups.values()];
}

/** 계산할 과목(켠 분반, 직접 넣은 강의실·시간 반영). 자료에 없는 과목은 빠진다. */
function collectCourses() {
  const courses = [], noSections = [];
  for (const p of state.picks) {
    const c = state.byId.get(p.id);
    if (!c) continue;
    const chosen = c.sections.filter((s) => !p.excluded.has(s.key)).map((s) => ({ ...s, meetings: effMeetings(s) }));
    if (!chosen.length) { noSections.push(c.id); continue; }
    courses.push({ ...c, sections: groupSections(chosen) });
  }
  return { courses, noSections };
}

const estimate = (courses) => courses.reduce((n, c) => n * c.sections.length, 1);

// ---------------------------------------------------------------- 탐색 워커
// 계산은 Web Worker(js/search-worker.js, 백엔드 몫)에서 돌려 화면이 멈추지 않게 한다. 워커를 못 쓰면 화면 스레드에서 돈다.
// 워커 → 화면: progress(0.2초마다), result, conflict(조합을 막는 과목과 까닭 cause), error. 취소는 terminate 후 새 워커
let worker = null, workerHasCampus = false, workerBroken = false, searchId = 0, pending = null;
class Cancelled extends Error {}

function stopWorker() {
  if (worker) worker.terminate();
  worker = null;
  workerHasCampus = false;
}

function startWorker() {
  if (worker || workerBroken || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  workerHasCampus = false;
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (!pending || m.id !== pending.id) return;
    if (m.type === "progress") pending.onProgress(m.done, m.ms);
    else if (m.type === "result") settle({ ranked: m.ranked, stats: m.stats, total: m.total || null });
    else if (m.type === "conflict") settle({ ranked: [], conflict: m.courseIds || [], cause: m.cause || "overlap" });
    else if (m.type === "error") settle(null, new Error(m.message));
  };
  worker.onerror = (e) => { // 워커 파일을 못 읽었거나 모듈 워커를 모르는 브라우저: 화면 스레드에서 다시
    e.preventDefault();
    workerBroken = true;
    stopWorker();
    const p = pending;
    pending = null;
    if (!p) return;
    if (p.opts.spare) p.reject(new Error("worker")); // 미리 찾던 것은 버린다(화면 스레드에서 돌리면 누르지도 않았는데 화면이 멈춘다)
    else runHere(p.courses, p.opts).then(p.resolve, p.reject);
  };
  return worker;
}

function settle(value, error) {
  const p = pending;
  pending = null;
  if (!p) return;
  if (error) p.reject(error); else p.resolve(value);
}

/** 화면 스레드에서 탐색(워커를 못 쓸 때). 전체 조합 수도 워커와 같게: 찾은 게 topK 보다 적으면 그게 전부다. count: false 면 다시 세지 않는다. */
async function runHere(courses, { topK = TOP_K, home = state.home, mode = state.mode, rules = activeRules(), count = true } = {}) {
  const res = search(courses, travelFor(mode), home, { topK, rules });
  if (!res.ranked.length) {
    const why = whyNone(courses, rules) || { cause: "overlap", courseIds: [] };
    return { ranked: [], conflict: why.courseIds, cause: why.cause };
  }
  res.total = res.ranked.length < topK ? { count: res.ranked.length, exact: true } : count ? countFeasible(courses, { rules }) : null;
  return res;
}

/**
 * 탐색: {ranked, stats, total} 또는 조합이 없으면 {ranked: [], conflict: [과목 id], cause}. total = {count, exact}(전체 조합 수).
 * opts = {topK, home, mode, rules, count, spare}. rules 는 추가 설정(공강 요일·점심시간): 조건을 지키는 조합만 찾고 센다.
 * 이어 찾기는 결과를 만든 조건(home·mode·rules) 그대로 topK 만 키워 다시 부르고 전체 수는 다시 세지 않는다
 * (count: false. 달라는 것보다 적게 왔을 때만 total 이 온다). spare: 누르기 전에 미리 찾아 두는 탐색이라 워커가 없으면 하지 않는다.
 */
function compute(courses, onProgress, opts = {}) {
  const w = startWorker();
  if (!w) return opts.spare ? Promise.reject(new Error("worker")) : runHere(courses, opts);
  const { topK = TOP_K, home = state.home, mode = state.mode, rules = activeRules(), count = true } = opts;
  return new Promise((resolve, reject) => {
    const id = ++searchId;
    pending = { id, courses, opts, resolve, reject, onProgress };
    const msg = { type: "search", id, courses, home, mode, topK, rules };
    if (!count) msg.total = false;
    if (!workerHasCampus) { msg.campus = state.campus; workerHasCampus = true; }
    w.postMessage(msg);
  });
}

/** 계산 중이면 멈춘다(취소 버튼, 담은 과목·조건이 바뀜, 다른 화면으로 감). */
function cancelCompute() {
  const p = pending;
  if (!p) return;
  pending = null;
  stopWorker();
  p.reject(new Cancelled());
}

function updateRun() {
  if (!busy) $("run").disabled = !state.loaded || !state.picks.length;
}

/** 오류 줄을 띄운 뒤: 첫 오류로 스크롤하고 알림 영역으로 읽는다. */
function reportError(text) {
  const first = $("picked-list").querySelector(".c-error") || ($("picked-error").hidden ? null : $("picked-error"));
  if (first) first.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
  announce(text, "alert");
}

/**
 * 버튼 안의 기다림(시간표 만들기, 후보 목록의 더 보기. 디자인 규칙 '상태와 피드백'): 500ms 가 지나도 안 끝나면 스피너와 글(text),
 * 10초를 넘을 것 같으면(누른 때부터 기다린 시간 + 남은 어림) 'text 42%'와 옆의 취소. 한번 뜬 스피너는 200ms 이상 둔다.
 * begin(heavy): heavy 면 화면 스레드에서 오래 계산할 것이라 스피너를 먼저 그린다(계산하는 동안에는 500ms 뒤에 그릴 수 없다).
 * end(keep): 기다림을 거둔다. keep 이면 한번 뜬 스피너를 200ms 채운 뒤에(취소했으면 바로)
 */
function busyButton(btn, cancel, { text, said, small = false }) {
  const t0 = performance.now();
  let shownAt = 0, long = false, timer = 0;
  const label = (s) => btn.replaceChildren(h("span", { class: small ? "spinner small" : "spinner", "aria-hidden": "true" }), s);
  const show = () => {
    if (shownAt) return;
    shownAt = performance.now();
    label(text);
    announce(said);
  };
  return {
    async begin(heavy) {
      if (heavy) { show(); await nextPaint(); } else timer = setTimeout(show, 500);
    },
    progress(done, ms) {
      if (!shownAt) return;
      const waited = performance.now() - t0, left = done > 0 ? ms / done - ms : Infinity;
      if (!long && (waited > 5000 || (ms > 1000 && waited + left > LONG_MS))) {
        long = true;
        cancel.hidden = false;
      }
      const pct = Math.min(99, Math.floor(done * 100));
      if (long && pct >= 1) label(`${text} ${pct}%`);
    },
    async end(keep) {
      clearTimeout(timer);
      const rest = shownAt && keep ? 200 - (performance.now() - shownAt) : 0;
      if (rest > 0) await sleep(rest);
    },
  };
}

let busy = false;
async function run() {
  if (busy || !state.loaded || !state.picks.length) return;
  clearErrors();
  const { courses: full, noSections } = collectCourses();
  state.errors.noSections = new Set(noSections);
  if (noSections.length) { renderPicked(); reportError("켠 분반이 없어요"); return; }
  if (!full.length) {
    state.errors.general = { text: "시간표를 만들 과목이 없어요" };
    renderPicked();
    reportError(state.errors.general.text);
    return;
  }
  renderPicked();
  // 워커에 보내는 것만 추린다(과목 id·이름·교과구분과 켠 분반)
  const courses = full.map((c) => ({ id: c.id, name: c.name, cls: c.cls, sections: c.sections }));
  busy = true;
  const btn = $("run"), cancel = $("cancel");
  btn.setAttribute("aria-disabled", "true"); // disabled 는 초점을 잃게 해서 쓰지 않는다. 두 번째 누름은 busy 로 무시한다
  const wait = busyButton(btn, cancel, { text: "만드는 중", said: "시간표 만드는 중" });
  await wait.begin(!startWorker() && estimate(courses) > HEAVY);
  loadRoutes();
  let res = null, cancelled = false;
  const rules = activeRules(); // 결과를 만든 조건. 더 보기도 이 조건 그대로 찾는다(그사이 조건을 바꾸면 계산이 취소된다)
  try {
    res = await compute(courses, wait.progress, { rules });
  } catch (e) {
    if (e instanceof Cancelled) cancelled = true;
    else console.error(e);
  }
  await wait.end(!cancelled);
  const hadFocus = cancel.contains(document.activeElement);
  cancel.hidden = true;
  btn.replaceChildren("시간표 만들기");
  btn.removeAttribute("aria-disabled");
  busy = false;
  updateRun();
  if (hadFocus) btn.focus({ preventScroll: true });
  if (cancelled) return;
  if (!res) {
    state.errors.general = { text: "시간표를 만들지 못했어요", retry: true };
    renderPicked();
    reportError(state.errors.general.text);
    return;
  }
  if (!res.ranked.length) {
    setNone(res.cause || "overlap", res.conflict || []);
    renderPicked();
    syncRules(); // 추가 설정 시트를 열어 둔 채 기다렸으면 그 머리의 오류 줄도
    reportError(state.errors.general.text);
    return;
  }
  showResult(res, full, rules);
}

/** 조합 안의 분반을 담은 과목 차례로 놓는다(고른 카드의 분반 목록 순서). */
function sortSections(ranked, courses) {
  const order = new Map(courses.map((c, i) => [c.id, i]));
  for (const ev of ranked) ev.sections.sort((a, b) => order.get(a.courseId) - order.get(b.courseId));
}

function showResult(res, courses, rules) {
  sortSections(res.ranked, courses);
  // ranked: 목록에 올린 조합(제목의 찾은 수). 처음에는 RANKS_STEP 개다. ahead: 찾아 뒀지만 아직 목록에 올리지 않은 다음 순위('더 보기'를 누를 때마다
  // RANKS_STEP 개씩 올린다). full: 마지막 탐색이 달라는 만큼 다 왔다(그 뒤 순위가 더 있을 수 있다). 더 보기는 아래 '순위'의 showMore.
  // days·axis: 요일 탭과 시간 축은 처음 찾은 것 전체(TOP_K 개)로 잡는다. 목록에 올린 것만으로 잡으면 더 보기를 누를 때마다 시간표가 움직인다
  state.result = { ranked: res.ranked.slice(0, RANKS_STEP), ahead: res.ranked.slice(RANKS_STEP), full: res.ranked.length >= TOP_K, total: res.total || null,
    courses, home: state.home, mode: state.mode, rules, days: weekDays(res.ranked), axis: hourRange(res.ranked) };
  rankMore.failed = rankMore.held = false;
  state.rank = 0;
  state.day = firstDay(res.ranked[0]);
  state.reveal = true;
  // 이벤트 테마 기간에 처음 시간표를 만든 사람에게는 그 해에 묻지 않는다(10/3 밤 디자인: 기본 테마를 써 본 적이 없어 '돌아갈' 곳이 없다.
  // 정보 화면의 '테마' 행으로는 바꿀 수 있고 다음 해에는 묻는다)
  if (themeOn() && !store.get("made", false)) store.set("themeAsked", season.event);
  store.set("made", true);
  updateInstall();
  go("result");
  // 성공 햅틱은 iOS 앱에서만(디자인 규칙 '햅틱': 안드로이드는 아직 없음. 정하면 조건만 넓힌다)
  if (SHELL === "ios") capacitor?.Plugins?.Haptics?.notification?.({ type: "SUCCESS" })?.catch?.(() => null);
}

// ---------------------------------------------------------------- 결과 화면

const currentEv = () => state.result.ranked[state.rank];

/** 찾아 둔 것(목록에 올린 것 + ahead) 뒤로 조합이 더 있나. 전체 수를 알면 그 수와 견주고, 다 못 센 큰 묶음이거나 수를 모르면(예전 워커)
 *  마지막 탐색이 달라는 만큼 다 왔을 때다. */
const moreBeyond = (R) => (R.total && R.total.exact ? R.total.count > R.ranked.length + R.ahead.length : R.full);
/** 목록에 올리지 않은 조합이 남았나(목록 아래의 '더 보기', 제목의 '걷는 시간이 짧은 …'). */
const hasMore = (R) => R.ahead.length > 0 || moreBeyond(R);
/** 목록 제목의 큰 덩이(더 보기로 카드가 붙은 뒤에는 알림 영역도 이 문장을 읽는다). 찾은 수는 목록에 올린 수이고 쉼표만 찍는다('1,020개'). */
const foundText = (R) => `${hasMore(R) ? "걷는 시간이 짧은" : "전체 조합"} ${R.ranked.length.toLocaleString("ko-KR")}개를 찾았어요`;

function firstDay(ev) {
  const days = ev ? Object.keys(ev.days).map(Number) : [];
  return days.length ? Math.min(...days) : 0;
}

/** 요일 탭: 월–금, 토·일 수업이 있으면 그날까지. */
function weekDays(ranked) {
  const used = new Set([0, 1, 2, 3, 4]);
  for (const ev of ranked) for (const d of Object.keys(ev.days)) used.add(Number(d));
  return [...used].sort((a, b) => a - b);
}

/** 시간 축: 조합들의 한 주 전체에서 가장 이른 정시부터 가장 늦은 정시까지(요일·순위를 바꿔도 움직이지 않는다). 너무 좁으면 네 시간. */
function hourRange(ranked) {
  let lo = Infinity, hi = -Infinity;
  for (const ev of ranked) for (const ms of Object.values(ev.days)) for (const m of ms) { lo = Math.min(lo, m.start); hi = Math.max(hi, m.end); }
  if (!Number.isFinite(lo)) return [9, 18];
  let h0 = Math.floor(lo / 60), h1 = Math.ceil(hi / 60);
  if (h1 - h0 < 4) { h1 = Math.min(24, h0 + 4); h0 = Math.max(0, h1 - 4); }
  return [h0, h1];
}

const lateOf = (l) => (l.slack !== null && l.slack < 0 ? Math.max(0, Math.round(-l.slack)) : 0); // 수치는 반올림한 정수 분

/**
 * 늦는 수업 요약(가이드 형식 '분 + 늦음'). 늦는 분을 더한 합은 뜻이 없어 쓰지 않고(10/1 사용자) 수업마다의 분을 쓴다(10/1 밤 사용자 결정).
 * 한 주(후보 카드)는 같은 분끼리 요일을 묶어 '월수 2분·목 5분 늦음'(요일 글자는 '월화수목 등교'처럼 붙여 쓴다). 같은 요일들에서 늦는
 * 분이 둘이면 요일을 한 번만: '화목 11분·17분 늦음'. 하루(하루 요약 태그)는 그날 늦는 분을 시각 순서로 '2분·5분 늦음'.
 * 늦는 수업이 없으면 ''.
 */
function lateText(legs, withDays) {
  const mins = new Map(); // 분 → 요일(처음 나온 순서). legs 는 요일·시각 순서
  for (const l of legs) {
    const m = lateOf(l);
    if (!m) continue;
    if (!mins.has(m)) mins.set(m, []);
    if (!mins.get(m).includes(l.day)) mins.get(m).push(l.day);
  }
  if (!mins.size) return "";
  if (!withDays) return `${[...mins.keys()].map((m) => `${m}분`).join("·")} 늦음`;
  const byDays = new Map(); // '화목' → [11, 17]
  for (const [m, ds] of mins) {
    const k = ds.map((d) => DAY_KO[d]).join("");
    if (!byDays.has(k)) byDays.set(k, []);
    byDays.get(k).push(m);
  }
  return `${[...byDays].map(([k, ms]) => `${k} ${ms.map((m) => `${m}분`).join("·")}`).join("·")} 늦음`;
}

// 조합 수의 단위: 만 → 억 → 조 → 경(수는 Number 라 9천조쯤부터는 어림값이다)
const COUNT_UNITS = [[1e4, "만"], [1e8, "억"], [1e12, "조"], [1e16, "경"]];

/** 전체 조합 수: 1만 아래는 쉼표('1,234개'), 1만부터는 만 단위 소수 한 자리('2.4만 개', '5.3만 개'), 딱 떨어지면 소수 없이('2만 개').
 *  단위 앞 수가 100 이상이면 소수 없이('142만 개', '1,421만 개'. '1,421.3만 개'는 자리가 넘친다). 1억부터는 억, 1조부터는 조('1.2억 개').
 *  반올림한다(10/3 사용자: 만이 넘어가는 순간부터 2.4만, 5.3만처럼. 딱 떨어지면 2만 개). */
function countLabel(n) {
  if (n < 10000) return `${n.toLocaleString("ko-KR")}개`;
  const num = (x) => x.toLocaleString("ko-KR", { maximumFractionDigits: 1 }); // 2.4 → '2.4', 2 → '2', 1421 → '1,421'
  for (let i = 0; i < COUNT_UNITS.length; i++) {
    const [u, name] = COUNT_UNITS[i];
    const one = Math.round(n / (u / 10)) / 10; // 소수 한 자리
    if (one < 100) return `${num(one)}${name} 개`;
    const whole = Math.round(n / u);
    if (whole < 10000 || i === COUNT_UNITS.length - 1) return `${num(whole)}${name} 개`; // 반올림해 1만이 되면 다음 단위로('1억 개')
  }
  return "";
}

/** 앞자리 하나만 남기고 내린 수(100 아래는 그대로): 456 → 400, 345678 → 300000. */
function roughFloor(n) {
  if (n < 100) return n;
  let lead = 1;
  while (lead * 10 <= n) lead *= 10;
  return Math.floor(n / lead) * lead;
}

/** 다 못 센 조합 수(실제는 그보다 많다)의 어림수: 앞자리 하나만 남기고 내린다(뒤에 '가 넘는'이 붙으니 올리면 틀린 말이 된다).
 *  456 → '400개', 3456 → '3천 개', 10000 → '1만 개', 345678 → '30만 개', 1900000 → '100만 개', 23000000 → '2천만 개', 120000000 → '1억 개',
 *  3.4조 → '3조 개'. 어디까지 세었는지는 기기 속도에 따라 달라서(시간 제한) 소수 자리까지 쓰지 않는다. */
function roughCount(n) {
  const v = roughFloor(n);
  if (v < 1000) return `${v}개`;
  if (v < 10000) return `${v / 1000}천 개`;
  let [u, name] = COUNT_UNITS[0];
  for (const [u2, name2] of COUNT_UNITS) if (v >= u2) [u, name] = [u2, name2];
  const k = Math.round(v / u); // 1~9000(경은 그 위로도)
  return `${k < 1000 ? k : k < 10000 ? `${k / 1000}천` : k.toLocaleString("ko-KR")}${name} 개`;
}

/**
 * 목록 제목: 희미한 '(전체 조합 1,234개 중)' + '걷는 시간이 짧은 6개를 찾았어요'. 찾은 수는 목록에 올린 수라 '더 보기'를 누를 때마다 는다('12개').
 * 목록에 올린 것이 전부면(처음부터든 더 보기로든) '전체 조합 4개를 찾았어요' 하나.
 * total 은 워커가 센 겹치지 않는 조합 수(같은 시간·건물 분반은 하나라 찾은 수와 단위가 같다). 1만부터는 '(전체 조합 2.4만 개 중)'.
 * exact=false 면 그보다 많다는 뜻이라 어림수로 '(1만 개가 넘는 조합 중)'. total 이 없으면(예전 워커) 희미한 부분 없이.
 */
function rankTitle(R) {
  const m = R.ranked.length, t = R.total;
  if (!hasMore(R)) return [foundText(R)];
  const found = h("span", { class: "rank-found" }, foundText(R));
  if (!t || (!t.exact && roughFloor(t.count) <= m)) return [found]; // 다 못 센 수의 어림수가 찾은 수보다 크지 않으면 알려 주는 것이 없다
  const n = Math.max(t.count, m);
  const all = t.exact ? `전체 조합 ${countLabel(n)}` : `${roughCount(n)}가 넘는 조합`;
  return [h("span", { class: "rank-total" }, `(${all} 중)`), " ", found];
}

/** 결과 화면의 조건 줄. 결과 화면에서 기숙사 동을 밝히는 곳은 이 줄뿐이다: '출발·도착 기숙사 906동 · 경사 반영'
 *  (번호표·파선 견본·핀 이름은 어느 동이든 '기숙사'). 추가 설정을 걸었으면 끝에 붙인다: '… · 금 공강 · 점심 60분'(목록 제목의 두 수는 그 조건을 지키는 조합만 센 것이다) */
const condText = (R) => dotted([`출발·도착 ${isDorm(R.home) ? `기숙사 ${buildingLabel(R.home)}` : placeLabel(R.home)}`,
  R.mode === "slope" ? "경사 반영" : "평지", ...rulesParts(R.rules)]);

/** 한 주 요약: '걷기 주 187분 · 월화수목 등교'(늦으면 빨간 ' · 화목 3분 늦음'). 덩이 사이(가운뎃점 앞)에서만 줄을 바꾼다. 시간이 모두 미정이면 등교 요일이 없다 */
function weekSum(ev, days) {
  const nw = (t) => h("span", { class: "nw" }, t);
  const walk = Math.round(ev.travel), late = lateText(ev.legs, true);
  const on = days.filter((d) => (ev.days[d] || []).length).map((d) => DAY_KO[d]).join("");
  return { walk, on, late, nodes: [nw(`걷기 주 ${walk}분`), on ? [" ·\u00a0", nw(`${on} 등교`)] : null, late ? h("span", { class: "late" }, " ·\u00a0", nw(late)) : null] };
}

function renderResult() {
  const R = state.result;
  if (!R) return;
  $("rank-count").replaceChildren(...rankTitle(R));
  $("rank-cond").replaceChildren(...condText(R));
  $("daytabs").replaceChildren(...R.days.map((d) => h("button", { type: "button", role: "tab", id: `tab-${d}`, "data-day": String(d), "aria-controls": "day-panel" }, DAY_KO[d])));
  updateTabs();
  renderDay({ reveal: state.reveal });
  state.reveal = false;
  renderRanks();
}

function updateTabs() {
  const ev = currentEv();
  for (const b of $("daytabs").children) {
    const d = Number(b.dataset.day);
    const on = d === state.day;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    b.setAttribute("aria-label", ev.days[d] ? `${DAY_KO[d]}요일` : `${DAY_KO[d]}요일, 수업 없음`);
  }
  $("day-panel").setAttribute("aria-labelledby", `tab-${state.day}`);
}

function selectDay(d) {
  if (d === state.day) return;
  state.day = d;
  updateTabs();
  renderDay({ fade: true });
}

$("daytabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (b) selectDay(Number(b.dataset.day));
});
$("daytabs").addEventListener("keydown", (e) => {
  const tabs = [...$("daytabs").children];
  const i = tabs.findIndex((b) => Number(b.dataset.day) === state.day);
  const j = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  selectDay(Number(tabs[j].dataset.day));
  tabs[j].focus();
});

const drawnSize = new WeakMap(); // 요소 → 그릴 때의 [폭, 높이]
function remember(el) {
  const r = el.getBoundingClientRect();
  drawnSize.set(el, [r.width, r.height]);
}

function renderDay({ reveal = false, fade = false } = {}) {
  const gridPx = sizeTimetable(); // 칸 높이를 먼저 정하고 그 크기를 기억한다(그린 뒤에 길어지면 ResizeObserver 가 다시 그려 첫 결과의 경로 그리기를 끊는다)
  remember($("panes"));
  const ev = currentEv();
  renderTimetable(ev, state.day, gridPx);
  if (!maps.small) maps.small = makeMap($("map"), false);
  if (maps.small) renderMap(maps.small, ev, state.day, { reveal });
  renderSummary(ev, state.day);
  if (fade && !reduceMotion.matches) { // 시간표와 경로는 150ms 교차 페이드
    const p = $("panes");
    p.classList.remove("is-fading");
    void p.offsetWidth;
    p.classList.add("is-fading");
  }
}

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** 시간표 높이(px). 한 시간은 tt-hour-min(32px, 글자 크기 설정만큼 더) 이상이다(10/2 사용자: "75분 수업에서 폰트 줄이는 건 용납을
 *  못하겠다. 통일성이 떨어지는 것 같음"): 75분 칸(40px - 사이 2px)에 과목명 한 줄(14px)과 강의실 줄이 늘 들어가고, 50분 칸(약 25px)에도
 *  과목명이 14px 그대로 한 줄 들어간다. 기본 높이(--tt-h: 폰 19.75rem = 316px, 840px부터 26.25rem = 420px)로 모자라면(저녁 수업으로 축이 긴 결과)
 *  시간표가 그만큼 길어지고, 늘어난 만큼을 .panes 의 --tt-extra 로 주어 옆의 지도 칸도 같이 길어진다(style.css).
 *  기본 높이도 글자 크기를 따라간다(10/3 디자인: --tt-h 는 rem. px 로 두면 글자를 키울 때 번호표·출처만 커져 지도가 줄어든다).
 *  축은 결과 전체(hourRange)라서 요일·후보를 바꿔도 높이가 그대로다. */
function sizeTimetable() {
  const cs = getComputedStyle(document.documentElement);
  const rem = remPx();
  const tth = cs.getPropertyValue("--tt-h").trim(); // '19.75rem'
  const base = Math.round(parseFloat(tth) * (tth.endsWith("rem") ? rem : 1) * 100) / 100 || 316;
  const hourMin = parseFloat(cs.getPropertyValue("--tt-hour-min")) || 32;
  const [h0, h1] = state.result.axis;
  const px = Math.max(base, Math.ceil((h1 - h0) * hourMin * (rem / 16)));
  $("panes").style.setProperty("--tt-extra", `${px - base}px`);
  return px;
}

/** 늦는 까닭: 걷는 시간과 쉬는 시간(강의실 미정 수업 앞뒤 쉬는 시간 포함). */
function lateWhy(l) {
  return `${placeLabel(l.from)}에서 ${buildingLabel(l.to)}까지 걷기 ${Math.round(l.minutes)}분, 쉬는 시간 ${Math.round(l.slack + l.minutes)}분`;
}

/** 칸 하나: 교과구분 연한 색 바탕에 과목명(부제 괄호 뺀 것)과 강의실, 늦으면 빨간 'N분 늦음'. */
function renderTimetable(ev, day, gridPx) {
  const box = $("tt");
  if (!(ev.days[day] || []).length) { box.replaceChildren(h("p", { class: "tt-empty" }, "수업 없음")); return; }
  const [h0, h1] = state.result.axis;
  const span = (h1 - h0) * 60;
  const k = remPx() / 16; // 글자 크기 설정만큼 줄 높이도 커진다
  const top = (m) => `${((m - h0 * 60) / span) * 100}%`;
  const hours = h("div", { class: "tt-hours", "aria-hidden": "true" });
  const grid = h("ol", { class: "tt-grid" });
  const step = h1 - h0 > 10 ? 2 : 1;
  for (let x = h0; x <= h1; x++) {
    grid.append(h("li", { class: "tt-line", "aria-hidden": "true", style: { top: top(x * 60) } }));
    if ((x - h0) % step === 0) hours.append(h("span", { style: { top: top(x * 60) } }, String(x)));
  }
  box.replaceChildren(hours, grid);
  const fullW = grid.clientWidth - 16; // 칸 안 글자 폭(좌우 여백 8)
  const family = getComputedStyle(grid).fontFamily;
  const titleFont = `500 ${14 * k}px ${family}`, labelFont = `500 ${12 * k}px ${family}`, pillFont = `700 ${12 * k}px ${family}`; // t-block, t-label, 늦음 알약
  const widthOf = (text, font = labelFont) => { canvas.font = font; return canvas.measureText(text).width; };
  const legs = ev.legs.filter((l) => l.day === day);
  let n = 0;
  legs.forEach((l, i) => {
    const m = l.meeting;
    if (!m) return;
    n += 1; // 지도 번호와 같은 순서
    const textW = fullW;
    const late = lateOf(l);
    const heightPct = ((m.end - m.start) / span) * 100;
    const px = (heightPct / 100) * gridPx;
    // 강의실은 늘 보이고(10/2 사용자: '동이 왜 안 뜨지? 공간이 없으면 나란히 배치해서라도') 과목명은 어느 칸이나 14px 다(10/2 사용자:
    // 75분 칸만 글자가 작아지면 통일성이 떨어진다. 그래서 한 시간이 32px 이상, sizeTimetable).
    // 쌓는 칸(38px 이상, 75분 이상 수업): 강의실 줄을 늘 두고 과목명은 남는 줄 수만큼(1–3줄, 넘치면 마지막 줄에 말줄임). 과목명 한 줄 +
    // 강의실 줄(34)이 겨우 들어가는 칸(38–40px)은 위아래 여백을 줄여 쓴다.
    // 낮은 칸(38px 미만, 50분 수업): 한 줄에 과목명과 강의실을 나란히(사이 8px, 가운뎃점 없이 크기·색으로 가른다). 넘치면 과목명이 먼저
    // 세 글자 + … 까지 줄고, 그래도 안 들어가면 호수를 빼고 건물만 '43-1동'
    const short = px < 38 * k;
    const raw = shortName(m.section.name), title = glueTail(raw, textW, canvasWidth(titleFont)); // 끝 번호는 앞 낱말에(위 glueTail. 줄 어림도 그 덩이로)
    const need = Math.min(3, textLines(title, titleFont, textW));
    const place = roomLabel(m);
    const rooms = place ? [place] : [];
    if (place && m.building && place !== buildingLabel(m.building)) rooms.push(buildingLabel(m.building));
    const fit = (avail) => {
      const lines = Math.max(1, Math.min(3, Math.floor((avail + 2 - 16 * k) / (18 * k))));
      return { lines, used: Math.min(lines, need) * 18 * k + 16 * k };
    };
    // 늦음 알약은 오른쪽 위. 과목명 첫 줄 옆에 들어가거나(넓은 칸) 가운데 놓인 글이 알약 아래에서 시작하면(높은 칸) 그대로 두고,
    // 둘 다 아니면 과목명 위에 알약 줄을 따로 둔다(과목명이 한 줄 밀린다). 낮은 칸은 한 줄의 오른쪽 끝(글은 알약 앞에서 끝난다)
    let lateRow = 0, pillW = 0;
    if (late) pillW = widthOf(`${late}분 늦음`, pillFont) + 12;
    if (late && !short) {
      const beside = firstLineWidth(title, titleFont, textW) + pillW + 4 <= textW;
      const below = (px - 6 - fit(px - 6).used) / 2 >= 16 * k + 2;
      if (!beside && !below) lateRow = 18 * k;
    }
    // 글 자리(10/2 디자인 '시간표'의 순서). 한 줄에 나란히 둘 때는 캔버스로 잰 폭에 1px 여유를 둔다: 강의실은 줄이지 않으므로(flex: none)
    // 0.1px 만 모자라도 과목명 끝 글자가 … 로 바뀐다
    let room = rooms[0], roomTop = false, pillRow = false, roomOnly = false, lines = 1;
    const gap = 8 * k + 1, tW = widthOf(raw, titleFont); // 한 줄로 둘 때의 폭은 붙이기 전 글로(낮은 칸은 줄을 바꾸지 않는다)
    let head = "", count = 0;
    for (const ch of raw) { head += ch; if (ch.trim() && ++count >= 3) break; }
    const minT = Math.min(tW, widthOf(`${head}…`, titleFont)); // 과목명은 세 글자 + … 까지만 줄인다(그 아래로 자르면 읽히지 않는다)
    const roomBeside = (rowW) => rooms.find((r) => tW + gap + widthOf(r) <= rowW) || rooms.find((r) => minT + gap + widthOf(r) <= rowW) || "";
    if (short) {
      // 낮은 칸: 과목명(14px 그대로) 옆에 강의실, 늦으면 줄 끝에 알약(글은 알약 앞에서 끝난다).
      // 알약 옆에 과목명 세 글자와 강의실이 안 들어가면 과목명만, 과목명 세 글자도 안 들어가면 과목명 대신 강의실
      const rowW = textW - (late ? pillW + 6 : 0);
      room = roomBeside(rowW);
      if (!room && minT > rowW) { room = rooms.find((r) => widthOf(r) + 1 <= rowW) || ""; roomOnly = !!room; }
    } else if (lateRow && px - 4 - lateRow < 34 * k) {
      // 알약 줄 밑에 과목명과 강의실 줄이 다 안 들어가는 75분 칸: 강의실을 알약 줄 왼쪽에(비어 있던 자리), 과목명은 그 아래
      room = rooms.find((r) => widthOf(r) + 1 <= textW - pillW - 6) || "";
      if (room) {
        roomTop = true;
        lines = Math.max(1, Math.min(3, Math.floor((px - 6 - lateRow) / (18 * k))));
      } else {
        // 좁은 칸(폰 360)은 알약 옆에 건물 이름도 안 들어간다: 알약 줄은 알약만, 그 아래 줄에 과목명과 강의실을 나란히(낮은 칸처럼)
        pillRow = true;
        room = roomBeside(textW);
      }
    } else ({ lines } = fit(px - 6 - lateRow));
    const kind = state.byId.get(m.section.courseId)?.cls || "", fill = clsFill(kind);
    const nx = legs[i + 1];
    let next = "";
    if (m.building && nx) {
      if (nx.meeting && nx.meeting.building) next = `다음 수업까지 걷기 ${Math.round(nx.minutes)}분`;
      else if (!nx.meeting) next = `${placeLabel(state.result.home)}까지 걷기 ${Math.round(nx.minutes)}분`;
    }
    const said = [`${n}. ${hm(m.start)}~${hm(m.end)} ${m.section.name}`, place, late ? `${late}분 늦음(${lateWhy(l)})` : "", next].filter(Boolean).join(", ");
    grid.append(h("li", {
      class: `tt-block${short ? " short" : ""}${roomTop ? " room-top" : pillRow ? " is-late pill-row" : lateRow ? " is-late" : ""}`,
      style: { top: top(m.start), height: `calc(${heightPct}% - 2px)`, background: fill, ...clsInk(kind), "--lines": String(lines),
        ...(late && (short || roomTop) ? { "--late-w": `${Math.ceil(pillW + 6)}px` } : {}) }, // 알약과 같은 줄의 글은 알약 앞에서 끝난다
      title: `${m.section.name} ${hm(m.start)}~${hm(m.end)}${place ? ` ${place}` : ""}`,
    },
    h("span", { class: "sr-only" }, said),
    late ? h("span", { class: "tt-late", "aria-hidden": "true", title: lateWhy(l) }, `${late}분 늦음`) : null,
    ...(pillRow ? [h("span", { class: "b-line", "aria-hidden": "true" }, h("span", { class: "b-title" }, title), room ? h("span", { class: "b-room" }, room) : null)]
      : [roomOnly ? null : h("span", { class: "b-title", "aria-hidden": "true" }, title), room ? h("span", { class: "b-room", "aria-hidden": "true" }, room) : null])));
  });
}

// ---- 과목명 끝 번호 붙이기(디자인 84판 '주간 시간표', 10/30 디자인: "과목명 끝의 짧은 번호(숫자 한두 자리, II 같은 로마 숫자, 영문 한 글자)는 앞 낱말에 붙여 줄을 같이 바꿔
// 줘. 둘이 한 줄에 안 들어갈 때(앞 낱말이 한 줄을 다 쓸 때)만 지금처럼 번호 혼자 다음 줄이고, 번호를 붙이려고 낱말 안에서 끊지는 않아"): `대학 글쓰기` / `1` 이 될 폭이면
// `대학` / `글쓰기 1`. 앞 낱말과 번호가 한 줄 폭에 들어갈 때만 사이 띄어쓰기를 줄을 바꾸지 않는 띄어쓰기(U+00A0)로 바꾼다. 안 들어가면 그대로 둔다: 붙여 두면 둘이 다음 줄로
// 넘어간 뒤 거기서도 넘쳐 낱말 안에서 끊기거나 번호가 한 줄 더 밀린다. (띄어쓰기 뒤에 WORD JOINER 를 넣는 방법은 크롬이 keep-all 에서 띄어쓰기 뒤를 늘 끊어 듣지 않았다.)
// 내 시간표·공유받은 시간표 격자(넣을 분반 미리 보기 포함), 결과 화면 시간표 칸, 시간표 이미지가 쓴다(일정 이름도 같은 칸이라 같이)
const NBSP = "\u00a0";
const TAIL_NO = /^(.*\S) (\d{1,2}|[IVX]{1,4}|[\u2160-\u216B]|[A-Za-z])$/;
/** 끝 번호를 앞 낱말에 붙인 글(붙일 것이 없거나 둘이 width 에 안 들어가면 그대로). widthOf(글) → px */
function glueTail(text, width, widthOf) {
  const s = String(text ?? ""), m = TAIL_NO.exec(s);
  if (!m || !(width > 0)) return s;
  return widthOf(`${m[1].split(/\s+/).pop()} ${m[2]}`) <= width - 1 ? `${m[1]}${NBSP}${m[2]}` : s; // 캔버스와 화면의 글자 폭 차이에 1px 여유
}
/** 줄을 바꿀 수 있는 낱말들(띄어쓰기에서 나눈다. glueTail 이 붙인 끝 번호(U+00A0)는 앞 낱말과 한 덩이) */
const lineWords = (text) => String(text).split(/[^\S\u00a0]+/).filter(Boolean);
const canvasWidth = (font) => (s) => { canvas.font = font; return canvas.measureText(s).width; };

/** 첫 줄의 폭 어림(textLines 와 같은 방식으로 줄을 바꾼다). */
function firstLineWidth(text, font, width) {
  canvas.font = font;
  const space = canvas.measureText(" ").width;
  let cur = 0;
  for (const word of lineWords(text)) {
    const w = canvas.measureText(word).width;
    if (!cur) { if (w >= width) return width; cur = w; continue; }
    if (cur + space + w > width) break;
    cur += space + w;
  }
  return cur;
}

/** 글자가 폭 안에서 몇 줄이 되는지 어림한다(띄어쓰기에서 줄을 바꾸고, 폭보다 긴 낱말은 쪼갠다). */
function textLines(text, font, width) {
  if (!(width > 0)) return 1;
  canvas.font = font;
  const space = canvas.measureText(" ").width;
  let lines = 1, cur = 0;
  for (const word of lineWords(text)) {
    const w = canvas.measureText(word).width;
    if (cur && cur + space + w <= width) { cur += space + w; continue; }
    if (cur) lines += 1;
    lines += Math.floor(w / width);
    cur = w % width;
  }
  return lines;
}

function renderSummary(ev, day) {
  const box = $("day-summary");
  if (!ev.days[day]) { box.replaceChildren(); return; }
  const legs = ev.legs.filter((l) => l.day === day);
  const walk = Math.round(legs.reduce((s, l) => s + l.minutes, 0));
  const late = lateText(legs, false); // '2분 늦음', 그날 둘이면 '2분·5분 늦음'(더한 값은 쓰지 않는다)
  const tag = (text) => h("span", { class: "tag danger" }, h("span", { class: "sr-only" }, ", "), text);
  box.replaceChildren(...[h("span", {}, "걷기 ", h("b", {}, `${walk}분`)), late ? tag(late) : null].filter(Boolean));
}

// ---------------------------------------------------------------- 지도

const maps = { small: null, full: null };
let campusBounds = null;

function coordOf(b) {
  const v = state.campus.buildings[b];
  return v && v[1] !== null && v[1] !== undefined ? [v[1], v[2]] : null;
}

// ---------------------------------------------------------------- 바탕 지도
// 10/1 사용자 결정: OSM 타일 대신 우리 자료(data/basemap.json: 수치지형도 1:5,000 건물·도로·물·등고선 + OSM 숲·길)로 직접 그린다
// (자료 형식은 레포 docs/basemap.md, 그리는 법은 이 절이 기준). 타일 서버를 안 써서 오프라인에서도 바탕이 있고, 다크 모드는 필터가 아니라
// 지도 색(--map-*)으로 그린다. 면·선은 처음 한 번 메르카토르 좌표(0~1)로 풀어 두고, 캔버스 하나에 화면에 걸리는 것만 그린다

let basemap = null, basemapWait = null, dataBounds = null;

/** Google polyline(소수 prec 자리) → [u, v, u, v, …] 메르카토르 좌표(0~1, Leaflet 화소 좌표 = 값 × 256 × 2^배율). */
function decodeWorld(s, prec) {
  const f = 10 ** prec, out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (let k = 0; k < 2; k++) {
      let sh = 0, r = 0, b;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    const phi = ((lat / f) * Math.PI) / 180;
    out.push((lon / f + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2);
  }
  return Float64Array.from(out);
}

function boxOf(arrays) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < x0) x0 = a[i];
      if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1];
      if (a[i + 1] > y1) y1 = a[i + 1];
    }
  }
  return [x0, y0, x1, y1];
}

/** 자료 v1: 면 = [소수 자리, 바깥 고리, 구멍…], 선 = [OSM highway, polyline], 등고선 = [높이 m, polyline]. */
function prepareBasemap(B) {
  const areas = {}, lines = {}, contours = {};
  for (const [k, list] of Object.entries(B.area || {})) {
    areas[k] = list.map(([prec, ...rings]) => { const rs = rings.map((r) => decodeWorld(r, prec)); return { rings: rs, bb: boxOf(rs) }; });
  }
  for (const [k, list] of Object.entries(B.line || {})) lines[k] = list.map(([kind, s]) => { const p = decodeWorld(s, 5); return { kind, pts: p, bb: boxOf([p]) }; });
  // 보행로는 캠퍼스 안 길(footway 등)과 산길(path·track, 거의 다 캠퍼스 밖)로 나눠 보이는 배율을 다르게 한다
  const trail = (f) => f.kind === "path" || f.kind === "track";
  lines.trail = (lines.walk || []).filter(trail);
  lines.foot = (lines.walk || []).filter((f) => !trail(f));
  for (const [k, list] of Object.entries(B.contour || {})) contours[k] = list.map(([z, s]) => { const p = decodeWorld(s, 5); return { z, pts: p, bb: boxOf([p]) }; });
  const [south, west, north, east] = B.bounds;
  return { areas, lines, contours, bounds: L.latLngBounds([south, west], [north, east]) };
}

/** 처음 지도를 만들 때 한 번 받는다(웹은 서비스 워커가 저장, 앱은 앱에 넣은 것). 실패하면 다음에 다시. */
function loadBasemap() {
  if (!basemapWait) {
    basemapWait = getJson("data/basemap.json").then((B) => {
      basemap = prepareBasemap(B);
      dataBounds = basemap.bounds;
      for (const mp of [maps.small, maps.full]) {
        if (!mp) continue;
        mp.map.setMaxBounds(dataBounds);
        applyMinZoom(mp.map);
        mp.base.redraw();
      }
    }).catch(() => { basemapWait = null; });
  }
  return basemapWait;
}

/** 빈 땅이 보이지 않게(사용자 결정): 캠퍼스가 다 들어오는 배율과, 화면이 자료 범위 안에 드는 배율 중 큰 쪽보다 덜 축소하지 않는다.
 *  캠퍼스는 가장자리 MIN_ZOOM_EDGE 를 비우고 들어와야 한다(핀 자리): 폰의 좁고 긴 지도에서 캠퍼스 끝에서 끝까지 걷는 날도 핀이 잘리지 않게 맞출 수 있다. */
const MIN_ZOOM_EDGE = 20;
function mapMinZoom(map) {
  const fit = map.getBoundsZoom(campusBounds, false, L.point(2 * MIN_ZOOM_EDGE, 2 * MIN_ZOOM_EDGE));
  return dataBounds ? Math.max(fit, map.getBoundsZoom(dataBounds, true)) : Math.max(12, fit);
}
/** 최소 배율을 바꾼다. setMinZoom 은 지금 배율이 더 낮으면 애니메이션으로 확대하는데, 그사이 setView 로 옮겨도
 *  애니메이션이 끝나는 순간 그 자리로 되돌아간다(전체 화면 지도가 경로 대신 최소 배율로 열렸다). 그래서 애니메이션 없이 */
function applyMinZoom(map) {
  // getBoundsZoom 은 지금 최소 배율보다 낮게 답하지 않는다. 지도 칸이 낮아진 날(번호표가 길거나 시간표가 짧은 날)에 앞 요일의 값에 묶이지 않게 먼저 푼다
  map.options.minZoom = 0;
  const mz = mapMinZoom(map);
  map.options.minZoom = mz;
  if (map.getZoom() < mz) map.setZoom(mz, { animate: false });
  map.fire("zoomlevelschange");
}

// 지도 색은 디자인 토큰 map-*(style.css)에서 읽는다. 기기 테마가 바뀌면 다시 읽고 다시 그린다.
// 10/2 토큰을 정하며 찻길·보행자 길 양옆 테두리(예전 road-case·ped-case)는 road-line·ped-line 으로 합쳤다
const MAP_COLORS = ["land", "green", "park", "grass", "pitch", "campus", "campus-line", "contour", "contour-index", "contour-label", "water", "walk-area",
  "road", "road-line", "road-secondary", "road-secondary-line", "road-primary", "road-primary-line", "road-trunk", "road-trunk-line",
  "ped", "ped-line", "foot", "steps", "building", "building-line", "halo"];
let mapColorCache = null;
function mapColors() {
  if (!mapColorCache) {
    const cs = getComputedStyle(document.documentElement);
    mapColorCache = Object.fromEntries(MAP_COLORS.map((k) => [k, cs.getPropertyValue(`--map-${k}`).trim()]));
    mapColorCache.font = getComputedStyle(document.body).fontFamily;
  }
  return mapColorCache;
}
// 기기의 라이트·다크가 바뀌면 지도 색도 바뀐다: 아래 '라이트·다크'의 applyTheme 이 data-scheme 과 함께 지도를 다시 그린다(기본(기기 설정)일 때만)

// 선 폭은 미터로 정하고 배율마다 화소로 바꾼다(최소 화소 아래로는 가늘어지지 않는다). 캠퍼스 안 찻길 폭(m)은 OSM highway 값으로
const ROAD_M = { service: 4.5, residential: 6, living_street: 5, unclassified: 6, tertiary: 7, tertiary_link: 6 };

/** 바탕을 그린다. b = 캔버스가 덮는 범위(layer 좌표), m = 화소 배수. 순서: 땅 → 등고선 → 물 → 도로면 → 길(선) → 건물 → 등고선 높이.
 *  보행로·계단은 처음 시안의 주황 점선 대신 옅은 회색 점·사다리로, 확대했을 때만(10/1 사용자: 주황 점선이 너무 많아 시선을 빼앗는다).
 *  산길은 15부터, 캠퍼스 안 보행로는 15.5부터, 계단은 16.25부터. 경로선(파랑)이 지도에서 가장 눈에 띄게 */
function drawBasemap(ctx, map, b, m) {
  const size = b.getSize(), C = mapColors();
  ctx.setTransform(m, 0, 0, m, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = C.land;
  ctx.fillRect(0, 0, size.x, size.y);
  if (!basemap) return;
  const z = map.getZoom(), S = 256 * 2 ** z, o = map.getPixelOrigin();
  const ox = o.x + b.min.x, oy = o.y + b.min.y;
  const k = (156543.034 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** z; // 화소 하나가 몇 m
  const pad = 12 / S;
  const x0 = ox / S - pad, y0 = oy / S - pad, x1 = (ox + size.x) / S + pad, y1 = (oy + size.y) / S + pad;
  const seen = (f) => f.bb[2] >= x0 && f.bb[0] <= x1 && f.bb[3] >= y0 && f.bb[1] <= y1;
  const trace = (p, close) => {
    ctx.moveTo(p[0] * S - ox, p[1] * S - oy);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * S - ox, p[i + 1] * S - oy);
    if (close) ctx.closePath();
  };
  const fill = (list, color, line, width) => {
    if (!list) return;
    ctx.fillStyle = color;
    if (line) { ctx.strokeStyle = line; ctx.lineWidth = width; ctx.lineJoin = "round"; }
    for (const f of list) {
      if (!seen(f)) continue;
      ctx.beginPath();
      for (const r of f.rings) trace(r, true);
      ctx.fill("evenodd");
      if (line) ctx.stroke();
    }
  };
  // 폭이 같은 선끼리 한 번에 긋는다(점선은 선마다 처음부터)
  const stroke = (list, color, width, { dash = null, cap = "round", alpha = 1 } = {}) => {
    if (!list || !(alpha > 0)) return;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineCap = cap;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash || []);
    let cur = -1;
    for (const f of list) {
      if (!seen(f)) continue;
      const w = typeof width === "function" ? width(f) : width;
      if (w !== cur) {
        if (cur >= 0) ctx.stroke();
        ctx.beginPath();
        ctx.lineWidth = cur = w;
      }
      trace(f.pts, false);
    }
    if (cur >= 0) ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };
  const px = (meters, min, extra = 0) => Math.max(min, meters / k) + extra;
  const { areas: A, lines: Ln, contours: Z } = basemap;
  fill(A.green, C.green);
  fill(A.park, C.park);
  fill(A.grass, C.grass);
  fill(A.campus, C.campus, C["campus-line"], 1.2);
  fill(A.pitch, C.pitch);
  if (z >= 15.75) stroke(Z.minor, C.contour, 0.7);
  stroke(Z.index, C["contour-index"], 1.1);
  fill(A.water, C.water);
  fill(A.walk, C["walk-area"]);
  fill(A.road, C.road, C["road-line"], 0.9);
  for (const t of ["secondary", "primary", "trunk"]) fill(A[`road_${t}`], C[`road-${t}`], C[`road-${t}-line`], 0.9);
  const roadW = (f) => ROAD_M[f.kind] || 5;
  stroke(Ln.road, C["road-line"], (f) => px(roadW(f), 2.6, 2));
  stroke(Ln.pedestrian, C["ped-line"], px(5, 2.6, 2));
  stroke(Ln.road, C.road, (f) => px(roadW(f), 1.6));
  stroke(Ln.pedestrian, C.ped, px(5, 1.6));
  const dots = [0.1, Math.max(3.5, 1.9 / k)]; // 둥근 끝 + 아주 짧은 선 = 점
  if (z >= 15) stroke(Ln.trail, C.foot, px(0.8, 1.4), { dash: dots });
  if (z >= 15.5) stroke(Ln.foot, C.foot, px(0.8, 1.6), { dash: dots });
  if (z >= 16.25) stroke(Ln.steps, C.steps, px(2.2, 3), { dash: [Math.max(1.2, 0.35 / k), Math.max(1.2, 0.35 / k)], cap: "butt" });
  fill(A.building, C.building, C["building-line"], 0.8);
  // 많이 확대하면 계곡선(25 m) 가운데에 높이: t-label(12px 500), map-halo 2px 테두리(10/2 디자인: 지도 안 글자도 12px 이상)
  if (z >= 17 && Z.index) {
    ctx.font = `500 12px ${C.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.halo;
    ctx.fillStyle = C["contour-label"];
    for (const f of Z.index) {
      if (!seen(f)) continue;
      const i = Math.floor(f.pts.length / 4) * 2;
      const x = f.pts[i] * S - ox, y = f.pts[i + 1] * S - oy;
      if (x < 0 || y < 0 || x > size.x || y > size.y) continue;
      ctx.strokeText(String(f.z), x, y);
      ctx.fillText(String(f.z), x, y);
    }
  }
}

/** 바탕 지도 층: Leaflet 의 캔버스 그리기 틀(L.Renderer: 화면보다 조금 넓은 캔버스, 확대·축소 애니메이션 동안 늘였다 줄임)에 그림만 우리 것. */
const BaseMap = typeof L === "undefined" ? null : L.Renderer.extend({
  options: { padding: 0.1, pane: "ttw-base" },
  _initContainer() {
    const c = (this._container = document.createElement("canvas"));
    c.setAttribute("aria-hidden", "true");
    this._ctx = c.getContext("2d");
  },
  _destroyContainer() {
    L.DomUtil.remove(this._container);
    this._ctx = null;
  },
  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    L.Renderer.prototype._update.call(this);
    const b = this._bounds, c = this._container, size = b.getSize();
    this._m = Math.min(2, window.devicePixelRatio || 1); // 3배 화면도 2배로(캔버스 메모리)
    L.DomUtil.setPosition(c, b.min);
    c.width = Math.round(this._m * size.x);
    c.height = Math.round(this._m * size.y);
    c.style.width = `${size.x}px`;
    c.style.height = `${size.y}px`;
    this.redraw();
  },
  redraw() {
    if (this._ctx && this._bounds && this._map) drawBasemap(this._ctx, this._map, this._bounds, this._m || 1);
  },
  // 끌거나 미끄러지는 동안에도 그려 둔 범위(화면 + 여유 10%)를 벗어나면 다시 그린다. Leaflet 그리기 틀은 다 멈춘 뒤에만 다시 그려서
  // 세게 밀면 멈출 때까지 바탕이 비었다(타일은 옮기는 동안에도 받는다)
  getEvents() {
    return { ...L.Renderer.prototype.getEvents.call(this), move: this._onMove };
  },
  _onMove() {
    if (this._frame || !this._bounds || this._map._animatingZoom) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      const map = this._map;
      if (!map || map._animatingZoom) return;
      const a = map.containerPointToLayerPoint([0, 0]), b = map.containerPointToLayerPoint(map.getSize());
      if (!this._bounds.contains(a) || !this._bounds.contains(b)) this._update();
    });
  },
  onRemove() {
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    L.Renderer.prototype.onRemove.call(this);
  },
});

/** 건물 번호 목록(번호만인 건물 먼저, 짧은 번호 먼저): 수업이 없는 날 모든 건물 번호를 겹치지 않게 놓을 때 이 순서로.
 *  기숙사(10/3 디자인·자료): 919동은 네 동을 따로 쓴다(919A·919B·919C·919D, 이동시간 지점). 이동시간 지점이 아닌 기숙사 동(919 한 점)은
 *  번호로 쓰지 않는다. 붙어 있는 동이라 낮은 배율에서는 겹치는 번호가 숨고 확대하면 다 보인다.
 *  기숙사 동의 이름은 자료의 건물 이름('(관악사)학부 생활관') 대신 종류로 쓴다(학부생활관). */
let buildingMarks = null;
function allBuildingMarks() {
  if (!buildingMarks) {
    const ids = new Set(state.campus.ids);
    buildingMarks = Object.entries(state.campus.buildings || {})
      .filter(([id, v]) => v && v[1] !== null && v[1] !== undefined && !(isDorm(id) && !ids.has(id)))
      .map(([id, v]) => ({ id, text: id === "GATE" ? "정문" : id, name: buildingName(id), at: L.latLng(v[1], v[2]), pri: /^\d+$/.test(id) ? 0 : 1 }))
      .sort((a, b) => a.pri - b.pri || a.id.length - b.id.length);
  }
  return buildingMarks;
}

/** 지도 둘 다 확대·축소된다. 마우스: 확대·축소 버튼, 휠, 끌기. 터치: 두 손가락으로 확대·이동, 두 번 눌러 확대.
 *  시간표 옆 작은 지도는 터치에서 한 손가락 끌기를 끈다(페이지 스크롤이 지도에 걸리지 않게). 전체 화면 지도는 한 손가락으로 끈다. */
function makeMap(el, full) {
  if (typeof L === "undefined" || !state.campus) return null;
  if (!campusBounds) campusBounds = L.latLngBounds(state.campus.ids.map(coordOf).filter(Boolean)).pad(0.1);
  const still = reduceMotion.matches;
  const mouse = finePointer.matches;
  const map = L.map(el, {
    zoomControl: false, attributionControl: false, // 저작권 표기는 지도 밖 .map-attr(늘 보이고, 스크린리더가 읽는다)
    dragging: full || mouse, touchZoom: true, doubleClickZoom: true, scrollWheelZoom: full || mouse, boxZoom: mouse,
    keyboard: true, inertia: !still, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still,
    // 끌 수 있는 범위는 바탕 지도 자료 범위(loadBasemap 이 받으면 건다). 받기 전에 캠퍼스 범위로 묶으면 첫 요일을 맞출 때 가운데가 캠퍼스에 묶여 핀이 잘린다
    zoomSnap: 0.25, zoomDelta: 0.5, maxZoom: 19.5, maxBounds: dataBounds || undefined, maxBoundsViscosity: 1.0,
  });
  const buttons = full || mouse;
  if (buttons) L.control.zoom({ position: "topright", zoomInTitle: "확대", zoomOutTitle: "축소" }).addTo(map);
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "지도");
  // 바탕 지도(타일 자리 200), 수업 뒤 출발·도착 자리로 가는 길은 경로선(overlayPane, 400) 아래 칸: 겹치는 길에서 경로를 덮지 않게.
  // 선 끝과 핀을 잇는 점선의 테두리는 그보다도 아래 칸(어느 선도 덮지 않게)
  const basePane = map.createPane("ttw-base");
  basePane.style.zIndex = "200";
  basePane.style.pointerEvents = "none";
  map.createPane("ttw-stub").style.zIndex = "385";
  map.createPane("ttw-back").style.zIndex = "390";
  const base = new BaseMap().addTo(map);
  map.setView(campusBounds.getCenter(), 15, { animate: false });
  const legend = el.closest(".mapcard").querySelector(".legend");
  const mp = { map, el, base, full, buttons, legend, back: L.layerGroup().addTo(map), lines: L.layerGroup().addTo(map), stubs: L.layerGroup().addTo(map),
    marks: L.layerGroup().addTo(map), legLabels: L.layerGroup().addTo(map), names: L.layerGroup().addTo(map), data: null };
  // 배율이 바뀌면 붙어 보이는 번호를 다시 묶고, 옆으로 비킨 선을 그 배율의 화소 간격으로 다시 그린다(선 끝과 핀을 잇는 점선도 그 자리로).
  // 구간 라벨과 건물 번호는 옮길 때마다(화면 가장자리·버튼에 걸리지 않게). 배율이 바뀌면 zoomend 다음에 moveend 가 온다
  map.on("zoomend", () => { if (mp.data) { placeMarks(mp); drawReturn(mp); drawStubs(mp); } });
  map.on("moveend", () => { if (mp.data) { placeLegLabels(mp); placeLabels(mp); } });
  loadBasemap();
  return mp;
}

// 수업 뒤 출발·도착 자리로 가는 길: ⌂ 핀과 같은 색(home) 파선 + 흰 테두리, 경로선 옆으로 7px 비켜서(같은 길을 되짚어도 경로선이 가려지지 않게)
const RETURN_OFFSET = 7, RETURN_DASH = "8 6";
const RETURN_KEY = '<svg class="line-key" width="20" height="8" viewBox="0 0 20 8" aria-hidden="true"><path d="M1 4H19" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="4 3"/></svg>';

/** 선을 진행 방향 오른쪽으로 px 만큼 평행하게 옮긴 점들(지금 배율의 layer 좌표). 모서리는 두 변 법선의 이등분선, 뾰족하면 2px 배까지만. */
function offsetPoints(map, line, px) {
  const pts = [];
  for (const ll of line) {
    const p = map.latLngToLayerPoint(ll);
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.5) pts.push(p);
  }
  if (pts.length < 2) return pts;
  const normal = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); return [-dy / d, dx / d]; };
  return pts.map((p, i) => {
    const n1 = i > 0 ? normal(pts[i - 1], p) : null;
    const n2 = i < pts.length - 1 ? normal(p, pts[i + 1]) : null;
    let ox, oy;
    if (n1 && n2) {
      const sx = n1[0] + n2[0], sy = n1[1] + n2[1], s = Math.hypot(sx, sy);
      if (s < 1) { ox = n2[0] * px; oy = n2[1] * px; } // 거의 되돌아가는 꺾임: 이음매 없이 다음 변 쪽으로
      else { const m = (2 * px) / s; ox = (sx / s) * m; oy = (sy / s) * m; }
    } else { const n = n1 || n2; ox = n[0] * px; oy = n[1] * px; }
    return L.point(p.x + ox, p.y + oy);
  });
}

function offsetLine(map, line, px) {
  const pts = offsetPoints(map, line, px);
  return pts.length < 2 ? line : pts.map((p) => map.layerPointToLatLng(p));
}

function drawReturn(mp) {
  mp.back.clearLayers();
  for (const lg of mp.data.legs) {
    if (!lg.home) continue;
    const off = offsetLine(mp.map, lg.line, RETURN_OFFSET);
    L.polyline(off, { pane: "ttw-back", className: "map-route-home-case", weight: 7, dashArray: RETURN_DASH, lineCap: "butt", lineJoin: "round", interactive: false }).addTo(mp.back);
    L.polyline(off, { pane: "ttw-back", className: "map-route-home", weight: 3, dashArray: RETURN_DASH, lineCap: "butt", lineJoin: "round", interactive: false }).addTo(mp.back);
  }
}

// 선 끝과 핀을 잇는 점선(10/3 사용자: 경로와 번호가 떨어져 있어 이상하다). 경로 자료는 건물 문 앞에서 끝나고 핀은 건물 자리(번호를 쓰는 자리)에
// 서서, 둘 사이가 보통 20~50m(가장 먼 301동은 100m) 벌어진다. 그 사이를 구간 선과 같은 색 점선으로 잇는다(지도 앱의 '길 끝에서 목적지까지').
// 실선을 핀까지 늘이지 않는 것은 건물을 가로지르는 길처럼 읽혀서고(일곱에 하나는 핀이 선 건물 면 밖을 많이 지난다), 핀을 문 앞으로 옮기지 않는 것은
// 들어간 문과 나오는 문이 다른 건물(16동은 문 사이 155m)에서 다음 구간이 다시 핀과 떨어지고 번호가 건물 밖 길 위에 서서다
// 점은 그 선의 굵기 그대로(수업 가는 길 4px, 출발·도착 자리로 가는 길 3px), 점 사이 3px. 테두리는 card 1px: 건물 위에서 route 점이
// 2.5:1(라이트)이라 3:1 에 못 미치는데, 선처럼 2px 를 두르면 흰 띠가 이어져 구슬 꿴 줄처럼 무거워진다. 테두리는 맨 아래 칸에 그려 어느 선도 덮지 않는다
// 한 핀에 닿는 점선은 선 끝이 서로 10px 안이면 하나만 긋는다(수업 가는 길 먼저. 10/3 디자인): 같은 문으로 들어가고 나오는 건물에서는 실선의 끝과
// 7px 비킨 파선의 시작이 나란해서, 둘 다 그으면 두 색 점이 겹친 채 핀까지 간다. 문이 다르면 둘 다 긋는다
const STUB = { route: { weight: 4, dashArray: "0.1 7" }, home: { weight: 3, dashArray: "0.1 6" } }, STUB_CASE = 1, STUB_NEAR = 10;

/** 건물 b 의 핀이 지금 서 있는 자리: 다른 수업 핀과 묶였으면 그 묶음 자리(placeMarks), 출발·도착 건물이면 ⌂. 핀이 없으면 null */
function pinSpot(mp, b) {
  const pin = (mp.pins || []).find((q) => q.bs.includes(b));
  return pin ? pin.at : b === mp.data.home ? mp.data.homeAt : null;
}

/** 구간 lg 의 그려진 선 양 끝에서 핀까지: [[선 끝, 핀 자리], …]. 출발·도착 자리로 가는 길은 옆으로 비킨 선의 끝에서. 2px 안쪽이면 없다 */
function legStubs(mp, lg) {
  const { map } = mp;
  const line = lg.home ? offsetLine(map, lg.line, RETURN_OFFSET) : lg.line, out = [];
  for (const [end, b] of [[line[0], lg.ends[0]], [line[line.length - 1], lg.ends[1]]]) {
    const pin = pinSpot(mp, b);
    if (!pin) continue;
    const p = map.latLngToLayerPoint(end), q = map.latLngToLayerPoint(pin);
    if (Math.hypot(p.x - q.x, p.y - q.y) >= 2) out.push([end, pin]); // 선 끝에서 시작해야 점 간격이 선 끝에 맞는다
  }
  return out;
}

/** 그릴 점선을 구간 순서대로: [구간 0 의 [[선 끝, 핀 자리], …], 구간 1 의 …]. 같은 핀에 닿고 선 끝이 STUB_NEAR 안인 것은 하나만 남긴다
 *  (수업 가는 길이 먼저, 그다음은 앞 구간) */
function dayStubs(mp) {
  const { map } = mp, legs = mp.data.legs, out = legs.map(() => []), kept = [];
  const order = legs.map((_, i) => i).sort((a, b) => Number(legs[a].home) - Number(legs[b].home)); // 안정 정렬: 같은 갈래는 구간 순서 그대로
  for (const i of order) {
    for (const s of legStubs(mp, legs[i])) {
      const p = map.latLngToLayerPoint(s[0]), pin = s[1];
      if (kept.some((k) => (k.pin === pin || (k.pin[0] === pin[0] && k.pin[1] === pin[1])) && Math.hypot(k.p.x - p.x, k.p.y - p.y) <= STUB_NEAR)) continue;
      kept.push({ pin, p });
      out[i].push(s);
    }
  }
  return out;
}

function drawStubs(mp) {
  mp.stubs.clearLayers();
  dayStubs(mp).forEach((stubs, i) => {
    const home = mp.data.legs[i].home, dots = home ? STUB.home : STUB.route;
    for (const seg of stubs) {
      const opt = { ...dots, lineCap: "round", interactive: false, ofHome: home };
      L.polyline(seg, { ...opt, weight: dots.weight + 2 * STUB_CASE, pane: "ttw-stub", className: "map-stub-case" }).addTo(mp.stubs);
      L.polyline(seg, { ...opt, pane: home ? "ttw-back" : "overlayPane", className: home ? "map-stub-home" : "map-stub" }).addTo(mp.stubs);
    }
  });
}

/** 지도 아래 번호표: 수업 순서 번호와 건물, 출발·도착, 점선(마지막 수업 뒤 출발·도착 자리로 가는 길)이 있으면 그 견본.
 *  '기숙사 가는 길'. '돌아가는 길'은 '빙 돌아가는 길(우회로)'로도 읽혀서, '수업 뒤 기숙사로'는 말이 어색해서 쓰지 않는다 */
function renderLegend(mp, legs, hasReturn) {
  const items = [];
  let n = 0;
  for (const l of legs) {
    if (!l.meeting) continue;
    n += 1;
    const where = l.meeting.building ? buildingLabel(l.meeting.building) : "미정"; // 장소 없음은 한 낱말(디자인 67판: 두 열에서 '강의실 미정'이 잘렸다)
    items.push(h("li", {}, h("span", { class: "num" }, String(n)), h("span", {}, where)));
  }
  if (items.length) items.push(h("li", {}, h("span", { class: "num home", "aria-hidden": "true" }, svg(HOME_PIN.replace('width="12" height="12"', 'width="10" height="10"'))), h("span", {}, placeLabel(state.result.home))));
  if (items.length && hasReturn) items.push(h("li", { class: "line" }, svg(RETURN_KEY), h("span", {}, `${placeLabel(state.result.home)} 가는 길`)));
  mp.legend.replaceChildren(...items);
}

function renderMap(mp, ev, day, { reveal = false } = {}) {
  const { map } = mp;
  const R = state.result;
  mp.data = null; // 아래에서 배율을 맞추는 동안(zoomend·moveend) 앞 요일의 핀·라벨을 다시 놓지 않게
  const legs = ev.days[day] ? ev.legs.filter((l) => l.day === day) : [];
  // 선: 수업 가는 길(번호가 붙은 수업으로)은 실선, 마지막 수업 뒤 출발·도착 자리로 가는 길은 점선
  const homeLines = [], classLines = [], legLines = [];
  let num = 0; // 도착하는 수업의 번호(핀 번호와 같다)
  for (const l of legs) {
    if (l.meeting) num += 1;
    if (l.from === l.to) continue;
    let line = routeLine(state.routes, l.from, l.to);
    if (!line) {
      const a = coordOf(l.from), b = coordOf(l.to);
      if (!a || !b) continue;
      line = [a, b];
    }
    (l.meeting ? classLines : homeLines).push(line);
    const mins = Math.round(l.minutes);
    // 걷는 시간 라벨(출발·도착 자리로 가는 구간은 ⌂ 를 붙인다). 라벨 자리는 placeLegLabels 가 배율마다 고른다
    legLines.push({ line, home: !l.meeting, text: mins > 0 ? `${mins}분` : "", num: l.meeting ? num : 0, ends: [l.from, l.to] });
  }
  // 같은 길을 오가는 두 구간(301동 → 83동 → 301동)은 두 라벨이 한 길에 나란히 서서 어느 쪽이 어느 쪽인지 모른다. 이 라벨들에만 앞에
  // 도착하는 수업 번호를 붙인다(10/2 디자인: '2 26분', '3 32분'. ⌂ 19분의 ⌂ 처럼 '그 수업으로 가는 길'). ⌂ 구간은 ⌂ 가 이미 말한다
  const sameRoad = (a, b) => (a.ends[0] === b.ends[0] && a.ends[1] === b.ends[1]) || (a.ends[0] === b.ends[1] && a.ends[1] === b.ends[0]);
  for (const lg of legLines) lg.tag = !lg.home && lg.text && legLines.some((o) => o !== lg && !o.home && o.text && sameRoad(lg, o)) ? lg.num : 0;
  renderLegend(mp, legs, homeLines.length > 0); // 번호표를 먼저 채워야 지도 칸 높이가 정해진다
  mp.el.setAttribute("aria-label", `${DAY_KO[day]}요일 지도`);
  // 맞추는 동안 끌 수 있는 범위(maxBounds)를 풀었다가 맞춘 뒤 다시 건다(10/3 디자인 세션이 찾은 것). 걸어 둔 채 칸 크기나 최소 배율이 바뀌면
  // Leaflet 이 moveend 마다 0.25초 애니메이션으로 범위 안에 옮기는데(_panInsideMaxBounds), 그 애니메이션이 뒤이은 setView·fitBounds 와 엉킨다:
  // 남은 만큼 밀리거나(수업 없는 날 ⌂ 가 가운데에서 11~39px 벗어났다), 최소 배율이 올라간 날은 맞춘 뒤에 최소 배율로 되돌아간다
  // (폰 320·태블릿 768 에서 수업 없는 날이 캠퍼스 전체로 열려 ⌂ 가 위에서 잘렸다). 그래서 같은 요일은 어디서 넘어와도 같은 자리·같은 배율이다
  const limit = map.options.maxBounds;
  if (limit) map.setMaxBounds(null);
  map.invalidateSize();
  applyMinZoom(map);
  mp.lines.clearLayers();
  const homeAt = coordOf(R.home);
  const stops = [], pts = homeAt ? [homeAt] : [];
  let n = 0;
  for (const l of legs) {
    if (!l.meeting) continue;
    n += 1;
    const at = l.meeting.building ? coordOf(l.meeting.building) : null;
    if (at && l.meeting.building !== R.home) stops.push({ at, nums: [n], names: [l.meeting.section.name], b: l.meeting.building });
  }
  for (const line of [...classLines, ...homeLines]) pts.push(...line);
  // 선 모양: 수업 가는 길은 route 4px 실선 + card 2px 테두리. 출발·도착 자리로 가는 길은 경로선 아래 칸에 ⌂ 색 파선(drawReturn, 배율이 정해진 뒤)
  const drawn = [];
  for (const line of classLines) drawn.push(L.polyline(line, { className: "map-route-case", weight: 8, lineCap: "round", lineJoin: "round", interactive: false }).addTo(mp.lines));
  for (const line of classLines) drawn.push(L.polyline(line, { className: "map-route", weight: 4, lineCap: "round", lineJoin: "round", interactive: false }).addTo(mp.lines));
  for (const st of stops) pts.push(st.at);
  // 요일·순위를 바꾸면 그날 경로 전체가 들어오게(애니메이션 없이). 핀이 오른쪽 위 버튼(크게 보기, 확대·축소), 오른쪽 아래 저작권 표기와
  // 핀 오른쪽 건물 번호에 가리지 않게 가장자리를 비운다. 폰의 작은 지도는 폭이 좁아 위쪽을 비운다
  const k = remPx() / 16; // 글자를 키우면 저작권 표기도 커진다
  const attr = mp.el.parentElement.querySelector(".map-attr"); // 좁은 지도에서는 저작권 표기가 두 줄이 된다
  const top = Math.max(mp.full || mp.buttons ? 40 : 56, Math.round(24 + 16 * k)), bottom = Math.max(32, Math.round(16 + 16 * k), (attr ? attr.offsetHeight : 0) + 8);
  const pad = mp.full ? { paddingTopLeft: [24, top], paddingBottomRight: [68, bottom] }
    : mp.buttons ? { paddingTopLeft: [20, top], paddingBottomRight: [56, bottom] } : { paddingTopLeft: [20, top], paddingBottomRight: [20, bottom] };
  if (pts.length > 1) {
    const bounds = L.latLngBounds(pts), fit = { ...pad, maxZoom: 17, animate: false };
    map.fitBounds(bounds, fit);
    // 묶인 핀(2·3·4·5·6)은 한 핀보다 넓다. 가장자리 밖으로 잘리면 그만큼 더 비우고 다시 맞춘다(묶음은 배율마다 달라서 몇 번 본다).
    // 맨 아래 핀이 오른쪽 아래 저작권 표기 밑에 걸려도 그만큼 아래를 더 비운다(아래 여백은 선 끝 기준이라 핀 반지름만큼 모자랄 수 있다).
    // 배율이 그대로면 더 비운 폭의 반만큼만 옮겨지므로 둘째부터는 두 배로 비운다
    for (let i = 0; i < 4; i++) {
      const w = map.getSize().x;
      const host = mp.el.getBoundingClientRect(), ar = attr ? attr.getBoundingClientRect() : null;
      const attrLeft = ar && ar.width ? ar.left - host.left : Infinity, attrTop = ar && ar.width ? ar.top - host.top : Infinity;
      let l = 0, r = 0, under = 0;
      const pins = groupStops(map, stops).map((pin) => [map.latLngToContainerPoint(pin.at), pin.w]);
      if (homeAt) pins.push([map.latLngToContainerPoint(homeAt), 24]);
      for (const [pt, pw] of pins) {
        l = Math.max(l, 4 + pw / 2 - pt.x);
        r = Math.max(r, pt.x + pw / 2 + 4 - w);
        if (pt.x + pw / 2 > attrLeft && pt.y + 12 - attrTop > 0.5) under = Math.max(under, pt.y + 12 + 2 - attrTop); // 걸렸을 때만, 2px 띄운다
      }
      if (l < 1 && r < 1 && under < 1) break;
      const more = (v) => (v < 1 ? 0 : Math.ceil(v) * (i ? 2 : 1));
      fit.paddingTopLeft = [fit.paddingTopLeft[0] + more(l), fit.paddingTopLeft[1]];
      fit.paddingBottomRight = [fit.paddingBottomRight[0] + more(r), fit.paddingBottomRight[1] + more(under)];
      map.fitBounds(bounds, fit);
    }
  } else if (pts.length) map.setView(pts[0], 16, { animate: false }); // 수업 없는 날: 출발·도착 자리를 가운데에, 배율 16
  if (limit) { map.panInsideBounds(limit, { animate: false }); map.setMaxBounds(limit); } // 범위 밖이면 애니메이션 없이 안으로 옮긴 뒤 다시 건다
  mp.data = { stops, legs: legLines, homeAt, home: R.home }; // home: 결과가 지워진 뒤(입력 화면에서 과목을 바꾼 뒤)에도 지도가 옮겨지면 다시 그린다
  drawReturn(mp);
  placeMarks(mp);
  drawStubs(mp); // 핀 자리(묶음)가 정해진 뒤에
  placeLegLabels(mp);
  placeLabels(mp);
  if (reveal && !reduceMotion.matches) revealRoute(mp, drawn);
}

/** 지금 배율에서 겹치는 수업 핀을 묶는다: [{at, nums, names, bs, label '2·3', w 핀 폭}] */
function groupStops(map, stops) {
  const merged = [];
  for (const st of stops) {
    const pt = map.latLngToContainerPoint(st.at);
    const near = merged.find((m) => Math.abs(m.pt.x - pt.x) < 24 && Math.abs(m.pt.y - pt.y) < 24);
    if (near) {
      near.nums.push(...st.nums);
      near.names.push(...st.names);
      if (!near.bs.includes(st.b)) near.bs.push(st.b);
    } else merged.push({ at: st.at, pt, nums: [...st.nums], names: [...st.names], bs: [st.b] });
  }
  for (const st of merged) {
    st.label = st.nums.join("·");
    st.w = st.label.length > 1 ? 12 + 7 * st.label.length : 24;
  }
  return merged;
}

/** 핀. 화면에서 겹치는 수업 핀은 1·2 로 묶는다(배율이 바뀔 때마다 다시). 구간 라벨은 placeLegLabels. */
function placeMarks(mp) {
  const { map, marks, data } = mp;
  marks.clearLayers();
  const merged = groupStops(map, data.stops);
  if (data.homeAt) {
    L.marker(data.homeAt, { keyboard: false, interactive: false,
      icon: L.divIcon({ className: "", html: `<div class="pin home" role="img" aria-label="${esc(placeLabel(data.home))}">${HOME_PIN}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(marks);
  }
  for (const st of merged) {
    const name = [st.label, ...new Set(st.names), st.bs.map(buildingLabel).join("·")].join(", "); // 1, 동물생화학 2, 26동
    L.marker(st.at, { keyboard: false, interactive: false, zIndexOffset: 100,
      icon: L.divIcon({ className: "", html: `<div class="pin" role="img" aria-label="${esc(name)}">${st.label}</div>`, iconSize: [st.w, 24], iconAnchor: [st.w / 2, 12] }) }).addTo(marks);
  }
  mp.pins = merged;
}

/** 지도 글자 폭(px). 굵기 w 의 12px(지도 그림 글자는 px 고정). 글꼴을 받으면 다시 잰다. */
const mapTextW = (() => {
  let cache = new Map();
  if (document.fonts) document.fonts.addEventListener("loadingdone", () => { cache = new Map(); });
  return (w, text) => {
    const k = `${w} ${text}`;
    let v = cache.get(k);
    if (v === undefined) {
      canvas.font = `${w} 12px ${mapColors().font}`;
      v = canvas.measureText(text).width;
      cache.set(k, v);
    }
    return v;
  };
})();
/** 건물 번호(.blabel b, 12px 700)와 이름(span, 12px 500) 가운데 넓은 쪽 + 테두리 여유. */
const blabelW = (text, name) => Math.max(mapTextW(700, text), name ? mapTextW(500, name) : 0) + 4;

/** 지도 오른쪽 위 버튼(크게 보기, 마우스·전체 화면 지도의 확대·축소)의 상자, 지도 칸 좌표 [x0, y0, x1, y1]. */
function mapButtonBoxes(mp) {
  const host = mp.el.getBoundingClientRect(), out = [];
  for (const el of mp.el.parentElement.querySelectorAll(".map-expand > span, .leaflet-control-zoom")) {
    const r = el.getBoundingClientRect();
    if (r.width) out.push([r.left - host.left - 2, r.top - host.top - 2, r.right - host.left + 2, r.bottom - host.top + 2]);
  }
  return out;
}

/** 수업이 있는 날 핀 옆 건물 번호: 글, (많이 확대하면) 이름, 폭, 자리. 핀 오른쪽이 기본이고 오른쪽 가장자리나 오른쪽 위 버튼에 걸리면 왼쪽,
 *  왼쪽도 가장자리에 걸리거나(폰의 좁은 지도에서 넓게 묶인 핀 2·3·4·5·6) 다른 핀을 덮으면 핀 아래에 둔다(dx: 가장자리에 걸리지 않게 옆으로 민 만큼). */
function pinTag(mp, pin, withName) {
  const { map } = mp;
  const text = pin.bs.map((b) => (b === "GATE" ? "정문" : b)).join("·");
  const name = withName ? pin.bs.map(buildingName).filter(Boolean).join("·") : "";
  const pt = map.latLngToContainerPoint(pin.at), x = pt.x, lw = blabelW(text, name), W = map.getSize().x, hw = pin.w / 2, hh = name ? 15 : 9;
  const right = [x + hw + 3, pt.y - hh, x + hw + 3 + lw, pt.y + hh], left = [x - hw - 3 - lw, pt.y - hh, x - hw - 3, pt.y + hh];
  let side = right[2] > W - 4 || mapButtonBoxes(mp).some((b) => boxHit(right, b)) ? "left" : "right", dx = 0;
  if (side === "left" && x - hw >= 0 && x + hw <= W) { // 핀이 화면 안에 있을 때만(지도를 끌어 핀이 나가면 번호도 따라 나간다)
    const others = (mp.pins || []).filter((q) => q !== pin).map((q) => [map.latLngToContainerPoint(q.at), q.w / 2]);
    if (mp.data && mp.data.homeAt) others.push([map.latLngToContainerPoint(mp.data.homeAt), 12]);
    if (left[0] < 4 || others.some(([q, w]) => boxHit(left, [q.x - w - 1, q.y - 13, q.x + w + 1, q.y + 13]))) {
      side = "below";
      dx = Math.max(4 + lw / 2 - x, Math.min(0, W - 4 - lw / 2 - x));
    }
  }
  return { text, name, lw, side, dx };
}

// ---- 구간 라벨 자리
// 10/1 밤 사용자 제보: 두 구간이 함께 지나는 길에 놓인 '12분'이 어느 구간 것인지 한눈에 안 들어왔다(구간 길이의 가운데에 두던 때).
// 이제 라벨은 그 구간만 지나는 자리(다른 구간 선에서 LABEL_SEP 넘게 떨어진 자리) 가운데 가장 긴 토막의 가운데에 둔다. 그런 자리가
// 없으면(다른 구간과 같은 길만 지나면) 다른 선에서 가장 먼 자리. 목표는 선 모양으로만 정해서 지도를 옮겨도 그대로이고, 목표가 핀·핀 옆
// 건물 번호·다른 라벨·지도 버튼·저작권 표기에 걸리거나 화면 밖이면 목표에서 가까운 자리를 고른다(그 구간만 지나는 자리부터).
// 둘 데가 없으면 숨긴다(가이드: 다른 라벨·핀과 겹치면 숨긴다). 그 구간만 지나는 자리가 짧은 라벨부터 자리를 잡는다
const LABEL_SEP = 8; // 다른 구간 선의 가운데에서 라벨 상자까지: 경로선 테두리 반폭 4px + 틈 4px
const LABEL_H = 18; // .leg-label: 줄 16px + 위아래 1px

const boxHit = (a, b) => !(a[2] <= b[0] || a[0] >= b[2] || a[3] <= b[1] || a[1] >= b[3]);

/** 축에 맞춘 상자 r = [x0, y0, x1, y1] 과 선분 ab 사이 거리(겹치면 0). */
function boxSegDist(r, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1; // Liang–Barsky: 선분이 상자를 지나는지
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (clip(-dx, a.x - r[0]) && clip(dx, r[2] - a.x) && clip(-dy, a.y - r[1]) && clip(dy, r[3] - a.y)) return 0;
  const toBox = (p) => Math.hypot(Math.max(r[0] - p.x, 0, p.x - r[2]), Math.max(r[1] - p.y, 0, p.y - r[3]));
  const l2 = dx * dx + dy * dy;
  const toSeg = (x, y) => { const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0; return Math.hypot(x - a.x - t * dx, y - a.y - t * dy); };
  return Math.min(toBox(a), toBox(b), toSeg(r[0], r[1]), toSeg(r[2], r[1]), toSeg(r[0], r[3]), toSeg(r[2], r[3]));
}

function placeLegLabels(mp) {
  const { map, data } = mp;
  mp.legLabels.clearLayers();
  mp.boxes = [];
  if (!data) return;
  const size = map.getSize(), o = map.containerPointToLayerPoint([0, 0]);
  const withName = map.getZoom() >= 17.25;
  // 피할 상자(layer 좌표): 핀과 핀 옆 건물 번호, 지도 위 버튼(크게 보기, 확대·축소)과 저작권 표기
  const pins = [], avoid = [];
  if (data.homeAt) { const p = map.latLngToLayerPoint(data.homeAt); pins.push([p.x - 14, p.y - 14, p.x + 14, p.y + 14]); }
  for (const pin of mp.pins || []) {
    const p = map.latLngToLayerPoint(pin.at), hw = pin.w / 2, t = pinTag(mp, pin, withName), hh = t.name ? 15 : 9;
    pins.push([p.x - hw - 2, p.y - 14, p.x + hw + 2, p.y + 14]);
    avoid.push(t.side === "below" ? [p.x + t.dx - t.lw / 2 - 2, p.y + 12, p.x + t.dx + t.lw / 2 + 2, p.y + 16 + 2 * hh]
      : t.side === "left" ? [p.x - hw - 5 - t.lw, p.y - hh, p.x - hw, p.y + hh] : [p.x + hw, p.y - hh, p.x + hw + 5 + t.lw, p.y + hh]);
  }
  const ui = [];
  const host = mp.el.getBoundingClientRect();
  for (const el of mp.el.parentElement.querySelectorAll(".map-expand, .leaflet-control-zoom, .map-attr")) {
    const r = el.getBoundingClientRect();
    if (r.width) ui.push([o.x + r.left - host.left - 4, o.y + r.top - host.top - 4, o.x + r.right - host.left + 4, o.y + r.bottom - host.top + 4]);
  }
  avoid.push(...pins, ...ui);
  const view = [o.x + 4, o.y + 4, o.x + size.x - 4, o.y + size.y - 4];
  // 구간 선(layer 좌표). 출발·도착 자리로 가는 길은 그려진 대로 오른쪽으로 비킨 선
  const lines = data.legs.map((lg) => (lg.home ? offsetPoints(map, lg.line, RETURN_OFFSET) : lg.line.map((ll) => map.latLngToLayerPoint(ll))));
  const seg = (a, b) => [a, b, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  // 선 끝과 핀을 잇는 점선(그려진 것만)도 그 구간의 선으로 친다(다른 구간 라벨이 그 위에 서지 않게). 라벨 후보 자리는 길 위(lines)에서만 고른다
  const stubs = dayStubs(mp);
  const segs = lines.map((pts, i) => pts.slice(1).map((b, k) => seg(pts[k], b))
    .concat(stubs[i].map(([a, b]) => seg(map.latLngToLayerPoint(a), map.latLngToLayerPoint(b)))));
  const isHome = data.legs.map((lg) => lg.home);
  const CAP = 32; // 이보다 먼 선은 볼 필요가 없다
  /** 상자 r 에서 i 아닌 구간 선까지 가장 가까운 거리: [모든 선, 수업 가는 길(실선)만]. */
  const sepOf = (i, r) => {
    let all = CAP, cls = CAP;
    for (let j = 0; j < segs.length; j++) {
      if (j === i) continue;
      for (const [a, b, x0, y0, x1, y1] of segs[j]) {
        const d0 = isHome[j] ? all : cls; // 이 선이 줄일 수 있는 값
        if (x0 > r[2] + d0 || x1 < r[0] - d0 || y0 > r[3] + d0 || y1 < r[1] - d0) continue;
        const d = boxSegDist(r, a, b);
        all = Math.min(all, d);
        if (!isHome[j]) cls = Math.min(cls, d);
        if (!cls) return [0, 0];
      }
    }
    return [all, cls];
  };
  /** 구간 i 의 선이 다른 수업 구간 선과 3px 안에 겹치는 길이 비율. 거의 1 이면 같은 길을 되짚는 구간(301 → 83 → 301). */
  const overlap = (i) => {
    const pts = lines[i];
    let tot = 0, hit = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / 4));
      for (let m = 0; m < n; m++) {
        const t = (m + 0.5) / n, p = L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        tot += len / n;
        if (segs.some((sg, j) => j !== i && !isHome[j] && sg.some(([c, d, x0, y0, x1, y1]) => p.x >= x0 - 3 && p.x <= x1 + 3 && p.y >= y0 - 3 && p.y <= y1 + 3
          && L.LineUtil.pointToSegmentDistance(p, c, d) <= 3))) hit += len / n;
      }
    }
    return tot ? hit / tot : 1;
  };
  const items = [];
  data.legs.forEach((lg, i) => {
    const pts = lines[i];
    if (!lg.text || pts.length < 2) return;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const len = cum[cum.length - 1];
    // 상자: 좌우 6px, ⌂ 10px + 2px, 수업 번호(.num 16px 원, 왼쪽 -4px·오른쪽 4px 여백)
    const numW = lg.tag ? Math.max(16, Math.ceil(mapTextW(700, String(lg.tag))) + 8) : 0;
    const hw = (Math.ceil(mapTextW(500, lg.text)) + 12 + (lg.home ? 12 : 0) + numW) / 2 + 1, hh = LABEL_H / 2 + 1;
    const step = Math.max(3, len / 160), end = Math.min(12, len / 2);
    const cands = [];
    for (let s = end, k = 1; s <= len - end + 1e-6; s += step) {
      while (k < cum.length - 1 && cum[k] < s) k++;
      const segLen = cum[k] - cum[k - 1], t = segLen ? (s - cum[k - 1]) / segLen : 0;
      const x = pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, y = pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t;
      const box = [x - hw, y - hh, x + hw, y + hh];
      const [sep, cls] = sepOf(i, box);
      cands.push({ s, x, y, box, sep, cls });
    }
    // 목표: 그 구간만 지나는 토막(이어진 후보) 가운데 가장 긴 것의 가운데. 없으면 다른 선에서 가장 먼 자리(같으면 구간 가운데에 가까운 쪽)
    const runs = [];
    let first = -1;
    cands.forEach((c, n) => {
      const own = c.sep >= LABEL_SEP;
      if (own && first < 0) first = n;
      if (first >= 0 && (!own || n === cands.length - 1)) { runs.push([cands[first].s, cands[own ? n : n - 1].s]); first = -1; }
    });
    const longest = runs.reduce((a, r) => (!a || r[1] - r[0] > a[1] - a[0] ? r : a), null);
    const mid = (c) => Math.abs(c.s - len / 2);
    const target = longest ? (longest[0] + longest[1]) / 2 : cands.reduce((a, c) => (c.sep > a.sep || (c.sep === a.sep && mid(c) < mid(a)) ? c : a)).s;
    // 다른 수업 실선이 지나가는 자리에도 둘 수 있는 라벨: ⌂ 라벨(⌂ 가 어느 선인지 말한다), 같은 길을 되짚는 구간(어디 두어도 그 길뿐)
    const anywhere = lg.home || (!longest && overlap(i) >= 0.9);
    items.push({ i, lg, cands, target, anywhere, own: runs.reduce((t, r) => t + r[1] - r[0] + step, 0) });
  });
  const placed = [];
  const free = (bx) => bx[0] >= view[0] && bx[1] >= view[1] && bx[2] <= view[2] && bx[3] <= view[3]
    && !avoid.some((q) => boxHit(bx, q)) && !placed.some((q) => boxHit(bx, q));
  items.sort((a, b) => a.own - b.own || a.i - b.i);
  for (const it of items) {
    const near = (a, b) => Math.abs(a.s - it.target) - Math.abs(b.s - it.target);
    const loose = (a, b) => b.sep - a.sep || near(a, b);
    // 1) 그 구간만 지나는 자리, 2) 다른 수업 실선이 라벨 밑으로 지나가지는 않는 자리, 3) (anywhere 일 때만) 아무 자리
    const c = it.cands.filter((x) => x.sep >= LABEL_SEP).sort(near).find((x) => free(x.box))
      || it.cands.filter((x) => x.sep < LABEL_SEP && x.cls > 0).sort(loose).find((x) => free(x.box))
      || (it.anywhere ? it.cands.filter((x) => x.sep < LABEL_SEP && !x.cls).sort(loose).find((x) => free(x.box)) : null);
    if (!c) continue; // 둘 데가 없거나 어느 구간 것인지 헷갈리는 자리뿐이면 숨긴다(크게 보기에서 확대하면 보인다)
    placed.push([c.box[0] - 2, c.box[1] - 2, c.box[2] + 2, c.box[3] + 2]);
    L.marker(map.layerPointToLatLng([c.x, c.y]), { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "", html: `<span class="leg-label${it.lg.home ? " to-home" : ""}" aria-hidden="true">${it.lg.home ? HOME_PIN.replace('width="12" height="12"', 'width="10" height="10"') : ""}${it.lg.tag ? `<span class="num">${it.lg.tag}</span>` : ""}${it.lg.text}</span>`, iconSize: [0, 0] }) }).addTo(mp.legLabels);
  }
  mp.boxes = pins.concat(ui, placed); // 수업이 없는 날 건물 번호가 피할 자리(placeLabels): 핀, 지도 버튼·저작권 표기, 구간 라벨
}

/**
 * 건물 번호(사용자 결정 10/1). 수업이 있는 날: 그날 수업 건물 번호만 핀 오른쪽에(겹쳐도 숨기지 않는다).
 * 수업이 없는 날: 배율 15.5 이상에서 모든 건물 번호, 화면에서 겹치거나(핀·구간 라벨 자리도) 가장자리에 걸리면 숨긴다. 배율 17.25 이상이면 이름도.
 * 꾸밈이라 스크린리더는 읽지 않는다(핀 이름과 아래 번호표가 같은 것을 말한다).
 */
function placeLabels(mp) {
  const { map, names, data } = mp;
  names.clearLayers();
  if (!data || !state.campus) return;
  const z = map.getZoom(), withName = z >= 17.25;
  const labelIcon = (html) => L.divIcon({ className: "", html, iconSize: [0, 0] });
  const size = map.getSize();
  if (data.stops.length) {
    for (const pin of mp.pins || []) {
      const { text, name, side, dx } = pinTag(mp, pin, withName); // 오른쪽 가장자리·버튼에 걸리면 핀 왼쪽, 왼쪽도 걸리면 핀 아래
      L.marker(pin.at, { interactive: false, keyboard: false, zIndexOffset: 50,
        icon: labelIcon(`<div class="blabel day${side === "right" ? "" : " " + side}" style="--pin-half:${pin.w / 2}px;--dx:${dx}px" aria-hidden="true"><b>${esc(text)}</b>${name ? `<span>${esc(name)}</span>` : ""}</div>`) }).addTo(names);
    }
    return;
  }
  if (z < 15.5) return;
  const o = map.containerPointToLayerPoint([0, 0]);
  const placed = (mp.boxes || []).slice();
  for (const lb of allBuildingMarks()) {
    const p = map.latLngToLayerPoint(lb.at);
    const w = blabelW(lb.text, withName ? lb.name : ""), hh = withName ? 28 : 15;
    const box = [p.x - w / 2 - 2, p.y - hh / 2 - 1, p.x + w / 2 + 2, p.y + hh / 2 + 1];
    if (box[0] < o.x + 2 || box[1] < o.y + 2 || box[2] > o.x + size.x - 2 || box[3] > o.y + size.y - 2) continue;
    if (placed.some((q) => !(box[2] < q[0] || box[0] > q[2] || box[3] < q[1] || box[1] > q[3]))) continue;
    placed.push(box);
    L.marker(lb.at, { interactive: false, keyboard: false,
      icon: labelIcon(`<div class="blabel" aria-hidden="true"><b>${esc(lb.text)}</b>${withName && lb.name ? `<span>${esc(lb.name)}</span>` : ""}</div>`) }).addTo(names);
  }
}

/** 첫 결과에서 한 번: 1위 경로 실선을 400ms 동안 그리고, 핀은 번호 순서로 나타난다. */
function revealRoute(mp, drawn) {
  const easing = "cubic-bezier(0.2, 0, 0, 1)";
  for (const pl of drawn) {
    const path = pl.getElement && pl.getElement();
    if (!path || !path.animate || !path.getTotalLength) continue;
    const len = path.getTotalLength();
    if (!len) continue;
    path.style.strokeDasharray = String(len);
    path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 400, easing })
      .finished.then(() => { path.style.strokeDasharray = ""; }, () => null);
  }
  const pins = [...mp.el.querySelectorAll(".pin:not(.home)")];
  pins.forEach((p, i) => p.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }],
    { duration: 200, delay: (i * 400) / Math.max(1, pins.length), easing, fill: "backwards" }));
  // 실선 끝과 핀을 잇는 점선은 실선이 다 그려진 뒤에 나타난다(파선 쪽 점선은 파선처럼 처음부터 있다)
  mp.stubs.eachLayer((pl) => {
    const path = !pl.options.ofHome && pl.getElement && pl.getElement();
    if (path && path.animate) path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 400, easing, fill: "backwards" });
  });
}

function renderFullMap() {
  if (!state.result) return;
  $("map-title").textContent = `${DAY_KO[state.day]}요일 지도`;
  if (!maps.full) maps.full = makeMap($("map-full"), true);
  if (maps.full) renderMap(maps.full, currentEv(), state.day);
  remember($("map-full")); // 번호표가 들어간 뒤의 크기(크기가 같으면 다시 그리지 않는다)
}

// ---------------------------------------------------------------- 순위

function twinText(twins) {
  const shown = twins.slice(0, 3).map(sectionLabel).join(", ");
  return twins.length > 3 ? `${shown} 외 ${twins.length - 3}개` : shown;
}

/** 후보 카드: 순위, 한 주 걷는 시간·등교 요일(늦는 수업이 있으면 빨간 ' · 월수 2분 늦음'), 요일별 미리보기. 고른 카드는 테두리와 담은 분반 목록, 저장하기.
 *  늦는 분을 한 주치 더한 값(예전 ' · 10분 늦음')은 뜻이 없어서 쓰지 않는다(10/1 사용자). 그 뒤 '늦을 수 있음'(앱 말투에 안 맞음),
 *  '늦음'(가이드 형식 '분 + 늦음'·원칙 '늦음은 분으로'에 안 맞음)을 거쳐 늦는 요일과 그 분으로(10/1 밤 사용자 결정, lateText) */
function rankItem(ev, i) {
  const R = state.result;
  const [h0, h1] = R.axis;
  const span = (h1 - h0) * 60;
  const pct = (x) => `${(x / span) * 100}%`;
  const cur = i === state.rank;
  const { walk, on: days, late, nodes } = weekSum(ev, R.days);
  const clsOf = (courseId) => state.byId.get(courseId)?.cls || "";
  const week = h("span", { class: "week", "aria-hidden": "true", style: { "--days": String(R.days.length) } },
    R.days.map((d) => h("span", { class: "wd" }, DAY_KO[d])),
    R.days.map((d) => h("span", { class: "wc" }, (ev.days[d] || []).map((m) => h("span", {
      class: "wb", style: { top: pct(m.start - h0 * 60), height: pct(m.end - m.start), background: clsColor(clsOf(m.section.courseId)) },
    })))));
  const btn = h("button", {
    type: "button", class: "rank-hit", "data-rank": String(i), "aria-current": cur ? "true" : null,
    "aria-label": [`${i + 1}위`, `걷기 주 ${walk}분`, days ? `${days} 등교` : "", late].filter(Boolean).join(", "),
  },
  h("span", { class: "rank-head" }, h("span", { class: "rank-no" }, `${i + 1}위`), h("span", { class: "rank-sum" }, nodes)),
  week);
  // 저장하기는 고른 카드에만 둔다(10/23 저녁 사용자: "선택한 거 아니면 저장하기 버튼 안 뜨게 하셈"). 다른 후보는 카드를 눌러 고른 뒤 저장한다
  let saveBox = null;
  if (cur) {
    const save = h("button", { type: "button", class: "btn-save", "data-save": String(i) });
    setSaveButton(save, ev, i);
    saveBox = h("div", { class: "rank-save" }, save);
  }
  return h("li", { class: cur ? "rank selected" : "rank" }, btn, cur ? rankPicks(ev) : null, saveBox);
}

/**
 * 고른 카드의 분반 목록: 과목명 | 분반 두 열(수강신청 때 분반 열만 내려 읽게). 분반은 번호만 진하게, 교수는 흐리게.
 * 같은 시간·건물의 다른 분반은 아래 줄에 '같은 시간·건물'(과목명 열)과 그 분반(분반 열). 좁은 카드·큰 글자면 분반이 과목명 아래로 간다(CSS).
 */
function rankPicks(ev) {
  return h("ul", { class: "rank-picks" }, ev.sections.map((s) => {
    const c = state.byId.get(s.courseId);
    const [no, prof] = sectionParts(s);
    const twins = s.twins && s.twins.length ? s.twins : null;
    return h("li", {},
      h("span", { class: "swatch", "aria-hidden": "true", style: { background: clsColor(c ? c.cls : "") } }),
      h("span", { class: "p-name" }, s.name), " ",
      h("span", { class: "p-sec" }, h("span", { class: "no" }, no), h("wbr"), h("span", { class: "pf" }, prof)),
      twins ? [" ", h("span", { class: "p-twins" }, h("span", { class: "p-tl" }, "같은 시간·건물"), " ", h("span", { class: "p-tw" }, twinText(twins)))] : null);
  }));
}

function renderRanks() {
  $("ranks").replaceChildren(...state.result.ranked.map((ev, i) => rankItem(ev, i)));
  renderMore();
}

// ---- 더 보기(10/4 사용자: "지금 더 보기랑 더 찾기가 나눠져 있는데 이거 하나로 통일", 6개씩, 버튼 이름은 '더 보기'. 그 앞은 10/3 밤 사용자:
// "개수 상관없이 더 찾기 누르면 다음 순위 이어서 찾아줘")
// 목록 아래 버튼 하나. 처음에는 RANKS_STEP 개를 목록에 올리고, 누를 때마다 다음 순위 RANKS_STEP 개를 붙인다(한도 없음). 목록 제목의 찾은 수는
// 목록에 올린 수다('6개' → '12개' → '18개' …). 다 올리면 자리를 숨기고 제목이 '전체 조합 N개를 찾았어요'가 된다.
// 엔진은 이어서 찾지 못하고 topK 를 키워 처음부터 다시 찾는다(순위는 topK 와 상관없이 정해져 있어 앞쪽은 그대로이고 그 뒤 순위가 이어 붙는다).
// 걸리는 시간은 topK 가 커져도 거의 같아서(10/3 잼, 분반이 많은 과목 일곱: 20개 2.0초, 60개 2.2초, 1,000개 2.8초) 찾을 때는 넉넉히 찾아 두고
// (찾아 둔 수 24 → 72 → 168 → 360 …. 모두 RANKS_STEP 의 배수) RANKS_STEP 개씩 목록에 올린다. 찾아 둔 것이 한 번 누를 몫 이하로 남으면 다음 몫을
// 미리 찾는다: 그러면 대개 누르자마자 붙는다. 찾아 둔 것(R.ahead)은 누르기 전까지 목록에도 제목의 수에도 넣지 않는다.
const rankMore = {
  job: null, // 돌고 있는 탐색 {opts, onProgress, done: Promise<"ok" | "cancelled" | "failed">}
  waiting: false, // 눌러 놓고 탐색을 기다리는 중(버튼은 aria-disabled, 500ms 뒤 '찾는 중')
  failed: false, // 눌렀는데 찾지 못했다(오류 줄 + '다시 시도')
  held: false, // 취소했거나 찾지 못했거나 다른 화면으로 가서 멈춘 뒤에는 다시 누를 때까지 미리 찾지 않는다
};

function renderMore() {
  const R = state.result;
  const more = hasMore(R);
  $("ranks-more").hidden = !more;
  if (rankMore.waiting) return; // 기다리는 동안의 라벨은 waitMore 가 그린다
  const failed = more && rankMore.failed;
  $("ranks-error").hidden = !failed;
  const btn = $("ranks-more-btn");
  btn.classList.toggle("small", failed); // 오류 줄 옆의 '다시 시도'는 다른 곳처럼 작은 텍스트 버튼
  btn.replaceChildren(failed ? "다시 시도" : "더 보기");
  if (failed) btn.setAttribute("aria-describedby", "ranks-error"); else btn.removeAttribute("aria-describedby");
  // 찾아 둔 것이 한 번 누를 몫 이하로 남았고 그 뒤로 조합이 더 있으면 다음 몫을 미리 찾는다(다음다음 누름이 기다리지 않게).
  // 워커에서만(화면 스레드에서 돌리면 누르지도 않았는데 화면이 멈춘다)
  if (R.ahead.length <= RANKS_STEP && moreBeyond(R) && !rankMore.job && !rankMore.held && !rankMore.failed && startWorker()) seekMore(R, true);
}

/** 찾아 둔 것 뒤의 순위를 찾기 시작한다(결과를 만든 과목·조건(출발·도착, 이동시간, 추가 설정) 그대로 topK 만 키워서). 찾은 것은 R.ahead 에 둔다. spare = 누르기 전에 미리 찾는 것. */
function seekMore(R, spare) {
  const have = R.ranked.length + R.ahead.length;
  let want = have * 2 + TOP_K; // 찾아 둔 수가 24 → 72 → 168 → 360 …
  if (R.total && R.total.exact) want = Math.min(want, R.total.count);
  const courses = R.courses.map((c) => ({ id: c.id, name: c.name, cls: c.cls, sections: c.sections }));
  const job = { opts: { topK: want, home: R.home, mode: R.mode, rules: R.rules, count: false, spare }, onProgress: null, done: null };
  job.done = compute(courses, (done, ms) => { if (job.onProgress) job.onProgress(done, ms); }, job.opts).then((res) => {
    if (state.result !== R || res.ranked.length < have) return "failed"; // 앞쪽은 지난번과 같다는 약속이 깨졌다(올 수 없는 일)
    const tail = res.ranked.slice(have);
    sortSections(tail, R.courses);
    R.ahead = R.ahead.concat(tail);
    R.full = res.ranked.length >= want;
    if (res.total) R.total = res.total; // 달라는 것보다 적게 왔다: 그게 전부다
    return "ok";
  }, (e) => {
    if (e instanceof Cancelled) return "cancelled";
    console.error(e);
    return "failed";
  }).then((how) => {
    if (rankMore.job === job) rankMore.job = null;
    if (how !== "ok" && state.result === R) rankMore.held = true;
    return how;
  });
  rankMore.job = job;
  return job;
}

/**
 * 탐색을 기다리는 동안의 버튼. '시간표 만들기'와 같다(busyButton: 500ms 뒤 작은 스피너 + '찾는 중', 10초를 넘을 수 있으면 '찾는 중 42%'와 '취소').
 * 미리 찾던 탐색이 돌고 있으면 그것을 기다린다. 그동안에도 카드를 고르고 요일을 바꿀 수 있다.
 */
async function waitMore(R) {
  const btn = $("ranks-more-btn"), cancel = $("ranks-cancel");
  rankMore.waiting = true;
  $("ranks-error").hidden = true;
  btn.classList.remove("small");
  btn.removeAttribute("aria-describedby");
  btn.replaceChildren("더 보기");
  btn.setAttribute("aria-disabled", "true"); // disabled 는 초점을 잃게 해서 쓰지 않는다. 두 번째 누름은 rankMore.waiting 으로 무시한다
  // 기다린 시간은 누른 때부터 잰다(미리 찾던 탐색은 누르기 전부터 돌고 있었다)
  const wait = busyButton(btn, cancel, { text: "찾는 중", said: "시간표 찾는 중", small: true });
  let how = "ok";
  await wait.begin(!rankMore.job && !startWorker() && estimate(R.courses) > HEAVY);
  if (state.result !== R || screen !== "result") how = "cancelled"; // 스피너를 그리는 사이 다른 화면으로 갔다
  else {
    const job = rankMore.job || seekMore(R, false);
    job.opts.spare = false; // 이제 누른 것이다(워커가 죽으면 화면 스레드에서라도 찾는다)
    job.onProgress = wait.progress;
    how = await job.done;
  }
  await wait.end(how !== "cancelled");
  rankMore.waiting = false;
  if (cancel.contains(document.activeElement)) btn.focus({ preventScroll: true }); // 숨기면 초점을 잃는다
  cancel.hidden = true;
  btn.removeAttribute("aria-disabled");
  return how;
}

/**
 * '더 보기'(찾지 못한 뒤에는 '다시 시도')를 눌렀다. 다음 순위 RANKS_STEP 개를 목록에 붙인다: 찾아 둔 것이 있으면 바로, 없으면 찾는 동안 기다렸다가.
 * 이미 보이던 카드의 차례와 고른 카드는 그대로이고, 새 카드는 애니메이션 없이 붙고, 화면은 스크롤하지 않는다(버튼이 있던 자리에 새 카드의 첫 장).
 * 남은 것이 RANKS_STEP 개보다 적으면 그만큼만 붙고, 다 올리면 버튼 자리가 없어지고 제목이 '전체 조합 N개를 찾았어요'가 된다.
 */
async function showMore() {
  const R = state.result;
  if (rankMore.waiting || !R) return;
  rankMore.failed = rankMore.held = false;
  const box = $("ranks-more"), btn = $("ranks-more-btn");
  const at = document.activeElement; // 누를 때의 초점
  // 찾아 둔 것이 한 번 누를 몫에 못 미치고 그 뒤로 조합이 더 있으면 찾는 동안 기다린다(미리 찾기가 아직 안 끝났거나, 워커가 없어 미리 찾지 못했다)
  let how = R.ahead.length < RANKS_STEP && moreBeyond(R) ? await waitMore(R) : "ok";
  if (state.result !== R) return; // 그사이 새 결과가 왔다
  if (how === "ok" && screen !== "result") how = "cancelled"; // 탐색이 막 끝났을 때 다른 화면으로 갔다: 찾은 것은 찾아 둔 채로 두고 목록은 그대로
  // 기다리는 동안 초점이 다른 데로 갔으면(카드를 골랐거나 Tab 으로 떠났다) 옮기지 않는다
  const stay = document.activeElement !== at && !box.contains(document.activeElement);
  if (how !== "ok") { // 취소했거나(다른 화면으로 간 것 포함) 찾지 못했다: 목록은 그대로
    rankMore.failed = how === "failed";
    renderMore();
    if (!stay && screen === "result") btn.focus({ preventScroll: true });
    if (rankMore.failed) announce("더 찾지 못했어요", "alert");
    return;
  }
  const from = R.ranked.length;
  R.ranked.push(...R.ahead.splice(0, RANKS_STEP));
  // 요일 탭과 시간 축은 처음 찾은 TOP_K 개로 잡아 뒀다(showResult). 목록이 그 뒤 순위까지 가면, 새로 올린 조합에 더 이르거나 늦은 수업·주말 수업이
  // 있을 때 넓어진다(줄지는 않는다)
  let grew = false;
  if (R.ranked.length > TOP_K) {
    const days = weekDays(R.ranked), axis = hourRange(R.ranked);
    axis[0] = Math.min(axis[0], R.axis[0]);
    axis[1] = Math.max(axis[1], R.axis[1]);
    grew = days.length !== R.days.length || axis[0] !== R.axis[0] || axis[1] !== R.axis[1];
    R.days = days;
    R.axis = axis;
  }
  // 목록 위쪽의 높이가 달라져도(시간 축이 넓어져 칸이 길어진다, 다 올려서 제목의 희미한 줄이 없어진다) 보던 목록 자리가 밀리지 않게 달라진 만큼 스크롤을 맞춘다.
  // 목록을 보고 있을 때만이다(목록 머리가 상단 바 위로 지나갔을 때). 기다리는 동안 위로 올라가 시간표를 보고 있으면 그 자리가 그대로여야 한다.
  // 재는 동안 전환을 끈다(style.css 의 is-still): 동작 줄이기에서는 모든 속성이 1ms 전환이라 바뀐 높이가 한 틀 뒤에야 잡힌다
  // (스크롤 붙잡기를 끈 크롬에서 목록이 그만큼 밀렸다. 붙잡기가 없는 Safari 26 까지가 그렇다. 크롬과 Safari 27 부터는 붙잡기가 대신 맞춰 준다)
  const top = $("ranks").getBoundingClientRect().top;
  const inList = top < document.querySelector("#view-result .topbar").getBoundingClientRect().bottom;
  let refocus = "";
  document.documentElement.classList.add("is-still");
  try {
    if (grew) { // 시간표와 미리보기 막대를 새 축으로 다시 그린다
      // 기다리는 동안 요일 탭이나 카드로 간 초점은 다시 그린 뒤 같은 탭·카드로 돌려준다
      const d = (stay && document.activeElement && document.activeElement.dataset) || {};
      refocus = d.rank ? `#ranks [data-rank="${d.rank}"]` : d.day ? `#daytabs [data-day="${d.day}"]` : "";
      renderResult();
    } else {
      $("rank-count").replaceChildren(...rankTitle(R));
      $("ranks").append(...R.ranked.slice(from).map((ev, i) => rankItem(ev, from + i)));
      renderMore();
    }
    if (inList) window.scrollBy(0, $("ranks").getBoundingClientRect().top - top);
  } finally {
    document.documentElement.classList.remove("is-still");
  }
  if (refocus) document.querySelector(refocus)?.focus({ preventScroll: true });
  // 초점은 새 카드의 첫 장으로(버튼은 새 카드 뒤에 있어서, 버튼에 두면 붙은 카드를 거슬러 올라가야 한다). 새 카드가 없으면(다 올렸다) 마지막 카드로
  if (!stay) $("ranks").querySelector(`[data-rank="${Math.min(from, R.ranked.length - 1)}"]`)?.focus({ preventScroll: true });
  announce(foundText(R)); // 초점이 카드로 가도 목록 제목의 수가 바뀐 것은 읽히지 않는다
}

function selectRank(i) {
  if (i !== state.rank) {
    const was = state.rank, list = $("ranks");
    state.rank = i;
    updateTabs();
    renderDay({ fade: true });
    // 바뀌는 두 장만 다시 그린다(더 보기로 목록이 수백 장이 되면 다 다시 그리는 데만 0.1~0.4초가 걸린다. 폰은 그 서너 배)
    for (const k of [was, i]) list.children[k]?.replaceWith(rankItem(state.result.ranked[k], k));
    list.children[i]?.querySelector(".rank-hit").focus({ preventScroll: true });
    announce(`${i + 1}위 시간표`);
  }
  // 두 칸이 화면 밖이면 칸이 보이게 스크롤한다
  const bar = document.querySelector("#view-result .topbar").getBoundingClientRect().bottom;
  const panes = $("panes").getBoundingClientRect();
  if (panes.top < bar || panes.bottom > window.innerHeight) $("daytabs").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
}

$("ranks").addEventListener("click", (e) => {
  const sv = e.target.closest("[data-save]");
  if (sv) { toggleSave(Number(sv.dataset.save), sv); return; }
  const b = e.target.closest("[data-rank]");
  if (b) selectRank(Number(b.dataset.rank));
});
$("ranks-more-btn").addEventListener("click", () => showMore());
$("ranks-cancel").addEventListener("click", () => cancelCompute());

// ---------------------------------------------------------------- 내 시간표(디자인 규칙 '내 시간표', 10/22 사용자: "SNU TT 참고해서 시간표 만들고 저장하는 기능
// 만들어", "같은 학기마다도 시간표 여러 개 만들 수 있어야 함")
// 자료 형식과 함수는 백엔드 timetables.js(T, docs/timetables.md). 기기에는 학기마다 시간표 목록(timetables@학기)과 지금 보는 시간표 id(timetable@학기)를 둔다.
// 보는 학기는 앱 전체의 학기다(탐색 학기 줄과 같은 값). 학기에 시간표가 없으면 빈 '시간표 1'을 보이고 처음 넣거나 이름을 바꿀 때 만든다
// (빈 시간표를 저절로 쌓지 않는다). 칸과 목록은 지금 편람 값을 따르고(T.reconcile: 내가 바꾼 시간·장소는 그대로), 편람을 받기 전에는 적어 둔 값으로 그린다.
// 시간이 겹치게 넣으면 묻지 않고 겹치는 항목을 뺀 뒤 되돌리기를 준다(묻는 창은 되돌릴 수 없는 일에만 쓴다)

const COLOR_NAMES = ["파랑", "초록", "주황", "보라", "노랑", "분홍", "청록", "회색"]; // 칸 색 item-0~7 의 이름(색 고르기의 스크린리더 이름. 화면에는 쓰지 않는다)
// 이벤트 테마의 칸 색 이름: 테마마다 팔레트가 따로라 이름도 그 테마의 것이다(디자인 80판. 크리스마스 값은 81판 '선명하게')
const THEME_COLOR_NAMES = { xmas: ["초록", "연초록", "금색", "청록", "빨강", "크림", "연두", "은색"] };
const colorNames = () => THEME_COLOR_NAMES[document.documentElement.dataset.theme] || COLOR_NAMES;
// 시간표 칸 색: 과목별(item) | 교과구분별(cls). 이 기기 하나, 학기와 상관없다. 기기에 두는 열쇠는 다 백엔드 timetables.js 의 STORE_KEYS
let ttColor = T.colorMode(store.get(T.STORE_KEYS.color, "item"));
const mine = { sem: "", list: [], id: "" }; // 보는 학기, 그 학기 시간표 목록(T.parseList), 지금 보는 시간표 id
let savedIndex = null; // 저장한 시간표의 '항목 열쇠=수업' 묶음 → 시간표(후보 카드의 저장됨. T.findSaved 와 같은 견줌을 카드마다 다시 하지 않게)

/** '2026년 2학기' */
function semesterLabel(sem) {
  const [y, k] = String(sem || "").split("-");
  return TERMS[k] ? `${y}년 ${TERMS[k]}` : "";
}

function readMine(sem) {
  mine.sem = sem || "";
  mine.list = sem ? T.parseList(store.get(semKey(T.STORE_KEYS.list, sem), []), sem) : [];
  mine.id = sem ? String(store.get(semKey(T.STORE_KEYS.current, sem), "") || "") : "";
  savedIndex = null;
}
/** 저장한다. 실패해도 알리지 않는다(디자인 규칙 '상태와 피드백': 다음에 켤 때 복원되지 않을 뿐) */
function saveMine() {
  savedIndex = null;
  if (!mine.sem) return;
  const listKey = semKey(T.STORE_KEYS.list, mine.sem), curKey = semKey(T.STORE_KEYS.current, mine.sem);
  if (mine.list.length) store.set(listKey, T.serialize(mine.list)); else store.del(listKey);
  if (mine.id) store.set(curKey, mine.id); else store.del(curKey);
}
/** 이 판이 읽을 수 있는 시간표(새 판이 적은 것은 목록에 남겨 두기만 한다: T.parseList 의 _newer) */
const shownTts = () => mine.list.filter((t) => !t._newer);
/** 지금 보는 시간표: 기억한 것, 없으면 대표, 그것도 없으면 목록 맨 위. 학기에 하나도 없으면 아직 만들지 않은 빈 '시간표 1' */
function curTt() {
  const list = shownTts();
  return list.find((t) => t.id === mine.id) || list.find((t) => t.primary) || list[0] || { id: "", title: T.nextTitle(mine.list), items: [], virtual: true };
}
/** 시간표를 목록에 넣거나 바꿔 넣고 저장한다. select 면 그 시간표를 보는 시간표로 */
function putTt(t, { select = true } = {}) {
  const i = mine.list.findIndex((x) => x.id === t.id);
  if (i >= 0) mine.list[i] = t; else mine.list.push(t);
  if (select) mine.id = t.id;
  saveMine();
}
/** 지금 시간표를 fn(t) → 새 t 로 바꾼다. 아직 없는 빈 시간표 1이면 이때 만든다. 바꾼 시간표(fn 이 null 이면 null) */
function editTt(fn) {
  let t = curTt();
  if (t.virtual) t = T.createTimetable(mine.list, mine.sem); // 이름을 안 주면 '시간표 n'(백엔드)
  const next = t && fn(t);
  if (!next) return null;
  putTt(next);
  return next;
}
/** 이름 바꾸기: 같은 학기에 같은 이름이 있으면 '이름 (2)'부터 비는 번호(T.uniqueTitle 과 같은 꼴. 겹치지 않으면 친 그대로: uniqueTitle 은 끝의 ' (n)'을 떼고 본다) */
function renamed(title, selfId) {
  const used = mine.list.filter((t) => t.id !== selfId).map((t) => t.title);
  return used.includes(title) ? T.uniqueTitle(title, used) : title;
}
/** 지금 시간표가 바뀌었다(다른 시간표로 바꿨거나 학기가 바뀌었다). 보이지 않는 내 시간표 탭에 쌓인 과목 추가 화면은 그 시간표의 것이라 거둔다 */
function selectTt(id) {
  if (id === mine.id) return;
  mine.id = id;
  saveMine();
  if (tab !== "mine") stacks.mine.length = 1;
}

/** 항목마다 그릴 것 [{key, item, meetings, state, live}]: 지금 편람과 견준 것(T.reconcile). 편람을 받기 전에는 적어 둔 수업 그대로 */
function ttEntries(t) {
  if (state.loaded && state.semester === (t.sem || mine.sem)) return T.reconcile(t, state.byId); // 공유받은 시간표는 다른 학기일 수 있다
  return t.items.map((it) => ({ key: T.itemKey(it), item: it, meetings: (it.custom ? it.meetings : it.own || it.base).map(meetOf), state: it.custom ? "custom" : "same", live: null }));
}
const meetsOverlap = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;
/** 시간이 겹치는 항목들의 열쇠 */
function clashKeys(entries) {
  const out = new Set();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].meetings.some((a) => entries[j].meetings.some((b) => meetsOverlap(a, b)))) { out.add(entries[i].key); out.add(entries[j].key); }
    }
  }
  return out;
}
const courseName = (e) => (e.item.custom ? e.item.title : (state.loaded && state.byId.get(e.item.course)?.name) || e.item.name);
const colorNo = (it) => (Number.isInteger(it.color) ? it.color : 0) % COLOR_NAMES.length;
/** 칸 색과 점 색: 과목별이면 item-N, 교과구분별이면 탐색과 같은 교과구분 색(일정은 기타). 칸 색은 테마마다 따로다(디자인 80판) */
const itemFill = (it) => (ttColor === "cls" ? clsFill(it.custom ? "" : it.cls) : `var(--item-${colorNo(it)})`);
const itemDot = (it) => (ttColor === "cls" ? clsColor(it.custom ? "" : it.cls) : `var(--item-${colorNo(it)}-dot)`);
/** 칸 위 글자색: 그 칸 색의 글자색(--block-fg 과목명·--block-fg2 강의실. 내 시간표·공유받은 시간표 격자·시간표 이미지. 크리스마스의 짙은 칸은 흰 과목명과 옅은 같은 색 강의실) */
const itemInk = (it) => {
  const k = ttColor === "cls" ? `cls-${clsKey(it.custom ? "" : it.cls)}` : `item-${colorNo(it)}`;
  return { "--block-fg": `var(--${k}-fg)`, "--block-fg2": `var(--${k}-fg2)` };
};
/** 일정의 메타·칸: '금 16:00~18:00 · 63동'(장소가 없으면 시각까지) */
const customWhen = (meetings) => meetingGroups(meetings).map((g) => `${daysLabel(g.days)} ${hm(g.start)}~${hm(g.end)}${g.building ? ` · ${buildingLabel(g.building)}` : ""}`).join(", ");

/** 태그는 두 개까지, 위험 → 주의 → 중립. 없는 과목은 편람에서 과목이 사라진 것(탐색과 같은 말), 없는 분반은 과목은 있고 분반만 사라진 것 */
function itemTags(e, clash) {
  const tags = [];
  if (clash.has(e.key)) tags.push(["danger", "시간 겹침"]);
  if (e.state === "gone") tags.push(["danger", e.missing === "section" ? "없는 분반" : "없는 과목"]);
  if (e.state === "changed") tags.push(["warning", "편람 바뀜"]);
  if (e.live && e.live.status === "폐강대상") tags.push(["warning", "폐강 대상"]);
  if (!e.item.custom && (!e.meetings.length || e.meetings.some((m) => !m.building))) tags.push(["", "미정"]);
  if (e.item.own) tags.push(["", "직접 입력"]);
  return tags.slice(0, 2);
}

/** 내 시간표가 바뀌었다: 보이는 곳만 다시 그린다(목록 시트, 내 시간표 화면, 과목 추가의 넣은 과목 표시) */
function mineChanged() {
  if ($("tt-list-sheet").open) refillTtList(); // 학기를 바꾼 뒤 편람을 받으면 다시 그린다: 목록 안의 초점은 같은 일을 하는 요소로
  if (mineShown()) renderMine();
}

/** 내 시간표 화면이 보인다: 내 시간표, 그리고 과목 추가(넓은 화면은 그 화면의 오른쪽 칸, 폰은 그 화면 위의 시트다) */
function mineShown() {
  return screen === "mine" || screen === "add";
}

function renderMine() {
  if (!mineShown()) return;
  const t = curTt();
  const entries = ttEntries(t);
  const clash = clashKeys(entries);
  if (itemsErrFor && itemsErrFor !== `${mine.sem}|${t.id}`) itemsError(null); // 이미지로 추가 오류 줄은 다른 시간표·학기로 바뀌면 거둔다
  renderMineHead(t);
  $("tt-legend").hidden = ttColor !== "cls" || !entries.length; // 격자 높이를 채울 때 색 풀이 자리를 뺀다(renderItems 에서도 같은 값)
  renderWeek(t, entries, clash);
  renderItems(entries, clash);
  $("route-run").disabled = !canRoute(t); // 동선 탐색에 보낼 과목이 없으면 꺼진다(비었으면 빈 격자가 까닭을 보인다)
  if (addActive()) markAddRows(); // 과목 추가: 격자·목록에서 빼거나 되돌리거나 다른 시간표로 바꾸면 결과 행의 넣음 표시도
}
/** 격자만 다시(과목 추가의 미리 보기가 바뀌었다) */
function renderWeekNow() {
  if (!mineShown()) return;
  const t = curTt(), entries = ttEntries(t);
  renderWeek(t, entries, clashKeys(entries));
}
/**
 * 넓은 화면 과목 추가에서 미리 보는 분반(addPreview): {meetings: 넣으면 생길 수업, name, out: 넣으면 빠질 항목 열쇠, own: 이미 넣은 분반이면 그 항목 열쇠}.
 * 빠질 항목은 같은 과목의 다른 분반과 시간이 겹치는 항목(T.addItem 의 removed. 넣기 전의 t 는 그대로다)
 */
function previewOf(t) {
  if (!addPreview || screen !== "add" || !splitAdd() || !state.loaded) return null;
  const { c, s } = addPreview, it = t.items.find((x) => x.course === c.id);
  if (it && it.no === s.no) return { meetings: [], name: c.name, out: new Set(), own: T.itemKey(it) };
  const r = T.addItem(t, T.sectionItem(c, s), { force: true, byId: state.byId });
  return { meetings: s.meetings.map((m) => ({ ...m })), name: c.name, out: new Set(r.removed.map(T.itemKey)), own: null };
}

/** 머리 줄: '2026년 2학기 · 총 18학점' / '시간표 1 ▾' + 대표. 학점이 없으면(빈 시간표, 일정만) 학기만 */
function renderMineHead(t) {
  const sum = Math.round(T.credits(t) * 10) / 10, sem = semesterLabel(mine.sem);
  $("tt-sem").textContent = sum ? `${sem} · 총 ${sum}학점` : sem;
  $("tt-name").textContent = t.title;
  $("tt-primary").hidden = !t.primary;
  $("tt-switch").setAttribute("aria-label", [sum ? `${sem} 총 ${sum}학점` : sem, t.title, t.primary ? "대표" : ""].filter(Boolean).join(", "));
  $("tt-share").hidden = !t.items.length; // 비어 있는 시간표는 나눌 것이 없다(이미지 줄과 같다)
  sleighSoon(); // 크리스마스 썰매 그림: 학기·학점 줄, 이름, 공유가 바뀌었을 수 있다
}

/**
 * 주간 격자: 월–금(토·일 항목이 있으면 그 요일까지), 9~18시(항목이 더 이르거나 늦으면 정시로 넓힌다). 한 시간 = max(mine-hour-min, 30rem ÷ 시간 수).
 * 칸은 요일·시각 순 <ol> 이고 자리만 절대 배치다. 칸 글자는 t-label: 강의실은 늘 보이고(좁으면 건물과 호 사이에서 줄을 바꾼다) 과목명은 남는 줄만큼,
 * 칸이 낮아 과목명 한 줄도 못 두면 강의실을 건물만('43-1동'). 시간이 겹치는 칸은 반씩 나란히. 시간이 미정인 항목은 격자에 없다(목록에 '미정')
 */
let wkWidth = 0, wkFill = 0, wkGeom = null; // 내 시간표 격자의 첫 시각·한 시간 높이(폰 과목 추가 시트의 넣은 자리로 스크롤이 시각 → 자리로 쓴다)
// 컴퓨터(사이드바, 1100px부터)는 격자 카드가 화면 아래 끝(space-6 위, 색 풀이가 있으면 그 아래 끝)까지 오게 한 시간 높이를 늘린다(10/23 사용자: "뭔가 균형이 안 맞음.
// 배치 가이드 같은 거 찾아보고 반영해봐". 안드로이드 큰 화면 '보조 칸' 배치처럼 두 칸이 창의 본문 높이를 채우면 위 끝은 사이드바 탭, 아래 끝은 사이드바의 정보와
// 같은 줄에 선다. 전에는 격자가 내용만큼이라 화면 아래 5분의 1이 비었다). 높이가 25em 보다 낮은 창은 하지 않고, 한 시간은 8rem 까지
const wkFillWide = matchMedia("(min-width: 68.75em) and (min-height: 25em)");
function wkFillHour(box, body, hours, rem) {
  if (!wkFillWide.matches || !mineShown()) return 0;
  const card = box.getBoundingClientRect(), chrome = card.height - body.getBoundingClientRect().height; // 카드 위아래 여백 + 요일 줄
  if (!card.height) return 0; // 아직 그려지지 않았다(숨은 화면). 보이면 폭이 바뀌어 다시 그린다
  const top = card.top + window.scrollY; // 오른쪽 칸도 이 높이에 붙고 창 아래 끝까지 간다(style.css --mine-top)
  $("view-mine").style.setProperty("--mine-top", `${Math.round(top)}px`);
  const legend = $("tt-legend"), below = legend.hidden ? 0 : legend.getBoundingClientRect().height + parseFloat(getComputedStyle(legend).marginTop);
  const room = window.innerHeight - top - chrome - below - 24; // 24 = space-6(사이드바 아래 여백과 같다)
  return Math.min(8 * rem, room / hours);
}
// 창 높이가 바뀌면(컴퓨터) 격자를 다시 채운다
let wkFillRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(wkFillRaf);
  wkFillRaf = requestAnimationFrame(() => {
    if (!mineShown()) return;
    const want = wkFillWide.matches; // 채우는 폭이거나, 채우던 것을 풀어야 할 때만
    if (want || wkFill > 0) renderWeekNow();
  });
});
/** opts.box: 그릴 상자(내보내는 그림의 격자 카드. 없으면 내 시간표의 #wk), opts.hourPx: 한 시간 높이를 정해 그린다(미리 보기·화면 채우기 없음) */
function renderWeek(t, entries, clash, opts = {}) {
  const own = !opts.box, box = opts.box || $("wk");
  const blocks = [];
  for (const e of entries) for (const m of e.meetings) blocks.push({ e, m, half: "" });
  const pv = own ? previewOf(t) : null, ghosts = pv ? pv.meetings : [];
  const days = [0, 1, 2, 3, 4];
  for (const m of [...blocks.map((x) => x.m), ...ghosts]) if (!days.includes(m.day)) days.push(m.day);
  days.sort((a, b) => a - b);
  let h0 = 9, h1 = 18;
  for (const m of [...blocks.map((x) => x.m), ...ghosts]) { h0 = Math.min(h0, Math.floor(m.start / 60)); h1 = Math.max(h1, Math.ceil(m.end / 60)); }
  const hours = h1 - h0, rem = remPx();
  box.style.setProperty("--days", String(days.length));
  box.style.setProperty("--hours", String(hours));
  const body = h("div", { class: "wk-body" });
  box.replaceChildren(h("div", { class: "wk-head", "aria-hidden": "true" }, h("span"), days.map((d) => h("span", {}, DAY_KO[d]))), body);
  const hourPx = opts.hourPx || Math.max(3.75 * rem, (30 * rem) / hours, wkFillHour(box, body, hours, rem));
  box.style.setProperty("--hour-h", `${hourPx}px`);
  for (let i = 0; i <= hours; i++) {
    body.append(h("div", { class: "wk-line", "aria-hidden": "true", style: { top: `${i * hourPx}px` } }));
    if (i < hours) body.append(h("span", { class: "wk-hour", "aria-hidden": "true", style: { top: `${i * hourPx}px` } }, String(h0 + i)));
  }
  if (own) {
    wkWidth = box.clientWidth;
    wkFill = wkFillWide.matches ? hourPx : 0;
    wkGeom = { h0, hourPx };
  }
  const n = days.length;
  const at = (m) => ({ top: `${((m.start - h0 * 60) / 60) * hourPx}px`, height: `${((m.end - m.start) / 60) * hourPx - 2}px`,
    left: `calc(${days.indexOf(m.day)} * (100% + 2px) / ${n})`, width: `calc((100% + 2px) / ${n} - 2px)` });
  // 미리 보기: 넣으면 생길 칸(점선, 글자는 과목명과 강의실. 칸들 위에 얹는다). 마우스를 받지 않는다
  const addGhosts = () => {
    if (!ghosts.length) return;
    // 끝 번호 붙이기(glueTail)의 폭: 칸 폭(.wk-ghosts 는 시각 칸 1.375rem + 2px 오른쪽) − 안쪽 여백 3·3 − 점선 2·2
    const gw = (body.clientWidth - 1.375 * rem) / n - 2 - 10, gName = glueTail(shortName(pv.name), gw, canvasWidth(`500 ${0.75 * rem}px ${getComputedStyle(box).fontFamily}`));
    body.append(h("ol", { class: "wk-ghosts", "aria-hidden": "true" }, ghosts.map((m) => h("li", { style: at(m) },
      h("span", { class: "wk-ghost" }, h("span", { class: "b-title" }, gName), h("span", { class: "b-room" }, roomLabel(m)))))));
  };
  if (!t.items.length) { if (ghosts.length) addGhosts(); else body.append(h("p", { class: "wk-empty" }, "시간표가 비어 있어요")); return; }
  if (!blocks.length) { addGhosts(); return; }
  blocks.sort((a, b) => a.m.day - b.m.day || a.m.start - b.m.start || a.m.end - b.m.end);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = blocks[j], b = blocks[i];
      if (a.e !== b.e && meetsOverlap(a.m, b.m)) { if (!a.half) a.half = "half"; b.half = "half right"; }
    }
  }
  const list = h("ol", { class: "wk-blocks" });
  body.append(list);
  const colW = (list.clientWidth + 2) / n - 2;
  const font = `500 ${0.75 * rem}px ${getComputedStyle(box).fontFamily}`;
  for (const { e, m, half } of blocks) {
    const top = ((m.start - h0 * 60) / 60) * hourPx, height = ((m.end - m.start) / 60) * hourPx - 2;
    const textW = (half ? (colW - 2) / 2 : colW) - 8;
    const name = glueTail(e.item.custom ? e.item.title : shortName(courseName(e)), textW, canvasWidth(font)); // 끝 번호는 앞 낱말에(glueTail)
    const full = e.item.custom ? (m.building ? buildingLabel(m.building) : "") : roomLabel(m);
    let room = full, roomLines = room ? textLines(room, font, textW) : 0;
    if (room && height - 6 - roomLines * rem < rem && m.building && room !== buildingLabel(m.building)) {
      room = buildingLabel(m.building);
      roomLines = textLines(room, font, textW);
    }
    const lines = Math.max(1, Math.floor((height - 6 - roomLines * rem) / rem));
    const said = [`${DAY_KO[m.day]} ${hm(m.start)}~${hm(m.end)} ${e.item.custom ? e.item.title : courseName(e)}`, full, clash.has(e.key) ? "시간 겹침" : ""].filter(Boolean).join(", ");
    const mark = pv && pv.out.has(e.key) ? " is-out" : pv && pv.own === e.key ? " is-hl" : ""; // 미리 보기: 빠질 항목은 흐리게, 이미 넣은 분반은 테두리
    const cls = `wk-block${half ? ` ${half}` : ""}${mark}`, style = { background: itemFill(e.item), ...itemInk(e.item), "--lines": String(lines) };
    const parts = [h("span", { class: "b-title", "aria-hidden": "true" }, name), room ? h("span", { class: "b-room", "aria-hidden": "true" }, room) : null];
    list.append(h("li", { style: { top: `${top}px`, height: `${height}px`, left: `calc(${days.indexOf(m.day)} * (100% + 2px) / ${n})`, width: `calc((100% + 2px) / ${n} - 2px)` } },
      // 누르지 않는 격자(공유받은 시간표 미리 보기): 칸은 글이고 스크린리더는 목록의 글로 읽는다
      opts.still ? h("span", { class: cls, style }, ...parts, h("span", { class: "sr-only" }, said))
        : h("button", { type: "button", class: cls, "data-key": e.key, "aria-haspopup": "dialog", "aria-label": said, style }, ...parts)));
  }
  addGhosts();
}

/** 항목 목록: 첫 수업의 요일·시각 순(시간이 없는 것은 맨 뒤), 맨 아래 셋으로 나눈 '과목 추가' | '직접 추가' | '이미지로 추가'(10/23 저녁 사용자:
 *  "이미지로 추가는 과목추가, 직접 추가, 이 옆에 이미지로 추가 이렇게 3개로 구성하자". 칸이 좁아 아이콘 아래에 이름) */
function renderItems(entries, clash) {
  const first = (e) => (e.meetings.length ? Math.min(...e.meetings.map((m) => m.day * 1440 + m.start)) : Infinity);
  const sorted = [...entries].sort((a, b) => first(a) - first(b));
  const add = (kind, paths, text) => h("button", { type: "button", class: "add-row", "data-add": kind,
    "aria-describedby": kind === "image" && !$("items-error").hidden ? "items-error" : null }, icon(paths, 20), h("span", {}, text));
  $("items").replaceChildren(...sorted.map((e) => itemRow(e, clash)),
    h("li", { class: "add-trio" }, add("course", I.plus, "과목 추가"), add("custom", I.plus, "직접 추가"), add("image", IMAGE_ICON, "이미지로 추가")));
  $("tt-legend").hidden = ttColor !== "cls" || !entries.length;
}

/** 행: 색 점, 이름, 메타('001(홍승윤) · 전선 · 3학점', 일정은 '금 16:00~18:00 · 63동'), 태그, 빼기 ×. 행 어디든 눌린다(×만 따로) */
function itemRow(e, clash) {
  const it = e.item;
  const name = courseName(e);
  const meta = it.custom ? customWhen(e.meetings) : [sectionLabel({ no: it.no, instructor: it.instructor }), it.cls, fmtCredit(it.credit)].filter(Boolean).join(" · ");
  const tags = itemTags(e, clash);
  return h("li", { class: "course", "data-key": e.key },
    h("button", { type: "button", class: "course-hit", "data-item": e.key, "aria-haspopup": "dialog", "aria-label": [name, meta, ...tags.map(([, x]) => x)].join(", ") },
      h("span", { class: "dot", "aria-hidden": "true", style: { background: itemDot(it) } }),
      h("span", { class: "c-body" }, h("span", { class: "c-title" }, name), h("span", { class: "c-meta" }, meta))),
    tags.length ? h("span", { class: "tags", "aria-hidden": "true" }, tags.map(([k, x]) => h("span", { class: k ? `tag ${k}` : "tag" }, x))) : null,
    h("button", { type: "button", class: "icon-btn remove", "data-drop": e.key, "aria-label": `${name} 빼기` }, icon(I.x, 20)));
}

/** 항목 빼기: 확인 없이 빼고 스낵바 '과목을 뺐어요'·'일정을 뺐어요' [되돌리기]. 되돌리면 같은 시간표의 같은 자리로 */
function dropItem(key, { fromList = false } = {}) {
  const t = curTt();
  const at = t.items.findIndex((x) => T.itemKey(x) === key);
  if (at < 0) return;
  const it = t.items[at];
  const row = $("items").querySelector(`li[data-key="${CSS.escape(key)}"]`);
  const keyboard = Boolean(fromList && row && row.querySelector(":focus-visible"));
  const sib = row && (row.nextElementSibling?.dataset.key ? row.nextElementSibling : row.previousElementSibling);
  const nextKey = sib && sib.dataset.key;
  putTt(T.removeItem(t, key));
  renderMine();
  if (keyboard) ($("items").querySelector(`li[data-key="${CSS.escape(nextKey || "")}"] .remove`) || $("items").querySelector('[data-add="course"]'))?.focus();
  const name = it.custom ? it.title : it.name;
  announce(`${name} 뺐어요`);
  showSnackbar(it.custom ? "일정을 뺐어요" : "과목을 뺐어요", "되돌리기", () => {
    const cur = mine.list.find((x) => x.id === t.id);
    if (!cur || cur.items.some((x) => T.itemKey(x) === key)) return;
    const items = cur.items.slice();
    items.splice(Math.min(at, items.length), 0, it);
    putTt({ ...cur, items, updated: new Date().toISOString() }, { select: false });
    renderMine();
    $("items").querySelector(`li[data-key="${CSS.escape(key)}"] .course-hit`)?.focus();
  });
}

/** 겹치는 항목을 빼고 넣은 것을 되돌린다: 넣은 항목을 빼고, 뺀 항목과 바꾸기 전 분반(restore)을 돌려놓는다 */
function undoReplace(tid, addedKey, restore) {
  const cur = mine.list.find((x) => x.id === tid);
  if (!cur) return;
  const again = new Set(restore.map(T.itemKey));
  const items = cur.items.filter((x) => T.itemKey(x) !== addedKey && !again.has(T.itemKey(x)));
  putTt({ ...cur, items: [...items, ...restore], updated: new Date().toISOString() }, { select: false });
  mineChanged();
}

/**
 * 시간표에 항목을 넣는다(과목 추가 화면의 추가·바꾸기, 항목 시트의 바꾸기, 직접 추가). 같은 과목의 다른 분반은 바꿔 넣는다(색은 그대로).
 * 시간이 겹치는 항목이 있으면 묻지 않고 빼고 넣는다(T.addItem force). → {tid, added: 넣은 항목 열쇠, restore: 되돌릴 때 돌려놓을 항목들(T.addItem 의 removed),
 * removed: 겹쳐서 뺀 항목 수(바꿔 넣느라 뺀 같은 과목의 분반은 세지 않는다)}
 */
function placeItem(item) {
  let out = null;
  editTt((t) => {
    const r = T.addItem(t, item, { force: true, byId: state.byId });
    const swapped = (x) => T.itemKey(x) === T.itemKey(item) || (!!item.course && x.course === item.course);
    out = { tid: t.id, added: T.itemKey(item), restore: r.removed, removed: r.removed.filter((x) => !swapped(x)).length };
    return r.t;
  });
  return out;
}

$("tt-switch").addEventListener("click", (e) => openTtList(e.currentTarget));
$("route-run").addEventListener("click", () => {
  const t = curTt();
  if (devKey(t)) openDev($("route-run")); else routeTt(t);
});
$("items").addEventListener("click", (e) => {
  const drop = e.target.closest("[data-drop]");
  if (drop) { dropItem(drop.dataset.drop, { fromList: true }); return; }
  const hit = e.target.closest("[data-item]");
  if (hit) { openItem(hit.dataset.item, hit); return; }
  const add = e.target.closest("[data-add]");
  if (!add) return;
  itemsError(null); // 지난 이미지로 추가 오류 줄은 다음 추가에서 거둔다
  if (add.dataset.add === "course") openAdd(add);
  else if (add.dataset.add === "image") $("tt-file").click();
  else openCustom(null, add);
});
$("tt-share").addEventListener("click", (e) => openShare(e.currentTarget));
$("wk").addEventListener("click", (e) => {
  const b = e.target.closest("[data-key]");
  if (b) openItem(b.dataset.key, b);
});
// 격자 폭이 바뀌면(화면 회전, 폭 구간) 칸 글자를 다시 맞춘다
new ResizeObserver(() => {
  const w = $("wk").clientWidth;
  if (mineShown() && w && Math.abs(w - wkWidth) >= 1) renderMine();
}).observe($("wk"));

// ---- 시간표 목록 시트: 학기 묶음(접고 편다. 다른 학기를 고르면 앱 전체의 학기가 바뀐다), 시간표 행과 행마다 ⋯(시간표 메뉴 팝업), 맨 아래 '+ 새 시간표'(50개까지), 칸 색.
// 시간표를 통째로 바꾸는 일은 그 시간표 행의 ⋯ 가 여는 시간표 메뉴 팝업에서 한다(10/30 오후 사용자: "시간표 옵션은 그냥 창으로 띄우고". 그 전에는 행 아래에 펼쳤고
// 10/23 까지는 머리 줄 ⋯ 의 메뉴 시트가 보는 시간표 하나에만 걸었다. 아래 '시간표 메뉴 팝업').
// '동선 탐색에 담기'는 10/23 오후 사용자가 없앴다("동선 탐색에 넣기는 없애버리고 걍 동선 확인하기를 분반 정보 포함해서 동선탐색으로 보내": 아래 routeTt)
// 학기는 접고 펴는 목록(10/30 사용자, SNUTT 의 시간표 목록 그림과 함께: "시간표 목록도 그 학기 선택하는 거 SNUTT처럼 저런 형식의 목록으로 정리하는 게 나을 듯").
// 그 전에는 맨 위 연도·학기 선택칸 둘과 그 학기 시간표 목록이었다. 펼친 학기(tlSems)는 시트를 열 때 지금 학기 하나.
// 새 시간표는 목록 맨 아래 '+ 새 시간표' 하나가 학기와 이름을 고르는 팝업을 띄운다(10/30 사용자: "다른 학기의 시간표를 만들 수가 없음", 이어 "걍 새 시간표 추가할 때
// 학기랑 시간표 이름 선택하는 창을 하나 띄워주자". 아래 '새 시간표 팝업')
let tlSems = new Set();
function openTtList(opener) {
  tlSems = new Set([mine.sem]);
  renderTtList();
  openSheet($("tt-list-sheet"), opener);
}
// 이미지로 저장(10/23 디자인 75판): 사진 저장이 안 되는 앱(canSaveImage)과 비어 있는 시간표에는 없다. '이미지 보내기'는 10/23 저녁 사용자가 없애고
// 머리 줄의 공유 버튼으로 옮겼다("'이미지 보내기' 이거 없애버리고 오른쪽 위에 공유 … 버튼")
const TT_ACTS = [["copy", "복사하기"], ["primary", "대표 시간표로 설정하기"], ["save-image", "이미지로 저장"], ["delete", "지우기"]];
/** 목록의 학기(최근 먼저): 시간표가 있는 학기와 지금 보는 학기(비어 있으면 아직 만들지 않은 빈 시간표 1). 다른 학기에는 + 새 시간표 팝업에서 만든다 */
function tlSemesters() {
  const ids = state.semesters.map(([id]) => id).filter((id) => /^\d{4}-[12SW]$/.test(id));
  const shown = ids.filter((id) => id === mine.sem || T.hasTimetables(store.get(semKey(T.STORE_KEYS.list, id), [])));
  if (mine.sem && !shown.includes(mine.sem)) shown.unshift(mine.sem);
  return shown;
}
function ttMeta(t) {
  const n = t.items.filter((it) => !it.custom).length, m = t.items.length - n, sum = Math.round(T.credits(t) * 10) / 10;
  return t.items.length ? [n ? `총 ${sum}학점` : "", n ? `과목 ${n}` : "", m ? `일정 ${m}` : ""].filter(Boolean).join(" · ") : "비어 있음";
}
function renderTtList() {
  const cur = curTt();
  // 시간표 행: 이름(태그 대표)과 메타, 행 끝 ⋯ 가 시간표 메뉴 팝업을 연다(10/30 오후 사용자: "시간표 옵션은 그냥 창으로 띄우고". 그 전에는 행 아래에 펼쳤고 단추는
  // 학기 머리와 같은 펼침 꺾쇠였다: "시간표 메뉴도 ... 위아래 꺾쇠로 동일하게". 펼치지 않으니 꺾쇠 대신 ⋯). 지금 보는 시간표에는 체크를 두지 않는다(10/30 오후 사용자:
  // "체크표시랑 아래 꺾쇠 같이 있으니까 별로임. 걍 체크는 빼는 게 나아 보임". 머리 줄이 지금 시간표를 보인다. 스크린리더는 aria-current).
  // 다른 학기의 행(sem): 누르면 그 학기로 바꾸고 그 시간표를 보인다. ⋯ 는 그 학기로 바꾼 뒤 메뉴를 연다(시간표를 바꾸는 일은 지금 학기 것만 한다)
  const ttRow = (t, sem) => {
    const on = !sem && t.id === cur.id, tag = t.primary ? h("span", { class: "tag" }, "대표") : null;
    return h("li", { class: "tl-item" }, h("div", { class: "tl-line" },
      h("button", { type: "button", class: "tt-row", "data-tt": t.id, "data-sem": sem || null, "aria-current": on ? "true" : null },
        h("span", { class: "it" }, h("span", { class: "nm" }, h("span", {}, t.title), tag), h("span", { class: "mt" }, ttMeta(t)))),
      h("button", { type: "button", class: "icon-btn tl-more", "data-tt-more": t.id, "data-sem": sem || null, "aria-label": `${t.title} 메뉴`, "aria-haspopup": "dialog" },
        icon(I.more, 24))));
  };
  const group = (sem) => {
    const open = tlSems.has(sem), here = sem === mine.sem, gid = `tl-sem-${uid(sem)}`;
    const head = h("button", { type: "button", class: "tl-sem-head", "data-sem-toggle": sem, "aria-expanded": String(open), "aria-controls": open ? gid : null },
      h("span", {}, semesterLabel(sem)), icon(I.down, 20));
    if (!open) return h("li", { class: "tl-sem" }, head);
    const list = here ? (shownTts().length ? shownTts() : [cur]) : T.parseList(store.get(semKey(T.STORE_KEYS.list, sem), []), sem).filter((t) => !t._newer);
    return h("li", { class: "tl-sem is-open" }, head, h("ul", { class: "tl-tts", id: gid, "aria-label": semesterLabel(sem) }, list.map((t) => ttRow(t, here ? null : sem))));
  };
  const groups = tlSemesters().map(group);
  // 목록 맨 아래 + 새 시간표 하나(10/23 저녁 사용자가 옆의 '이미지 불러오기'를 항목 목록의 '이미지로 추가'로 옮겼다: "그 시간표 거기서는 빼버리고"):
  // 학기와 이름을 고르는 팝업(아래 openNewTt)
  groups.push(h("li", { class: "tl-new" }, h("button", { type: "button", class: "menu-row add", "data-tt-new": "", "aria-haspopup": "dialog" }, icon(I.plus, 20), "새 시간표")));
  $("tl-rows").replaceChildren(...groups);
  for (const r of document.querySelectorAll('input[name="tt-color"]')) r.checked = r.value === ttColor;
}
/** 목록을 다시 그린 뒤 초점을 같은 자리에(selector 는 #tl-rows 안. 주지 않으면 그리기 전에 초점이 있던 것과 같은 일을 하는 요소) */
function refillTtList(focusSel) {
  const a = document.activeElement, keep = !focusSel && a && $("tl-rows").contains(a) ? ttListSel(a) : null;
  renderTtList();
  const sel = focusSel || keep;
  if (sel) $("tl-rows").querySelector(sel)?.focus({ preventScroll: true });
}
const ttListSel = (el) => (["ttMore", "tt", "ttNew", "semToggle"].map((k) => [k, el.dataset[k]]).filter(([, v]) => v !== undefined)
  .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${CSS.escape(v)}"]`)[0] || null);
const ttById = (id) => (id ? mine.list.find((x) => x.id === id) : curTt().virtual ? curTt() : null) || null;
/** 이름 바꾸기: 비우거나 그대로면 바꾸지 않는다. 같은 학기에 같은 이름이 있으면 '이름 (2)'부터(renamed). 빈 시간표 1이면 이때 만든다 */
function renameTt(id, raw) {
  const v = T.cleanTitle(raw);
  let t = ttById(id);
  if (!t || !v || v === t.title) return null;
  if (t.virtual) { t = T.createTimetable(mine.list, mine.sem); if (!t) return null; mine.list.push(t); mine.id = t.id; }
  const next = { ...t, title: renamed(v, t.id), updated: new Date().toISOString() };
  putTt(next, { select: false });
  renderMine();
  return next;
}
/** 목록에서 다른 학기의 것을 누르면 그 학기로 바꾼다(앱 전체의 학기. 탐색 학기 줄과 같다). 내 시간표는 바로 그 학기 것이 된다(편람은 이어서 받는다) */
function tlGoSem(sem) {
  if (!sem || sem === mine.sem) return;
  switchSemester(sem);
  tlSems.add(sem);
}
$("tl-rows").addEventListener("click", (e) => {
  const d = $("tt-list-sheet");
  const semHead = e.target.closest("[data-sem-toggle]");
  if (semHead) { // 학기 머리: 접고 편다(여럿을 펴 둘 수 있다)
    const sem = semHead.dataset.semToggle;
    if (tlSems.has(sem)) tlSems.delete(sem); else tlSems.add(sem);
    refillTtList(`[data-sem-toggle="${CSS.escape(sem)}"]`);
    return;
  }
  const more = e.target.closest("[data-tt-more]");
  if (more) {
    tlGoSem(more.dataset.sem);
    openTtOpts(more.dataset.ttMore);
    return;
  }
  const row = e.target.closest("[data-tt]");
  if (row) {
    tlGoSem(row.dataset.sem);
    if (row.dataset.tt) selectTt(row.dataset.tt);
    renderMine();
    closeSheet(d);
    return;
  }
  if (e.target.closest("[data-tt-new]")) openNewTt();
});
// ---- 새 시간표 팝업(10/30 사용자: "다른 학기의 시간표를 만들 수가 없음", 이어 "걍 새 시간표 추가할 때 학기랑 시간표 이름 선택하는 창을 하나 띄워주자").
// 시간표 목록 맨 아래 + 새 시간표가 연다. 묻는 팝업과 같은 가운데 팝업(시트 위에 시트를 띄우지 않으므로 목록 시트는 닫히고, 닫으면 초점은 머리 줄 시간표 고르기로).
// 학기(연도·학기 선택칸, 처음은 지금 학기. 편람이 있는 모든 학기)와 이름(처음은 그 학기의 '시간표 n', 고치지 않았으면 학기를 바꿀 때 따라 바뀐다. 비우면 '시간표 n'),
// [닫기] [만들기]. 만들면 그 학기(다르면 앱 전체의 학기를 바꾼다)에 만들어 바로 보인다. 같은 이름이 있으면 뒤에 ' (2)'부터(T.createTimetable). 50개면 만들지 않고 팝업 안 오류 줄
let tnEdited = false;
const tnSem = () => ($("tn-year").hidden ? mine.sem : `${$("tn-year").value}-${$("tn-term").value}`);
const tnList = (sem) => (sem === mine.sem ? mine.list : T.parseList(store.get(semKey(T.STORE_KEYS.list, sem), []), sem));
function tnError(text) {
  $("tn-error").hidden = !text;
  $("tn-error").textContent = text || "";
  if (text) $("tn-make").setAttribute("aria-describedby", "tn-error"); else $("tn-make").removeAttribute("aria-describedby");
}
function tnSemChanged() {
  tnError(null);
  if (!tnEdited) $("tn-name").value = T.nextTitle(tnList(tnSem()));
}
function openNewTt() {
  fillTerm($("tn-year"), $("tn-term"), mine.sem || state.semester);
  tnEdited = false;
  tnSemChanged();
  openSheet($("tt-new"), $("tt-switch"));
}
$("tn-year").addEventListener("change", () => {
  const term = termInYear($("tn-year").value, tnSem());
  if (term) fillTerm($("tn-year"), $("tn-term"), `${$("tn-year").value}-${term}`);
  tnSemChanged();
});
$("tn-term").addEventListener("change", tnSemChanged);
$("tn-name").addEventListener("input", () => { tnEdited = true; tnError(null); });
$("tn-name").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  makeNewTt();
});
$("tn-make").addEventListener("click", makeNewTt);
function makeNewTt() {
  const sem = tnSem(), title = $("tn-name").value;
  if (!T.createTimetable(tnList(sem), sem, { title })) { // 50개: 학기를 바꾸지 않고 팝업 안에서 알린다
    tnError(FULL_TEXT);
    announce(FULL_TEXT, "alert");
    return;
  }
  if (sem !== mine.sem) switchSemester(sem); // 내 시간표는 바로 그 학기 것이 된다(편람은 이어서 받는다)
  const t = T.createTimetable(mine.list, mine.sem, { title });
  if (!t) return;
  putTt(t);
  renderMine();
  closeSheet($("tt-new"));
}
// ---- 시간표 메뉴 팝업(10/30 오후 사용자: "시간표 옵션은 그냥 창으로 띄우고". 그 전에는 목록의 행 아래에 펼쳤다): 목록 시트 행마다 ⋯ 가 연다. 묻는 팝업과 같은 가운데 팝업이고
// 시트 위에 시트를 띄우지 않으므로 목록 시트는 닫힌다. 닫기·바깥 누르기·Esc·뒤로 가기로 닫으면 목록 시트로 돌아간다(펼쳐 둔 학기 그대로, 초점은 그 시간표의 ⋯).
// 지우기와 앱의 사진 저장은 팝업을 닫고 스낵바를 보인다(목록으로 돌아가지 않는다).
// 머리는 태그(대표)·학기·메타와 이름 입력칸(이름이 곧 입력칸이다. 10/30 사용자: 행의 이름과 입력칸을 "하나로 합치는 게 좋을 것 같고, 이름 수정하는 란이라는 게 좀 더
// 잘 드러났으면", "대표나 과목 수 같은 건 제목 위로". Enter·다른 곳을 누르면 바꾸고, Esc 는 고치던 것을 원래 이름으로), 그 아래 복사하기·대표 시간표로 설정하기(대표가
// 아닌 시간표에만. 10/23 사용자: "'대표에서 빼기' 이거 없애고, 걍 대표 시간표가 아닌 시간표 메뉴에 '대표 시간표로 설정하기' 이거 넣어". 대표는 학기마다 늘 하나:
// 처음 만든 시간표가 대표이고 대표를 지우면 남은 것 중 하나가 대표다)·이미지로 저장·지우기, [닫기]. 복사하면 팝업은 사본을 가리킨다(이어서 이름을 바꿀 수 있게).
// 아직 만들지 않은 빈 시간표 1은 이름 칸만(이름을 바꾸면 만들어진다)
let toId = null, toBack = false; // 팝업이 가리키는 시간표 id(아직 만들지 않은 빈 시간표 1은 ""), 닫으면 목록 시트로 돌아가나
const ttOpts = $("tt-opts");
$("to-name").after(icon(I.edit, 20)); // 연필: 누르는 것이 아니라 고칠 수 있다는 표시(입력 중에는 숨긴다)
function toError(text) {
  $("to-error").hidden = !text;
  $("to-error").textContent = text || "";
}
/** 팝업 내용(태그·학기·메타, 이름, 메뉴 줄). focusSel 이 있으면 다시 그린 뒤 그 메뉴 줄에 초점 */
function renderTtOpts(focusSel) {
  const t = ttById(toId);
  if (!t) return;
  $("to-title").textContent = `${t.title} 메뉴`;
  $("to-meta").replaceChildren(...(t.primary ? [h("span", { class: "tag" }, "대표")] : []), h("span", {}, `${semesterLabel(mine.sem)} · ${ttMeta(t)}`));
  if (document.activeElement !== $("to-name")) $("to-name").value = t.title;
  const acts = TT_ACTS.filter(([k]) => !t.virtual && (k !== "primary" || !t.primary) && (k !== "save-image" || (t.items.length && canSaveImage())));
  if (acts.some(([k]) => k === "save-image")) preparedImage(t).catch(() => null); // 열 때 미리 그려 둔다(누르면 바로 저장한다)
  $("to-acts").replaceChildren(...acts.map(([k, text]) => h("li", {}, h("button", { type: "button", class: k === "delete" ? "menu-row danger" : "menu-row", "data-tt-act": k,
    "aria-describedby": k === "copy" && !$("to-error").hidden ? "to-error" : null }, text))));
  $("to-acts").hidden = !acts.length;
  if (focusSel) $("to-acts").querySelector(focusSel)?.focus({ preventScroll: true });
}
function openTtOpts(id) {
  toId = id;
  toBack = false;
  toError(null);
  renderTtOpts();
  openSheet(ttOpts, $("tt-switch")); // 목록 시트는 닫힌다
}
/** 메뉴 줄의 일. 복사하기·대표는 팝업을 그대로 두고 다시 그린다. 지우기는 팝업을 닫는다(스낵바의 되돌리기) */
function ttOptsAct(k) {
  const t = ttById(toId);
  if (!t) return;
  if (k === "copy") { // '시간표 1 (2)'처럼 번호를 붙인 사본(T.copyTimetable). 사본이 보는 시간표가 되고 팝업도 사본을 가리킨다
    const c = T.copyTimetable(t, mine.list);
    if (!c) {
      toError(FULL_TEXT);
      renderTtOpts('[data-tt-act="copy"]');
      announce(FULL_TEXT, "alert");
      return;
    }
    putTt(c);
    renderMine();
    toId = c.id;
    toError(null);
    renderTtOpts('[data-tt-act="copy"]');
    announce("복사했어요");
  } else if (k === "primary") { // 학기에 대표는 하나다: 이 시간표가 대표가 되고 전 대표는 대표가 아니다. 그 줄은 사라지므로 초점은 바로 아래 줄로
    mine.list = T.setPrimary(mine.list, t.id);
    saveMine();
    renderMine();
    renderTtOpts($("to-acts").querySelector('[data-tt-act="save-image"]') ? '[data-tt-act="save-image"]' : '[data-tt-act="delete"]');
    announce("대표 시간표로 설정했어요");
  } else if (k === "delete") { toBack = false; closeSheet(ttOpts); deleteTt(t); }
  else if (k === "save-image") imageAct(k, t, ttOpts);
}
$("to-acts").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tt-act]");
  if (b) ttOptsAct(b.dataset.ttAct);
});
// 이름 입력칸: Enter 나 다른 곳을 누르면(change) 바꾼다. 비우면 원래 이름. Esc 는 고치던 것을 원래 이름으로 되돌리고(팝업은 닫지 않는다), 고친 것이 없으면 팝업을 닫는다
function commitToName() {
  const input = $("to-name"), t = ttById(toId);
  const done = renameTt(toId, input.value);
  if (!done) { if (t) input.value = t.title; return null; }
  toId = done.id; // 빈 시간표 1이면 이때 만들어져 id 가 생긴다
  input.value = done.title;
  renderTtOpts();
  announce("이름을 바꿨어요");
  return done;
}
$("to-name").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const t = ttById(toId);
    if (t && e.target.value !== t.title) { e.preventDefault(); e.stopPropagation(); e.target.value = t.title; e.target.select(); }
    return;
  }
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  commitToName();
});
$("to-name").addEventListener("change", commitToName);
// 닫기·바깥 누르기·Esc·뒤로 가기(cancel)로 닫으면 목록 시트로 돌아간다. 화면이 바뀌어 닫히거나(뒤로 가기 기록) 지우기·사진 저장으로 닫히면 돌아가지 않는다
ttOpts.addEventListener("cancel", () => { toBack = true; });
ttOpts.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) { toBack = true; return; }
  if (e.target !== ttOpts) return;
  const r = ttOpts.getBoundingClientRect();
  if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) toBack = true;
});
ttOpts.addEventListener("close", () => {
  if (ttOpts.open || !toBack) return;
  toBack = false;
  const id = toId;
  renderTtList();
  openSheet($("tt-list-sheet"), $("tt-switch"));
  (($("tl-rows").querySelector(`[data-tt-more="${CSS.escape(id || "")}"]`)) || $("tl-rows").querySelector("[data-tt-more]"))?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- 시간표 이미지(디자인 75판 '시간표 이미지', 컴포넌트 TimetableImage. 10/23 사용자: "시간표 이미지로 내보내는
// 기능도 만들어 줘", "그 이미지에 … 시간표 정보를 지문처럼 … 파일 자체에"). 목록 시트 ⋯ 의 이미지로 저장, 머리 줄 공유의 이미지로 공유,
// 항목 목록 맨 아래 이미지로 추가(10/23 저녁 사용자가 '이미지 보내기'·'이미지 불러오기'를 옮겼다).
// 자료는 그림에 보이지 않고 PNG 파일 안의 글 조각(iTXt)에 들어간다(백엔드 timetables.js 의 addTimetableToPng·readTimetableImage·timetableFromImage. 메모는 빠진다).
// 그림(디자인 79판, 10/23 저녁 사용자: "비율 이상함 … 어느 플랫폼에서나 항상 같은 이미지", "디자인 형태는 지금 괜찮음 … 비율이랑 글자 크기만 잘 조절해봐", 비율은 "9:16"):
// 늘 1080×1920 한 장. 화면 밖(.tt-export)에 그림 px 그대로(화면 폭·기기 배율·글자 크기와 상관없이) 판을 짜고(layoutExport) 칸 글자 단계를 고른 뒤(fitExport)
// 그 자리·색·글자를 캔버스로 옮겨 그린다(paintExport). 브라우저가 줄을 바꾼 그대로라 판과 같다.
// DOM 을 그림으로 바꾸는 SVG foreignObject 는 사파리에서 캔버스를 막아(내보낼 수 없게 된다) 쓰지 않는다
const EXPORT_W = 1080, EXPORT_H = 1920;
// 판의 수치(그림 px, 디자인 79판 '시간표 이미지'): 판 여백 위·좌우·아래, 학기 줄, 이름(두 줄까지), 격자 카드 안 여백, 요일 줄, 시간 축, 칸 사이, 아래 줄(색 풀이·시간 미정), 워드마크
const EX = { top: 60, side: 44, bottom: 44, semLh: 46, semGap: 4, nameLh: 80, nameGap: 32, padT: 22, padR: 14, padB: 28, padL: 6,
  dayH: 36, dayGap: 10, axis: 44, gap: 4, noteGap: 18, noteLh: 38, markGap: 40, mark: 60 };
// 칸 글자 단계 [과목명, 강의실, 칸 안 여백](줄 높이는 과목명 × 1.27, 강의실 × 1.3 을 반올림: 38·33, 34·30, 30·27, 28·25). 큰 것부터 맞는 단계 하나를 그림 전체에 쓴다
const EX_LEVELS = [[30, 25, 9], [27, 23, 9], [24, 21, 8], [22, 19, 6]];
const IMAGE_ICON = '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.8" r="1.6"/><path d="M20.5 15.5l-4.6-4.6-9.4 8.6"/>';
const FULL_TEXT = "시간표는 학기마다 50개까지 만들 수 있어요"; // 10/30 사용자: "50개까지 에요도 50개까지 만들 수 있어요로 바꿔줘"(그 전 "시간표는 학기마다 50개까지예요")
// 못 불러올 때의 오류 줄(readTimetableImage 의 problem)
const IMPORT_PROBLEM = {
  jpeg: "사진으로 보내져 시간표 자료가 빠졌어요. 파일로 받은 이미지를 고르세요.",
  "no-data": "시간표 자료가 없는 이미지예요",
  broken: "이미지 파일이 깨졌어요",
  "not-png": "PNG 이미지가 아니에요",
  newer: "새 버전 앱에서 만든 이미지예요",
};
/** 사진 저장이 되는 곳: 웹(파일로 내려받기)과 앱 연결이 된다고 알린 앱(사진). 앱은 앱 연결이 켤 때 플러그인에 물어 둔 값(TTW_APP.canSaveImage.
 *  백엔드 update63: 답이 오기 전에는 false, 보통 몇 ms 안에 온다. 디자인 79판 '모든 기기에 둔다': iOS·안드로이드 9 이하도 사진에 저장하게 백엔드에 요청했고
 *  그 앱 연결은 true 를 알린다. 그 전 앱 연결에서 그 기기들은 줄이 없다(공유 시트 안에 저장이 있다)). 그 값이 없는 옛 앱 연결이면 웹뷰 사용자 에이전트로
 *  안드로이드 10 이상인지 본다. 그래도 저장이 거절되면(UNSUPPORTED) 공유 시트로 간다 */
function canSaveImage() {
  if (!IN_APP) return true; // 웹·설치한 웹 앱
  const app = window.TTW_APP;
  if (app && "canSaveImage" in app) return !!app.canSaveImage;
  if (SHELL !== "android") return false;
  const v = /Android (\d+)/.exec(navigator.userAgent);
  return !v || Number(v[1]) >= 10;
}
/** 앱 연결의 공유 시트(TTW_APP.shareImage)를 쓸 수 있다: 앱 연결이 알려 준 값(canShareImage, update63), 그 값이 없는 옛 앱 연결은 shareImage 가 있으면 */
const appShares = () => { const app = IN_APP && window.TTW_APP; return !!app && ("canShareImage" in app ? !!app.canShareImage : !!app.shareImage); };
/** '2026년 2학기 시간표 1'(공유 제목), 파일 이름은 거기에 .png(파일 이름에 못 쓰는 글자는 _) */
const imageTitle = (t) => `${semesterLabel(t.sem)} ${t.title}`;
const imageFile = (t) => `${imageTitle(t).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")}.png`;
// 미리 그린 그림(시간표·테마·다크·칸 색이 같으면 다시 쓴다)
let imageCache = null;
function preparedImage(t) {
  const key = [t.id, t.updated, t.title, document.documentElement.dataset.theme || "", darkNow(), ttColor, state.loaded && state.semester === t.sem].join("|");
  if (!imageCache || imageCache.key !== key) imageCache = { key, png: timetablePng(t) };
  return imageCache.png;
}
/** 워드마크: 이벤트 테마는 흰 단색, 그 밖에는 보는 화면의 라이트·다크 판(화면의 .wordmark 와 같다. 테마 탭에서 고른 라이트·다크도 따른다) */
function exportWordmark() {
  if (document.documentElement.dataset.theme) return "icons/wordmark-white.svg";
  return darkNow() ? "icons/wordmark-dark.svg" : "icons/wordmark.svg";
}
/** 시간표 하나 → 자료를 넣은 PNG 바이트(Uint8Array). 1080×1920: 학기·학점 줄, 이름(두 줄까지), 격자 카드(남는 높이를 채운다), 교과구분별이면 색 풀이, 시간 미정 줄, 워드마크 */
async function timetablePng(t) {
  const entries = ttEntries(t), untimed = entries.filter((e) => !e.meetings.length);
  const sum = Math.round(T.credits(t) * 10) / 10, sem = semesterLabel(t.sem);
  const legend = ttColor === "cls" && entries.length
    ? h("div", { class: "ex-legend" }, CLS_GROUPS.map(([name, key]) => h("span", {}, h("span", { class: "dot", style: { background: `var(--cls-${key})` } }), name))) : null;
  const late = untimed.length ? h("p", { class: "ex-untimed" }, `시간 미정 · ${untimed.map((e) => courseName(e)).join(", ")}`) : null;
  const name = h("p", { class: "ex-name" }, t.title), card = h("div", { class: "ex-card" });
  const mark = h("img", { class: "ex-mark", alt: "", src: exportWordmark() });
  const art = document.documentElement.dataset.theme === "xmas" && !lowArt.matches ? h("img", { alt: "", src: SLEIGH_SRC }) : null; // 크리스마스 썰매 그림
  const root = h("div", { class: "tt-export", "aria-hidden": "true", inert: true },
    h("p", { class: "ex-sem" }, sum ? `${sem} · ${sum}학점` : sem), name, card, legend || late ? h("div", { class: "ex-notes" }, legend, late) : null, mark);
  document.body.append(root);
  try {
    await Promise.all([document.fonts ? document.fonts.ready : null, ...[mark, art].map((im) => (im && im.decode ? im.decode().catch(() => null) : null))]);
    layoutExport(root, entries, { name, card, legend: !!legend, late: !!late });
    root.dataset.level = String(fitExport(root));
    const pic = paintExport(root, art && art.complete && art.naturalWidth && exportSleighFits(root) ? art : null);
    const blob = await new Promise((res) => pic.toBlob(res, "image/png"));
    return blob ? T.addTimetableToPng(new Uint8Array(await blob.arrayBuffer()), t) : null;
  } finally {
    root.remove();
  }
}
/** 판 짜기(디자인 79판): 이름 줄 수에 따라 카드 위 끝, 아래 줄 수에 따라 카드 아래 끝이 정해지고 격자가 카드를 채운다(한 시간 = 격자 높이 ÷ 시간 수. 9~18시·이름 한 줄이면 162).
 *  요일과 시간 범위는 내 시간표와 같다(월–금, 토·일 항목이 있으면 그 요일. 9~18시, 더 이르거나 늦으면 정시로). 칸은 요일 칸 안에 위아래 2씩 띄우고, 겹치는 칸은 반씩 */
function layoutExport(root, entries, { name, card, legend, late }) {
  const lines = Math.min(2, Math.max(1, Math.round(name.getBoundingClientRect().height / EX.nameLh)));
  const head = EX.top + EX.semLh + EX.semGap + EX.nameLh * lines + EX.nameGap;
  const notes = (legend ? EX.noteGap + EX.noteLh : 0) + (late ? (legend ? EX.noteLh : EX.noteGap + EX.noteLh) : 0);
  const cardH = EXPORT_H - head - (EX.markGap + EX.mark + EX.bottom) - notes;
  const bodyH = cardH - EX.padT - EX.dayH - EX.dayGap - EX.padB;
  const blocks = [];
  for (const e of entries) for (const m of e.meetings) blocks.push({ e, m, half: "" });
  const days = [0, 1, 2, 3, 4];
  for (const { m } of blocks) if (!days.includes(m.day)) days.push(m.day);
  days.sort((a, b) => a - b);
  let h0 = 9, h1 = 18;
  for (const { m } of blocks) { h0 = Math.min(h0, Math.floor(m.start / 60)); h1 = Math.max(h1, Math.ceil(m.end / 60)); }
  const hours = h1 - h0, hp = bodyH / hours, n = days.length;
  const gridW = EXPORT_W - 2 * EX.side - EX.padL - EX.padR - EX.axis, cw = (gridW - (n - 1) * EX.gap) / n;
  card.style.top = `${head}px`;
  card.style.height = `${cardH}px`;
  const notesEl = root.querySelector(".ex-notes");
  if (notesEl) notesEl.style.top = `${head + cardH}px`;
  const body = h("div", { class: "ex-body", style: { height: `${bodyH}px` } });
  card.replaceChildren(h("div", { class: "ex-days", style: { "--days": String(n) } }, days.map((d) => h("span", {}, DAY_KO[d]))), body);
  for (let i = 0; i <= hours; i++) {
    body.append(h("div", { class: "ex-line", style: { top: `${i * hp - 1}px` } }));
    if (i < hours) body.append(h("span", { class: "ex-hour", style: { top: `${i * hp}px` } }, String(h0 + i)));
  }
  blocks.sort((a, b) => a.m.day - b.m.day || a.m.start - b.m.start || a.m.end - b.m.end);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = blocks[j], b = blocks[i];
      if (a.e !== b.e && meetsOverlap(a.m, b.m)) { if (!a.half) a.half = "left"; b.half = "right"; }
    }
  }
  for (const { e, m, half } of blocks) {
    const w = half ? (cw - EX.gap) / 2 : cw;
    const x = EX.axis + days.indexOf(m.day) * (cw + EX.gap) + (half === "right" ? w + EX.gap : 0);
    const room = e.item.custom ? (m.building ? buildingLabel(m.building) : "") : roomLabel(m);
    const bld = m.building ? buildingLabel(m.building) : room;
    body.append(h("div", { class: "ex-block", "data-min": String(m.end - m.start), style: {
      left: `${x}px`, top: `${((m.start - h0 * 60) / 60) * hp + EX.gap / 2}px`, width: `${w}px`, height: `${((m.end - m.start) / 60) * hp - EX.gap}px`, background: itemFill(e.item), ...itemInk(e.item) } },
    h("b", { "data-raw": e.item.custom ? e.item.title : shortName(courseName(e)) }), // 글은 단계마다 fitExportBlock 이 넣는다(끝 번호 붙이기가 글자 크기를 따른다)
    room ? h("i", { "data-full": room, "data-bld": bld }, room) : null));
  }
}
/** 칸 글자 단계 고르기(디자인 79판): 큰 단계부터 그려 보고 한 칸이라도 걸리면 한 단계 줄인다(22 에서도 걸리면 22). 걸리는 것: 어느 칸이든 과목명의 낱말 하나가 한 줄보다 길다,
 *  75분 이상인 칸에 과목명이 다 들어가지 않거나 강의실이 한 줄로 들어가지 않는다(위아래 여백을 4로 줄여 들어가면 들어간 것). 75분보다 짧은 칸은 단계를 고르는 데 넣지 않는다. → 고른 단계 번호 */
function fitExport(root) {
  const blocks = [...root.querySelectorAll(".ex-block")];
  const measure = document.createElement("canvas").getContext("2d");
  for (let k = 0; k < EX_LEVELS.length; k++) {
    const [ns, rs, bp] = EX_LEVELS[k], last = k === EX_LEVELS.length - 1;
    root.style.setProperty("--ns", `${ns}px`);
    root.style.setProperty("--nlh", `${Math.round(ns * 1.27)}px`);
    root.style.setProperty("--rs", `${rs}px`);
    root.style.setProperty("--rlh", `${Math.round(rs * 1.3)}px`);
    root.style.setProperty("--bp", `${bp}px`);
    let ok = true;
    for (const bk of blocks) {
      const r = fitExportBlock(bk, measure);
      if (r.broken || (!r.full && Number(bk.dataset.min) >= 75)) { ok = false; if (!last) break; }
    }
    if (ok || last) return k;
  }
  return EX_LEVELS.length - 1;
}
/** 칸 하나를 그 단계 글자로 맞춘다. 다 들어가지 않으면 이 차례로 줄인다: 위아래 여백 4 → 과목명 줄 수(마지막 줄 말줄임) → 강의실 건물만과 과목명 한 줄 → 과목명 한 줄만.
 *  → { full: 과목명이 다 들어가고 강의실이 한 줄, broken: 과목명의 낱말 하나가 한 줄보다 길다 } */
function fitExportBlock(bk, measure) {
  const b = bk.querySelector("b"), i = bk.querySelector("i");
  const fits = () => bk.scrollHeight <= bk.clientHeight + 0.5;
  const clamp = (n) => b.style.setProperty("-webkit-line-clamp", String(n));
  bk.classList.remove("is-tight");
  if (i) { i.style.display = ""; i.textContent = i.dataset.full; }
  b.style.setProperty("-webkit-line-clamp", "unset");
  b.style.display = "block";
  const bs = getComputedStyle(b), raw = b.dataset.raw ?? "";
  measure.font = `${bs.fontWeight} ${bs.fontSize} ${bs.fontFamily}`;
  // 끝 번호는 이 단계 글자 크기로 앞 낱말에 붙인다(glueTail). '낱말 하나가 한 줄보다 길다'는 붙이기 전 낱말로 잰다(디자인 84판: 번호 하나 때문에 그림 전체 글자가 작아지지 않게)
  b.textContent = glueTail(raw, b.clientWidth, (t) => measure.measureText(t).width);
  const need = Math.max(1, Math.round(b.scrollHeight / parseFloat(bs.lineHeight)));
  b.style.display = "";
  const broken = raw.split(" ").some((w) => measure.measureText(w).width > b.clientWidth + 0.5);
  const tries = [[false, "full", need], [true, "full", need]];
  for (let n = need - 1; n >= 1; n--) tries.push([false, "full", n], [true, "full", n]);
  if (i) tries.push([false, "bld", 1], [true, "bld", 1]);
  for (const [tight, room, n] of tries) {
    bk.classList.toggle("is-tight", tight);
    if (i) i.textContent = i.dataset[room];
    clamp(n);
    if (fits()) {
      const roomLines = i ? Math.round(i.getBoundingClientRect().height / parseFloat(getComputedStyle(i).lineHeight)) : 1;
      return { full: n === need && room === "full" && roomLines <= 1, broken };
    }
  }
  bk.classList.add("is-tight");
  clamp(1);
  if (i) i.style.display = "none";
  return { full: false, broken };
}
const clearColor = (c) => !c || c === "transparent" || /^rgba\(.*,\s*0\)$/.test(c);
function roundPath(g, x, y, w, hh, r) {
  r = Math.max(0, Math.min(r, w / 2, hh / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hh, r);
  g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const cornerOf = (cs, r) => { const v = cs.borderTopLeftRadius; return v.endsWith("%") ? (Math.min(r.width, r.height) * parseFloat(v)) / 100 : parseFloat(v) || 0; };
// 크리스마스 썰매 그림(디자인 88판 '시간표 이미지'·'썰매 그림'): 이름 오른쪽, 가운데 (760, 125), 돌리기 전 폭 415, 시계 방향 3°(그림 px)
const EX_SLEIGH = { x: 760, y: 125, w: 415, deg: 3 };
/** 썰매 그림이 학기 줄·이름의 글자와 8 넘게 떨어진다(이름이 길면 빠진다) */
function exportSleighFits(root) {
  const R = root.getBoundingClientRect(), box = sleighBox(R.left + EX_SLEIGH.x, R.top + EX_SLEIGH.y, EX_SLEIGH.w, EX_SLEIGH.deg), span = document.createRange();
  return ![".ex-sem", ".ex-name"].some((sel) => {
    span.selectNodeContents(root.querySelector(sel));
    return [...span.getClientRects()].some((q) => nearBox(box, q));
  });
}
/** 화면 밖 판(그림 px 그대로 1080×1920)을 캔버스로: 바탕(이벤트 테마는 무늬 점까지), 썰매 그림(art, 크리스마스), 요소마다 바탕색·둥근 모서리·잘림, 그림(워드마크),
 *  글자(한 글자씩 판의 그 자리에) */
function paintExport(root, art = null) {
  const R = root.getBoundingClientRect(), k = EXPORT_W / R.width;
  const pic = h("canvas", { width: EXPORT_W, height: EXPORT_H });
  const g = pic.getContext("2d");
  g.scale(k, k);
  g.translate(-R.left, -R.top);
  g.fillStyle = getComputedStyle(root).backgroundColor;
  g.fillRect(R.left, R.top, R.width, R.height);
  // 이벤트 테마의 땡땡이: 앱 무늬(style.css --bg-pattern: 16×28 칸 가운데 점과 (8, 14) 옮긴 점, 지름 5)의 3배(48×84 칸, 지름 15. 디자인 79판). 대비를 높인 기기는 무늬가 없다
  const doc = getComputedStyle(document.documentElement);
  if (document.documentElement.dataset.theme && doc.getPropertyValue("--bg-pattern").trim() !== "none") {
    g.fillStyle = doc.getPropertyValue("--bg-tone").trim();
    for (let m = 0; m * 42 <= R.height + 42; m++) {
      for (let x = m % 2 ? 24 : 0; x <= R.width + 48; x += 48) { g.beginPath(); g.arc(R.left + x, R.top + m * 42, 7.5, 0, Math.PI * 2); g.fill(); }
    }
  }
  if (art) {
    const w = EX_SLEIGH.w, hh = (w * 92) / 286;
    g.save();
    g.translate(R.left + EX_SLEIGH.x, R.top + EX_SLEIGH.y);
    g.rotate((EX_SLEIGH.deg * Math.PI) / 180);
    g.drawImage(art, -w / 2, -hh / 2, w, hh);
    g.restore();
  }
  paintKids(g, root);
  // 알파 없는 PNG(디자인 규칙 '시간표 이미지'): 다 그린 판을 불투명 캔버스로 옮겨 RGB 로 내보낸다. 처음부터 불투명 캔버스에 그리면
  // 크롬이 글자를 LCD 방식(색 번짐)으로 그려 기기 설정마다 그림이 달라진다. 옮긴 뒤 처음 캔버스는 비운다(iOS 캔버스 메모리)
  const flat = h("canvas", { width: EXPORT_W, height: EXPORT_H });
  flat.getContext("2d", { alpha: false }).drawImage(pic, 0, 0);
  pic.width = pic.height = 0;
  return flat;
}
function paintKids(g, el) {
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) { paintText(g, n); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = n.getBoundingClientRect(), rad = cornerOf(cs, r);
    g.save();
    if (Number(cs.opacity) < 1) g.globalAlpha *= Number(cs.opacity);
    // 이벤트 테마의 색 풀이 판: 둘레 3px 를 바탕색으로(box-shadow 0 0 0 3px)
    const plate = /^(rgba?\([^)]*\)) 0px 0px 0px ([\d.]+)px$/.exec(cs.boxShadow);
    if (plate) { const sp = Number(plate[2]); g.fillStyle = plate[1]; roundPath(g, r.left - sp, r.top - sp, r.width + sp * 2, r.height + sp * 2, rad + sp); g.fill(); }
    if (!clearColor(cs.backgroundColor)) { g.fillStyle = cs.backgroundColor; roundPath(g, r.left, r.top, r.width, r.height, rad); g.fill(); }
    if (n instanceof HTMLImageElement && n.complete && n.naturalWidth) g.drawImage(n, r.left, r.top, r.width, r.height);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") { roundPath(g, r.left, r.top, r.width, r.height, rad); g.clip(); }
    paintKids(g, n);
    g.restore();
  }
}
/** 글자: 글자마다 화면의 자리(Range)에 그린다. 줄 수를 넘어 감춘 과목명(-webkit-line-clamp)은 마지막 줄 끝에 말줄임 */
function paintText(g, node) {
  const text = node.data, el = node.parentElement;
  if (!el || !text.trim()) return;
  const cs = getComputedStyle(el);
  g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  g.fillStyle = cs.color;
  g.textBaseline = "alphabetic";
  const fm = g.measureText("가");
  const ascent = fm.fontBoundingBoxAscent ?? fm.actualBoundingBoxAscent;
  const span = document.createRange(), box = el.getBoundingClientRect();
  const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none" ? box.bottom - parseFloat(cs.paddingBottom) : Infinity;
  const glyphs = [];
  for (let i = 0; i < text.length;) {
    const len = text.codePointAt(i) > 0xffff ? 2 : 1, ch = text.slice(i, i + len);
    if (ch.trim()) {
      span.setStart(node, i);
      span.setEnd(node, i + len);
      const rc = span.getClientRects()[0];
      if (rc && rc.width) glyphs.push({ ch, x: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom });
    }
    i += len;
  }
  let shown = glyphs.filter((q) => q.bottom <= clamp + 0.5);
  if (shown.length && shown.length < glyphs.length) {
    const lastTop = shown[shown.length - 1].top, ell = g.measureText("…").width, right = box.right - parseFloat(cs.paddingRight);
    while (shown.length > 1 && shown[shown.length - 1].top === lastTop && shown[shown.length - 1].right + ell > right + 0.5) shown.pop();
    const last = shown[shown.length - 1];
    shown = [...shown, { ch: "…", x: last.right, top: last.top }];
  }
  for (const q of shown) g.fillText(q.ch, q.x, q.top + ascent);
}
/** 이미지로 저장(목록 시트 ⋯)·이미지로 공유(공유 시트). 앱: 사진에 저장(스낵바 '사진에 저장했어요'. 스낵바가 보이게 시트는 닫는다)·공유 시트.
 *  저장하지 못하면(디자인 79판, 앱 연결과 맞춘 꼴은 saveFailed) 시트를 닫고 스낵바, 앱 연결이 못 한다고 하면(UNSUPPORTED: 옛 앱 연결) 공유 시트로.
 *  웹: 파일로 내려받기(브라우저가 알린다)·공유 시트(navigator.share. 파일을 못 보내는 브라우저는 내려받기). 공유를 마치면(앱은 공유 시트를 띄우면)
 *  누른 시트(sheet)를 닫는다. 기기의 공유 시트를 그냥 닫았으면 그대로 둔다 */
async function imageAct(k, t, sheet) {
  let bytes = null;
  try { bytes = await preparedImage(t); } catch { bytes = null; }
  if (!bytes) { announce("이미지를 만들지 못했어요", "alert"); return; }
  const name = imageFile(t), title = imageTitle(t), app = window.TTW_APP;
  if (k === "save-image" && !IN_APP) { downloadPng(bytes, name); return; }
  if (k === "save-image" && app && app.saveImage) {
    try {
      await app.saveImage({ bytes, name });
      closeSheet(sheet);
      showSnackbar("사진에 저장했어요");
      return;
    } catch (e) {
      if (!e || e.code !== "UNSUPPORTED") { closeSheet(sheet); saveFailed(e, t); return; }
    }
  }
  if (appShares() && app.shareImage) {
    try { await app.shareImage({ bytes, name, title }); closeSheet(sheet); return; } catch (e) { if (!e || e.code !== "UNSUPPORTED") return; }
  }
  const file = new File([bytes], name, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); closeSheet(sheet); } catch { /* 닫았다 */ }
    return;
  }
  downloadPng(bytes, name);
  if (k !== "save-image") closeSheet(sheet);
}
/** 앱이 사진에 저장하지 못했다(디자인 79판 '문구'). 앱 연결 TTW_APP.saveImage 의 거절 code: "DENIED"(사진 접근을 허락하지 않았다. 다시 묻지 않는 것도)는
 *  `사진 접근이 꺼져 있어요` [설정](TTW_APP.openSettings 가 앱의 설정 화면을 연다. 없는 앱 연결이면 버튼 없이), 그 밖은 `사진에 저장하지 못했어요` [다시 시도](그 시간표를 다시 저장) */
function saveFailed(e, t) {
  const app = window.TTW_APP;
  if (e && e.code === "DENIED") {
    const open = app && typeof app.openSettings === "function" ? () => Promise.resolve().then(() => app.openSettings()).catch(() => null) : null;
    showSnackbar("사진 접근이 꺼져 있어요", open ? "설정" : "", open);
    return;
  }
  showSnackbar("사진에 저장하지 못했어요", "다시 시도", () => {
    const cur = mine.list.find((x) => x.id === t.id) || t; // 그사이 이름을 바꿨으면 바뀐 것으로
    imageAct("save-image", cur, null);
  });
}
function downloadPng(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const a = h("a", { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------- 받은 시간표 넣기(이미지로 추가, 시간표 링크)
// 10/23 저녁 사용자: 이미지로 추가는 "해당 시간표의 학기에 새로운 시간표로 추가. 알림창으로 ~~학년도 ~~학기로 이동하였어요. 이런 느낌."
// 그 학기에 새 시간표로 넣고(이름이 겹치면 ' (2)'부터) 내 시간표 탭에서 그것을 보인다. 다른 학기면 그 학기로 옮기고 스낵바 '2026년 1학기로 이동했어요',
// 같은 학기면 '시간표를 추가했어요'. 받은 이름·과목명·일정 이름은 남이 만든 파일·링크의 글이라 화면에 글로만 넣는다(h() 는 텍스트 노드로 넣는다. 10/23 법무)
const SEM_ID = /^\d{4}-[12SW]$/;
let itemsErrFor = ""; // 항목 목록 아래 오류 줄을 띄운 때의 '학기|시간표'(다른 시간표로 바뀌면 거둔다)
/** 항목 목록 아래 오류 줄(이미지로 추가를 못 했다)을 띄우거나(글) 거둔다(null). 이미지로 추가 버튼이 그 줄을 가리킨다 */
function itemsError(text) {
  const p = $("items-error");
  p.hidden = !text;
  if (text) p.textContent = text;
  itemsErrFor = text ? `${mine.sem}|${curTt().id}` : "";
  const b = $("items").querySelector('[data-add="image"]');
  if (b && text) b.setAttribute("aria-describedby", "items-error");
  else if (b) b.removeAttribute("aria-describedby");
  // 폰은 목록 끝이 하단 바 바로 위라 새 줄이 바 밑에 생긴다: 보이게 올린다(html 의 scroll-padding-bottom 이 바 높이)
  if (text) p.scrollIntoView({ block: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
}
/** 받은 자료(이미지에 넣는 꼴: T.imagePayload)를 그 학기에 새 시간표로 넣는다. → { t, sem, same } 또는 null(그 학기가 꽉 찼다) */
function addReceived(payload) {
  const sem = payload.sem, same = sem === mine.sem;
  const list = same ? mine.list : T.parseList(store.get(semKey(T.STORE_KEYS.list, sem), []), sem);
  const t = T.timetableFromImage(payload, list);
  if (!t) return null;
  if (same) putTt(t);
  else {
    store.set(semKey(T.STORE_KEYS.list, sem), T.serialize([...list, t]));
    store.set(semKey(T.STORE_KEYS.current, sem), t.id); // 그 학기를 열면 이 시간표가 보인다
  }
  return { t, sem, same };
}
let afterPop = null; // 정보에서 내 시간표 탭으로 기록을 되돌린 뒤 할 일(popstate)
/** 내 시간표 탭으로 가서(이미 거기면 그대로) then 을 부른다. 다른 탭에 쌓아 둔 과목 추가 화면은 거두고 첫 화면으로 */
function goMine(then) {
  if (tab === "mine") { then(); return; }
  stacks.mine.length = 1;
  if (tab === "info" && infoFrom === "mine") { afterPop = then; history.go(-(depth - infoBase + 1)); return; }
  switchTab("mine", then);
}
/** 넣은 시간표를 보인다(위 머리): 내 시간표 탭, 다른 학기면 그 학기로 옮긴다. 편람이 없는 학기(학기 목록에 없다)는 옮기지 못해 '…에 추가했어요'만 */
function showReceived({ sem, same }) {
  goMine(() => {
    if (same) { renderMine(); showSnackbar("시간표를 추가했어요"); return; }
    if (!state.semesters.some(([x]) => x === sem)) { showSnackbar(`${semesterLabel(sem)}에 추가했어요`); return; }
    switchSemester(sem);
    showSnackbar(`${semesterLabel(sem)}로 이동했어요`);
  });
}
/** 이미지로 추가(항목 목록 맨 아래): PNG 안의 시간표 자료(T.readTimetableImage)를 그 학기에 새 시간표로. 못 하면 항목 목록 아래 오류 줄 */
$("tt-file").addEventListener("change", async () => {
  const input = $("tt-file"), f = input.files && input.files[0];
  input.value = ""; // 같은 파일을 다시 골라도 알게
  if (!f) return;
  const fail = (text) => { itemsError(text); announce(text, "alert"); };
  let bytes;
  try { bytes = new Uint8Array(await f.arrayBuffer()); } catch { fail(IMPORT_PROBLEM.broken); return; }
  const r = T.readTimetableImage(bytes);
  if (r.problem) { fail(IMPORT_PROBLEM[r.problem] || IMPORT_PROBLEM.broken); return; }
  if (!SEM_ID.test(r.payload.sem)) { fail(IMPORT_PROBLEM.broken); return; }
  const got = addReceived(r.payload);
  if (!got) { fail(FULL_TEXT); return; }
  itemsError(null);
  showReceived(got);
});

// ---------------------------------------------------------------- 공유(10/23 저녁 사용자: "오른쪽 위에 공유(그 삼각형 느낌 일반적인 공유 버튼) 버튼 만들어서 누르면 카톡, 인스타
// 등등으로 공유할 수 있는 기능", "공유 옵션은 링크로 공유, 이미지로 공유 두 가지 기능", "링크로 공유 했을 때 어플이 있으면 어플 켜서 시간표 추가, 어플 없으면 웹으로
// 시간표 띄우는 기능"). 머리 줄 오른쪽 공유 버튼 → 공유 시트(링크로 공유 · 이미지로 공유). 링크는 기기의 공유 시트(웹 navigator.share, 앱 TTW_APP.shareLink),
// 못 쓰면 복사하고 스낵바 '링크를 복사했어요'. 받는 쪽: 앱은 바로 넣고(앱 연결이 열린 주소를 알려 준다), 웹은 '공유받은 시간표' 시트로 보여 주고 '내 시간표에 넣기'.
//
// 시간표 링크: <웹 앱 주소>#t=<글>. '#' 뒤는 서버로 가지 않는다(웹 서버 기록·링크 미리 보기를 만드는 메신저 서버에 시간표가 가지 않는다).
// 글: 'z' + base64url(deflate-raw(JSON)), 압축을 못 하는 브라우저는 'j' + base64url(JSON).
// JSON: [판(1), 학기, 이름, 항목들]. 강좌 항목은 [교과목번호, 강좌번호, 색, 과목명, 바꾼 수업?]만 넣고 교수·학점·구분·편람 수업은 받는 쪽이 그 학기 편람에서 채운다
// (주소를 짧게: 다섯 과목이 200자 안팎. 이미지에 넣는 자료를 그대로 넣으면 600자쯤). 과목명은 받는 쪽 편람에 그 강좌가 없을 때 쓴다(없는 과목으로 남는다).
// 보내는 쪽 편람에 없는 강좌와 직접 넣은 일정은 이미지에 넣는 항목 그대로(객체). 메모는 넣지 않는다(이미지와 같다)
const LINK_VERSION = 1;
const LINK_BASE = "https://archi142857.github.io/tt-wizard/"; // 앱이 만드는 링크의 주소(웹 앱. 앱 연결의 TTW_APP.remote 가 있으면 그것)
const LINK_MAX = 64 * 1024; // 받은 글이 이보다 길면 읽지 않는다
const LINK_PROBLEM = {
  broken: "시간표 링크가 깨졌어요",
  newer: "새 버전 앱에서 만든 링크예요",
  old: "이 브라우저에서는 열 수 없는 링크예요",
};
const b64url = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
/** 바이트를 압축·풀기 스트림에 통과시킨다. max 를 넘게 나오면 멈추고 던진다(받은 링크의 압축 폭탄) */
async function pipeBytes(bytes, stream, max = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel().catch(() => null); throw new Error("too big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
/** 링크에 넣을 자료(위 머리의 JSON) */
function linkPayload(t) {
  const live = state.loaded && state.semester === t.sem ? state.byId : null;
  const items = t.items.map((raw) => {
    const it = { ...raw };
    delete it.memo;
    const c = !it.custom && live ? live.get(it.course) : null;
    if (!c || !c.sections.some((s) => s.no === it.no)) return it; // 직접 넣은 일정, 지금 편람에 없는 강좌(또는 편람을 받기 전): 그대로
    const x = [it.course, it.no, Number.isInteger(it.color) ? it.color : null, it.name];
    if (it.own) x.push(it.own);
    return x;
  });
  return [LINK_VERSION, t.sem, t.title, items];
}
/** 시간표 → 링크의 '#t=' 뒤 글 */
async function linkCode(t) {
  const bytes = new TextEncoder().encode(JSON.stringify(linkPayload(t)));
  if (typeof CompressionStream === "function") {
    try { return `z${b64url(await pipeBytes(bytes, new CompressionStream("deflate-raw")))}`; } catch { /* 압축 없이 */ }
  }
  return `j${b64url(bytes)}`;
}
/** 링크의 주소: 웹은 지금 연 주소(설치한 웹 앱도 같다), 앱은 웹 앱 주소(앱 안의 주소는 기기 안이라 남이 못 연다) */
function linkBase() {
  if (!IN_APP) return location.origin + location.pathname;
  const r = window.TTW_APP && window.TTW_APP.remote;
  return typeof r === "string" && /^https:\/\/[^/]+\/(.*\/)?$/.test(r) ? r : LINK_BASE;
}
/** 받은 글 → { link: {sem, title, items} } 또는 { problem } (LINK_PROBLEM 의 열쇠) */
async function readLinkCode(code) {
  if (typeof code !== "string" || code.length > LINK_MAX || !/^[zj][A-Za-z0-9_-]+$/.test(code)) return { problem: "broken" };
  if (code[0] === "z" && typeof DecompressionStream !== "function") return { problem: "old" };
  let data;
  try {
    let bytes = unb64url(code.slice(1));
    if (code[0] === "z") bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw"), 256 * 1024);
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { problem: "broken" };
  }
  if (!Array.isArray(data) || !Number.isInteger(data[0]) || data[0] < 1) return { problem: "broken" };
  if (data[0] > LINK_VERSION) return { problem: "newer" };
  const [, sem, title, items] = data;
  if (typeof sem !== "string" || !SEM_ID.test(sem) || !Array.isArray(items)) return { problem: "broken" };
  return { link: { sem, title: typeof title === "string" ? title : "", items } };
}
/** 그 학기의 강좌(id → 강좌). 지금 학기면 받아 둔 것, 아니면 그 학기 편람을 받는다(학기를 바꾸지 않는다). 학기 목록에 없으면 null */
async function coursesFor(sem) {
  await semReady;
  if (state.loaded && state.semester === sem) return state.byId;
  const entry = state.semesters.find(([x]) => x === sem);
  if (!entry) return null;
  let cj = state.cache.get(sem);
  if (!cj) { cj = await getJson(`data/${entry[1]}`); state.cache.set(sem, cj); }
  return new Map(parseCourses(cj).map((c) => [c.id, c]));
}
/** 받은 링크 → 이미지에 넣는 꼴의 자료(T.timetableFromImage 가 읽는다). 강좌 항목은 그 학기 편람으로 채우고, 편람에 없으면 과목명만 든 항목(없는 과목) */
async function linkToPayload(link) {
  const byId = link.items.some(Array.isArray) ? await coursesFor(link.sem).catch(() => null) : null;
  const items = [];
  for (const x of link.items) {
    if (!Array.isArray(x)) { if (x && typeof x === "object") items.push(x); continue; }
    const [course, no, color, name, own] = x;
    if (typeof course !== "string" || typeof no !== "string") continue;
    const c = byId && byId.get(course), s = c && c.sections.find((y) => y.no === no);
    const it = s ? T.sectionItem(c, s) : { course, no, name: typeof name === "string" && name ? name : course, instructor: "", credit: 0, cls: "", base: [] };
    if (Array.isArray(own)) it.own = own;
    if (Number.isInteger(color)) it.color = color;
    items.push(it);
  }
  return { app: "ttwizard", v: T.IMAGE_VERSION, sem: link.sem, title: link.title, items };
}

let shareTt = null, shareUrl = null; // 공유 시트를 연 시간표, 그 링크(Promise. 열 때 만들어 둔다: 웹의 공유는 누른 바로 그때만 된다)
function openShare(opener) {
  const t = curTt();
  if (!t.items.length) return;
  shareTt = t;
  shareUrl = linkCode(t).then((code) => `${linkBase()}#t=${code}`);
  shareUrl.catch(() => null);
  preparedImage(t).catch(() => null); // 이미지도 미리 그려 둔다
  $("sh-meta").textContent = `${semesterLabel(t.sem)} · ${t.title}`;
  openSheet($("share-sheet"), opener);
}
$("share-sheet").addEventListener("click", (e) => {
  const b = e.target.closest("[data-share]");
  if (!b || !shareTt) return;
  if (b.dataset.share === "link") shareByLink(shareTt);
  else imageAct("share-image", shareTt, $("share-sheet"));
});
/** 링크로 공유: 앱은 앱 연결의 공유 시트(TTW_APP.shareLink. 아직 없는 앱은 웹과 같은 길), 웹은 기기의 공유 시트(navigator.share). 둘 다 못 쓰면(컴퓨터 브라우저 등)
 *  복사하고 시트를 닫은 뒤 스낵바 '링크를 복사했어요'. 공유 시트를 그냥 닫았으면 공유 시트는 그대로 둔다 */
async function shareByLink(t) {
  const sheet = $("share-sheet"), title = imageTitle(t);
  let url = null;
  try { url = await shareUrl; } catch { url = null; }
  if (!url) { announce("링크를 만들지 못했어요", "alert"); return; }
  const app = IN_APP && window.TTW_APP;
  if (app && typeof app.shareLink === "function") {
    try { await app.shareLink({ url, title }); closeSheet(sheet); return; } catch (e) { if (!e || e.code !== "UNSUPPORTED") return; }
  }
  if (navigator.share) {
    try { await navigator.share({ title, url }); closeSheet(sheet); return; } catch (e) { if (e && e.name === "AbortError") return; } // 그 밖의 실패는 복사로
  }
  const ok = await copyText(url);
  closeSheet(sheet);
  showSnackbar(ok ? "링크를 복사했어요" : "링크를 복사하지 못했어요");
}
/** 글을 클립보드에: Clipboard API, 안 되면(앱 웹뷰 등) 잠깐 둔 입력칸을 골라 복사. 모달 시트 밖은 inert 라 그 칸은 열린 시트 안에 둔다 */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 아래 */ }
  const ta = h("textarea", { readonly: "", "aria-hidden": "true", style: { position: "fixed", top: "0", left: "-9999px", opacity: "0" } });
  ta.value = text;
  (document.querySelector("dialog[open]") || document.body).append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

// ---- 받는 쪽: 웹은 주소의 '#t=', 앱은 앱 연결이 알려 주는 주소(TTW_APP.launchUrl: 켤 때 연 주소의 Promise, 켜 둔 동안 열면 'ttw:open-url' 이벤트의 detail.url)
let shared = null; // 공유받은 시간표 시트에 보이는 것 { payload, t }
/** 받은 주소(또는 '#t=' 뒤 글)를 연다. 앱은 바로 넣고, 웹은 공유받은 시간표 시트 */
let lastLink = null; // 앱: 바로 넣은 링크와 그때(같은 주소가 켤 때 주소와 이벤트로 두 번 와도 한 번만 넣는다)
const LAUNCH_DONE = "ttw.launchLink"; // 앱: 켤 때 연 주소를 넣었다(sessionStorage. 웹뷰를 새로 열어도 launchUrl 이 같으면 다시 넣지 않는다)
async function receiveLink(code) {
  const r = await readLinkCode(code);
  await semReady; // 학기 목록과 보는 학기(mine.sem)가 정해진 뒤에
  if (r.problem) { showSnackbar(LINK_PROBLEM[r.problem]); return; }
  const payload = await linkToPayload(r.link);
  if (IN_APP) {
    if (reopening) return; // 기기 저장소를 되살려 새로 여는 중: 새로 연 뒤에 다시 받는다
    // 같은 주소가 켤 때 주소(launchUrl)와 이벤트(ttw:open-url)로 두 번 온다(안드로이드: Capacitor 가 켤 때의 intent 를 한 번 더 넘긴다. 10/30 백엔드).
    // 거르기는 기다린 뒤(위 await) 확인과 적기를 한 번에 하므로 둘이 같이 와도 하나만 넣고, 10초는 먼저 넣은 때부터 잰다
    if (lastLink && lastLink.code === code && Date.now() - lastLink.at < 10000) return;
    lastLink = { code, at: Date.now() };
    const got = addReceived(payload);
    if (!got) { showSnackbar(FULL_TEXT); return; }
    // 어느 길로 왔든 넣은 주소를 적어 둔다: 켤 때 주소가 이벤트보다 늦게 풀리거나 웹뷰를 새로 열어도 다시 넣지 않는다
    try { sessionStorage.setItem(LAUNCH_DONE, code); } catch { /* 못 적으면 다음에 새로 열 때 한 번 더 넣을 수 있다 */ }
    showReceived(got);
    return;
  }
  openShared(payload);
}
/** 바로가기 주소 → { tab, sem } 또는 null(10/30 백엔드: 홈 화면 위젯을 누르면 앱이 '…/tt-wizard/#tab=mine&sem=<학기>' 로 열린다. 웹에서 같은 주소를 열어도 같다:
 *  나중의 홈 화면 바로가기). tab 은 탭 이름(TABS)일 때만, sem 은 학기 꼴('2026-2')일 때만. 시간표 링크(#t=)는 linkCodeOf */
function navOf(url) {
  const hash = String(url || "").split("#")[1];
  if (!hash || !/(^|&)(tab|sem)=/.test(hash)) return null;
  const q = new URLSearchParams(hash), t = q.get("tab"), sem = q.get("sem") || "";
  const nav = { tab: TABS.includes(t) ? t : null, sem: /^\d{4}-[12SW]$/.test(sem) ? sem : null };
  return nav.tab || nav.sem ? nav : null;
}
/** 바로가기를 연다: 학기 목록을 받은 뒤 그 학기(편람이 있는 학기면. 앱 전체의 학기)로 바꾸고 그 탭으로(이미 그 탭이면 그 탭의 첫 화면) */
async function goNav(nav) {
  await semReady;
  if (nav.sem && nav.sem !== state.semester && state.semesters.some(([x]) => x === nav.sem)) switchSemester(nav.sem);
  if (nav.tab) switchTab(nav.tab);
}
/** 주소 → '#t=' 뒤 글(없으면 null). 메신저가 링크 끝에 붙여 넘긴 문장부호(')' '.' 등)는 글자 모양 밖이라 떼어 낸다 */
const linkCodeOf = (url) => { const m = /#(?:.*&)?t=([A-Za-z0-9_-]+)/.exec(String(url || "")); return m ? m[1] : null; };
/** 공유받은 시간표 시트(웹): 학기·이름·학점, 격자(누르지 않는다), 시간 미정 줄, '내 시간표에 넣기' */
function openShared(payload) {
  const t = T.timetableFromImage(payload, []); // 보이기만 한다(이름 겹침은 넣을 때 그 학기 목록으로 본다)
  if (!t) { showSnackbar(LINK_PROBLEM.broken); return; }
  shared = { payload, t };
  const entries = ttEntries(t), untimed = entries.filter((e) => !e.meetings.length);
  const sum = Math.round(T.credits(t) * 10) / 10;
  $("sd-meta").textContent = [semesterLabel(t.sem), t.title, sum ? `${sum}학점` : ""].filter(Boolean).join(" · ");
  $("sd-error").hidden = true;
  $("sd-add").removeAttribute("aria-describedby");
  const d = $("shared-sheet");
  openSheet(d, null);
  renderWeek(t, entries, clashKeys(entries), { box: $("sd-wk"), hourPx: 3.75 * remPx(), still: true }); // 시트가 열린 뒤 그린다(칸 폭을 잰다)
  $("sd-legend").hidden = ttColor !== "cls" || !entries.length;
  $("sd-untimed").hidden = !untimed.length;
  $("sd-untimed").textContent = untimed.length ? `시간 미정 · ${untimed.map((e) => courseName(e)).join(", ")}` : "";
}
$("sd-add").addEventListener("click", () => {
  if (!shared) return;
  const got = addReceived(shared.payload);
  if (!got) { // 그 학기가 꽉 찼다: 버튼 위 오류 줄(시트 안 알림 영역으로도 읽는다)
    $("sd-error").textContent = FULL_TEXT;
    $("sd-error").hidden = false;
    $("sd-add").setAttribute("aria-describedby", "sd-error");
    announce(FULL_TEXT, "alert");
    return;
  }
  shared = null;
  closeSheet($("shared-sheet"));
  showReceived(got);
});
// 칸 색(10/23 사용자: 정보 화면이 아니라 시간표 탭 안에): 고르면 바로 바뀐다
for (const r of document.querySelectorAll('input[name="tt-color"]')) {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    ttColor = r.value === "cls" ? "cls" : "item";
    store.set(T.STORE_KEYS.color, ttColor);
    renderMine();
  });
}

/** 지우기: 확인 없이 지우고 학기의 다른 시간표(대표, 없으면 맨 위)로 바꾼 뒤 스낵바 '시간표를 지웠어요' [되돌리기]. 마지막 하나를 지우면 빈 시간표 1 모습이 된다 */
function deleteTt(t) {
  const at = mine.list.findIndex((x) => x.id === t.id), sem = mine.sem, was = mine.id;
  mine.list = T.deleteTimetable(mine.list, t.id);
  if (curTt().id !== mine.id || was === t.id) mine.id = curTt().id;
  saveMine();
  if (tab !== "mine") stacks.mine.length = 1;
  mineChanged();
  syncSaves();
  announce("시간표를 지웠어요");
  showSnackbar("시간표를 지웠어요", "되돌리기", () => {
    if (mine.sem !== sem || mine.list.some((x) => x.id === t.id)) return;
    const list = mine.list.slice();
    list.splice(Math.min(at, list.length), 0, t);
    mine.list = t.primary ? T.setPrimary(list, t.id) : list;
    mine.id = was;
    saveMine();
    mineChanged();
    syncSaves();
  });
}

// ---- 개발자 메뉴(웹만. 10/24 사용자: "차라리 개발자 루트 같은 걸 만들어놓자", "21년도 1학기에서 저 과목 하나만을 시간표에 추가하고 동선 확인하기를 눌렀을 때
// 개발자 메뉴로 들어갈 수 있게 만들어줘. 테마라던지 이런 거 제한 없고 기능 같은 거 테스트 해볼 수 있는 메뉴로"): 2021년 1학기 시간표에 '신경계질환의 병인기작 및 약물 개발 전략'
// 001(806.508A) 하나만 넣고 동선 확인하기를 누르면 동선 탐색 대신 연다. 메뉴는 따로 된 파일 js/dev.js 이고 열 때만 불러온다(그리기·스타일 모두 그 파일 안).
// 스토어 앱에서는 열지 않는다(법무: 바이너리에 숨긴 기능은 Apple 2.5.19 의 앱 삭제·계정 해지 사유. dev.js 는 앱 묶음에서 빼게 백엔드에 요청했다)
const DEV_KEY = { sem: "2021-1", course: "806.508A", no: "001" };
const devKey = (t) => !IN_APP && mine.sem === DEV_KEY.sem && t.items.length === 1 && !t.items[0].custom
  && t.items[0].course === DEV_KEY.course && t.items[0].no === DEV_KEY.no;
let devMenu = null;
async function openDev(opener) {
  try {
    devMenu = devMenu || await import("./dev.js");
  } catch {
    showSnackbar("개발자 메뉴를 열지 못했어요", "다시 시도", () => openDev(opener));
    return;
  }
  devMenu.open(devApi(), opener);
}
/** 개발자 메뉴의 테마: 기간과 상관없이 고른다. 이벤트 테마는 시험으로 켜고(ttw.devTheme, 고른 것은 'xmas-test' 로 따로 기억해 실제 기간에 남지 않는다),
 *  기본·라이트·다크는 시험을 끄고 테마 탭에서 고를 때와 같다(실제 기간이면 돌아가기와 같다) */
function pickDevTheme(v) {
  if (THEMES.some(([id]) => id === v)) store.set("devTheme", v); else store.del("devTheme");
  const now = seasonTheme();
  if ((now ? now.event : "") !== (season ? season.event : "")) {
    if (themeOn()) applyTheme(false); // 시험 테마를 끄기 전에 그 모습부터 거둔다(아래에서 새 판단으로 다시 건다)
    season = now;
  }
  if (season && v === season.id) setTheme(true);
  else setScheme(v);
  renderThemes();
}
/** 개발자 메뉴가 쓰는 것: 그리기·시트·스낵바와 화면이 가진 값·동작 몇 가지(js/dev.js 는 이것만 본다) */
const devApi = () => ({
  h, icon, I, store, openSheet, closeSheet, wireSheet, showSnackbar,
  themes: [...SCHEMES.map(([id, name]) => [id, name]), ...THEMES.map(([id, name]) => [id, name])],
  theme: () => (themeOn() ? season.id : scheme),
  pickTheme: pickDevTheme,
  ask(opener) { // 묻는 팝업(이벤트 테마가 꺼져 있으면 시험으로 켠 뒤)
    if (!themeOn()) pickDevTheme(THEMES[0][0]);
    showAsk(opener);
  },
  forgetTheme() { store.del("themeOff"); store.del("themeAsked"); }, // 끈 테마·물어본 테마를 잊는다(묻는 팝업을 처음부터)
  update() { showSnackbar("새 버전이 있어요", "새로고침", () => location.reload()); announce("새 버전이 있어요"); },
  image: () => timetablePng(curTt()), // 지금 보는 시간표의 그림(PNG 바이트, 자료 조각까지)
  info() {
    let keys = [];
    try { keys = Object.keys(localStorage).filter((k) => k.startsWith("ttw.")); } catch { /* 못 읽으면 0 */ }
    const chars = keys.reduce((n, k) => n + k.length + (localStorage.getItem(k) || "").length, 0);
    return { version: APP_VERSION, shell: SHELL, sem: state.semester ? semesterLabel(state.semester) : "", courses: state.loaded ? state.courses.length : 0,
      updated: (state.semesterMeta && state.semesterMeta.updated) || "", sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      keys: keys.length, bytes: chars * 2 }; // localStorage 는 UTF-16
  },
  wipe() { // 이 기기의 기록(ttw.*)을 다 지우고 처음 켠 것처럼 다시 연다. 다시 열기 전 숨길 때 저장하는 것(담은 과목·스크롤)이 도로 쓰지 않게 막고 지운다
    reopening = true;
    for (const box of [localStorage, sessionStorage]) {
      try { for (const k of Object.keys(box)) if (k.startsWith("ttw.")) box.removeItem(k); } catch { /* 못 지운 것은 그대로 */ }
    }
    location.replace(location.pathname);
  },
});

/** 동선 확인하기(10/23 사용자: "동선 탐색에 넣기는 없애버리고 걍 동선 확인하기를 분반 정보 포함해서 동선탐색으로 보내"): 이 시간표의 과목을 그 분반만 켜서(다른 분반은 끈다)
 *  동선 탐색의 담은 과목으로 바꿔 넣고, 항목에서 바꾼 시간·장소(강의실 미정에 고른 건물 등, 항목의 own)는 탐색의 직접 입력으로 옮긴 뒤 동선 탐색 탭에서 시간표 만들기를 돌린다
 *  (켠 분반이 과목마다 하나라 조합은 이 시간표 하나다. 탐색의 조건·추가 설정은 그대로 쓴다: 맞는 조합이 없으면 입력 화면의 오류 줄). 전에 담아 둔 과목이 달랐으면
 *  결과 화면(조합이 없으면 입력 화면)에 되돌리기 스낵바. 직접 넣은 일정과 편람에서 사라진 과목·분반은 탐색에 담을 수 없어 빠진다 */
const canRoute = (t) => state.loaded && state.semester === mine.sem && t.items.some((it) => !it.custom && state.byId.get(it.course)?.sections.some((s) => s.key === T.itemKey(it)));
let afterResult = null; // 결과 화면이 뜬 뒤 할 일(동선 확인하기의 되돌리기 스낵바. showView 가 결과 화면을 그린 뒤 부른다)
function routeTt(t) {
  if (!canRoute(t) || busy) return;
  const picks = [], own = [];
  for (const it of t.items) {
    if (it.custom) continue;
    const c = state.byId.get(it.course), key = T.itemKey(it), s = c && c.sections.find((x) => x.key === key);
    if (!s) continue;
    picks.push({ id: c.id, excluded: new Set(c.sections.filter((x) => x.key !== key).map((x) => x.key)), ...snapshot(c) });
    own.push([s, it.own]);
  }
  const sig = (ps) => ps.map((p) => `${p.id}:${[...p.excluded].sort().join(",")}`).sort().join("|");
  const before = { picks: state.picks.map((p) => ({ ...p, excluded: new Set(p.excluded) })), overrides: JSON.parse(JSON.stringify(state.overrides)) };
  const replaced = before.picks.length > 0 && sig(before.picks) !== sig(picks);
  state.picks = picks;
  for (const [s, o] of own) { // 이 시간표의 분반은 이 시간표의 시간·장소로(바꾼 것이 없으면 편람대로)
    if (o && o.length) setOwn(s, o.map(([day, start, end, building, room]) => ({ days: [day], start, end, building, room })));
    else delete state.overrides[s.key];
  }
  changed();
  renderPicked();
  const undo = () => {
    state.picks = before.picks;
    state.overrides = before.overrides;
    changed();
    renderPicked();
    if (screen === "result") back(); // 결과는 바꿔 넣은 과목의 것이다
  };
  const snack = replaced ? () => showSnackbar("담은 과목을 이 시간표로 바꿨어요", "되돌리기", undo) : null;
  switchTab("explore", async () => {
    afterResult = snack;
    await run();
    if (afterResult && !state.result) { const f = afterResult; afterResult = null; f(); } // 조합이 없거나 못 만들었다: 입력 화면에서
  });
}

// ---- 항목 시트(과목): 과목 시트와 같은 시트. 머리(과목명, 메타, 겹친 과목을 뺐다는 줄), 강의평·수강편람, 색, 넣은 분반(시간·장소 바꾸기), 다른 분반(바꾸기),
// 시간표에서 빼기. 바꾼 것은 바로 저장된다. 닫으면 '편람 바뀜'을 본 것으로 친다(T.acknowledge)
const itemSheet = { tid: "", key: "", undo: null };
// 넣은 분반의 펼침과 입력 줄(과목 시트의 editState 와 같은 칸)
let itemEdit = null;
const newEdit = () => ({ wide: false, open: false, at: -1, days: [], sh: 9, sm: 0, eh: 10, em: 15, b: "", room: "", b0: "", room0: "", error: "" });

function openItem(key, opener) {
  const t = curTt(), it = t.items.find((x) => T.itemKey(x) === key);
  if (!it) return;
  if (it.custom) { openCustom(key, opener); return; }
  Object.assign(itemSheet, { tid: t.id, key, undo: null });
  itemEdit = newEdit();
  $("is-note").hidden = true;
  renderItemSheet();
  openSheet($("item-sheet"), opener);
}
/** 시트가 보는 항목: [시간표, 항목, 견준 것(ttEntries 의 하나), 지금 편람의 과목] */
function itemNow() {
  const t = mine.list.find((x) => x.id === itemSheet.tid);
  const it = t && t.items.find((x) => T.itemKey(x) === itemSheet.key);
  if (!it) return [];
  const e = ttEntries(t).find((x) => x.key === itemSheet.key);
  return [t, it, e, state.loaded ? state.byId.get(it.course) || null : null];
}
function renderItemSheet() {
  const [t, it, e, c] = itemNow();
  if (!it) return;
  $("is-title").textContent = c ? c.name : it.name;
  $("is-meta").textContent = [it.course, c ? c.dept : "", fmtCredit(c ? c.credit : it.credit)].filter(Boolean).join(" · ");
  $("is-review").href = reviewUrl(c ? c.name : it.name);
  setCatalogLink($("is-catalog"), it.course, it.no);
  const others = c ? c.sections.filter((s) => s.no !== it.no) : [];
  const alts = it.alts || [];
  others.sort((a, b) => (alts.includes(a.key) ? alts.indexOf(a.key) : alts.length) - (alts.includes(b.key) ? alts.indexOf(b.key) : alts.length));
  const cur = h("div", { class: "sec is-cur" });
  fillCurSec(cur, e);
  $("is-body").replaceChildren(...[
    ttColor === "item" ? h("fieldset", { class: "sheet-field" }, h("legend", { class: "field-label" }, "색"),
      h("div", { class: "swatches" }, colorNames().map((name, i) => h("label", {},
        h("input", { type: "radio", name: "is-color", value: String(i), checked: colorNo(it) === i, "aria-label": name }),
        // 체크는 그 색의 글자색(크리스마스의 짙은 원 위에서는 흰색)
        h("span", { class: "sw", style: { background: `var(--item-${i})`, color: `var(--item-${i}-fg)` } }, icon(I.check, 20)))))) : null,
    h("div", { class: "sheet-field item-secs" }, h("span", { class: "field-label" }, "넣은 분반"), cur),
    others.length ? h("div", { class: "sheet-field item-secs" },
      h("div", { class: "list-head" }, h("span", {}, `다른 분반 ${others.length}`)),
      h("ul", { class: "list secs" }, others.map((s) => otherSec(t, it, s)))) : null,
    h("div", { class: "sheet-foot" }, h("button", { type: "button", class: "btn-text", "data-act": "remove" }, "시간표에서 빼기"))].filter(Boolean));
}

/** 다른 분반 행: 번호(교수), 둘째 줄 시각·강의실, 태그(이 시간표의 다른 항목과 겹치면 '시간 겹침'), 오른쪽 '바꾸기' */
function otherSec(t, it, s) {
  const clash = T.overlapsWith(t, s.meetings, { except: T.itemKey(it), course: it.course, byId: state.byId }).length > 0;
  return secRow(s, clash, h("button", { type: "button", class: "btn-add", "data-act": "swap", "aria-label": `${sectionLabel(s)} 바꾸기${clash ? ", 시간 겹침" : ""}` }, "바꾸기"));
}
/** 분반 행(과목 추가 화면의 과목 시트, 항목 시트의 다른 분반): 번호(교수)와 오른쪽 버튼, 둘째 줄 '월·수 11:00~12:15 · 28동 103호', 태그 */
function secRow(s, clash, btn) {
  const groups = meetingGroups(s.meetings);
  const tags = [];
  if (clash) tags.push(["danger", "시간 겹침"]);
  if (s.status === "폐강대상") tags.push(["warning", "폐강 대상"]);
  if (!s.meetings.length || s.meetings.some((m) => !m.building)) tags.push(["", "미정"]);
  return h("li", { class: "sec", "data-key": s.key },
    h("div", { class: "sec-line" }, h("span", { class: "sec-title" }, s.no, h("span", { class: "prof" }, `(${instructorOf(s)})`)), btn),
    groups.length ? groups.map((g) => h("div", { class: "sec-when" }, h("span", {}, groupText(g)))) : h("div", { class: "sec-when" }, h("span", {}, "시간 미정")),
    tags.length ? h("div", { class: "tags", "aria-hidden": "true" }, tags.slice(0, 2).map(([k, x]) => h("span", { class: k ? `tag ${k}` : "tag" }, x))) : null);
}

/**
 * 넣은 분반: 006(한상미) / 수업마다 한 줄. 편람에 시간이 있으면 행 끝 펼침 화살표로 수업 칩(누르면 고치는 입력 줄, ×는 빼기), 시간 추가, 바꿨으면 편람 값과 되돌리기.
 * 과목 시트의 '정해진 시간·장소 바꾸기'와 같다(입력 줄은 timeEditor). 바꾼 수업은 항목의 own 으로 둔다(편람과 같아지면 지운다)
 */
function fillCurSec(li, e) {
  const it = e.item, st = itemEdit;
  const s = { no: it.no, instructor: it.instructor };
  const cat = e.live ? e.live.meetings : it.base.map(meetOf); // 편람 값(편람에서 사라졌으면 넣을 때 본 값)
  const hasCat = cat.length > 0, altered = hasCat && !!it.own;
  const groups = meetingGroups(e.meetings);
  const wide = hasCat && st.wide;
  const editId = "is-edit", adding = st.open && st.at < 0;
  const addButton = () => h("button", { type: "button", class: "btn-text small", "data-act": "add-time", "aria-expanded": String(adding), "aria-controls": adding ? editId : null },
    icon(I.plus, 16), "시간 추가");
  const parts = [h("div", { class: "sec-line" }, h("span", { class: "sec-title" }, it.no, h("span", { class: "prof" }, `(${instructorOf(s)})`)))];
  if (hasCat) parts.push(h("button", { type: "button", class: "icon-btn sec-more", "data-act": "more", "aria-expanded": String(wide), "aria-label": `${sectionLabel(s)} 시간·장소 바꾸기` }, icon(I.down, 20)));
  const tags = [];
  if (e.state === "changed") tags.push(["warning", "편람 바뀜"]);
  if (e.live && e.live.status === "폐강대상") tags.push(["warning", "폐강 대상"]);
  const rows = [], extra = [];
  if (hasCat && !wide) {
    for (const g of groups) rows.push(h("div", { class: "sec-when" }, h("span", {}, groupText(g))));
    if (!groups.length) rows.push(h("div", { class: "sec-when" }, h("span", {}, "시간 미정")));
    if (altered) tags.push(["", "직접 입력"]);
  } else {
    if (!groups.length && !hasCat) rows.push(h("div", { class: "sec-when" }, h("span", {}, "시간 미정"), addButton()));
    if (groups.length) {
      extra.push(meetingChips(chipMeetings(e.meetings), st, editId));
      if (st.open && st.at >= 0) extra.push(timeEditor(st, editId));
    }
    if (groups.length || hasCat) extra.push(h("div", { class: "sec-tools" }, addButton()));
    if (adding) extra.push(timeEditor(st, editId));
    if (altered) {
      extra.push(h("div", { class: "sec-orig" },
        h("span", {}, `편람 ${meetingGroups(cat).map(groupText).join(", ")}`),
        h("button", { type: "button", class: "btn-text small", "data-act": "revert" }, "되돌리기")));
    }
  }
  if (tags.length) rows.push(h("div", { class: "tags" }, tags.slice(0, 2).map(([k, x]) => h("span", { class: k ? `tag ${k}` : "tag" }, x))));
  li.replaceChildren(...parts, ...rows, ...extra);
}
function refillCur(focusSel) {
  const [, it, e] = itemNow();
  const li = $("is-body").querySelector(".sec.is-cur");
  if (!it || !li) return;
  fillCurSec(li, e);
  if (focusSel) li.querySelector(focusSel)?.focus();
}
/** 넣은 분반의 수업을 groups 로. 편람 값과 같아졌으면 사용자가 정한 수업(own)을 지운다 */
function setItemOwn(groups) {
  const [t, it, e] = itemNow();
  if (!it) return;
  const seen = new Set(), meet = [];
  for (const g of groups) {
    for (const day of g.days) {
      const x = [day, g.start, g.end, g.building || "", g.building ? g.room || "" : ""];
      if (seen.has(x.join(","))) continue;
      seen.add(x.join(","));
      meet.push(x);
    }
  }
  meet.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const cat = e.live ? e.live.meetings : it.base.map(meetOf);
  putTt(T.updateItem(t, itemSheet.key, { own: sameAsCatalog(meet.map(meetOf), cat) ? undefined : meet }), { select: false });
  renderMine();
}

$("is-body").addEventListener("change", (ev) => {
  const x = ev.target;
  if (x.name === "is-color") { // 고르면 바로 바뀐다
    const [t] = itemNow();
    if (!t) return;
    putTt(T.updateItem(t, itemSheet.key, { color: Number(x.value) }), { select: false });
    renderMine();
    return;
  }
  if (x.dataset.edit && x.dataset.edit !== "room") applyCurEdit(x); // 호실은 아래 input 에서(치는 대로)
});
$("is-body").addEventListener("input", (ev) => {
  if (ev.target.dataset.edit === "room" && !ev.isComposing) applyCurEdit(ev.target, { light: true });
});
/** 넣은 분반의 입력 줄을 바로 반영한다(과목 시트의 applySecEdit 와 같다) */
function applyCurEdit(x, { light = false } = {}) {
  const [, it, e] = itemNow();
  if (!it) return;
  const st = itemEdit;
  const r = editedList(st, chipMeetings(e.meetings), x);
  if (r) {
    setItemOwn(toGroups(r.next));
    const [, , e2] = itemNow();
    followChip(st, e2 ? chipMeetings(e2.meetings) : [], r.m);
    if (light && st.at >= 0) { relabelChip($("is-body").querySelector(".sec.is-cur"), st.at, chipMeetings(e2.meetings)[st.at]); return; }
  }
  refillCur(editFocus(x));
}
$("is-body").addEventListener("click", (ev) => {
  const actEl = ev.target.closest("[data-act]");
  const act = actEl && actEl.dataset.act;
  if (!act) return;
  const [t, it, e, c] = itemNow();
  if (!it) return;
  const st = itemEdit;
  if (act === "remove") { const key = itemSheet.key; closeSheet($("item-sheet")); dropItem(key); return; }
  if (act === "swap") { swapSection(t, it, c, actEl.closest(".sec").dataset.key); return; }
  if (act === "more") {
    st.wide = !st.wide;
    if (!st.wide) { st.open = false; st.error = ""; }
    refillCur('[data-act="more"]');
  } else if (act === "add-time") {
    Object.assign(st, { open: !(st.open && st.at < 0), at: -1, days: [], b0: "", room0: "", room: "", error: "" });
    refillCur('[data-act="add-time"]');
  } else if (act === "edit-chip") {
    const i = Number(actEl.dataset.i), m = chipMeetings(e.meetings)[i];
    if (!m) return;
    if (st.open && st.at === i) Object.assign(st, { open: false, error: "" });
    else {
      Object.assign(st, { open: true, at: i, days: [m.day], sh: Math.floor(m.start / 60), sm: m.start % 60, eh: Math.floor(m.end / 60), em: m.end % 60,
        b: m.building, room: m.room, b0: m.building, room0: m.room, error: "" });
    }
    refillCur(`[data-act="edit-chip"][data-i="${i}"]`);
  } else if (act === "del-chip") {
    const list = chipMeetings(e.meetings);
    list.splice(Number(actEl.dataset.i), 1);
    Object.assign(st, { open: false, error: "" });
    setItemOwn(toGroups(list));
    refillCur('[data-act="add-time"]');
  } else if (act === "revert") {
    Object.assign(st, { open: false, error: "" });
    putTt(T.updateItem(t, itemSheet.key, { own: undefined }), { select: false });
    renderMine();
    refillCur('[data-act="more"]');
  }
});

/**
 * 다른 분반으로 바꾸기. 이 시간표의 다른 항목과 겹치면 묻지 않고 그 항목을 빼고 넣는다: 시트 머리의 메타 아래에 '겹치는 과목을 뺐어요'와 되돌리기
 * (시트 안의 알림 영역으로도 읽는다). 되돌리면 뺀 항목과 바꾸기 전 분반이 돌아오고 초점은 바꾸기를 누른 분반 행으로. 색과 같은 시간·건물 분반 목록은 그대로
 */
function swapSection(t, it, c, secKey) {
  const s = c && c.sections.find((x) => x.key === secKey);
  if (!s) return;
  const item = T.sectionItem(c, s);
  if (it.alts && it.alts.includes(s.key)) item.alts = [...it.alts.filter((k) => k !== s.key), T.itemKey(it)]; // 같은 시간·건물 분반끼리 바꿨다
  const r = placeItem(item);
  if (!r) return;
  itemSheet.key = r.added;
  itemEdit = newEdit();
  renderMine();
  renderItemSheet();
  if (r.removed) {
    $("is-note").hidden = false;
    $("is-note-text").textContent = "";
    setTimeout(() => { $("is-note-text").textContent = "겹치는 과목을 뺐어요"; }, 60);
    itemSheet.undo = () => {
      undoReplace(r.tid, r.added, r.restore);
      itemSheet.key = T.itemKey(it);
      itemEdit = newEdit();
      $("is-note").hidden = true;
      renderItemSheet();
      $("is-body").querySelector(`.sec[data-key="${CSS.escape(s.key)}"] [data-act="swap"]`)?.focus();
    };
  } else {
    $("is-note").hidden = true;
    itemSheet.undo = null;
  }
  ($("is-body").querySelector(".sec.is-cur [data-act]") || $("item-sheet").querySelector("[data-close]")).focus();
  if (!r.removed) announce(`${sectionLabel(s)}로 바꿨어요`);
}
$("is-undo").addEventListener("click", () => { const f = itemSheet.undo; itemSheet.undo = null; if (f) f(); });

/** 항목 시트를 닫았다: 편람 값이 달라진 항목은 본 것으로 치고('편람 바뀜'을 뗀다) 겹친 과목을 뺐다는 줄을 거둔다 */
function itemSheetClosed() {
  $("is-note").hidden = true;
  itemSheet.undo = null;
  const [t, it, e] = itemNow();
  if (!it || !e || e.state !== "changed" || !state.loaded) return;
  const ack = T.acknowledge(t, state.byId, { key: itemSheet.key }); // 그 항목만(바뀐 것이 없으면 받은 t 그대로)
  if (ack === t) return;
  putTt(ack, { select: false });
  renderMine();
}

// ---- 직접 추가 시트(일정): 이름(30자), 요일(월–일, 여럿), 시각(시·분 선택), 장소(건물 선택칸, 처음 미정, 강의 건물에 기숙사 동을 더한 목록), 메모.
// 넣은 일정을 누르면 같은 시트에 값이 채워져 열린다(제목은 일정 이름, 오른쪽 완료, 맨 아래 시간표에서 빼기. 바꾼 것은 바로 저장된다)
const custom = { key: null, title: "", days: [], sh: 9, sm: 0, eh: 10, em: 0, b: "", memo: "", errors: new Set() };

function openCustom(key, opener) {
  const it = key ? curTt().items.find((x) => T.itemKey(x) === key) : null;
  if (key && !it) return;
  if (it) {
    const g = meetingGroups(it.meetings.map(meetOf))[0] || { days: [], start: 540, end: 600, building: "" };
    Object.assign(custom, { key, title: it.title, days: [...new Set(it.meetings.map(([d]) => d))].sort((a, b) => a - b),
      sh: Math.floor(g.start / 60), sm: g.start % 60, eh: Math.floor(g.end / 60), em: g.end % 60, b: g.building || "", memo: it.memo || "", errors: new Set() });
  } else Object.assign(custom, { key: null, title: "", days: [], sh: 9, sm: 0, eh: 10, em: 0, b: "", memo: "", errors: new Set() });
  $("cu-title").textContent = it ? it.title : "직접 추가";
  $("cu-done").textContent = it ? "완료" : "추가";
  renderCustom();
  openSheet($("custom-sheet"), opener);
}
/** 장소 선택칸: 미정, 강의 건물, 기숙사 동 */
function placeSelect(value, attrs) {
  const el = buildingSelect(value, attrs);
  const dorms = dormOptions().filter(([b]) => b !== value);
  if (dorms.length) el.append(h("optgroup", { label: "기숙사" }, dorms.map(([b, text]) => h("option", { value: b }, text))));
  el.value = value || "";
  return el;
}
function renderCustom() {
  const c = custom, err = (k, text) => h("p", { class: "error-line", id: `cu-err-${k}`, hidden: true }, text);
  const sel = (key, from, to, step, label) => {
    const el = h("select", { class: "select", "data-cu": key, "aria-label": label }, range(from, to, step).map((v) => h("option", { value: String(v) }, pad2(v))));
    el.value = String(c[key]);
    return el;
  };
  const colon = () => h("span", { "aria-hidden": "true" }, ":");
  $("cu-body").replaceChildren(...[
    h("div", { class: "cu-field" }, h("label", { class: "field-label", for: "cu-name" }, "이름"),
      h("input", { class: "text-input", id: "cu-name", type: "text", maxlength: String(T.TITLE_MAX), autocomplete: "off", enterkeyhint: "done", value: c.title, "data-cu": "title" }),
      err("name", "이름이 없어요")),
    h("fieldset", { class: "cu-field", id: "cu-days" }, h("legend", { class: "field-label" }, "요일"),
      h("div", { class: "days" }, range(0, 6).map((d) => h("label", {},
        h("input", { type: "checkbox", value: String(d), checked: c.days.includes(d), "data-cu": "day", "aria-label": `${DAY_KO[d]}요일` }), DAY_KO[d]))),
      err("day", "고른 요일이 없어요")),
    h("div", { class: "cu-field", role: "group", "aria-labelledby": "cu-time-label" }, h("span", { class: "field-label", id: "cu-time-label" }, "시각"),
      h("div", { class: "time-row" },
        h("span", { class: "time-part" }, sel("sh", 6, 23, 1, "시작 시"), colon(), sel("sm", 0, 55, 5, "시작 분"), h("span", { "aria-hidden": "true" }, "~")),
        h("span", { class: "time-part" }, sel("eh", 6, 23, 1, "끝 시"), colon(), sel("em", 0, 55, 5, "끝 분"))),
      err("time", "끝 시각이 시작보다 빨라요")),
    h("div", { class: "cu-field" }, h("label", { class: "field-label", for: "cu-place" }, "장소"), placeSelect(c.b, { class: "select", id: "cu-place", "data-cu": "b" })),
    h("div", { class: "cu-field" }, h("label", { class: "field-label", for: "cu-memo" }, "메모"),
      h("input", { class: "text-input", id: "cu-memo", type: "text", maxlength: "100", autocomplete: "off", enterkeyhint: "done", value: c.memo, "data-cu": "memo" })),
    c.key ? h("div", { class: "sheet-foot" }, h("button", { type: "button", class: "btn-text", "data-act": "remove" }, "시간표에서 빼기")) : null].filter(Boolean));
  syncCustomErrors();
}
/** 오류 줄을 원인 아래에 보이거나 거두고, 원인인 칸에 잇는다 */
function syncCustomErrors() {
  const tie = (el, on, id) => {
    if (!el) return;
    if (on) { el.setAttribute("aria-describedby", id); if (el.matches("input, select")) el.setAttribute("aria-invalid", "true"); }
    else { el.removeAttribute("aria-describedby"); el.removeAttribute("aria-invalid"); }
  };
  for (const k of ["name", "day", "time"]) $(`cu-err-${k}`).hidden = !custom.errors.has(k);
  tie($("cu-name"), custom.errors.has("name"), "cu-err-name");
  tie($("cu-days"), custom.errors.has("day"), "cu-err-day");
  for (const el of $("cu-body").querySelectorAll('[data-cu="eh"], [data-cu="em"]')) tie(el, custom.errors.has("time"), "cu-err-time");
}
/** 고칠 수 없는 칸(빈 이름, 고른 요일 없음, 끝이 시작보다 이름) */
function customProblems() {
  const c = custom, out = new Set();
  if (!T.cleanTitle(c.title)) out.add("name");
  if (!c.days.length) out.add("day");
  if (c.eh * 60 + c.em <= c.sh * 60 + c.sm) out.add("time");
  return out;
}
const customMeetings = () => custom.days.map((day) => ({ day, start: custom.sh * 60 + custom.sm, end: custom.eh * 60 + custom.em, building: custom.b }));
/** 넣은 일정을 고치는 중이면 바로 저장한다(고칠 수 없는 칸은 그 칸만 두고). 오류 줄은 원인 아래에, 풀리면 사라진다 */
function customChanged(field) {
  const bad = customProblems();
  for (const k of [...custom.errors]) if (!bad.has(k)) custom.errors.delete(k);
  if (custom.key) {
    for (const k of bad) custom.errors.add(k);
    const t = curTt(), it = t.items.find((x) => T.itemKey(x) === custom.key);
    if (it) {
      const patch = {};
      if (field === "title" && !bad.has("name")) patch.title = T.cleanTitle(custom.title);
      if ((field === "day" || field === "time" || field === "b") && !bad.has("day") && !bad.has("time")) patch.meetings = T.customItem({ title: "x", meetings: customMeetings() }).meetings;
      if (field === "memo") patch.memo = custom.memo.trim() || undefined;
      if (Object.keys(patch).length) {
        putTt(T.updateItem(t, custom.key, patch), { select: false });
        renderMine();
        if (patch.title) $("cu-title").textContent = patch.title;
      }
    }
  }
  syncCustomErrors();
}
$("cu-body").addEventListener("input", (ev) => {
  const x = ev.target, k = x.dataset.cu;
  if (k === "title" || k === "memo") { custom[k] = x.value; customChanged(k); }
});
$("cu-body").addEventListener("change", (ev) => {
  const x = ev.target, k = x.dataset.cu;
  if (!k || k === "title" || k === "memo") return;
  if (k === "day") {
    const d = Number(x.value);
    custom.days = x.checked ? [...new Set([...custom.days, d])].sort((a, b) => a - b) : custom.days.filter((y) => y !== d);
    customChanged("day");
  } else if (k === "b") { custom.b = x.value; customChanged("b"); }
  else { custom[k] = Number(x.value); customChanged("time"); }
});
$("cu-body").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229 || !ev.target.matches("input.text-input")) return;
  ev.preventDefault();
  ev.target.blur(); // 키보드만 닫는다
});
$("cu-body").addEventListener("click", (ev) => {
  if (!ev.target.closest('[data-act="remove"]')) return;
  const key = custom.key;
  closeSheet($("custom-sheet"));
  dropItem(key);
});
// 추가: 빈 칸이 있으면 원인 아래에 오류 줄(넣은 값은 지우지 않는다). 겹치는 항목이 있으면 과목처럼 빼고 넣은 뒤 스낵바
$("cu-done").addEventListener("click", () => {
  if (custom.key) { closeSheet($("custom-sheet")); return; }
  const bad = customProblems();
  if (bad.size) {
    custom.errors = bad;
    syncCustomErrors();
    const first = bad.has("name") ? "#cu-name" : bad.has("day") ? '[data-cu="day"]' : '[data-cu="eh"]';
    $("cu-body").querySelector(first)?.focus();
    announce(bad.has("name") ? "이름이 없어요" : bad.has("day") ? "고른 요일이 없어요" : "끝 시각이 시작보다 빨라요", "alert");
    return;
  }
  const r = placeItem(T.customItem({ title: custom.title, meetings: customMeetings(), memo: custom.memo.trim() }));
  closeSheet($("custom-sheet"));
  renderMine();
  if (!r) return;
  announce(`${T.cleanTitle(custom.title)} 넣었어요`);
  if (r.removed) showSnackbar("겹치는 과목을 뺐어요", "되돌리기", () => undoReplace(r.tid, r.added, r.restore));
});

// ---- 과목 추가: 탐색과 같은 찾기(검색어는 따로, 최근 검색어는 같이).
// 결과는 분반(강좌)마다 한 행이고 누르면 시트 없이 바로 넣는다(10/23 사용자: "과목 추가할 때의 로직만 SNUTT 참고해서"). 넣은 분반을 다시 누르면 빼고, 같은 과목의
// 다른 분반이 들어 있으면 바꿔 넣는다. 시간이 겹치면 묻지 않고 겹친 항목을 빼고 넣은 뒤 되돌리기(SNUTT 는 묻는다. 디자인 규칙 '겹치면 묻지 않고 바꿔 넣는다').
// 넣는 동안 시간표가 늘 보인다(디자인 규칙 '과목 추가'):
// - 넓은 화면(두 칸)은 내 시간표 화면의 오른쪽 칸이다(화면 'add'. 기록에 남는다. 10/22 밤 사용자: "탐색도 같은 창에 오른쪽에뜨도록"): 행에 마우스를 올리거나 키보드로
//   고르면(방향키) 그 분반이 왼쪽 격자에 미리 보인다(점선 칸, 빠질 항목은 흐리게. addPreview). 검색 전 자리에는 최근 검색어 아래 과목 둘러보기(탐색과 같은 선택칸,
//   행은 분반 행. 10/23 사용자가 시안 가를 골랐다)
// - 폰(679px까지)은 내 시간표 위에 반쯤 올라오는 시트다(#add-sheet. 10/23 사용자: "핸드폰에서는 시간표 탭에서 과목 추가할 때 기존 시간표가 안 보이는 문제", 시안 나).
//   시트라 기록에 남지 않는다. 아래 '폰의 과목 추가 시트'
// 검색창과 결과 카드는 하나이고 폭에 따라 그 칸이나 시트로 옮긴다(placeAdd)
let addShown = RESULTS_STEP, addLast = "", addBrowseFor = null, addBrowseDrawn = "", addBrowseTop = 0, addRecentDrawn = "";
const addQ = $("add-q");
const addData = new Map(); // 검색 결과: 분반 열쇠 → {c, s, marks}(그린 행과 이어 그릴 행)
const addBrowse = new Map(); // 둘러보기(넓은 화면 검색 전): 분반 열쇠 → {c, s, marks}
const addOf = (key) => addData.get(key) || addBrowse.get(key) || null;
const addLists = () => [$("add-list"), $("add-browse-list")];
let addPreview = null, addHover = null; // 격자에 미리 보는 분반, 마우스가 올라간 분반(둘 다 addOf 의 값)
function splitAdd() {
  return twoPane.matches;
}
/** 검색창과 결과 카드를 두 칸이면 내 시간표의 오른쪽 칸(#mine-add), 아니면 과목 추가 시트에 둔다. 옮기면 초점이 풀리므로 그 안에 있던 초점은 되돌린다 */
function placeAdd() {
  const home = splitAdd() ? $("mine-add") : $("as-body");
  const box = $("add-box"), results = $("add-results");
  if (box.parentElement === home) return;
  const had = box.contains(document.activeElement) || results.contains(document.activeElement) ? document.activeElement : null;
  home.append(box, results);
  if (had && !had.closest("[hidden]") && (!addSheet.contains(had) || addSheet.open)) had.focus({ preventScroll: true });
}
/** 검색한 과목들을 분반 행으로: 교수로 찾았으면(과목명·번호·학과로는 안 맞았다) 그 교수의 분반만 */
function addSections(hits) {
  const out = [];
  for (const { c, marks } of hits) {
    const byProf = marks.prof && !marks.name && !marks.id && !marks.dept ? c.sections.filter((s) => instructorOf(s) === marks.prof.name) : [];
    for (const s of byProf.length ? byProf : c.sections) out.push({ c, s, marks });
  }
  return out;
}
/** 행의 지금 모습: 이 시간표에 그 분반이 있으면 넣음, 같은 과목의 다른 분반이면 바꾸기, 아니면 추가. 다른 항목과 시간이 겹치면 '시간 겹침' */
function addState({ c, s }, t = curTt()) {
  const it = t.items.find((x) => x.course === c.id);
  const kind = !it ? "add" : it.no === s.no ? "on" : "swap";
  const clash = kind !== "on" && T.overlapsWith(t, s.meetings, { course: c.id, byId: state.byId }).length > 0;
  return { kind, clash, it };
}
const addWhen = (s) => (s.meetings.length ? meetingGroups(s.meetings).map(groupText).join(", ") : "시간 미정");
const ADD_WORD = { add: "추가", on: "넣음", swap: "바꾸기" };
/** 분반 행: 과목명 / 001(교수) · 학과(번호로 찾았으면 번호) · 교과구분 · 학점 / 요일·시각 · 강의실, 오른쪽 추가·✓ 넣음·바꾸기. 행 어디를 눌러도 그 버튼(탐색의 결과 행과 같다) */
function addRow(d) {
  const { c, s, marks } = d;
  const prof = marks.prof && marks.prof.name === instructorOf(s) ? marked(marks.prof.name, marks.prof.ranges) : instructorOf(s);
  const where = marks.id ? marked(c.id, marks.id) : c.dept ? marked(c.dept, marks.dept) : null;
  const rest = [c.cls, fmtCredit(c.credit)].filter(Boolean).join(" · ");
  const li = h("li", { class: "result add-sec", "data-key": s.key },
    h("div", { class: "r-body" },
      h("span", { class: "r-title" }, marked(c.name, marks.name)),
      h("span", { class: "r-meta" }, h("span", { class: "r-sec" }, String(s.no), "(", prof, ")"), where ? [" · ", where] : null, rest ? ` · ${rest}` : ""),
      h("span", { class: "r-meta r-when" }, addWhen(s))),
    h("button", { type: "button", class: "btn-add", "data-sec": s.key }));
  paintAddRow(li, d);
  return li;
}
function paintAddRow(li, d, t = curTt()) {
  const { kind, clash } = addState(d, t), b = li.querySelector(".btn-add");
  li.classList.toggle("is-picked", kind === "on");
  b.classList.toggle("is-on", kind === "on");
  b.replaceChildren(...(kind === "on" ? [icon(I.check, 16), "넣음"] : [ADD_WORD[kind]]));
  b.setAttribute("aria-label", [`${d.c.name} ${sectionLabel(d.s)}`, addWhen(d.s), ADD_WORD[kind], clash ? "시간 겹침" : ""].filter(Boolean).join(", "));
  const tag = li.querySelector(".r-clash");
  if (clash && !tag) b.before(h("span", { class: "tag danger r-clash", "aria-hidden": "true" }, "시간 겹침"));
  else if (!clash && tag) tag.remove();
}
/** 넣은 표시·바꾸기·시간 겹침만 고친다(검색 결과와 둘러보기). 목록을 다시 그리면 이어 붙인 결과(넓은 화면)가 처음으로 돌아가 읽던 자리를 잃는다 */
function markAddRows() {
  const t = curTt();
  for (const [list, data] of [[$("add-list"), addData], [$("add-browse-list"), addBrowse]]) {
    for (const li of list.querySelectorAll(".add-sec")) {
      const d = data.get(li.dataset.key);
      if (d) paintAddRow(li, d, t);
    }
  }
}
/** 넓은 화면 검색 전의 과목 둘러보기(디자인 규칙 '과목 추가'): 탐색 둘러보기의 과목 차례에 같은 과목 안은 분반 번호 순, 칸 안에서 이어 붙인다. 선택칸과 고른 목록은
 *  탐색과 같다(browseKey. 바꾸면 둘 다). 학기(자료)나 고른 목록이 바뀌었을 때만 새로 그리고 true(그대로면 행과 스크롤 자리를 둔다) */
const secOrder = (a, b) => String(a.no).localeCompare(String(b.no), "en", { numeric: true });
function renderAddBrowse(show) {
  $("add-browse").hidden = !show;
  if (!show) return false;
  const fresh = addBrowseFor !== state.courses;
  if (fresh) { addBrowseFor = state.courses; addBrowseDrawn = ""; }
  fillBrowseSelect($("add-browse-select"), fresh);
  if (addBrowseDrawn === browseKey) return false;
  addBrowseDrawn = browseKey;
  const rows = browseCourses().flatMap((c) => [...c.sections].sort(secOrder).map((s) => ({ c, s, marks: NO_MARKS })));
  addBrowse.clear();
  for (const d of rows) addBrowse.set(d.s.key, d);
  feedList($("add-browse-list"), rows, addRow);
  return true;
}
/** 최근 검색어 칩. 목록이 그대로면 다시 만들지 않는다(키보드 초점이 칩에 있을 때 다시 그려 초점을 잃지 않게) */
function renderAddRecent(show) {
  $("add-recent").hidden = !show;
  const key = show ? JSON.stringify(recent) : "";
  if (key === addRecentDrawn) return;
  addRecentDrawn = key;
  $("add-recent-list").replaceChildren(...(show ? recent : []).map((text) => h("li", { class: "chip" },
    h("button", { type: "button", class: "chip-q", "data-q": text }, h("span", {}, text)),
    h("button", { type: "button", class: "chip-x", "data-del": text, "aria-label": `${text} 지우기` }, icon(I.x, 16)))));
}
const addFocused = () => document.activeElement === addQ || $("add-results").contains(document.activeElement);
function renderAdd({ more = false } = {}) {
  const raw = addQ.value, box = $("add-results"), list = $("add-list");
  const wide = splitAdd();
  $("add-clear").hidden = !raw;
  addQ.disabled = !state.loaded;
  addQ.placeholder = state.loading ? "불러오는 중" : "과목명, 교과목번호, 교수";
  if (!raw.trim() || !state.loaded) {
    const fromSearch = addLast !== "";
    addLast = "";
    clearTimeout(countTimer);
    stopFeed(list);
    list.replaceChildren();
    addData.clear();
    setAddPreview(null, { hover: true });
    $("add-empty").hidden = $("add-more").hidden = true;
    // 검색 전: 넓은 화면은 최근 검색어(있을 때만)와 과목 둘러보기, 폰은 빈 검색창에 초점이 있을 때 최근 검색어만. 불러오는 중에는 두지 않는다
    const recentOn = state.loaded && recent.length > 0 && (wide || addFocused());
    box.hidden = !(recentOn || (wide && state.loaded));
    renderAddRecent(recentOn);
    const redrawn = renderAddBrowse(wide && state.loaded);
    if (fromSearch && wide && !box.hidden) box.scrollTop = redrawn ? 0 : addBrowseTop; // 검색을 지우면 둘러보던 자리로
    return;
  }
  const fresh = raw !== addLast;
  if (fresh && !addLast && !$("add-browse").hidden) addBrowseTop = box.scrollTop;
  renderAddRecent(false);
  renderAddBrowse(false);
  if (fresh) { addShown = RESULTS_STEP; addLast = raw; }
  const found = findCourses(raw), rows = addSections(found.hits);
  addData.clear();
  for (const d of rows) addData.set(d.s.key, d);
  if (fresh) setAddPreview(null, { hover: true });
  box.hidden = false;
  $("add-empty").hidden = rows.length > 0;
  if (wide) {
    if (fresh && box.scrollTop) box.scrollTop = 0;
    feedList(list, rows, addRow);
    $("add-more").hidden = true;
  } else {
    const before = more ? list.children.length : 0;
    stopFeed(list);
    list.replaceChildren(...rows.slice(0, addShown).map(addRow));
    $("add-more").hidden = rows.length <= addShown;
    if (more) { list.children[before]?.querySelector("button")?.focus(); return; }
  }
  clearTimeout(countTimer);
  countTimer = setTimeout(() => announce(rows.length ? `분반 ${rows.length.toLocaleString("ko-KR")}개` : "검색 결과 없음"), 500);
}
addQ.addEventListener("input", () => renderAdd());
addQ.addEventListener("focus", () => { if (!addQ.value.trim()) renderAdd(); });
addQ.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (state.loaded && addData.size) saveRecent(addQ.value);
  // 마우스 기기는 첫 행으로(이어서 방향키·Enter), 폰은 화상 키보드만 닫는다
  const first = finePointer.matches && $("add-list").querySelector(".btn-add");
  if (first) first.focus(); else addQ.blur();
});
// 폰 시트: 빈 검색창에서 초점이 나가면 최근 검색어를 내린다(누른 자리가 밀리지 않게 조금 뒤에)
for (const el of [addQ, $("add-results")]) {
  el.addEventListener("focusout", () => setTimeout(() => { if (addSheet.open && !twoPane.matches && !addQ.value.trim() && !addFocused()) renderAdd(); }, 250));
}
$("add-clear").addEventListener("click", () => { addQ.value = ""; renderAdd(); addQ.focus(); });
$("add-more").addEventListener("click", () => { addShown += RESULTS_STEP; renderAdd({ more: true }); });
// 최근 검색어 모두 지우기(디자인 78판: 탐색 입력 화면과 같은 모양·자리. 탐색과 같이 쓰는 목록이라 둘 다 빈다). 키보드로 눌렀으면 초점은 검색창으로
$("add-recent-clear").addEventListener("click", (e) => {
  const had = keptFocus(e, e.currentTarget);
  setRecent([]);
  renderAdd();
  if (!$("recent").hidden) renderIdle(true); // 탐색 입력 화면에 그려 둔 최근 검색어도
  if (had) addQ.focus({ preventScroll: true });
});
$("add-recent-list").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const had = keptFocus(e, del), i = recent.indexOf(del.dataset.del);
    setRecent(recent.filter((x) => x !== del.dataset.del));
    renderAdd();
    if (!$("recent").hidden) renderIdle(true);
    if (had) ($("add-recent-list").querySelectorAll(".chip-q")[Math.min(i, recent.length - 1)] || addQ).focus({ preventScroll: true });
    return;
  }
  const b = e.target.closest("[data-q]");
  if (!b) return;
  const had = keptFocus(e, b);
  addQ.value = b.dataset.q;
  saveRecent(b.dataset.q);
  renderAdd();
  if (had) addQ.focus({ preventScroll: true });
});
// 둘러보기 목록을 바꿨다: 탐색의 둘러보기도 같이 바뀐다(고른 목록을 함께 기억). 새 목록을 맨 위부터(선택칸이 위로 지나갔으면 선택칸 바로 아래부터) 보이고 분반 수를 읽는다
$("add-browse-select").addEventListener("change", (e) => {
  browseKey = e.target.value;
  store.set("browse", browseKey);
  renderAddBrowse(true);
  if (!$("browse").hidden) renderBrowse(true); // 탐색 탭에 그려 둔 둘러보기도(돌아가면 바뀐 목록. 탭을 바꿀 때는 다시 그리지 않는다)
  const box = $("add-results"), top = $("add-browse").getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  if (box.scrollTop > top) box.scrollTop = top;
  setAddPreview(null, { hover: true });
  announce(`분반 ${addBrowse.size.toLocaleString("ko-KR")}개`);
});
for (const list of addLists()) {
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".btn-add[data-sec]"), d = b && addOf(b.dataset.sec);
    if (d && state.byId.has(d.c.id)) toggleAddSection(d);
  });
}
/** 분반 행을 눌렀다: 넣은 분반이면 빼고(되돌리기 스낵바), 아니면 넣는다(같은 과목의 다른 분반은 바꿔 넣고, 겹친 항목은 빼고 넣은 뒤 되돌리기).
 *  폰의 시트에서 넣었으면 그 칸이 시트에 가려 있을 때 시간표를 그 시각으로 스크롤한다(revealAdded) */
function toggleAddSection(d) {
  const { c, s } = d, { kind, it } = addState(d);
  if (kind === "on") {
    dropItem(T.itemKey(it));
    return;
  }
  const r = placeItem(T.sectionItem(c, s));
  if (!r) return;
  if (addQ.value.trim()) saveRecent(addQ.value);
  mineChanged();
  revealAdded(r.added, r.restore);
  announce(`${c.name} ${kind === "swap" ? "분반을 바꿨어요" : "넣었어요"}`);
  if (r.removed) showSnackbar("겹치는 과목을 뺐어요", "되돌리기", () => undoReplace(r.tid, r.added, r.restore));
}
// 격자 미리 보기(넓은 화면): 나중에 한 쪽을 따른다. 마우스를 움직이면 그 밑의 행, 키보드로 행을 옮기면(초점) 그 행. 마우스가 멈춰 있는 동안 키보드로 목록이
// 스크롤돼 밑의 행이 바뀌어도(브라우저가 보내는 가짜 마우스 이벤트) 따라가지 않는다
let addPtr = ""; // 마지막 마우스 자리
function setAddPreview(d, { hover = false } = {}) {
  if (hover) addHover = d;
  const a = document.activeElement, focused = a && addLists().some((l) => l.contains(a)) ? addOf(a.dataset.sec || "") : null;
  const next = addHover || focused || null;
  if (next === addPreview) return;
  addPreview = next;
  if (screen === "add" && splitAdd()) requestAnimationFrame(renderWeekNow);
}
for (const list of addLists()) {
  list.addEventListener("mousemove", (e) => {
    const at = `${e.screenX},${e.screenY}`;
    if (!finePointer.matches || at === addPtr) return;
    addPtr = at;
    const li = e.target.closest(".add-sec");
    setAddPreview(li ? addOf(li.dataset.key) : null, { hover: true });
  });
  list.addEventListener("mouseleave", () => { addPtr = ""; setAddPreview(null, { hover: true }); });
  list.addEventListener("focusin", () => setAddPreview(null, { hover: true }));
  list.addEventListener("focusout", () => setTimeout(() => setAddPreview(addHover), 0));
}
listKeys(addQ, $("add-results"), ".btn-add");

// ---- 폰의 과목 추가 시트(디자인 규칙 '과목 추가'의 폰, 679px까지): 따로 화면 대신 내 시간표 위에 아래에서 반쯤(55%) 올라오는 시트. 손잡이를 끌어 올리면 90%,
// 거기서 내리면 55%, 55%에서 내리면 닫힌다. 머리는 손잡이·'과목 추가'·'닫기'(넣은 것은 바로 저장된다). 모달 dialog 라 키보드·스크린리더의 초점은 시트 안에 머물고
// 시트 밖 시간표는 누를 수 없다(::backdrop 이 받는다. 바깥 누르기로 닫지 않는다: 시트 밖은 시간표를 스크롤하는 자리). 바탕을 덮지 않고 뒤 화면 스크롤을 막지 않아서
// (style.css) 시트 밖을 끌거나 휠을 굴리면 시간표가 스크롤된다. 시트라서 기록에 남기지 않고 닫기·뒤로 가기(Esc, 안드로이드 뒤로 = cancel)·아래로 끌기로 닫힌다.
// 폭이 바뀌면 옮겨 간다: 넓은 화면에서 연 칸(화면 'add', 기록에 남는다)이 폰 폭이 되면 그 기록 그대로 이 시트를 띄우고(닫으면 그 기록을 거둔다), 폰의 시트가 넓은
// 화면이 되면 시트를 닫고 그 칸을 연다(go). 검색어와 초점은 옮겨 간다
let keepAddQ = false, addRefocus = null, addConverting = false, addReveal = null; // addReveal: 키보드가 떠 있는 동안 넣은 것(내려가면 그 자리로 스크롤)
/** 내 시간표의 '과목 추가': 넓은 화면은 오른쪽 칸(화면), 폰은 시트 */
function openAdd(opener) {
  if (splitAdd()) go("add");
  else openAddSheet(opener);
}
/** keep: 넓은 화면의 칸에서 옮겨 왔다(검색어와 스크롤 자리를 둔다) */
function openAddSheet(opener, { keep = false } = {}) {
  if (addSheet.open) return;
  if (!keep) addQ.value = ""; // 검색어는 탐색과 따로 두고 열 때 비운다
  addSheet.classList.remove("is-full", "is-kb");
  addSheet.style.height = "";
  placeAdd();
  openSheet(addSheet, opener);
  renderAdd();
  snackHome();
  if (finePointer.matches && !addQ.disabled) addQ.focus({ preventScroll: true }); // 마우스 기기는 바로 검색창(누른 까닭이 찾기라), 터치 기기는 제목(화상 키보드를 바로 올리지 않는다)
  // 시트 위로 시간표 윗부분이 보이게(항목 목록 아래의 '과목 추가'를 누를 때는 격자가 위로 지나가 있다)
  if (!keep) window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
}
addSheet.addEventListener("close", () => {
  if (addSheet.open) return; // 닫힌 뒤 바로 다시 열었다(기록을 오가며)
  addSheet.classList.remove("is-full", "is-kb");
  addSheet.style.height = "";
  addReveal = null;
  snackHome(); // 시트 안에 옮겨 둔 스낵바를 제자리로(보이던 것은 그대로 보인다)
  if (addConverting) { addConverting = false; return; } // 넓은 화면의 칸으로 옮겨 갔다(검색어·초점은 그 칸에서 그대로)
  addQ.value = ""; // 닫으면 검색어를 비운다
  renderAdd();
  if (screen === "add" && history.state && history.state.view === "add") back(); // 넓은 화면에서 연 칸이 폰 폭이라 시트였다: 그 기록을 거둔다
});
// 손잡이(붙은 머리)를 끈다. 55%에서 올리면 90%(손가락을 따라 높이가 는다), 90%에서 내리면 55%, 55%에서 내리면 닫힌다(손가락을 따라 내려간다).
// 놓을 때 가운데(72.5%)를 넘었거나 빠르게 튕겼으면 그쪽으로. 화상 키보드가 떠 있는 동안은 내려 끌면 키보드만 내린다(시트는 연 높이로 돌아간다)
{
  const head = addSheet.querySelector(".sheet-head");
  let y0 = null, t0 = 0, dy = 0, dragging = false, pid = null, h0 = 0, half = 0, full = 0, wasFull = false, kb = false;
  head.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    kb = addSheet.classList.contains("is-kb");
    wasFull = addSheet.classList.contains("is-full");
    h0 = addSheet.getBoundingClientRect().height;
    half = (h0 / (wasFull ? 0.9 : 0.55)) * 0.55;
    full = (h0 / (wasFull ? 0.9 : 0.55)) * 0.9;
    y0 = e.clientY; t0 = e.timeStamp; dy = 0; dragging = false; pid = e.pointerId;
  });
  head.addEventListener("pointermove", (e) => {
    if (y0 === null || e.pointerId !== pid) return;
    dy = e.clientY - y0;
    if (!dragging && Math.abs(dy) > 8) { dragging = true; head.setPointerCapture(pid); }
    if (!dragging) return;
    if (kb) { addSheet.style.transform = `translateY(${Math.max(0, dy)}px)`; return; }
    const want = h0 - dy;
    addSheet.style.height = `${Math.round(Math.min(full, Math.max(half, want)))}px`;
    addSheet.style.transform = want < half ? `translateY(${Math.round(half - want)}px)` : "";
  });
  const end = (e) => {
    if (y0 === null || e.pointerId !== pid) return;
    y0 = null;
    if (!dragging) return;
    const speed = dy / Math.max(1, e.timeStamp - t0); // 아래로 +
    if (kb) {
      if (dy > 48 && typingField(document.activeElement)) document.activeElement.blur();
      settleAdd(addSheet.classList.contains("is-full"));
      return;
    }
    const want = h0 - dy, mid = (half + full) / 2;
    const to = wasFull
      ? (want < half - 96 ? "close" : want < mid || (dy > 32 && speed > 0.5) ? "half" : "full")
      : (want > mid || (dy < -32 && speed < -0.5) ? "full" : dy > 96 || (dy > 32 && speed > 0.5) ? "close" : "half");
    if (to === "close") closeSheet(addSheet);
    else settleAdd(to === "full");
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}
/** 끌기를 놓았다: 55%나 90%로 200ms 에 자리 잡는다(ease-standard 감속. 동작 줄이기에서는 바로) */
function settleAdd(full) {
  const from = { height: `${addSheet.getBoundingClientRect().height}px`, transform: addSheet.style.transform || "translateY(0)" };
  addSheet.classList.toggle("is-full", full);
  addSheet.style.height = addSheet.style.transform = "";
  if (reduceMotion.matches || !addSheet.animate) return;
  addSheet.animate([from, { height: `${addSheet.getBoundingClientRect().height}px`, transform: "translateY(0)" }], { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" });
}
/** 화상 키보드: 시트 안 검색창에 초점이 있고 키보드가 떠 있으면 시트가 키보드 위의 보이는 높이를 다 쓴다(결과가 보이게. 그동안 시간표는 가린다). 내려가면 연 높이로.
 *  키보드는 updateTyping 과 같게 판단한다(보이는 높이가 120px 넘게 줄었다). 브라우저는 visual viewport 만 줄고(iOS 는 그 안에서 화면을 밀어 올리기도 한다)
 *  앱 껍데기는 창이 준다: 어느 쪽이든 보이는 자리(offsetTop, height)에 맞춘다 */
function fitAddSheet() {
  if (!addSheet.open) return;
  const a = document.activeElement;
  const kb = !!vv && coarsePointer.matches && addSheet.contains(a) && typingField(a) && fullH - viewH() > 120;
  if (kb) {
    addSheet.style.setProperty("--kb-top", `${Math.round(vv.offsetTop)}px`);
    addSheet.style.setProperty("--kb-h", `${Math.round(vv.height)}px`);
  }
  addSheet.classList.toggle("is-kb", kb);
  // 키보드가 떠 있는 동안(시간표를 가렸다) 넣은 것은 내려간 뒤 그 자리로(iOS 는 행을 눌러도 검색창에서 초점이 떠나지 않아 키보드가 그대로다)
  if (!kb && addReveal) { const r = addReveal; addReveal = null; requestAnimationFrame(() => revealAdded(r.key, r.removed)); }
}
/**
 * 폰 시트에서 분반을 넣거나 바꿨다(겹쳐서 다른 항목을 뺀 때도): 그 칸이 시트에 가려 있으면(위로 지나가 있어도) 시트 위로 보이는 시간표를 그 시각으로 스크롤한다
 * (10/23 사용자: "겹치는 거 나올 때마다 시간표를 그 위치로 스크롤". 겹치지 않아도 가려 있으면 넣은 것이 안 보여서 같게 했다. 디자인 규칙 '과목 추가').
 * 넣은 칸의 위 끝(수업이 여럿이면 가장 이른 것)을 시트 위 영역의 위쪽에 두고, 뺀 칸이 있으면 그 자리도 같이 들어오게(다 못 담으면 넣은 칸 먼저).
 * 위 끝에서 한 시간(짧은 칸은 칸 전체)이 이미 보이면 움직이지 않는다. 부드럽게, 동작 줄이기에서는 바로. 시트를 거의 다 올렸으면 하지 않고, 키보드가 떠 있으면(시간표를 가렸다) 내려간 뒤에 한다
 */
function revealAdded(key, removed) {
  if (addSheet.open && addSheet.classList.contains("is-kb")) { addReveal = { key, removed }; return; }
  if (!addSheet.open || !wkGeom) return;
  const wk = $("wk"), body = wk.querySelector(".wk-body");
  const rects = [...wk.querySelectorAll(".wk-block")].filter((b) => b.dataset.key === key).map((b) => b.getBoundingClientRect());
  if (!body || !rects.length) return; // 시간이 미정인 분반은 격자에 없다
  const first = rects.reduce((a, b) => (b.top < a.top ? b : a));
  const need = Math.min(first.height, wkGeom.hourPx);
  const lo = Math.max(0, $("view-mine").querySelector(".topbar").getBoundingClientRect().bottom) + 8;
  const hi = addSheet.getBoundingClientRect().top - 8;
  if (hi - lo < need) return;
  if (first.top >= lo && first.top + need <= hi) return;
  const b = body.getBoundingClientRect();
  const yOf = (min) => Math.min(b.bottom, b.top + ((min - wkGeom.h0 * 60) / 60) * wkGeom.hourPx);
  const gone = removed.flatMap((it) => (it.custom ? it.meetings : it.own || it.base || []).map((m) => yOf(m[1])));
  const from = Math.min(first.top, ...gone), to = Math.max(first.top, ...gone) + need;
  const at = to - from <= hi - lo ? from : first.top;
  window.scrollTo({ top: Math.max(0, Math.round(window.scrollY + at - lo)), behavior: reduceMotion.matches ? "auto" : "smooth" });
}

/**
 * 검색 결과를 방향키로(10/23 사용자: "검색하고 나서 방향키로 안 움직여짐"): 검색창에서 ↓ 는 첫 행, 행에서 ↓·↑ 는 다음·앞 행(첫 행에서 ↑ 는 검색창), Home·End 는 처음·끝 행,
 * Esc 는 검색창. 행에서 글자나 지우기를 누르면 검색창으로 가서 이어 친다. 넓은 화면은 행이 이어 붙으므로 끝 가까이 가면 더 그려진다(feedList).
 * 행은 그 행의 버튼(sel)이다(탐색은 담기, 과목 추가는 추가)
 */
function listKeys(input, box, sel) {
  const rows = () => [...box.querySelectorAll(sel)].filter((el) => el.getClientRects().length);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const first = rows()[0];
    if (!first) return;
    e.preventDefault();
    first.focus();
  });
  box.addEventListener("keydown", (e) => {
    const cur = e.target.closest && e.target.closest(sel);
    if (!cur || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = rows(), i = all.indexOf(cur);
    let next;
    if (e.key === "ArrowDown") next = all[i + 1];
    else if (e.key === "ArrowUp") next = i > 0 ? all[i - 1] : input;
    else if (e.key === "Home") next = all[0];
    else if (e.key === "End") next = all[all.length - 1];
    else if (e.key === "Escape") next = input;
    else if ((e.key.length === 1 && e.key !== " ") || e.key === "Backspace") { input.focus(); return; }
    else return;
    e.preventDefault();
    next?.focus();
  });
}

// ---- 후보 카드의 저장하기: 이름을 묻지 않고 새 시간표 '시간표 n'으로 저장하고 '✓ 저장됨'. 다시 누르면 지우고 되돌리기 스낵바.
// 같은 시간·건물 분반은 함께 남겨 항목 시트의 다른 분반 맨 위에(T.itemsFromRanked 의 alts). 저장한 시간표가 내 시간표 탭에서 보는 시간표가 된다
const meetSig = (it) => sigOf((it.custom ? it.meetings : it.own || it.base).map(meetOf));
const itemsSig = (items) => items.map((it) => `${T.itemKey(it)}=${meetSig(it)}`).sort().join("|");
function savedFor(ev) {
  if (!savedIndex) {
    savedIndex = new Map();
    for (const t of shownTts()) if (!t.items.some((it) => it.custom) && !savedIndex.has(itemsSig(t.items))) savedIndex.set(itemsSig(t.items), t);
  }
  return savedIndex.get(itemsSig(T.itemsFromRanked(ev, state.byId))) || null;
}
function setSaveButton(b, ev, i) {
  const saved = state.loaded && !!savedFor(ev);
  const box = b.parentElement;
  if (box && mine.list.length < T.PER_SEMESTER_MAX && box.querySelector(".error-line")) { // 50개 아래가 됐다(지웠다): 오류 줄을 거둔다(디자인 67판)
    box.querySelector(".error-line").remove();
    b.removeAttribute("aria-describedby");
  }
  b.classList.toggle("is-saved", saved);
  b.setAttribute("aria-label", `${i + 1}위 시간표 ${saved ? "저장됨" : "저장하기"}`);
  b.replaceChildren(...(saved ? [icon(I.check, 20), "저장됨"] : ["저장하기"]));
}
/** 후보 카드의 저장 버튼을 지금 목록에 맞춘다(지우기·되돌리기 뒤) */
function syncSaves() {
  if (screen !== "result" || !state.result) return;
  for (const b of document.querySelectorAll("#ranks [data-save]")) setSaveButton(b, state.result.ranked[Number(b.dataset.save)], Number(b.dataset.save));
}
function toggleSave(i, b) {
  const R = state.result, ev = R && R.ranked[i];
  if (!ev || !state.loaded) return;
  const found = savedFor(ev);
  if (found) { deleteTt(found); setSaveButton(b, ev, i); return; }
  const t = T.createTimetable(mine.list, mine.sem, { source: "search", from: { home: R.home, mode: R.mode }, items: T.itemsFromRanked(ev, state.byId) });
  const box = b.parentElement;
  box.querySelector(".error-line")?.remove();
  if (!t) {
    box.prepend(h("p", { class: "error-line", id: `save-err-${i}` }, FULL_TEXT));
    b.setAttribute("aria-describedby", `save-err-${i}`);
    announce(FULL_TEXT, "alert");
    return;
  }
  b.removeAttribute("aria-describedby");
  if (mine.id !== t.id && tab !== "mine") stacks.mine.length = 1;
  putTt(t);
  setSaveButton(b, ev, i);
  announce(`${t.title}에 저장했어요`);
}

/**
 * 수강편람 링크(과목·항목·과목 추가 시트의 강의평 옆, 법무 10/22). 과목마다 여는 주소가 없어(수강신청 사이트의 강의계획서·검색 주소는 바로 열면 첫 화면으로
 * 돌아간다. 백엔드 10/22) 수강편람 누리집을 연다. 기기 브라우저로(강의평처럼 data-browser="system", 법무). 교과목번호는 시트 머리, 강좌번호는 분반 행에 있다
 */
const catalogUrl = () => CATALOG_URL;
function setCatalogLink(a, courseId, no) {
  const url = catalogUrl(courseId, no);
  a.hidden = !url;
  if (url) a.href = url; else a.removeAttribute("href");
}

// ---------------------------------------------------------------- 정보 화면, 자료 출처, 오픈소스 라이선스

/** 웹 Safari(iPhone·iPad 의 Safari 탭)에서만 '홈 화면에 추가' 안내. navigator.standalone 은 Safari 탭에서만 false 다. */
function isSafariTab() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return SHELL === "web" && ios && navigator.standalone === false;
}

// ---- 이벤트 테마(디자인 규칙 '이벤트 테마'): 정해 둔 기간에 저절로 켜진다. 한 벌뿐이라 기기가 다크여도 같은 모습이다.
// [값, 이름, 시작 MM-DD, 끝 MM-DD(그날까지, 기기 날짜), 상태 바 색 = style.css 의 그 테마 --bg, 스토어 앱의 시스템 바 글자("DARK" = 짙은 바탕 위 밝은 글자, "LIGHT" = 그 반대),
// 테마 탭 카드의 고를 수 있는 때]. 크리스마스는 12월 한 달(10/23 사용자: "12월 한 달". 그전에는 25일까지).
// 기간은 한 해 안에 두고(해를 넘기지 않는다) 서로 겹치지 않게 한다. index.html 머리의 스크립트가 같은 판단으로 그리기 전에 먼저 건다(테마를 더하면 거기도 고친다)
const THEMES = [["xmas", "크리스마스", "12-01", "12-31", "#103924", "DARK", "12월 한 달"]];
const BASE_BAR = ["#eef0ff", "#16171b"]; // 기본 테마의 상태 바 색(라이트, 다크)
/** 개발 서버: http 의 내 컴퓨터(localhost·127.x·[::1]·*.localhost)나 같은 와이파이의 사설 주소(192.168.x·10.x·172.16~31.x. 실제 폰으로 시험할 때).
 *  배포한 웹(https)과 스토어 앱(https://localhost, capacitor://localhost)은 아니다 */
const devHost = () => location.protocol === "http:" && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$|\.localhost$/.test(location.hostname);
/** 지금 켤 이벤트 테마(없으면 null). event 는 돌아가기와 물어본 것을 기억하는 이름이다: 해마다 달라서('xmas-2026') 그 해 그 테마에만 남는다.
 *  시험용 주소(?theme=xmas)는 개발 서버에서만 기간 밖에서도 켜고, 그때 고른 것이 실제 기간에 남지 않게 따로 기억한다('xmas-test').
 *  배포한 웹·스토어 앱은 주소로 켜지 않는다(10/23 밤 사용자: 링크로 넣으면 날짜와 상관없이 테마가 보이는 문제. index.html 머리의 스크립트도 같다).
 *  웹의 개발자 메뉴에서 고른 테마(ttw.devTheme, 10/24 사용자: 개발자 메뉴는 "테마라던지 이런 거 제한 없고")도 시험용 주소와 같다. 스토어 앱은 보지 않는다 */
function seasonTheme(now = new Date()) {
  const test = (devHost() ? new URLSearchParams(location.search).get("theme") : null) || (IN_APP ? null : store.get("devTheme", null));
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const forced = THEMES.find(([id]) => id === test);
  const t = forced || THEMES.find(([, , from, to]) => md >= from && md <= to);
  return t ? { id: t[0], name: t[1], event: `${t[0]}-${forced ? "test" : now.getFullYear()}`, bar: t[4], bars: t[5] } : null;
}
let season = seasonTheme();
const themeOn = () => !!season && store.get("themeOff", "") !== season.event;
// ---- 라이트·다크(10/23 밤 사용자: "테마에서 기본(기기설정), 라이트, 다크 모두 따로 만들어줘"): 테마 탭에서 고른다. [값, 이름, 카드 아랫줄].
// 고른 것은 ttw.scheme("light"·"dark", 기본은 지운다). 그린 모습은 html 의 data-scheme(light·dark)이고 style.css 의 다크 값이 거기에 걸린다.
// index.html 머리의 스크립트가 같은 판단으로 그리기 전에 먼저 건다. 이벤트 테마가 켜져 있는 동안은 그 테마의 한 벌이고, 끄면(기간이 끝나면) 고른 것으로 돌아간다
const SCHEMES = [["system", "기본", "기기 설정"], ["light", "라이트"], ["dark", "다크"]];
const SYSTEM_DARK = matchMedia("(prefers-color-scheme: dark)");
let scheme = ((v) => (SCHEMES.some(([id]) => id === v) ? v : "system"))(store.get("scheme", "system"));
/** 이벤트 테마가 아닐 때 다크로 그리나: 다크를 골랐거나, 기본(기기 설정)이고 기기가 다크 */
const darkNow = () => scheme === "dark" || (scheme === "system" && SYSTEM_DARK.matches);
let themedBars = false; // 스토어 앱의 시스템 바 글자색을 테마·고른 라이트·다크에 맞춰 바꿔 두었는지
function applyTheme(on) {
  const t = on ? season : null, root = document.documentElement, dark = darkNow(), forced = scheme !== "system";
  if (t) root.dataset.theme = t.id; else delete root.dataset.theme;
  root.dataset.scheme = dark ? "dark" : "light";
  // 상태 바 색: 이벤트 테마는 그 색, 라이트·다크를 골랐으면 그 색(meta 의 media 와 상관없이 둘 다), 기본이면 meta 의 media(기기 설정)대로
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const bar = t ? t.bar : forced ? BASE_BAR[dark ? 1 : 0] : null;
  if (metas[0]) metas[0].content = bar || BASE_BAR[0];
  if (metas[1]) metas[1].content = bar || BASE_BAR[1];
  const cs = document.querySelector('meta[name="color-scheme"]');
  if (cs) cs.content = forced ? (dark ? "dark" : "light") : "light dark";
  // 스토어 앱은 화면을 상태 바 밑까지 그린다. 상태 바의 시계·아이콘이 바탕 위에서 보이게 글자색을 맞추고(테마, 고른 라이트·다크), 기본이면 기기 설정대로 돌린다
  if (IN_APP && (t || forced || themedBars)) {
    themedBars = !!t || forced;
    try { capacitor.Plugins.SystemBars.setStyle({ style: t ? t.bars : forced ? (dark ? "DARK" : "LIGHT") : "DEFAULT" }).catch(() => null); } catch { /* 없으면 그대로 둔다 */ }
  }
  mapColorCache = null; // 테마를 켜고 끄거나 라이트·다크가 바뀌면 지도 색도 바뀐다
  for (const mp of [maps.small, maps.full]) if (mp) mp.base.redraw();
  sleighSoon(); // 크리스마스 썰매 그림
}
/** 라이트·다크 고르기(테마 탭). 기간에 켜진 이벤트 테마는 끈다(돌아가기와 같다: 그 해에는 저절로 다시 켜지지 않는다) */
function setScheme(v) {
  scheme = v;
  if (v === "system") store.del("scheme"); else store.set("scheme", v);
  if (themeOn()) setTheme(false); else applyTheme(false);
}
// 기기 설정이 바뀌면 기본(기기 설정)일 때만 따라간다
SYSTEM_DARK.addEventListener("change", () => { if (scheme === "system") applyTheme(themeOn()); });
applyTheme(themeOn());
// 앱을 켜 둔 채 기간이 시작되거나 끝나도 보고 있는 동안에는 바꾸지 않는다. 다른 데 갔다가 돌아올 때(앱을 다시 열 때) 날짜를 다시 본다:
// 폰은 앱을 며칠씩 내려만 두기도 해서, 새로 켤 때만 보면 기간이 끝난 테마가 남는다
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const now = seasonTheme();
  if ((now ? now.event : "") === (season ? season.event : "")) return;
  season = now;
  if ($("theme-ask").open) $("theme-ask").close(); // 지난 테마를 묻던 팝업은 거둔다
  applyTheme(themeOn());
  renderThemes(); // 테마 탭의 카드(기간이 바뀌면 크리스마스 카드가 켜지거나 흐려진다)
  setTimeout(askTheme, 400);
});
/** 켜거나 끈다(테마 탭, 묻는 팝업). 고른 것은 그 해 그 테마에만 남는다. 기간에 기본·라이트·다크를 고르면 '돌아가기'와 같다(그 해에는 저절로 다시 켜지지 않는다) */
function setTheme(on) {
  if (!season) return;
  if (on) store.del("themeOff"); else store.set("themeOff", season.event);
  store.set("themeAsked", season.event); // 스스로 골랐으면 다시 묻지 않는다
  applyTheme(on);
}
/** 이벤트 테마가 저절로 켜진 뒤 처음 들어왔을 때 한 번 묻는다: '기본 테마로 돌아갈까요?' [닫기] [돌아가기]. 첫 화면(켤 때 연 탭의 첫 화면: 입력 화면이나
 *  내 시간표) 위 가운데 팝업이다(10/23 사용자: "팝업". 디자인 75판). 시간표를 만들어 본 적이 없는 사람에게는 묻지 않는다(돌아갈 '원래'를 본 적이 없다).
 *  닫기·바깥 누르기·뒤로 가기는 그대로 둔다는 뜻이다. 테마 탭에 있으면 묻지 않는다(거기서 고른다).
 *  돌아갈 곳은 테마 탭에서 고른 것이라 제목도 그 이름이다(10/23 밤: '라이트 테마로 돌아갈까요?', '다크 테마로 돌아갈까요?') */
function askTheme() {
  if (!themeOn() || store.get("themeAsked", "") === season.event || !store.get("made", false) || launchLink) return; // 공유받은 시간표를 열 때는 묻지 않는다
  if ((screen !== "input" && screen !== "mine") || document.querySelector("dialog[open]")) return; // 그새 다른 화면이나 시트를 열었으면 끼어들지 않고 다음에 켤 때 묻는다
  store.set("themeAsked", season.event);
  showAsk();
}
/** 묻는 팝업을 연다(제목은 돌아갈 곳의 이름). 이벤트 테마가 켜져 있을 때만 부른다 */
function showAsk(opener) {
  $("theme-ask-title").textContent = `${SCHEMES.find(([id]) => id === scheme)[1]} 테마로 돌아갈까요?`;
  openSheet($("theme-ask"), opener);
}
$("theme-ask-yes").addEventListener("click", () => { setTheme(false); renderThemes(); closeSheet($("theme-ask")); });

// ---- 크리스마스 썰매 그림(디자인 88~91판 '이벤트 테마'의 '썰매 그림', 컴포넌트 XmasSleigh. 10/30 사용자: "크리스마스 테마에 루돌프나 산타같은 이미지 추가되면 좋을 것 같은데",
// 디자인 시안을 보고 "순록이 산타 썰매 끌고 있는 옆모습 이미지를 만들어 줘. 그건 다 빈자리에 넣자"). 디자인 세션이 그린 그림 하나(icons/xmas-sleigh.svg, 286×92)를
// 폰 내 시간표 상단 바, 컴퓨터 사이드바 빈 곳 둘(index.html, 자리·크기는 style.css .xmas-sleigh), 시간표 이미지(EX_SLEIGH, 캔버스)에만 둔다. 크리스마스 테마에서만이고
// 대비를 높인 기기·강제 색에서는 무늬처럼 없다. 돌린 그림의 둘레 상자가 글자·아이콘(버튼은 보이는 아이콘 24)과 8px 안으로 가까워지면 그리지 않는다.
// 폰은 본문을 내리면(스크롤이 0이 아니면) 숨긴다: 내려간 시간표가 그림 밑으로 지나가지 않게. 숨기고 보일 때 움직임은 없다.
// 사이드바는 둘끼리도 8px 띄우고, 빈 곳이 낮으면 위의 작은 것부터 빠진다(원래 썰매가 빠지면 작은 것도 없다: 빈 곳 높이 230px 아래면 원래 썰매만, 175px 아래면 없다)
const SLEIGH_SRC = "icons/xmas-sleigh.svg";
const lowArt = matchMedia("(prefers-contrast: more), (forced-colors: active)");
/** 가운데 (cx, cy), 돌리기 전 폭 w 인 썰매 그림(286×92)을 deg 만큼 돌렸을 때의 둘레 상자 */
function sleighBox(cx, cy, w, deg) {
  const hh = (w * 92) / 286, a = (Math.abs(deg) * Math.PI) / 180;
  const bw = w * Math.cos(a) + hh * Math.sin(a), bh = w * Math.sin(a) + hh * Math.cos(a);
  return { left: cx - bw / 2, right: cx + bw / 2, top: cy - bh / 2, bottom: cy + bh / 2, width: bw, height: bh };
}
/** 상자 r 이 상자 b 에서 gap 안으로 가깝다(겹치면 물론). 크기가 없는 것(숨은 것)은 빼고 */
const nearBox = (b, r, gap = 8) => r.width > 0 && r.height > 0 && r.left < b.right + gap && r.right > b.left - gap && r.top < b.bottom + gap && r.bottom > b.top - gap;
const boxesOf = (el) => (el ? [...el.getClientRects()] : []);
/** 다음 그림 때 자리를 다시 본다(여러 번 불러도 한 번). 함수 선언이라 앞에서 불러도 된다(applyTheme 는 이 모듈을 읽는 중에 부른다) */
function sleighSoon() {
  cancelAnimationFrame(sleighSoon.raf);
  sleighSoon.raf = requestAnimationFrame(placeSleighs);
}
function placeSleighs() {
  const on = document.documentElement.dataset.theme === "xmas" && !lowArt.matches;
  // 폰 내 시간표(한 칸 화면): 상단 바 오른쪽 끝에서 120, 상단 바 위 끝(안전 영역 아래)에서 60, 폭 120, 10°. 워드마크·오프라인 태그·ⓘ·학기·학점 줄·이름·공유를 본다
  const top = document.querySelector("#view-mine > .topbar > .xmas-sleigh");
  if (top) {
    const bar = top.parentElement, r = bar.getBoundingClientRect();
    let show = on && !twoPane.matches && mineShown() && window.scrollY <= 0 && r.width > 0;
    if (show) {
      const box = sleighBox(r.right - 120, r.top + parseFloat(getComputedStyle(bar).paddingTop) + 60, 120, 10);
      const near = [...bar.querySelectorAll(".brand img, .offline-tag, [data-open-info] svg"), $("tt-sem"), $("tt-switch").querySelector(".nm"), $("tt-share").querySelector("svg")];
      show = !near.some((el) => boxesOf(el).some((q) => nearBox(box, q)));
    }
    if (top.hidden === show) top.hidden = !show;
  }
  // 컴퓨터 사이드바: 빈 곳(.sb-art) 높이의 28%에 작고 흐린 썰매(왼쪽에서 140, 폭 130, 10°), 67%에 원래 썰매(125, 폭 202, 반시계 10°). 탭 목록과 맨 아래 묶음을 본다
  const art = document.querySelector(".sidebar > .sb-art");
  if (art) {
    const [small, orig] = art.children, a = art.getBoundingClientRect();
    const near = [document.querySelector(".sidebar nav ul"), document.querySelector(".sidebar .sb-foot")].flatMap(boxesOf);
    const ob = sleighBox(a.left + 125, a.top + a.height * 0.67, 202, 10), sb = sleighBox(a.left + 140, a.top + a.height * 0.28, 130, 10);
    const showOrig = on && a.height > 0 && !near.some((q) => nearBox(ob, q));
    const showSmall = showOrig && !near.some((q) => nearBox(sb, q)) && !nearBox(sb, ob);
    if (orig.hidden === showOrig) orig.hidden = !showOrig;
    if (small.hidden === showSmall) small.hidden = !showSmall;
  }
}
// 다시 볼 때: 테마(applyTheme), 머리 줄 글(renderMineHead), 화면 바꾸기(showView), 연결 상태(renderOnline)는 그 자리에서 부른다. 그 밖은 아래
// (창 크기·안전 영역, 글꼴을 받아 글자 폭이 바뀜, 칸 크기, 대비 설정). 스크롤은 0 인지 아닌지가 바뀔 때만
window.addEventListener("resize", sleighSoon);
lowArt.addEventListener("change", sleighSoon);
if (document.fonts) document.fonts.addEventListener("loadingdone", sleighSoon);
{
  const ro = new ResizeObserver(sleighSoon);
  for (const el of [document.querySelector(".sidebar > .sb-art"), document.querySelector("#view-mine > .topbar"), $("tt-switch")]) if (el) ro.observe(el);
  let down = window.scrollY > 0;
  window.addEventListener("scroll", () => {
    if (down === window.scrollY > 0) return;
    down = !down;
    sleighSoon();
  }, { passive: true });
}

// ---- 테마 탭(디자인 75판 '테마 탭', 컴포넌트 ThemeTab): 테마마다 카드 하나(라디오. 미리보기 + 이름, 이벤트 테마는 '시즌 한정' 태그와 고를 수 있는 때).
// 카드는 기본(기기 설정) · 라이트 · 다크 · 이벤트 테마(10/23 밤 사용자: "테마에서 기본(기기설정), 라이트, 다크 모두 따로 만들어줘". 그전에는 기본과 크리스마스 둘).
// 고르면 바로 바뀐다(확인 버튼·스낵바·알림 없음: 색이 바뀐 것은 화면이 알린다). 기간 밖 테마는 흐리고 눌리지 않는다(개발 서버의 시험 주소 ?theme=xmas 는 기간 안으로 본다).
// 고른 것: 이벤트 테마가 켜져 있으면 그 테마, 아니면 고른 라이트·다크(기본). 기간에 기본·라이트·다크를 고르면 이벤트 테마는 꺼진다(돌아가기와 같다)
// 미리보기는 토큰으로 그린 작은 화면이다(style.css .mini. 칸 자리는 디자인 미리보기 그대로): 기본은 라이트 위에 다크를 대각선으로 반, 라이트·다크는 그 한 장,
// 크리스마스는 그 바탕과 흰 워드마크
const MINI_BLOCKS = [[14, 10, 15, 22, 0], [48, 10, 15, 22, 0], [31, 6, 15, 20, 1], [65, 6, 15, 20, 1], [14, 38, 15, 20, 2], [48, 38, 15, 20, 2], [31, 58, 15, 30, 3], [82, 62, 14, 24, 7], [65, 45, 15, 22, 5]];
const MINI_WORDMARK = { light: "icons/wordmark.svg", dark: "icons/wordmark-dark.svg", xmas: "icons/wordmark-white.svg" };
function miniScreen(kind) {
  return h("span", { class: `mini is-${kind}` }, h("img", { class: "mw", src: MINI_WORDMARK[kind] || MINI_WORDMARK.light, alt: "" }),
    h("span", { class: "mh" }), h("span", { class: "mh2" }),
    h("span", { class: "mc" }, MINI_BLOCKS.map(([l, t, w, hh, c]) => h("i", { style: { left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${hh}%`, background: `var(--item-${c})` } }))),
    h("span", { class: "mb" }));
}
function renderThemes() {
  const cur = themeOn() ? season.id : scheme;
  const cards = [...SCHEMES.map(([id, name, sub]) => ({ id, name, when: sub, base: true })), ...THEMES.map(([id, name, , , , , when]) => ({ id, name, when }))];
  $("themes").replaceChildren(h("legend", { class: "sr-only" }, "테마"), ...cards.map((c) => {
    const off = !c.base && !(season && season.id === c.id);
    return h("label", { class: off ? "theme-card is-off" : "theme-card" },
      h("input", { type: "radio", name: "theme", value: c.id, checked: c.id === cur, disabled: off, "aria-label": [c.name, c.base ? "" : "시즌 한정", c.when].filter(Boolean).join(", ") }),
      h("span", { class: "prev", "aria-hidden": "true" }, c.id === "system" ? [miniScreen("light"), miniScreen("dark")] : miniScreen(c.id)),
      h("span", { class: "ok", "aria-hidden": "true" }, icon('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.6"/>', 16)),
      h("span", { class: "nm" }, h("span", {}, c.name), c.base ? null : h("span", { class: "tag" }, "시즌 한정")),
      c.when ? h("span", { class: "when" }, c.when) : null);
  }));
}
$("themes").addEventListener("change", (e) => {
  if (e.target.name !== "theme") return;
  const v = e.target.value;
  if (season && v === season.id) setTheme(true);
  else if (SCHEMES.some(([id]) => id === v)) setScheme(v);
});

/**
 * 정보 화면(10/22 디자인, 10/23 75판): 카드를 띄워 두고 묶음 제목은 두지 않는다. 자료 출처 /
 * 개발자 정보·리뷰 남기기(스토어 앱)·홈 화면에 추가(웹 Safari) / 개인정보 처리방침·오픈소스 라이선스·버전. 주소가 없는 행은 두지 않고, 줄이 다 빠진 카드도 두지 않는다.
 * '문의하기' 줄은 10/23 없앴다(메일 주소는 개발자 정보 안). 설정 카드도 10/23 없앴다(테마는 테마 탭, 시간표 칸 색은 시간표 목록 시트)
 * 이동시간 계산 방법은 10/22 밤 사용자가 뺐다(입력 화면 조건의 이동시간 ⓘ 시트로만 본다)
 */
function renderInfo() {
  const next = (key, text) => h("button", { type: "button", class: "info-row", "data-info": key }, h("span", {}, text), icon(I.right, 20));
  const out = (href, text) => h("a", { class: "info-row", href, target: "_blank", rel: "noopener" }, h("span", {}, text), icon(I.out, 20));
  const card = (rows) => (rows.some(Boolean) ? h("ul", { class: "card info-list" }, rows.filter(Boolean).map((r) => h("li", {}, r))) : null);
  $("info-list").replaceChildren(...[
    card([next("sources", "자료 출처")]),
    card([next("developer", "개발자 정보"), REVIEW_URL[SHELL] ? out(REVIEW_URL[SHELL], "리뷰 남기기") : null, isSafariTab() ? next("a2hs", "홈 화면에 추가") : null]),
    card([PRIVACY_URL ? out(PRIVACY_URL, "개인정보 처리방침") : null, next("licenses", "오픈소스 라이선스"),
      h("div", { class: "info-row" }, h("span", {}, "버전"), h("span", { class: "v" }, APP_VERSION))]),
  ].filter(Boolean));
}

$("info-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-info]");
  if (!b) return;
  const k = b.dataset.info;
  if (k === "a2hs") openSheet($("a2hs-sheet"), b);
  else go("page", { page: k });
});

let pageName = "sources";
const NGII_URL = "https://map.ngii.go.kr/"; // 국토정보플랫폼(국토지리정보원이 수치지형도를 내주는 누리집)
const APACHE_URL = "https://www.apache.org/licenses/LICENSE-2.0";
/** 오픈소스 라이선스 줄: 왼쪽 칸(k, 비면 앞 줄과 한 칸), 이름, 라이선스, 원문 주소, 고지문 파일(있으면 목록 아래에 전문).
 *  순서와 왼쪽 칸 이름은 디자인 규칙('화면과 동작'의 정보 화면, 10/22). 스토어 앱에는 앱의 바탕(Capacitor 와 그 안의 Apache Cordova, 안드로이드는 AndroidX)이
 *  더 있다: 고지문을 함께 내야 하는 라이선스다(10/22 법무·백엔드). SNUTT 는 과목 검색 규칙을 따온 곳(search.js 머리의 고지와 같은 레포).
 *  고지문 파일: Leaflet 은 vendor/leaflet/LICENSE, 나머지 다섯(SNUTT·Pretendard 는 10/22 밤 백엔드 update60, Fredoka·ODbL·공공누리는 10/23 update61)은 web/licenses/
 *  (앱도 web/ 을 옮길 때 같은 자리로 들어간다), 앱에만 있는 셋은 앱 묶음의 licenses/(백엔드 build_app.py). 파일을 못 읽은 줄은 원문 링크다 */
function ossRows() {
  return [
    { k: "지도 표시", name: "Leaflet", lic: "BSD-2-Clause", href: "https://github.com/Leaflet/Leaflet/blob/main/LICENSE", file: "vendor/leaflet/LICENSE" },
    { k: "과목 검색", name: "SNUTT", lic: "MIT", href: "https://github.com/wafflestudio/snutt/blob/develop/LICENSE", file: "licenses/snutt.txt" },
    IN_APP && { k: "앱 실행 환경", name: "Capacitor", lic: "MIT", href: "https://github.com/ionic-team/capacitor/blob/main/LICENSE", file: "licenses/capacitor.txt" },
    IN_APP && { k: "", name: "Apache Cordova", lic: "Apache-2.0", href: APACHE_URL, file: "licenses/cordova.txt" }, // 앱 실행 환경 한 칸에 두 줄(안드로이드·iOS 같다)
    SHELL === "android" && { k: "안드로이드", name: "AndroidX", lic: "Apache-2.0", href: APACHE_URL, file: "licenses/androidx.txt" },
    { k: "글꼴", name: "Pretendard", lic: "SIL OFL 1.1", href: "https://github.com/orioncactus/pretendard/blob/main/LICENSE", file: "licenses/pretendard.txt" },
    // 아래 셋도 전문(10/23 사용자: "전문 말하는 거임"). 백엔드 update61 이 web/licenses/ 에 넣었다(Fredoka·ODbL 은 프론트엔드 초안, 공공누리 제1유형은 법무 문안.
    // web/licenses/ 와 그 파일 목록을 정한 시험은 백엔드 몫). 공공누리 고지문은 줄표 줄이 없어 한 칸이다
    { k: "로고 글꼴", name: "Fredoka", lic: "SIL OFL 1.1", href: "https://github.com/google/fonts/blob/main/ofl/fredoka/OFL.txt", file: "licenses/fredoka.txt" },
    { k: "지도 자료", name: "OpenStreetMap", lic: "ODbL", href: "https://www.openstreetmap.org/copyright", file: "licenses/odbl.txt" },
    { k: "지도·경사 자료", name: "국토지리정보원 수치지형도", lic: "공공누리 제1유형", href: "https://www.kogl.or.kr/info/licenseType1.do", file: "licenses/kogl-type1.txt" },
  ].filter(Boolean);
}
function renderPage() {
  const dev = pageName === "developer", sources = !dev && pageName !== "licenses";
  $("page-title").textContent = dev ? "개발자 정보" : sources ? "자료 출처" : "오픈소스 라이선스";
  $("page-foot").hidden = !sources; // '강의 시간과 강의실은 수강편람에서 한 번 더 확인하세요'(자료 출처 아래)
  $("page-texts").hidden = sources || dev;
  // 내용이 같으면 다시 그리지 않는다(기록으로 돌아올 때 읽던 자리와 초점이 그대로 있게)
  const key = dev ? "developer" : sources ? `sources ${state.semesterMeta.updated || ""}` : "licenses";
  if ($("page-list").dataset.key === key) return;
  $("page-list").dataset.key = key;
  const link = (href, text) => h("a", { href, target: "_blank", rel: "noopener" }, text);
  const list = (rows) => $("page-list").replaceChildren(...rows.map(([k, v]) => h("li", {}, h("span", { class: "k" }, k), h("span", { class: "v" }, v))));
  if (dev) {
    // 개발자 정보(10/23 사용자: "그냥 개발자 정보로 메뉴 만들고 거기다가 적어줘". 디자인 75판): 자료 출처와 같은 두 칸 목록.
    // 메일은 글줄 안의 링크(mailto:). 새 창(target)으로 두지 않는다: 앱은 그 링크를 인앱 브라우저로 여는데(아래 a[target=_blank]) 메일 주소는 기기가 메일 앱으로 연다
    $("page-texts").replaceChildren();
    list([["만든 사람", DEV_NAME], ["문의", h("a", { href: DEV_MAIL_HREF }, DEV_MAIL)]]);
    return;
  }
  if (sources) {
    $("page-texts").replaceChildren();
    list([
      ["과목", [link(CATALOG_URL, "서울대학교 수강편람"), state.semesterMeta.updated ? ` · ${asofLong(state.semesterMeta.updated)}` : ""]],
      ["건물", "서울대학교 캠퍼스맵"],
      ["길", link("https://moreadorecampus.com/", "캠퍼스 마법 지도")],
      // 공공누리 제1유형: 온라인에서는 가능하면 출처 누리집으로 가는 링크를 준다(국토정보플랫폼. 10/5 디자인)
      ["경사", [link(NGII_URL, "국토지리정보원 수치지형도"), " · 공공누리 제1유형"]],
      ["지도", [link(NGII_URL, "국토지리정보원 수치지형도"), " · 공공누리 제1유형, ", link("https://www.openstreetmap.org/copyright", "© OpenStreetMap contributors"), " · ODbL"]],
    ]);
    return;
  }
  // 오픈소스 라이선스(10/22 밤 사용자: "라이센스는 앱 안에서 전문 쭉 작성해줘"): 위에 쓰는 것 목록, 그 아래 고지문 전문을 차례로 쭉.
  // 전문이 있는 이름은 글자 그대로 두고(바로 아래에 전문이 있다), 고지문 파일을 못 읽은 것은 원문 링크
  const oss = ossRows(), rows = [];
  for (const r of oss) {
    const v = [r.file ? h("span", { "data-lic": r.file }, r.name) : link(r.href, r.name), ` · ${r.lic}`];
    if (r.k || !rows.length) rows.push([r.k, v]);
    else rows[rows.length - 1][1].push(h("br"), ...v);
  }
  list(rows);
  renderLicenseTexts(oss.filter((r) => r.file));
}

// ---- 라이선스 전문. 앱에 넣은 고지문을 읽어 목록 아래에 이름·라이선스 머리와 칸으로 차례로 보인다(앱 안 서버(https://localhost)의 파일이라
// 인앱 브라우저로는 못 연다). 못 읽은 것(그 파일이 없는 앱 빌드)은 전문을 두지 않고 목록의 이름을 원문 링크로 바꾼다
const licenseTexts = new Map();
async function renderLicenseTexts(list) {
  const box = $("page-texts");
  box.replaceChildren();
  const texts = await Promise.all(list.map((r) => loadLicense(r.file).catch(() => null)));
  if ($("page-list").dataset.key !== "licenses") return; // 읽는 사이 자료 출처로 바뀌었다
  box.replaceChildren(...list.flatMap((r, i) => {
    if (texts[i] === null) {
      $("page-list").querySelector(`[data-lic="${r.file}"]`)?.replaceWith(h("a", { href: r.href, target: "_blank", rel: "noopener" }, r.name));
      return [];
    }
    return [h("h2", { class: "section-title lic-title" }, r.name, h("span", { class: "count" }, r.lic)),
      h("div", { class: "license-cards" }, licenseBlocks(texts[i]).map((b) => h("p", { class: "card license-text" }, linkify(b))))];
  }));
}
/** 고지문 글 속 주소(http·https)를 누를 수 있는 링크로(10/23 사용자: "라이선스에 있는 링크들 다 하이퍼링크로"). 글자는 그대로 두고 [글, <a>, 글 …]로 나눈다.
 *  주소는 공백·한글 앞에서 끝나고, 끝에 붙은 문장부호와 짝 없는 닫는 괄호는 뺀다('(https://map.ngii.go.kr)에서', 'http://www.apache.org/).').
 *  외부 링크라 스토어 앱은 Capacitor Browser 로 연다(아래 a[target=_blank] 처리) */
const URL_IN_TEXT = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%()]+/g;
function linkify(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    let url = m[0];
    for (;;) {
      const last = url.slice(-1), open = (url.match(/\(/g) || []).length, close = (url.match(/\)/g) || []).length;
      if (".,;:!?'\"]".includes(last) || (last === ")" && close > open)) url = url.slice(0, -1);
      else break;
    }
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(h("a", { href: url, target: "_blank", rel: "noopener" }, url));
    at = m.index + url.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
async function loadLicense(file) {
  if (!licenseTexts.has(file)) {
    const r = await fetch(file);
    if (!r.ok) throw new Error(`${file} ${r.status}`);
    licenseTexts.set(file, await r.text());
  }
  return licenseTexts.get(file);
}
/** 고지문을 폰 폭에 맞게 편다. 글자는 그대로 두고 줄만 다시 나눈다: 폭에 맞춰 끊어 둔 줄(70~80자)은 앞줄에 잇고, 빈 줄(문단)·목록 머리(`1.` `(a)` `*`)·
 *  짧은 줄(이름, 판, 저작권 줄)·우리가 쓴 머리 줄(한글 설명, `이름 — 주소`)은 그대로 둔다. 줄표만 있는 줄에서 칸(카드)을 나눈다(선을 긋지 않는다).
 *  이어 붙이는 줄: 소문자로 시작하거나(주소는 빼고), 앞줄이 50자 이상이고 들여 쓴 만큼이 같거나 깊다. 그대로 두면 80자 줄이 폰에서 한 줄 반씩 꺾인다 */
function licenseBlocks(text) {
  const blocks = [[]];
  let prev = null; // 이어 붙일 수 있는 앞줄 { indent, len }
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd(), body = line.trim(), lines = blocks[blocks.length - 1];
    if (/^[-=_]{10,}$/.test(body)) { blocks.push([]); prev = null; continue; }
    if (!body) { if (lines.length && lines[lines.length - 1]) lines.push(""); prev = null; continue; }
    const indent = line.length - line.trimStart().length;
    const own = /[가-힣]| — /.test(body);
    const item = /^([-*•]|\d+[.)]|\([a-z0-9]{1,3}\))\s/i.test(body);
    const lower = /^[("'“]?[a-z]/.test(body) && !/^https?:/.test(body);
    if (prev && !own && !item && (lower || (prev.len >= 50 && indent >= prev.indent))) lines[lines.length - 1] += ` ${body}`;
    else { lines.push(body); prev = own ? null : { indent }; }
    if (prev) prev.len = line.length;
  }
  return blocks.map((b) => b.join("\n").trim()).filter(Boolean);
}

// ---------------------------------------------------------------- 탭, 화면 이동과 뒤로 가기(디자인 규칙 '탭', '뒤로 가기')
// 아래 탭 셋: 내 시간표(내 시간표 → 과목 추가), 탐색(입력 → 결과 → 전체 화면 지도), 테마(한 화면. 10/23 오후). 내 시간표의 동선 확인하기는 그 시간표를 탐색 탭으로
// 보낸다(routeTt). 정보(정보 → 자료 출처·개발자 정보·오픈소스 라이선스)는
// 탭과 같은 층의 셋째 묶음 'info' 다(10/23 사용자: 시간표 탭에서 정보를 열고 동선 탐색에 다녀오면 시간표 탭에 정보가 다시 떴다. "이걸 다 동일한 층위로 맞춰줘").
// 탭처럼 제 화면 더미(stacks.info)와 스크롤 자리를 기억하고, 탭을 누르면 그 탭의 화면으로 가며(정보는 어느 탭에도 쌓이지 않는다), 열 때와 나갈 때는 탭을
// 바꿀 때처럼 교차 페이드다. 막대·사이드바에서는 정보에 있는 동안 세 탭 모두 고르지 않은 모양이고 컴퓨터 사이드바의 '정보'가 고른 모양이다.
// 화면만 기록(pushState)을 남기고 탭 바꾸기, 요일 탭, 순위 선택, 시트는 남기지 않는다. 탭마다 쌓인 화면(stacks)과 스크롤 자리를 기억한다.
// 기록은 늘 [켤 때 연 탭의 첫 화면, (다른 탭이면 그 탭의 첫 화면), 그 탭에 쌓인 화면 …]이다: 탭을 바꾸면 기록을 첫 화면까지 되감고(history.go) 새 탭의
// 것을 다시 쌓는다. 그래서 탭의 첫 화면에서 뒤로 가면 켤 때 연 탭의 첫 화면, 거기서 뒤로 가면 앱을 나간다(안드로이드 원칙. 스토어 앱의 뒤로 가기는
// native.js 가 열린 시트를 닫거나 history.back 을 부르고, 되돌아갈 기록이 없으면 앱을 내린다). 앱을 켜면 그 학기에 저장한 시간표가 있으면 내 시간표,
// 없으면 탐색에서 시작한다. 내 시간표 탭의 동선 화면은 10/23 오후에 없앴다(동선 확인하기가 탐색 탭으로 보낸다).
// 정보의 기록은 연 탭의 기록 위에 얹는다: [… 연 탭에 쌓인 화면, 정보, (자료 출처·라이선스)]. 그래서 정보의 첫 화면에서 뒤로 가면 정보를 연 그 화면이다.
// 정보에서 다른 탭을 누르면 탭을 바꿀 때처럼 첫 화면까지 되감고 그 탭의 것을 쌓는다(정보를 연 탭이면 정보만큼 되돌린다)

// 과목 추가(add)는 내 시간표 화면이다: 넓은 화면은 그 오른쪽 칸, 폰 폭은 그 위의 시트(넓은 화면에서 연 기록을 폰 폭에서 보일 때. 폰에서 연 시트는 화면이 아니다)
const VIEW_EL = { input: "view-input", mine: "view-mine", add: "view-mine", result: "view-result", map: "view-map", info: "view-info", page: "view-page", theme: "view-theme" };
const VIEW_ELS = [...new Set(Object.values(VIEW_EL))];
const H1 = { input: "input-title", mine: "mine-title", add: "add-panel-title", result: "result-title", map: "map-title", info: "info-title", page: "page-title", theme: "theme-title" };
const ROOT = { mine: "mine", explore: "input", theme: "theme", info: "info" };
const TABS = ["mine", "explore", "theme"]; // 막대·사이드바의 탭 단추(정보는 폰은 탭 첫 화면 상단 바의 ⓘ, 컴퓨터는 사이드바 맨 아래 '정보')
// 탭 이름(10/23 사용자: "'시간표', '동선 탐색' 뭐 이런 느낌으로", 오후 "테마도 걍 탭 하나로 빼자"). 아래 탭 막대와 컴퓨터의 사이드바가 같은 이름을 보인다
const TAB_NAME = { mine: "시간표", explore: "동선 탐색", theme: "테마" };
// 탭 아이콘 [선, 채운 판]. 채운 판의 뚫린 선(격자의 칸 선)은 알약 색(--tab-ind)으로 그린다(style.css)
const TAB_ICON = {
  mine: ['<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M9.2 9.5v11M14.8 9.5v11"/>',
    '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5" fill="currentColor"/><path d="M3.5 9.5h17M9.2 9.5v11M14.8 9.5v11" stroke="var(--tab-ind)" stroke-width="1.8"/>'],
  // 동선 탐색: 두 끝(출발·도착 점)을 잇는 길이 W 모양(10/23 사용자: 시간표 아이콘이 TT 를 닮았으니 동선 탐색은 W 를). 고르면 두 점을 채운다
  explore: ['<circle cx="4.5" cy="7" r="2"/><circle cx="19.5" cy="7" r="2"/><path d="M4.5 9C4.5 15 6.4 19 8.25 19S12 11.5 12 11.5 13.9 19 15.75 19 19.5 15 19.5 9"/>',
    '<circle cx="4.5" cy="7" r="2" fill="currentColor"/><circle cx="19.5" cy="7" r="2" fill="currentColor"/><path d="M4.5 9C4.5 15 6.4 19 8.25 19S12 11.5 12 11.5 13.9 19 15.75 19 19.5 15 19.5 9"/>'],
  // 테마: 팔레트(엄지 자리가 파인 둥근 판과 물감 점 넷. 디자인 75판 TabBar 그대로). 고르면 판을 채우고 점을 알약 색으로 뚫는다
  theme: ['<path d="M12 3.5C7.3 3.5 3.5 7.3 3.5 12s3.8 8.5 8.5 8.5c1.2 0 1.9-.9 1.6-2-.3-1.2.5-2.3 1.8-2.3H17c1.9 0 3.5-1.6 3.5-3.6C20.5 7.4 16.7 3.5 12 3.5z"/>'
    + ["7.6 12.3", "8.9 8.1", "13.2 6.9", "16.9 9.4"].map((c) => { const [x, y] = c.split(" "); return `<circle cx="${x}" cy="${y}" r="1.25" fill="currentColor" stroke="none"/>`; }).join(""),
  '<path d="M12 3.5C7.3 3.5 3.5 7.3 3.5 12s3.8 8.5 8.5 8.5c1.2 0 1.9-.9 1.6-2-.3-1.2.5-2.3 1.8-2.3H17c1.9 0 3.5-1.6 3.5-3.6C20.5 7.4 16.7 3.5 12 3.5z" fill="currentColor"/>'
    + ["7.6 12.3", "8.9 8.1", "13.2 6.9", "16.9 9.4"].map((c) => { const [x, y] = c.split(" "); return `<circle cx="${x}" cy="${y}" r="1.3" fill="var(--tab-ind)" stroke="none"/>`; }).join("")],
};
// 사이드바 '정보'의 ⓘ [선, 채운 판]: 정보에 있는 동안 탭처럼 고른 모양(채운 원, 안의 i 는 알약 색)
const INFO_ICON = ['<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  '<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M12 11v5" stroke="var(--tab-ind)"/><circle cx="12" cy="7.8" r=".6" fill="var(--tab-ind)" stroke="var(--tab-ind)"/>'];
let screen = "input", depth = 0, tab = "explore", launchTab = "explore", screenTab = "explore";
let rebuild = null; // 탭을 바꾸며 기록을 되감는 중: 되감기가 끝나면(popstate) 새 탭의 기록을 쌓는다
const stacks = { explore: [{ view: "input", extra: {} }], mine: [{ view: "mine", extra: {} }], theme: [{ view: "theme", extra: {} }], info: [{ view: "info", extra: {} }] };
const scrollOf = {}, openers = {}, lastFocus = {};
let infoFrom = null, infoBase = null; // 정보를 연 탭, 기록에서 정보 첫 화면의 깊이(정보를 연 적이 없으면 null)
/** 그 묶음 첫 화면의 기록 깊이: 켤 때 연 탭 0, 다른 탭 1, 정보는 연 탭의 기록 위 */
const baseDepth = (t) => (t === "info" ? infoBase : t === launchTab ? 0 : 1);

/** 탐색 결과를 지운다(담은 과목·분반·조건·학기가 바뀌었다). 보이지 않는 탐색 탭에 쌓인 결과 화면은 거둔다 */
function dropExplore() {
  state.result = null;
  if (tab !== "explore") stacks.explore.length = 1;
}

function go(name, extra = {}) {
  openers[`${tab}:${name}`] = document.activeElement;
  stacks[tab].push({ view: name, extra });
  depth += 1;
  history.pushState({ tab, view: name, depth, ...extra }, "", `#${extra.page || name}`);
  showView(name, "forward", extra);
}

function back() {
  if (depth > 0) history.back();
  else showView(ROOT[tab], "back");
}

/** 탭을 바꾼다: 그 탭에서 마지막으로 보던 화면과 스크롤 자리로. 고른 탭을 다시 누르면 그 탭의 첫 화면으로, 첫 화면이면 맨 위로.
 *  정보에서 누르면: 정보를 연 탭이면 정보만큼 기록을 되돌리고(그 탭의 마지막 화면), 다른 탭이면 탭을 바꿀 때처럼 되감아 쌓는다.
 *  after: 다른 탭으로 바꾸고 그 화면을 보인 뒤 부른다(동선 확인하기가 탐색 탭에서 시간표 만들기를 돌린다) */
function switchTab(next, after) {
  if (rebuild || !TAB_NAME[next]) return;
  if (next === tab) { toFirst(); return; }
  if (tab === "info" && next === infoFrom) { history.go(-(depth - infoBase + 1)); return; }
  const apply = () => {
    const target = stacks[next];
    if (next !== launchTab) history.pushState({ tab: next, view: ROOT[next], depth: 1 }, "", `#${ROOT[next]}`);
    target.slice(1).forEach((en, i) => history.pushState({ tab: next, view: en.view, depth: baseDepth(next) + 1 + i, ...en.extra }, "", `#${en.extra.page || en.view}`));
    depth = baseDepth(next) + target.length - 1;
    enterTab(next);
    const top = target[target.length - 1];
    showView(top.view, "tab", top.extra);
    if (after) after();
  };
  if (depth > 0) { rebuild = apply; history.go(-depth); } else apply();
}
/** 고른 탭(정보)을 다시 눌렀다: 그 묶음의 첫 화면으로, 첫 화면이면 맨 위로 */
function toFirst() {
  const n = stacks[tab].length - 1;
  if (n > 0) history.go(-n);
  else window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
}
function enterTab(next) {
  tab = next;
}

/** 아래 탭 막대(알약 안에 아이콘 20 + 이름)와 컴퓨터의 사이드바(아이콘 24 + 이름): 고른 것에 aria-current="page"와 채운 아이콘.
 *  이름이 보이므로 버튼 이름은 그 글자다. 둘 중 하나만 보인다(style.css 의 1100px 규칙). 정보에 있는 동안은 세 탭 모두 고르지 않은 모양이고
 *  사이드바 맨 아래 '정보'가 고른 모양이다(탭과 같은 층. 폰의 ⓘ 는 탭 첫 화면의 상단 바에만 있어 정보 화면에서는 보이지 않는다) */
function renderTabs() {
  for (const b of document.querySelectorAll(".sidebar [data-open-info]")) {
    const on = tab === "info";
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    b.replaceChildren(icon(INFO_ICON[on ? 1 : 0]), h("span", {}, "정보"));
  }
  for (const list of document.querySelectorAll(".tabbar ul, .sidebar ul")) {
    const bar = !list.closest(".sidebar");
    if (!list.children.length) {
      list.replaceChildren(...TABS.map((k) => h("li", {}, h("button", bar
        ? { type: "button", class: "tab", "data-tab": k }
        : { type: "button", class: "sb-item", "data-tab": k }))));
    }
    for (const b of list.querySelectorAll("[data-tab]")) {
      const on = b.dataset.tab === tab;
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
      const pic = icon(TAB_ICON[b.dataset.tab][on ? 1 : 0], bar ? 20 : 24);
      const name = h("span", bar ? { class: "tab-name" } : {}, TAB_NAME[b.dataset.tab]);
      b.replaceChildren(...(bar ? [h("span", { class: "ind" }, pic, name)] : [pic, name]));
    }
  }
}
for (const nav of document.querySelectorAll(".tabbar, .sidebar nav")) {
  nav.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) switchTab(b.dataset.tab); });
}
// 워드마크(탭 첫 화면의 상단 바, 컴퓨터의 사이드바)를 누르면 시간표 탭의 첫 화면으로(10/23 밤 사용자: "여기서 워드마크 누르면 메인화면(시간표 탭)으로 가도록 해줘").
// 시간표 탭을 다시 누를 때와 같다(이미 시간표 탭이면 그 첫 화면, 첫 화면이면 맨 위로). <a href="./"> 라 Ctrl·Cmd·가운데 누르기는 브라우저대로 새 탭에 연다.
// 키보드 차례에는 넣지 않는다(index.html tabindex=-1: 같은 일을 하는 시간표 탭 버튼이 있어 Tab 이 두 번 서지 않게)
for (const a of document.querySelectorAll("[data-home]")) {
  a.addEventListener("click", (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    switchTab("mine");
  });
}
// 탭이 셋이라 칸이 모자라면(폭 320, 글자를 키움) 이름이 여러 줄이 되고 막대가 그만큼 높아진다(디자인 75판 '탭'). 늘어난 만큼을 --tabbar-grow 로 알려
// 하단 주요 버튼·스낵바·본문 끝 여백(style.css 의 --tabbar-top·--tabbar-space)이 막대에 가리지 않게 한다. 막대가 숨으면(컴퓨터, 화상 키보드) 0
// 칸이 아이콘 옆에 가장 긴 낱말(시간표)도 못 담을 만큼 좁으면(탭 셋에 글자 200% 등) 이름이 글자마다 꺾이므로 아이콘을 이름 위에 둔다(style.css .is-tight).
// 지금 모양이 아니라 낱말 폭으로 정해서 모양을 바꿔도 판단이 오가지 않는다
{
  const bar = $("tabbar"), ul = bar.querySelector("ul");
  const ruler = document.createElement("canvas").getContext("2d");
  const fit = () => {
    const cell = ul.querySelector(".tab"), name = ul.querySelector(".tab-name");
    if (!cell || !name || !ruler) return;
    const cs = getComputedStyle(name), ccs = getComputedStyle(cell);
    ruler.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const word = Math.max(...TABS.flatMap((k) => TAB_NAME[k].split(" ")).map((w) => ruler.measureText(w).width));
    const room = cell.clientWidth - parseFloat(ccs.paddingLeft) - parseFloat(ccs.paddingRight);
    bar.classList.toggle("is-tight", room > 0 && room + 0.5 < 12 + 20 + 6 + word + 16); // 알약 여백·아이콘·사이(style.css .tabbar .tab .ind)
  };
  // 모양을 정한 뒤 늘어난 높이를 잰다. 한 번에 한다: 모양이 바뀌었다 같은 프레임에 되돌아오면 크기 관찰은 알리지 않는다
  const update = () => {
    fit();
    const cell = ul.querySelector(".tab");
    const grow = cell ? Math.max(0, ul.getBoundingClientRect().height - parseFloat(getComputedStyle(cell).minHeight)) : 0;
    document.documentElement.style.setProperty("--tabbar-grow", `${Math.round(grow)}px`);
  };
  new ResizeObserver(update).observe(ul);
  document.fonts?.ready.then(update); // 글꼴이 들어오면 낱말 폭이 달라진다
}
// 탭마다 마지막에 초점이 있던 곳(그 탭으로 돌아오면 거기로. 화면 밖의 탭 막대·사이드바는 빼고)
document.addEventListener("focusin", (e) => {
  if (e.target.closest && e.target.closest(".view")) lastFocus[screenTab] = e.target;
});

function titleOf(name) {
  const t = name === "input" ? "" : $(h1Of(name)).textContent;
  return t ? `${t} · TT Wizard` : "TT Wizard";
}
/** 그 화면을 보이는 요소와 제목. 과목 추가는 내 시간표 화면과 그 오른쪽 칸의 제목(h2), 폰 폭이면 그 위 시트의 제목이다 */
const viewOf = (name) => VIEW_EL[name];
const h1Of = (name) => (name === "add" && !splitAdd() ? "as-title" : H1[name]);
/** 화면 요소를 보이고 숨긴다(내 시간표 화면은 넓은 화면 과목 추가면 오른쪽 칸만 찾기로, 폰 폭의 과목 추가면 그 위에 시트) */
function layoutViews(name) {
  for (const id of VIEW_ELS) {
    const v = $(id), on = id === viewOf(name);
    v.hidden = !on;
    v.querySelector("main").hidden = !on;
  }
  const adding = name === "add" && splitAdd();
  $("view-mine").classList.toggle("is-adding", adding);
  $("mine-add").hidden = !adding;
  document.querySelector(".mine-right").hidden = adding;
  placeAdd();
  // 넓은 화면에서 연 과목 추가 칸(그 기록)을 폰 폭에서 보인다: 내 시간표 위 시트로(검색어 그대로. 닫으면 그 기록을 거둔다). 다시 넓어지면 시트를 거둔다
  if (name === "add" && !splitAdd() && !addSheet.open) openAddSheet(null, { keep: true });
  else if (name === "add" && splitAdd() && addSheet.open) { addConverting = true; addSheet.close(); }
}

/** View Transitions 가 되면 결과 화면(지도, 결과 화면에서 연 자료 출처)이 24px 옆에서 밀려 들어오고(300ms), 뒤로 갈 때는 반대로(200ms),
 *  탭을 바꾸면(정보 묶음 안도) 교차 페이드(150ms). 안 되면 바로 바뀐다. */
function transition(apply, dir) {
  if (dir === "init" || !document.startViewTransition || reduceMotion.matches || document.visibilityState !== "visible") { apply(); return; }
  const root = document.documentElement;
  root.dataset.nav = dir;
  const t = document.startViewTransition(apply);
  const done = () => { if (root.dataset.nav === dir) delete root.dataset.nav; };
  t.finished.then(done, done);
}

/** 화면을 보인다. dir: forward(새 화면) · back(기록을 되돌아옴) · tab(탭을 바꿈) · init(켤 때) */
function showView(name, dir, extra = {}) {
  if (!VIEW_EL[name]) name = ROOT[tab]; // 없어진 화면의 기록(10/22 밤까지 있던 라이선스 전문 화면 'text')
  if ((name === "result" || name === "map") && !state.result) name = ROOT[tab]; // 결과가 지워졌다(학기를 바꿨다)
  if (name !== "input" || screen === "result") cancelCompute(); // 결과 화면을 떠나면 이어 찾던 것도 멈춘다
  const from = screen;
  // 넓은 화면에서 내 시간표 ↔ 과목 추가: 같은 화면의 오른쪽 칸만 바뀐다. 옆으로 밀지 않고 교차 페이드(탭 바꾸기와 같은 dur-fade), 스크롤 자리도 그대로
  const swap = dir !== "tab" && dir !== "init" && splitAdd() && screenTab === tab && ((from === "mine" && name === "add") || (from === "add" && name === "mine"));
  scrollOf[`${screenTab}:${from}`] = window.scrollY;
  if (from === "input") store.set("scroll", window.scrollY);
  if (name === "page") pageName = extra.page || pageName;
  if (name === "add" && dir === "forward" && !keepAddQ) addQ.value = ""; // 검색어는 탐색과 따로 두고 화면에 새로 들어올 때 비운다(폰의 시트에서 옮겨 오면 그대로)
  keepAddQ = false;
  const apply = () => {
    screen = name;
    screenTab = tab;
    layoutViews(name);
    document.body.classList.toggle("tabbar-off", name === "map"); // 전체 화면 지도는 탭 막대를 덮는다
    document.body.classList.toggle("no-cta", name !== "input" && name !== "mine"); // 스낵바는 주요 버튼이 없는 화면에서 탭 막대 바로 위
    renderTabs();
    if (name === "result") { $("result-title").textContent = "추천 시간표"; renderResult(); }
    if (name === "add") renderAdd();
    if (mineShown()) renderMine();
    if (name === "info") renderInfo();
    if (name === "map") renderFullMap();
    if (name === "page") renderPage();
    if (name === "theme") renderThemes();
    document.title = titleOf(name);
    if (from !== name) hideSnackbar();
    if (name === "result" && afterResult) { const f = afterResult; afterResult = null; f(); }
    if (!swap) window.scrollTo(0, dir === "back" || dir === "tab" ? scrollOf[`${tab}:${name}`] || 0 : 0);
    focusAfter(name, dir, from);
    if (name === "input") showUpdateIfReady();
    sleighSoon(); // 폰 내 시간표 상단 바의 썰매(돌아온 스크롤 자리)
  };
  // 정보 묶음 안(정보 ↔ 자료 출처·개발자 정보·오픈소스 라이선스)도 옆으로 밀지 않고 교차 페이드(10/23 저녁 사용자: "정보탭 누를 때 화면 살짝 옆으로 흔들리는 것도
  // 빼줘". 정보는 탭과 같은 층이라 탭을 바꿀 때와 같다). 결과 화면에서 연 자료 출처(탐색 탭)는 그대로 민다
  const inInfo = tab === "info" && screenTab === "info" && (dir === "forward" || dir === "back");
  transition(apply, swap || inInfo ? "tab" : dir);
}

/** 초점: 새 화면은 그 h1, 되돌아오면 그 화면을 연 요소, 탭을 바꾸면 그 탭에서 마지막에 있던 자리(없으면 h1). 스크린리더가 화면이 바뀐 것을 읽는다.
 *  넓은 화면의 과목 추가를 열면 마우스가 있는 기기는 바로 검색창(누른 까닭이 찾기라), 터치 기기는 칸의 제목(화상 키보드를 띄우지 않는다) */
function focusAfter(name, dir, from) {
  if (dir === "init") return;
  if (name === "add") { // 폰의 시트에서 넓은 화면의 칸으로 옮겨 왔으면 초점도 옮겨 온다. 폰 폭이면 시트가 초점을 가졌다(제목, 마우스 기기는 검색창)
    const el = addRefocus;
    addRefocus = null;
    if (el && el.isConnected && !el.closest("[hidden]") && (splitAdd() ? $("mine-add") : addSheet).contains(el)) { el.focus({ preventScroll: true }); return; }
    if (!splitAdd()) return;
  }
  const ok = (el) => !!el && el.isConnected && !el.closest("[hidden]") && $(viewOf(name)).contains(el);
  const h1 = () => $(h1Of(name)).focus({ preventScroll: true });
  const opener = relive(openers[`${tab}:${from}`], name), last = relive(lastFocus[tab], name);
  if (dir === "forward" && name === "add" && splitAdd() && finePointer.matches && !addQ.disabled) addQ.focus({ preventScroll: true });
  else if (dir === "forward") h1();
  else if (dir === "tab") { if (ok(last)) last.focus({ preventScroll: true }); else h1(); }
  else if (ok(opener)) opener.focus({ preventScroll: true });
  else if (name === "input") $("run").focus({ preventScroll: true });
  else h1();
}
/** 그 요소가 있던 목록을 다시 그렸으면(내 시간표의 항목 목록은 돌아올 때마다 새로 만든다) 같은 일을 하는 새 요소: id, 없으면 첫 data-* 값이 같은 것 */
function relive(el, name) {
  if (!el || el.isConnected) return el;
  const [k, v] = Object.entries(el.dataset || {})[0] || [];
  const sel = el.id ? `#${CSS.escape(el.id)}` : k ? `[data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${CSS.escape(v)}"]` : "";
  return (sel && $(viewOf(name)).querySelector(sel)) || null;
}

window.addEventListener("popstate", (e) => {
  if (rebuild) { const f = rebuild; rebuild = null; f(); return; } // 탭을 바꾸며 되감은 것
  for (const d of document.querySelectorAll("dialog[open]")) d.close(); // 화면이 바뀌면 열린 시트도 함께 닫는다
  let st = e.state && e.state.view ? e.state : null;
  // 모르는 기록은 켤 때 연 탭의 첫 화면(새로 연 뒤 남은 정보의 기록도: 정보를 연 적이 없어 깊이를 모른다)
  if (!st || !ROOT[st.tab] || baseDepth(st.tab) === null || (st.depth || 0) < baseDepth(st.tab)) st = { tab: launchTab, view: ROOT[launchTab], depth: 0 };
  const d = st.depth || 0, i = d - baseDepth(st.tab), stack = stacks[st.tab];
  const dir = d < depth ? "back" : "forward";
  if (i === 0) stack.length = 1;
  else { stack.length = Math.min(stack.length, i); stack.push({ view: st.view, extra: st }); }
  depth = d;
  const crossed = st.tab !== tab; // 다른 탭의 첫 화면에서 뒤로 가 켤 때 연 탭으로 왔다(앞으로 가기면 그 반대), 정보의 첫 화면에서 뒤로 가 연 탭으로 왔다
  if (crossed) enterTab(st.tab);
  showView(st.view, crossed ? "tab" : dir, st);
  if (afterPop) { const f = afterPop; afterPop = null; if (tab === "mine") f(); } // 받은 시간표를 넣고 정보에서 내 시간표 탭으로 돌아왔다(goMine)
});

// ---------------------------------------------------------------- 스낵바 (되돌리기, 새 버전)
// 한 번에 하나, 5초. 초점이 들어가 있거나 누르고 있는 동안에는 사라지지 않는다

let snackTimer = null, snackFn = null;
// 폰의 과목 추가 시트가 열려 있는 동안 스낵바는 시트 안에 둔다(모달 밖은 inert 라 되돌리기를 누를 수 없고, 시트가 위에 덮인다). 닫히면 제자리(뷰들 뒤)로
const snackSpot = [$("snackbar").parentNode, $("snackbar").nextSibling];
function snackHome() {
  const bar = $("snackbar");
  if (addSheet.open) { if (bar.parentNode !== addSheet) addSheet.append(bar); }
  else if (bar.parentNode !== snackSpot[0]) snackSpot[0].insertBefore(bar, snackSpot[1]);
}
function showSnackbar(text, action = "", fn = null) {
  const bar = $("snackbar");
  snackHome();
  $("snackbar-text").textContent = text;
  $("snackbar-action").textContent = action;
  $("snackbar-action").hidden = !action; // 동작 없는 알림(사진에 저장했어요, 시간표를 불러왔어요)
  snackFn = fn;
  bar.hidden = true;
  void bar.offsetWidth; // 다시 올라오게
  bar.hidden = false;
  placeSnackbar();
  armSnackbar();
}
/** 넓은 화면 입력 화면·내 시간표: 주요 버튼(시간표 만들기, 동선 확인하기)이 오른쪽 칸 안(sticky)이라 자리가 그때그때 달라서, 스낵바를 그 버튼 바로 위에 같은 폭으로 띄운다. */
function placeSnackbar() {
  const bar = $("snackbar");
  bar.style.bottom = bar.style.left = bar.style.right = bar.style.maxWidth = "";
  const cta = screen === "input" ? $("run") : screen === "mine" ? $("route-run") : null;
  if (bar.hidden || !cta || !twoPane.matches) return;
  const r = cta.getBoundingClientRect();
  if (!r.width || r.bottom <= 0 || r.top >= innerHeight) return;
  bar.style.bottom = `${Math.round(innerHeight - r.top + 8)}px`;
  bar.style.left = `${Math.round(r.left)}px`;
  bar.style.right = `${Math.round(document.documentElement.clientWidth - r.right)}px`;
  bar.style.maxWidth = "none";
}
window.addEventListener("scroll", placeSnackbar, { passive: true });
window.addEventListener("resize", placeSnackbar);
function armSnackbar() {
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnackbar, 5000);
}
function hideSnackbar() {
  clearTimeout(snackTimer);
  $("snackbar").hidden = true;
  snackFn = null;
}
{
  const bar = $("snackbar");
  bar.addEventListener("focusin", () => clearTimeout(snackTimer));
  bar.addEventListener("focusout", () => { if (!bar.hidden) armSnackbar(); });
  bar.addEventListener("pointerdown", () => clearTimeout(snackTimer));
  for (const t of ["pointerup", "pointercancel"]) bar.addEventListener(t, () => { if (!bar.hidden && !bar.contains(document.activeElement)) armSnackbar(); });
  $("snackbar-action").addEventListener("click", () => { const f = snackFn; hideSnackbar(); if (f) f(); });
}

// ---------------------------------------------------------------- 설치(웹), 새 버전, 연결 상태

// 서비스 워커: 설치한 앱이 네트워크 없이도 열리게(web/sw.js). https 나 localhost 에서만 된다. 스토어 앱(안드로이드·iOS)은 화면 파일이
// 앱에 들어 있어 쓰지 않는다(새 버전도 스토어 업데이트라 스낵바가 없다)
let updateReady = false, updateShown = false;
if (!IN_APP && "serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("sw.js").catch(() => null);
  // 새 워커가 이 화면을 맡으면 새 버전이 올라온 것(처음 설치될 때는 빼고)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    updateReady = true;
    showUpdateIfReady();
  });
}
/** 새 버전 스낵바는 입력 화면에서만. 결과를 보는 중이면 돌아올 때까지 미룬다. */
function showUpdateIfReady() {
  if (!updateReady || updateShown || screen !== "input") return;
  updateShown = true;
  showSnackbar("새 버전이 있어요", "새로고침", () => location.reload());
  announce("새 버전이 있어요");
}

// 설치 권유(웹 브라우저만): 첫 시간표를 만든 뒤 입력 화면 상단 바의 작은 '설치'(컴퓨터는 사이드바 맨 아래의 '설치'). 시스템 창을 닫으면 버튼을 없애고 다시 두지 않는다
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  updateInstall();
});
function updateInstall() {
  const show = SHELL === "web" && installPrompt && store.get("made", false) && !store.get("installDismissed", false);
  for (const b of document.querySelectorAll("[data-install]")) b.hidden = !show;
}
for (const b of document.querySelectorAll("[data-install]")) {
  b.addEventListener("click", async () => {
    if (!installPrompt) return;
    const p = installPrompt;
    installPrompt = null;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    if (!choice || choice.outcome !== "accepted") store.set("installDismissed", true);
    updateInstall();
    // 버튼이 없어졌으니 초점은 바로 옆의 정보로(지금 보이는 것: 입력 화면 상단 바의 ⓘ, 컴퓨터는 사이드바의 정보)
    [...document.querySelectorAll("[data-open-info]")].find((el) => el.getClientRects().length)?.focus({ preventScroll: true });
  });
}
window.addEventListener("appinstalled", () => { installPrompt = null; updateInstall(); });

function renderOnline() {
  for (const el of document.querySelectorAll(".offline-tag")) el.hidden = navigator.onLine !== false;
  sleighSoon(); // 오프라인 태그가 생기면 폰 상단 바의 썰매가 빠진다
}
window.addEventListener("offline", renderOnline);
window.addEventListener("online", () => {
  renderOnline();
  if (!basemap && (maps.small || maps.full)) loadBasemap(); // 처음 받다 끊겼으면 다시
});

// 외부 링크(처리방침·문의·출처)는 앱 밖으로. 스토어 앱은 Capacitor Browser(iOS 인앱 Safari, 안드로이드 Custom Tab), 웹은 새 탭.
// 시트의 강의평·수강편람(data-browser="system")만 스토어 앱에서도 기기의 기본 브라우저로 연다(수강편람은 법무 10/22): 에브리타임은 로그인해야 보이는데 인앱 브라우저는
// 기기 브라우저의 로그인을 이어받지 않는다. 앱에서는 앱 연결 native.js(백엔드 update51)가 이 표시가 붙었거나 everytime.kr 로 가는 링크의 click 을
// 먼저(capture) 받아 전파를 끊고, 남은 기본 이동을 Capacitor 가 기기에 넘긴다. 그래서 그 링크는 꼭 <a href> 로 두고 click 에 일을 걸지 않는다.
// 여기서도 그 표시가 붙은 링크는 건드리지 않는다(native.js 가 그 처리를 하기 전의 앱 빌드에서도 인앱 브라우저로 열지 않게)
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[target="_blank"]');
  const browser = IN_APP && capacitor?.Plugins?.Browser;
  if (!a || !browser || a.dataset.browser === "system") return;
  e.preventDefault();
  browser.open({ url: a.href });
});

// ---------------------------------------------------------------- 시작

$("year").addEventListener("change", () => onYearChange($("year")));
$("term").addEventListener("change", () => switchSemester(`${$("year").value}-${$("term").value}`));
$("banner-retry").addEventListener("click", () => {
  const f = bannerRetry;
  hideBanner();
  if (!$("year").hidden) $("year").focus({ preventScroll: true });
  if (f) f();
});

const q = $("q");
q.addEventListener("input", () => renderResults());
q.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중의 Enter 는 무시한다
  e.preventDefault();
  if (state.loaded && findCourses(q.value).hits.length) saveRecent(q.value);
  // 마우스 기기는 첫 결과 행으로(이어서 방향키·Enter 로 담는다), 폰은 화상 키보드만 닫는다
  const first = finePointer.matches && q.value.trim() && $("results-list").querySelector(".btn-add");
  if (first) first.focus(); else q.blur();
});
listKeys(q, $("results"), ".btn-add");
// 폰(한 칸): 빈 검색창에 초점이 오면 최근 검색어를 띄우고, 초점이 검색창과 그 카드 밖으로 나가면 내린다. 다른 곳을 누른 순간
// 카드가 사라져 누른 자리가 밀리지 않게(눌림이 엉뚱한 곳에 가지 않게) 조금 뒤에 내린다. 넓은 화면은 초점과 상관없이 늘 둔다
q.addEventListener("focus", () => { if (!q.value.trim()) renderResults(); });
for (const el of [q, $("results")]) {
  el.addEventListener("focusout", () => setTimeout(() => {
    if (!twoPane.matches && !q.value.trim() && !searchFocused()) renderResults();
  }, 250));
}
twoPane.addEventListener("change", () => {
  renderResults();
  if (screen === "add") { // 넓은 화면에서 연 과목 추가: 두 칸이면 내 시간표의 오른쪽 칸, 폰 폭이면 내 시간표 위 시트(기록은 그대로). 초점은 따라가고, 사라졌으면 그 제목으로
    const was = document.activeElement;
    layoutViews("add");
    renderAdd();
    renderMine();
    const inAdd = was && was !== document.body && (splitAdd() ? $("mine-add") : addSheet).contains(was);
    if (inAdd && was.isConnected && !was.closest("[hidden]")) was.focus({ preventScroll: true });
    else if (was && was !== document.body && (!was.isConnected || was.closest("[hidden]") || !splitAdd())) $(h1Of("add")).focus({ preventScroll: true });
  } else if (addSheet.open && splitAdd()) { // 폰의 과목 추가 시트가 넓은 화면이 됐다: 시트를 닫고 오른쪽 칸(기록에 남는 화면)을 연다. 검색어와 초점은 옮겨 간다
    addRefocus = addSheet.contains(document.activeElement) ? document.activeElement : null;
    addConverting = true;
    addSheet.close();
    keepAddQ = true;
    go("add");
  }
  placeSnackbar();
});
// 지운 칩·고른 칩은 다시 그리면 사라지므로 초점을 옮긴다. 키보드(detail 0)와 마우스로 눌렀을 때만:
// 터치로 누를 때 검색창에 초점을 주면 화상 키보드가 올라온다(크롬은 누른 버튼에 초점이 간다)
const keptFocus = (e, el) => document.activeElement === el && (e.detail === 0 || !coarsePointer.matches);
$("recent-list").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const had = keptFocus(e, del);
    const i = recent.indexOf(del.dataset.del);
    setRecent(recent.filter((x) => x !== del.dataset.del));
    renderResults();
    // 키보드로 지웠으면 초점을 다음(없으면 앞) 검색어로, 다 지웠으면 검색창으로
    if (had) ($("recent-list").querySelectorAll(".chip-q")[Math.min(i, recent.length - 1)] || q).focus({ preventScroll: true });
    return;
  }
  const b = e.target.closest("[data-q]");
  if (!b) return;
  const had = keptFocus(e, b);
  q.value = b.dataset.q;
  saveRecent(b.dataset.q); // 다시 쓴 검색어는 맨 앞으로
  renderResults();
  if (had) q.focus({ preventScroll: true });
});
$("recent-clear").addEventListener("click", (e) => {
  const had = keptFocus(e, e.currentTarget);
  setRecent([]);
  renderResults();
  if (had) q.focus({ preventScroll: true });
});
// 가상 키보드가 떠 있는 동안에만 하단 주요 버튼을 숨긴다. 초점만 보면 키보드를 내려도(안드로이드 뒤로, 키보드 내림 버튼)
// 검색창에 초점이 남아 버튼이 계속 안 보였다(10/1 사용자 제보). 키보드는 보이는 높이가 키보드 없을 때보다 크게 줄어든 것으로 안다:
// 브라우저(iOS Safari·Chrome)는 visual viewport 만, 앱 껍데기(WebView)는 창 높이가 줄어든다. 주소창이 접히고 펴지는 차이(~80px)는 넘지 않는다
const vv = window.visualViewport;
const viewH = () => (vv ? vv.height * vv.scale : window.innerHeight);
let fullH = 0; // 키보드 없을 때의 높이. 화면을 돌리면 다시 잰다
let typingGrace = 0; // 초점을 받은 뒤 키보드가 올라오는 동안(버튼이 키보드를 따라 올라왔다 사라지지 않게 먼저 숨긴다)
const typingField = (el) => !!el && ((el.tagName === "INPUT" && /^(search|text)$/.test(el.type)) || el.tagName === "TEXTAREA");
function updateTyping() {
  const cur = viewH();
  if (cur > fullH) fullH = cur;
  const typing = typingField(document.activeElement) && coarsePointer.matches && (fullH - cur > 120 || performance.now() < typingGrace);
  document.body.classList.toggle("is-typing", typing);
  fitAddSheet(); // 폰의 과목 추가 시트는 키보드 위의 보이는 높이를 다 쓴다
}
document.addEventListener("focusin", (e) => { if (typingField(e.target)) { typingGrace = performance.now() + 800; updateTyping(); setTimeout(updateTyping, 850); } });
document.addEventListener("focusout", (e) => { if (typingField(e.target)) { typingGrace = 0; updateTyping(); } });
(vv || window).addEventListener("resize", updateTyping);
if (vv) vv.addEventListener("scroll", fitAddSheet); // iOS 는 키보드가 뜨면 보이는 자리를 밀어 올린다(시트를 그 자리에 맞춘다)
const onRotate = () => { fullH = 0; updateTyping(); };
if (window.screen.orientation) window.screen.orientation.addEventListener("change", onRotate); // screen 은 이 파일에서 지금 화면 이름이라 window.screen
else window.addEventListener("orientationchange", onRotate);
updateTyping();
$("q-clear").addEventListener("click", () => {
  q.value = "";
  renderResults();
  q.focus();
});
// 검색창에 초점이 있을 때 담기·지우기·최근 검색어를 눌러도 키보드가 닫히지 않게 초점을 옮기지 않는다
for (const el of [$("results-list"), $("q-clear"), $("recent")]) {
  el.addEventListener("mousedown", (e) => { if (document.activeElement === q && e.target.closest("button")) e.preventDefault(); });
}
/** 검색 결과와 과목 둘러보기의 행: 누르면 담고 담은 행은 뺀다. 검색해서 담았으면 그 검색어를 최근 검색어에 넣는다. */
function onAddClick(e) {
  const b = e.target.closest(".btn-add");
  const c = b && state.byId.get(b.dataset.id);
  if (!c) return;
  if (isPicked(c.id)) removeCourse(c.id);
  else {
    addCourse(c.id);
    if (e.currentTarget.id === "results-list") saveRecent(q.value);
  }
  setAddButton(b, c.name, isPicked(c.id));
}
$("results-list").addEventListener("click", onAddClick);
// 과목 둘러보기: 목록을 바꾸면 새 목록을 맨 위부터(선택칸이 위로 지나갔으면 선택칸 바로 아래부터) 보이고 과목 수를 읽는다
$("browse-select").addEventListener("change", (e) => {
  browseKey = e.target.value;
  store.set("browse", browseKey);
  renderBrowse(true);
  const box = $("results"), top = $("browse").getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  if (box.scrollTop > top) box.scrollTop = top;
  announce(`과목 ${browseCourses().length}개`);
});
$("browse-list").addEventListener("click", onAddClick);
$("results-more").addEventListener("click", () => {
  resultsShown += RESULTS_STEP;
  renderResults({ more: true });
});

$("picked-list").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) { removeCourse(rm.dataset.remove, { fromList: true }); return; }
  const hit = e.target.closest("[data-open]");
  if (hit && state.loaded) openCourseSheet(hit.dataset.open, hit);
});
$("picked-retry").addEventListener("click", run);
$("run").addEventListener("click", run);
$("cancel").addEventListener("click", cancelCompute);
/** 정보로 간다(탭과 같은 층의 묶음, 위 '탭' 머리). 정보에서 마지막으로 보던 화면과 스크롤 자리로(탭처럼), 기록은 지금 보던 화면 위에 얹는다(뒤로 가면 여기).
 *  정보에 있을 때 컴퓨터의 사이드바 '정보'를 다시 누르면 고른 탭을 다시 누를 때처럼 정보의 첫 화면으로, 첫 화면이면 맨 위로 */
function openInfo() {
  if (rebuild) return;
  if (tab === "info") { toFirst(); return; }
  infoFrom = tab;
  infoBase = depth + 1;
  stacks.info.forEach((en, i) => history.pushState({ tab: "info", view: en.view, depth: infoBase + i, ...en.extra }, "", `#${en.extra.page || en.view}`));
  depth = infoBase + stacks.info.length - 1;
  enterTab("info");
  const top = stacks.info[stacks.info.length - 1];
  showView(top.view, "tab", top.extra);
}
for (const b of document.querySelectorAll("[data-open-info]")) b.addEventListener("click", openInfo);
$("open-calc").addEventListener("click", (e) => openSheet($("calc-sheet"), e.currentTarget));
$("open-sources").addEventListener("click", () => go("page", { page: "sources" }));
$("map-expand").addEventListener("click", () => go("map"));
for (const b of document.querySelectorAll("[data-back]")) b.addEventListener("click", back);

// 칸 크기가 바뀌면(화면 회전, 폭 구간) 시간표 높이와 지도를 다시 맞춘다. 그린 때와 크기가 같으면 두지 않는다
// (결과 화면이 처음 뜰 때도 불리므로, 첫 결과의 경로 그리기를 끊지 않게)
let resizeTimer = null;
const resizeObserver = new ResizeObserver((entries) => {
  for (const en of entries) {
    const { width, height } = en.contentRect;
    const prev = drawnSize.get(en.target);
    if (!width || !height || (prev && Math.abs(prev[0] - width) < 1 && Math.abs(prev[1] - height) < 1)) continue;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.result) return;
      if (screen === "result") renderDay();
      if (screen === "map") renderFullMap();
    }, 150);
  }
});
resizeObserver.observe($("panes"));
resizeObserver.observe($("map-full"));

// 화면이 숨겨질 때 한 번 더 저장한다(앱이 꺼졌다 켜져도 그대로)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  if (state.semester) { savePicks(); saveOverrides(); }
  if (screen === "input") store.set("scroll", window.scrollY);
});

history.scrollRestoration = "manual";
// 첫 탭: 지난번에 연 학기(openSem, 학기 선택 전의 기기는 고른 학기)에 저장한 시간표가 있으면 내 시간표. index.html 머리의 스크립트가 같은 판단으로
// 탐색 입력 화면을 먼저 가려 둔다(data-launch, 켜자마자 입력 화면이 번쩍 보이지 않게). 학기 목록을 받은 뒤 다른 학기로 열려도 첫 탭은 그대로다
readMine(String(store.get(T.STORE_KEYS.open, "") || store.get("semester", null)?.id || ""));
// 바로가기 주소(웹 '#tab=mine&sem=2026-2', 아래 navOf)면 첫 탭은 그 탭(학기는 학기 목록을 받은 뒤 goNav)
const launchNav = IN_APP ? null : navOf(location.href);
launchTab = tab = screenTab = launchNav?.tab || (T.hasTimetables(store.get(semKey(T.STORE_KEYS.list, mine.sem), [])) ? "mine" : "explore");
// 공유받은 시간표 링크(웹 #t=…): 주소를 지우기 전에 읽어 둔다(지우면 새로 고쳐도 다시 열리지 않는다). 학기 목록을 받은 뒤 공유받은 시간표 시트로 연다
const launchLink = IN_APP ? null : linkCodeOf(location.hash);
history.replaceState({ tab, view: ROOT[tab], depth: 0 }, "", location.pathname + location.search);
// 교과구분 색 풀이: 결과 화면 시간표 아래, 입력 화면 담은 과목 아래, 내 시간표 격자 아래(교과구분별 칸 색일 때), 공유받은 시간표 격자 아래
for (const id of ["cls-legend", "picked-legend", "tt-legend", "sd-legend"]) {
  $(id).replaceChildren(...CLS_GROUPS.map(([name, key]) => h("span", {}, h("span", { class: "dot", "aria-hidden": "true", style: { background: `var(--cls-${key})` } }), name)));
}
renderInfo();
renderOnline();
renderResults(); // 검색창 지우기 단추와 결과 카드(자료를 받기 전에는 두지 않는다)
showView(ROOT[tab], "init");
delete document.documentElement.dataset.launch;
startApp();
if (launchLink) receiveLink(launchLink);
if (launchNav?.sem) goNav({ sem: launchNav.sem, tab: null });
setTimeout(askTheme, 400); // 첫 화면이 그 테마로 보인 뒤에 묻는다
// 이미 열어 둔 웹 앱의 주소 칸에 시간표 링크를 붙여 넣었다(주소의 # 만 바뀌면 새로 열리지 않는다)
window.addEventListener("hashchange", () => {
  if (IN_APP) return;
  const code = linkCodeOf(location.hash), nav = code ? null : navOf(location.href);
  if (!code && !nav) return;
  history.replaceState({ tab, view: screen, depth }, "", location.pathname + location.search);
  if (code) receiveLink(code); else goNav(nav);
});
// 앱: 앱 연결(native.js)이 앱으로 열린 시간표 링크를 알려 준다(백엔드에 요청한 약속 10/23 저녁: 켤 때 연 주소는 TTW_APP.launchUrl(주소 글이나 null 의 Promise),
// 켜 둔 동안 열린 주소는 window 의 'ttw:open-url' 이벤트(detail.url)). 앱은 보여 주지 않고 바로 넣는다
if (IN_APP) {
  Promise.resolve(window.TTW_APP?.launchUrl).then((u) => {
    const c = linkCodeOf(u);
    if (!c) { const nav = navOf(u); if (nav) goNav(nav); return; } // 홈 화면 위젯(navOf)
    let done = false;
    try { done = sessionStorage.getItem(LAUNCH_DONE) === c; } catch { done = false; }
    if (!done) receiveLink(c);
  }).catch(() => {});
  window.addEventListener("ttw:open-url", (e) => {
    const u = e.detail && e.detail.url, c = linkCodeOf(u);
    if (c) { receiveLink(c); return; }
    const nav = navOf(u);
    if (nav) goNav(nav);
  });
}
// 스토어 앱의 저장소 되살리기(백엔드 10/22 밤): 앱 연결(native.js)이 기기 저장소(Preferences)에서 지워진 localStorage 를 되살리면 TTW_APP.restored 가
// { keys: [되살린 열쇠 …] } 로 풀린다(웹에는 없다). 되살린 것이 있으면 켤 때 읽은 것(빈 값)으로 그린 화면이라 한 번 새로 연다: 첫 탭(그 학기에 저장한 시간표가
// 있으면 내 시간표)과 학기·담은 과목·시간표·설정을 되살린 값으로 다시 고른다. 한 세션에 한 번만(sessionStorage. 못 쓰면 새로 열지 않는다)
Promise.resolve(window.TTW_APP?.restored).then((r) => {
  if (!r || !Array.isArray(r.keys) || !r.keys.length) return;
  try {
    if (sessionStorage.getItem("ttw.reopened")) return;
    sessionStorage.setItem("ttw.reopened", "1");
  } catch {
    return;
  }
  reopening = true;
  location.reload();
}).catch(() => {});
