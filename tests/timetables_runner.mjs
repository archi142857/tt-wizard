// tests/test_timetables.py 가 부른다: 저장한 시간표(web/js/timetables.js)와 동선 확인(engine.checkRoute)을 돌려 결과를 JSON 으로 출력한다.
//   node tests/timetables_runner.mjs <courses.json> <campus.json>
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { parseCourses, TravelMatrix, search, checkRoute } from "../web/js/engine.js";
import * as T from "../web/js/timetables.js";

const [, , coursesPath, campusPath] = process.argv;
const courses = parseCourses(JSON.parse(readFileSync(coursesPath, "utf8")));
const campus = JSON.parse(readFileSync(campusPath, "utf8"));
const byId = new Map(courses.map((c) => [c.id, c]));
const travel = TravelMatrix.fromCampus(campus, "slope");
const out = {};
const NOW = new Date("2026-10-22T10:00:00Z");
const keys = (t) => t.items.map(T.itemKey);
// 작은 가짜 편람: course("A", 학점, [[강좌번호, [[요일, 시작, 끝, 건물], ...]], ...])
const sec = (id, no, meetings) => ({ key: `${id}-${no}`, courseId: id, no, name: id, instructor: "교수" + no, status: "",
  meetings: meetings.map(([day, start, end, building]) => ({ day, start, end, building, room: "" })) });
const course = (id, credit, secs) => ({ id, name: "과목 " + id, dept: "", credit, cls: "교양", program: "학사", sections: secs.map(([no, ms]) => sec(id, no, ms)) });
const later = (c, mins) => ({ ...c, sections: c.sections.map((x) => ({ ...x, meetings: x.meetings.map((m) => ({ ...m, start: m.start + mins, end: m.end + mins })) })) });

// 1) 이름: 새로 만들 때 겹치면 (2)부터 번호, 복사본은 늘 번호(이미 있는 번호 다음), 길이·빈 이름·같은 이름
{
  let list = [];
  const a = T.createTimetable(list, "2026-2", { title: "  내   시간표 ", now: NOW });
  list = [a];
  const b = T.createTimetable(list, "2026-2", { title: "내 시간표", now: NOW });
  list.push(b);
  const c = T.copyTimetable(a, list, NOW);
  list.push(c);
  const d = T.copyTimetable(c, list, NOW);
  list.push(d);
  const long = T.uniqueTitle("가".repeat(40), ["가".repeat(30)]);
  out.titles = {
    names: list.map((x) => x.title),
    primary: list.map((x) => !!x.primary),
    problems: [T.titleProblem("   ", list), T.titleProblem("내 시간표 (2)", list), T.titleProblem("내 시간표 (2)", list, b.id), T.titleProblem("새 이름", list)],
    rename: T.renameTimetable(b, "내 시간표", list).problem || null,
    renamed: T.renameTimetable(b, "  가을  계획 ", list, NOW).t.title,
    long: [long.length, long.endsWith(" (2)")],
    full: T.createTimetable(Array.from({ length: T.PER_SEMESTER_MAX }, (_, k) => ({ id: "x" + k, title: "t" + k })), "2026-2") === null,
  };
  const afterDelete = T.deleteTimetable(list, a.id);
  out.titles.primaryAfterDelete = afterDelete.filter((x) => x.primary).length;
  out.titles.setPrimary = T.setPrimary(list, d.id).map((x) => !!x.primary);
  // 이름을 안 주면 '시간표 n'(비는 가장 작은 번호). 빈칸뿐인 이름도 안 준 것으로
  let plain = [];
  for (let k = 0; k < 3; k++) plain.push(T.createTimetable(plain, "2026-2", { title: k === 1 ? "   " : "", now: NOW }));
  plain = plain.filter((x) => x.title !== "시간표 2");
  out.titles.plain = plain.map((x) => x.title);
  out.titles.nextTitle = [T.nextTitle([]), T.nextTitle(plain), T.nextTitle(list), T.createTimetable(plain, "2026-2", { now: NOW }).title];
  out.titles.plainCopy = T.copyTimetable(plain[0], plain, NOW).title;
}

