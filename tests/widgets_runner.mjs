// tests/test_widgets.py 가 부른다: 홈 화면 위젯 자료(web/js/timetables.js 의 widgetData)를 만들고 결과를 JSON 으로 출력한다.
//   node tests/widgets_runner.mjs <campus.json> <위젯 자료를 쓸 파일>
// 쓴 파일은 앱의 WidgetData(자바)가 같은 자료를 읽는지 볼 때 쓴다(tests/widget_java/WidgetCheck.java).
import { readFileSync, writeFileSync } from "node:fs";
import { TravelMatrix, checkRoute } from "../web/js/engine.js";
import * as T from "../web/js/timetables.js";

const [, , campusPath, outPath] = process.argv;
const campus = JSON.parse(readFileSync(campusPath, "utf8"));
const out = {};
const noon = (s) => new Date(`${s}T12:00:00`); // 기기 시각의 날짜(시간대와 상관없이 그날)
const NOW = new Date("2026-10-30T03:00:00Z");

// 1) 학기의 날들과 이름, 넘길 학기 고르기(끝나지 않은 학기를 시작 차례로 셋까지)
out.terms = {
  dates: ["2026-1", "2026-S", "2026-2", "2026-W", "2027-W", "2026-X", ""].map((s) => T.termDates(s)),
  labels: ["2026-1", "2026-S", "2026-2", "2026-W", "nope"].map(T.termLabel),
  pick: T.widgetSemesters(["2027-S", "2025-2", "2026-1", "2026-2", "2026-S", "2026-W", "2027-1", "2026-2"], noon("2026-10-30")),
  pickWinter: T.widgetSemesters(["2026-2", "2026-W", "2027-1"], noon("2026-12-22")),
  pickLastDay: T.widgetSemesters(["2026-2", "2026-W"], noon("2026-12-21")),
};

// 2) 자바 시험에 넘길 자료: 걷는 시간은 가짜 표(집 → A 12분, A → B 20분: 쉬는 15분이라 5분 늦음)
const fake = { "HOME|A": 12, "A|B": 20, "HOME|B": 15, "B|A": 20 };
const minutes = (a, b) => (a === b ? 0 : fake[`${a}|${b}`] ?? 30);
const custom = (title, meetings, color) => ({ ...T.customItem({ title,
  meetings: meetings.map(([day, start, end, building, room]) => ({ day, start, end, building, room })) }), color });
let a = T.createTimetable([], "2026-2", { title: "시간표 1", now: NOW });
a = { ...a, items: [
  custom("생명과학 1", [[0, 570, 645, "A", "104"], [2, 570, 645, "A", "104"]], 1),
  custom("대학 글쓰기 1", [[0, 660, 735, "B", "303"], [2, 660, 735, "B", "303"]], 2),
  custom("통계학", [[4, 780, 855, "A", "104"]], 9),
  custom("시간 미정", [], 3),
] };
let b = T.createTimetable([], "2027-1", { title: "봄", now: NOW });
b = { ...b, items: [custom("물리학 1", [[1, 600, 675, "A", ""]], 0)] };
const entries = (t) => T.reconcile(t, new Map());
const data = T.widgetData([{ t: a, entries: entries(a) }, { t: b, entries: entries(b) }], { minutes, home: "HOME" });
writeFileSync(outPath, JSON.stringify(data));
const mon = data.terms[0].days[0];
out.data = {
  keys: Object.keys(data), v: data.v, same: JSON.stringify(data) === JSON.stringify(T.widgetData([{ t: a, entries: entries(a) }, { t: b, entries: entries(b) }], { minutes, home: "HOME" })), colors: data.colors, terms: data.terms.map((t) => [t.sem, t.label, t.title, t.from, t.to, t.untimed, t.days.map((d) => d.length)]),
  monday: mon.map((l) => [l.name, l.place, l.start, l.end, l.color, l.cls, l.walk, l.from, l.late]), home: data.home, buildings: mon.map((l) => l.b), back: mon.map((l) => l.back ?? null),
  friday: data.terms[0].days[4].map((l) => [l.color, l.walk, l.from]), // 색 번호는 0~7 로
  noMinutes: T.widgetData([{ t: a, entries: entries(a) }], {}).terms[0].days[0].map((l) => [l.walk, l.late]),
  cls: T.widgetData([{ t: a, entries: entries(a) }], { colors: "cls" }).colors,
  odd: T.widgetData([{ t: { ...a, sem: "2026-X" }, entries: [] }, null], { colors: "?" }),
  names: T.widgetData([{ t: a, entries: entries(a) }], { name: (e) => `[${e.item.title}]`, place: (m) => `${m.building}-${m.room}` }).terms[0].days[0].map((l) => [l.name, l.place]),
};