// 2) 항목 넣기: 겹치면 묻고(넣지 않음), force 면 겹친 것을 빼고 넣는다(뺀 것은 removed). 같은 과목 다른 분반은 바꿔 넣는다. 색은 비는 가장 작은 번호
{
  const A = course("A", 3, [["001", [[0, 540, 615, "301"], [2, 540, 615, "301"]]], ["002", [[1, 540, 615, "43-1"]]]]);
  const B = course("B", 2, [["001", [[0, 600, 690, "83"]]]]); // A-001 의 월 9:00~10:15 와 겹친다
  const C = course("C", 1, [["001", [[4, 780, 870, "71"]]]]);
  let t = T.createTimetable([], "2026-2", { now: NOW });
  t = T.addItem(t, T.sectionItem(A, A.sections[0]), { now: NOW }).t;
  t = T.addItem(t, T.sectionItem(C, C.sections[0]), { now: NOW }).t;
  const ask = T.addItem(t, T.sectionItem(B, B.sections[0]), { now: NOW });
  const forced = T.addItem(t, T.sectionItem(B, B.sections[0]), { force: true, now: NOW });
  const swap = T.addItem(t, T.sectionItem(A, A.sections[1]), { now: NOW }); // 같은 과목 다른 분반: 바꿔 넣고 색은 그대로
  const swapped = swap.t;
  const custom = T.customItem({ title: "  동아리  ", meetings: [{ day: 5, start: 600, end: 720, building: "" }, { day: 9, start: 1, end: 2, building: "" }] });
  const withCustom = T.addItem(t, custom, { now: NOW }).t;
  const clashCustom = T.addItem(t, T.customItem({ title: "약속", meetings: [{ day: 4, start: 800, end: 900, building: "" }] }), { now: NOW });
  out.items = {
    askOverlap: ask.overlaps, askUnchanged: ask.t === t, askRemoved: ask.removed,
    forced: keys(forced.t), forcedColor: forced.t.items.find((it) => it.course === "B").color,
    forcedOverlaps: forced.overlaps, forcedRemoved: forced.removed.map(T.itemKey), forcedUndo: keys(t),
    swapped: keys(swapped), swappedColor: swapped.items.find((it) => it.course === "A").color, swappedRemoved: swap.removed.map(T.itemKey),
    colors: withCustom.items.map((it) => it.color),
    customTitle: custom.title, customMeetings: custom.meetings,
    clashCustom: clashCustom.overlaps,
    credits: T.credits(withCustom),
    removed: keys(T.removeItem(withCustom, custom.custom, NOW)),
    updated: T.updateItem(withCustom, custom.custom, { memo: "메모", title: "동아리 방" }, NOW).items.find((it) => it.custom),
    cleared: "memo" in T.updateItem(T.updateItem(withCustom, custom.custom, { memo: "메모" }, NOW), custom.custom, { memo: undefined }, NOW).items.find((it) => it.custom),
    updatedAt: forced.t.updated,
  };
  // 색은 여덟 가지(0~7): 다 쓰면 가장 적게 쓰인 색, 빈 색이 생기면 그 색
  let many = T.createTimetable([], "2026-2", { now: NOW });
  for (let k = 0; k < 10; k++) many = T.addItem(many, T.customItem({ title: "일정" + k, meetings: [{ day: k % 5, start: 480 + 60 * Math.floor(k / 5), end: 530 + 60 * Math.floor(k / 5), building: "" }] }), { now: NOW }).t;
  const gap = T.removeItem(many, many.items[3].custom, NOW);
  out.items.colorsMany = many.items.map((it) => it.color);
  out.items.colorsGap = T.addItem(gap, T.customItem({ title: "새 일정", meetings: [{ day: 6, start: 600, end: 660, building: "" }] }), { now: NOW }).t.items.at(-1).color;
}

// 3) 탐색 결과 저장: 같은 분반·수업으로 저장되고, checkRoute 가 search 와 같은 비용·경로를 낸다. 같은 결과는 이미 저장됨
{
  const ids = courses.filter((c) => c.sections.some((s) => s.meetings.length)).slice(0, 4).map((c) => c.id);
  const res = search(ids.map((i) => byId.get(i)), travel, "919", { topK: 3 });
  const ev = res.ranked[0];
  let list = [];
  const t = T.createTimetable(list, "2026-2", { source: "search", from: { home: "919", mode: "slope" }, items: T.itemsFromRanked(ev, byId), now: NOW });
  list = [t];
  const secs = T.toSections(t, byId);
  const chk = checkRoute(secs, travel, "919");
  out.fromSearch = {
    keys: keys(t),
    rankedKeys: ev.sections.map((s) => s.key),
    cost: [chk.cost, ev.cost],
    legs: JSON.stringify(chk.legs.map((l) => [l.day, l.from, l.to, l.minutes, l.slack])) === JSON.stringify(ev.legs.map((l) => [l.day, l.from, l.to, l.minutes, l.slack])),
    overlaps: chk.overlaps,
    saved: T.findSaved(list, ev, byId) === t,
    other: res.ranked.length > 1 ? T.findSaved(list, res.ranked[1], byId) : null,
    source: t.source,
    from: t.from,
    colors: t.items.map((it) => it.color),
  };
  // 사용자가 강의실을 정해 둔 분반(탐색에 넘긴 수업이 편람과 다르다) → own 으로 남고, 같은 시간·건물 분반은 alts 로
  const s = ev.sections[0];
  const fake = { ...ev, sections: [{ ...s, meetings: s.meetings.map((m) => ({ ...m, building: "301", room: "" })), twins: [{ key: s.courseId + "-999" }] }, ...ev.sections.slice(1)] };
  const items = T.itemsFromRanked(fake, byId);
  out.fromSearch.own = items[0].own;
  out.fromSearch.alts = items[0].alts;
  out.fromSearch.ownUsed = T.toSections({ ...t, items }, byId)[0].meetings.map((m) => m.building);
  // 겹치는 시간표: checkRoute 가 겹치는 쌍을 알린다
  const a = { meetings: [{ day: 0, start: 540, end: 600, building: "301" }] }, b = { meetings: [{ day: 0, start: 570, end: 630, building: "43-1" }] }, c = { meetings: [{ day: 1, start: 540, end: 600, building: "" }] };
  out.overlapPairs = checkRoute([a, b, c], travel, "919").overlaps;
}

// 4) 편람과 맞추기: 바뀌면 changed(새 값을 쓴다), own 이 있으면 own, 사라지면 gone(적어 둔 값), 본 것으로 하면 same
{
  const c = courses.find((x) => x.sections.some((s) => s.meetings.length));
  const s = c.sections.find((x) => x.meetings.length);
  let t = T.createTimetable([], "2026-2", { now: NOW });
  t = T.addItem(t, T.sectionItem(c, s), { now: NOW }).t;
  const ownItem = T.sectionItem(c, s, { meetings: s.meetings.map((m) => ({ ...m, start: m.start + 60, end: m.end + 60 })) });
  const moved = { ...c, sections: c.sections.map((x) => (x === s ? { ...x, meetings: x.meetings.map((m) => ({ ...m, start: m.start + 30, end: m.end + 30 })) } : x)) };
  const movedMap = new Map(byId).set(c.id, moved);
  const goneMap = new Map(byId).set(c.id, { ...c, sections: c.sections.filter((x) => x !== s) });
  const r = (tt, map) => T.reconcile(tt, map).map((x) => [x.state, x.meetings.map((m) => m.start)]);
  const tOwn = T.updateItem(t, s.key, { own: ownItem.own }, NOW);
  out.reconcile = {
    same: r(t, byId),
    changed: r(t, movedMap),
    own: r(tOwn, movedMap),
    gone: r(t, goneMap),
    ack: r(T.acknowledge(t, movedMap, NOW), movedMap),
    ackOpts: r(T.acknowledge(t, movedMap, { now: NOW }), movedMap),
    ackSame: T.acknowledge(t, byId, NOW) === t,
    base: s.meetings.map((m) => m.start),
    // 편람이 옮긴 시간과 겹치는 일정: 지금 편람(byId)으로 보면 겹치고, 적어 둔 값으로 보면 안 겹친다
    movedOverlap: (() => {
      const m0 = moved.sections.find((x) => x.no === s.no).meetings[0];
      const probe = [{ day: m0.day, start: m0.end - 10, end: m0.end + 50 }];
      return [T.overlapsWith(t, probe, { byId: movedMap }), T.overlapsWith(t, probe),
        T.addItem(t, T.customItem({ title: "약속", meetings: probe }), { byId: movedMap, now: NOW }).overlaps];
    })(),
  };
}