// 3) 걷는 시간·늦음이 동선 확인(engine.checkRoute)과 같다: 실제 건물·이동 행렬, 강의실 미정 수업이 사이에 낀 날
{
  const travel = TravelMatrix.fromCampus(campus, "slope");
  const ids = campus.ids.filter((x) => !(campus.dorms || []).some(([d]) => d === x));
  const home = (campus.homes && campus.homes[0] && campus.homes[0][0]) || ids[0];
  const [p, q, r] = [ids[1], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]];
  let t = T.createTimetable([], "2026-2", { now: NOW });
  t = { ...t, items: [
    custom("첫", [[1, 540, 615, p, ""]], 0),
    custom("미정", [[1, 630, 680, "", ""]], 1),
    custom("둘", [[1, 690, 765, q, ""]], 2),
    custom("셋", [[1, 770, 845, r, ""], [3, 600, 650, r, ""]], 3),
  ] };
  const w = T.widgetData([{ t, entries: entries(t) }], { minutes: (x, y) => travel.minutes(x, y), home }).terms[0];
  const ev = checkRoute(T.toSections(t, new Map()), travel, home);
  const legs = ev.legs.filter((l) => l.meeting);
  const fromEngine = legs.map((l) => [l.day, l.meeting.start, l.meeting.building ? Math.round(l.minutes) : null,
    l.slack !== null && l.slack < 0 ? Math.max(0, Math.round(-l.slack)) : 0]);
  const fromWidget = [1, 3].flatMap((d) => w.days[d].map((l) => [d, l.start, l.walk, l.late]));
  // 돌아가는 길(마지막 위치 확정 수업 → 출발·도착 지점)도 같다: 그날 마지막 위치 확정 수업의 back
  const backEngine = ev.legs.filter((l) => !l.meeting).map((l) => [l.day, Math.round(l.minutes)]);
  const backWidget = [1, 3].map((d) => [d, w.days[d].filter((l) => l.back !== undefined).map((l) => l.back)[0]]);
  out.engine = { same: JSON.stringify(fromEngine) === JSON.stringify(fromWidget), fromEngine, fromWidget, buildings: [p, q, r].every(Boolean),
    back: [backEngine, backWidget] };
}

// 4) 기기에 둔 값만으로(앱 연결이 부르는 widgetDataFromStore): 대표 시간표만, 끝난 학기는 빼고, 모르는 출발 지점은 자료의 첫 출발 후보, 이동 기준 flat
{
  const travel = (c, mode) => TravelMatrix.fromCampus(c, mode);
  const ids = campus.ids;
  const t = { ...T.createTimetable([], "2099-2", { title: "대표", now: NOW }),
    items: [custom("첫", [[0, 540, 615, ids[1], ""]], 0), custom("둘", [[0, 630, 700, ids[2], ""]], 1)] };
  const other = { ...T.createTimetable([t], "2099-2", { title: "다른", now: NOW }), items: [custom("셋", [[1, 600, 650, ids[1], ""]], 2)] };
  const old = { ...T.createTimetable([], "2020-1", { title: "옛", now: NOW }), items: [custom("넷", [[2, 600, 650, ids[1], ""]], 3)] };
  const rows = { "timetables@2099-2": [t, other], "timetables@2020-1": [old], home: "없는 동", mode: "flat", timetableColor: "cls", "picks@2099-2": [] };
  const got = T.widgetDataFromStore({ get: (k) => rows[k], keys: Object.keys(rows), campus, travel });
  const first = (campus.homes && campus.homes[0] && campus.homes[0][0]) || ids[0];
  const want = T.widgetData([{ t, entries: T.reconcile(t, new Map()) }], { minutes: (a, b) => travel(campus, "flat").minutes(a, b), home: first, colors: "cls" });
  out.store = { same: JSON.stringify(got) === JSON.stringify(want), sems: got.terms.map((x) => [x.sem, x.title]),
    walks: got.terms[0].days[0].map((l) => l.walk), noCampus: T.widgetDataFromStore({ get: (k) => rows[k], keys: Object.keys(rows) }).terms[0].days[0].map((l) => l.walk),
    nothing: T.widgetDataFromStore({ get: () => undefined, keys: [] }) };
}

console.log(JSON.stringify(out));