// 4-2) 항목 하나만 본 것으로(key: 항목 시트를 닫을 때), 사라진 까닭(missing: 과목째 / 분반만)
{
  const A = course("A", 3, [["001", [[0, 540, 615, "301"]]], ["002", [[1, 540, 615, "301"]]]]);
  const B = course("B", 2, [["001", [[2, 600, 690, "83"]]]]);
  const map = new Map([["A", A], ["B", B]]);
  let t = T.createTimetable([], "2026-2", { now: NOW });
  t = T.addItem(t, T.sectionItem(A, A.sections[0]), { now: NOW }).t;
  t = T.addItem(t, T.sectionItem(B, B.sections[0]), { now: NOW }).t;
  t = T.addItem(t, T.customItem({ title: "운동", meetings: [{ day: 4, start: 600, end: 660, building: "" }] }), { now: NOW }).t;
  const moved = new Map([["A", later(A, 30)], ["B", later(B, 30)]]);
  const one = T.acknowledge(t, moved, { key: "A-001", now: NOW });
  const st = (tt, m) => T.reconcile(tt, m).map((x) => [x.key, x.state, x.missing]);
  out.reconcile2 = {
    one: st(one, moved),
    oneSameObj: T.acknowledge(one, moved, { key: "A-001", now: NOW }) === one,
    none: st(t, map),
    noCourse: st(t, new Map([["A", A]])),
    noSection: st(t, new Map([["A", { ...A, sections: [A.sections[1]] }], ["B", B]])),
  };
}

// 5) 기기에 두기: 그대로 돌아오고, 어긋난 것은 버리고, 새 판은 지우지 않고 그대로 돌려준다. 대표는 하나만
{
  const c = courses[0], s = c.sections[0];
  let t = T.createTimetable([], "2026-2", { title: "저장", now: NOW });
  t = T.addItem(t, T.sectionItem(c, s), { now: NOW }).t;
  t = T.addItem(t, T.customItem({ title: "운동", meetings: [{ day: 6, start: 600, end: 660, building: "71" }], memo: "체육관" }), { now: NOW }).t;
  const raw = JSON.parse(JSON.stringify(T.serialize([t])));
  const back = T.parseList(raw, "2026-2");
  const newer = { v: 99, id: "tz", sem: "2026-2", title: "새 판", whatever: [1, 2] };
  const junk = [null, 3, { id: 5 }, { id: "ok", title: "", primary: true, items: [{ course: 1 }, { custom: "c1", title: "", meetings: [[7, 1, 2, "", ""], [1, 600, 700, "301", ""]], color: 9 }, { course: "X", no: "001", base: [[0, 900, 800, "", ""]], color: -1 }] }, { ...t, id: "dup", primary: true }];
  const parsed = T.parseList([...raw, newer, ...junk], "2026-2");
  out.storage = {
    same: JSON.stringify(back) === JSON.stringify([t]),
    ids: parsed.map((x) => x.id),
    newerKept: JSON.stringify(T.serialize(parsed).find((x) => x.id === "tz")) === JSON.stringify(newer),
    ok: parsed.find((x) => x.id === "ok"),
    primaries: parsed.filter((x) => x.primary).map((x) => x.id),
    notArray: T.parseList({ a: 1 }, "2026-2"),
    // 첫 탭 고르기: 읽은 값 그대로 보고 parseList 와 같은 답
    has: [[raw, true], [[newer], false], [[newer, ...raw], true], [[{ id: "nov", title: "판 없음" }], true], [junk.slice(0, 3), false], [[], false], [null, false], [{ a: 1 }, false]]
      .map(([v, want]) => T.hasTimetables(v) === want && T.hasTimetables(v) === T.parseList(v, "2026-2").filter((x) => !x._newer).length > 0),
    colorMode: ["cls", "item", undefined, null, "xyz", 3].map(T.colorMode),
    keys: T.STORE_KEYS,
  };
}

// 6) 이미지 파일에 담기: PNG 의 iTXt 조각에 넣고 그대로 다시 읽는다. 메모는 빼고, 다른 조각은 그대로, 깨지거나 없으면 알린다
{
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6; // 1×1, 8비트 RGBA
  const foreign = Buffer.concat([Buffer.from("Comment\0\0\0\0\0", "latin1"), Buffer.from("다른 프로그램이 넣은 글", "utf8")]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("tEXt", Buffer.from("Software\0paint", "latin1")),
    chunk("iTXt", foreign), chunk("IDAT", zlib.deflateSync(Buffer.from([0, 20, 40, 200, 255]))), chunk("IEND", Buffer.alloc(0))]);
  const types = (b) => { const out = []; for (let i = 8; i < b.length;) { const n = b.readUInt32BE(i); out.push(b.toString("latin1", i + 4, i + 8)); i += n + 12; } return out; };
  const crcs = (b) => { const bad = []; for (let i = 8; i < b.length;) { const n = b.readUInt32BE(i); if ((zlib.crc32(b.subarray(i + 4, i + 8 + n)) >>> 0) !== b.readUInt32BE(i + 8 + n)) bad.push(i); i += n + 12; } return bad; };

  const A = course("A", 3, [["001", [[0, 540, 615, "301"]]], ["002", [[1, 540, 615, "301"]]]]);
  let t = T.createTimetable([], "2026-2", { title: "내 시간표 ✓", now: NOW });
  t = T.addItem(t, T.sectionItem(A, A.sections[0], { meetings: [{ day: 0, start: 540, end: 615, building: "43-1", room: "101" }], alts: ["A-009"] }), { now: NOW }).t;
  t = T.addItem(t, T.customItem({ title: "동아리", meetings: [{ day: 4, start: 1080, end: 1200, building: "" }], memo: "비밀 메모" }), { now: NOW }).t;
  t = T.updateItem(t, "A-001", { color: 5 }, NOW);
  const png2 = Buffer.from(T.addTimetableToPng(new Uint8Array(png), t));
  const read = T.readTimetableImage(png2);
  const back = T.timetableFromImage(read.payload, [], { now: NOW });
  const again = Buffer.from(T.addTimetableToPng(png2.buffer.slice(png2.byteOffset, png2.byteOffset + png2.length), { ...t, title: "다시" }));
  const strip = (it) => { const { memo, ...rest } = it; return rest.custom ? { ...rest, custom: "c" } : rest; };
  const broken = Buffer.from(png2); broken[broken.length - 20] ^= 0xff; // 마지막 조각(IEND) 앞의 우리 조각 글 한 바이트
  const newer = Buffer.from(T.addTimetableToPng(new Uint8Array(png), t)); // 아래에서 v 를 바꾼 판
  const fakeNewer = (() => {
    const s = JSON.stringify({ ...T.imagePayload(t), v: 99 });
    const body = Buffer.concat([Buffer.from(T.IMAGE_KEY + "\0\0\0\0\0", "latin1"), Buffer.from(s, "utf8")]);
    return Buffer.concat([png.subarray(0, png.length - 12), chunk("iTXt", body), png.subarray(png.length - 12)]);
  })();
  const evil = { app: "ttwizard", v: 1, sem: "2026-2", title: "가".repeat(40), items: [{ course: 5 }, { custom: "x", title: "", meetings: [[9, 1, 2, "", ""], [2, 600, 660, "71", ""]], color: 12 }, "글자", null] };
  const full = Array.from({ length: T.PER_SEMESTER_MAX }, (_, k) => ({ id: "x" + k, title: "t" + k }));
  out.image = {
    types: types(png2), crcBad: crcs(png2), foreignKept: png2.includes(foreign),
    sameAsBefore: png2.subarray(0, png.length - 12).equals(png.subarray(0, png.length - 12)),
    payloadKeys: Object.keys(read.payload), memoGone: !JSON.stringify(read.payload).includes("비밀"),
    items: JSON.stringify(read.payload.items) === JSON.stringify(t.items.map(({ memo, ...it }) => it)),
    back: { sem: back.sem, title: back.title, primary: !!back.primary, source: back.source,
      items: JSON.stringify(back.items.map(strip)) === JSON.stringify(t.items.map(strip)),
      newCustomId: back.items.find((it) => it.custom).custom !== t.items.find((it) => it.custom).custom },
    againOne: types(again).filter((x) => x === "iTXt").length, againTitle: T.readTimetableImage(again).payload.title,
    problems: [T.readTimetableImage(png).problem, T.readTimetableImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])).problem,
      T.readTimetableImage(Buffer.from("hello")).problem, T.readTimetableImage(broken).problem,
      T.readTimetableImage(png2.subarray(0, png2.length - 30)).problem, T.readTimetableImage(fakeNewer).problem, T.readTimetableImage(null).problem],
    notPng: T.addTimetableToPng(Buffer.from("hello"), t) === null,
    evil: (() => { const x = T.timetableFromImage(evil, [{ id: "a", title: "가".repeat(30) }], { now: NOW }); return { title: x.title, items: x.items }; })(),
    full: T.timetableFromImage(read.payload, full) === null,
    dup: T.timetableFromImage(read.payload, [{ id: "a", title: "내 시간표 ✓" }], { now: NOW }).title,
    newerSize: newer.length > png.length,
    pngBase64: png2.toString("base64"),
  };
}

console.log(JSON.stringify(out));
