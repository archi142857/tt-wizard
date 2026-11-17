// 로그인·동기화·친구 끝까지 시험: Firebase 에뮬레이터(Auth 9099, Firestore 8085)에서 web/js/account.js 를 여러 사람(A·B·C·D·E·R·S)으로 돌린다.
//   cd firebase && npx firebase emulators:exec --only auth,firestore --project demo-ttw "node ../tests/account_e2e.mjs"
import * as appM from "firebase/app";
import * as authM from "firebase/auth";
import * as fsM from "firebase/firestore";
import * as account from "../web/js/account.js";
import assert from "node:assert/strict";

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { get: (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), keys: () => [...m.keys()],
    remove: (k) => m.delete(k), m };
};
const as = (sub, email) => account.configure({
  sdk: { app: appM, auth: authM, firestore: fsM },
  config: { apiKey: "demo-key", projectId: "demo-ttw", authDomain: "demo-ttw.firebaseapp.com" },
  connect: async ({ auth, db }) => {
    authM.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fsM.connectFirestoreEmulator(db, "127.0.0.1", 8085);
    await authM.signInWithCredential(auth, authM.GoogleAuthProvider.credential(JSON.stringify({ sub: sub, email, email_verified: true })));
  },
});
// 에뮬레이터 주인(규칙을 거치지 않음)으로 쓰고 읽기: 옛 판 앱이 남긴 자료를 만들고, 서버에 무엇이 남았는지 본다
const base = "http://127.0.0.1:8085/v1/projects/demo-ttw/databases/(default)/documents";
const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
const owner = (path, fields) => fetch(`${base}/${enc(path)}`, {
  method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
const value = (v) => ("stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue : "timestampValue" in v ? "time" : null);
const peek = async (path) => {
  const r = await fetch(`${base}/${enc(path)}`, { headers: { Authorization: "Bearer owner" } });
  if (r.status === 404) return null;
  const j = await r.json();
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, value(v)]));
};
const str = (s) => ({ stringValue: s });
const int = (n) => ({ integerValue: String(n) });
const no = (p) => p.then(() => "ok", (e) => e.code);
const today = Math.floor(Date.now() / 86400000); // 하루 요청 수·신고의 날(세계 표준시 날짜, 규칙 today())
const out = {};
const t1 = { v: 1, id: "t1", sem: "2026-2", title: "시간표 1", created: "2026-11-01T00:00:00.000Z", updated: "2026-11-10T00:00:00.000Z", source: "manual", primary: true,
  from: { home: "919", mode: "slope" },
  items: [{ course: "881.007", no: "001", name: "유전학", instructor: "김교수", credit: 3, cls: "전필", base: [[0, 630, 705, "83", "201"]] },
          { custom: "c1", title: "병원", meetings: [[2, 600, 660, "", ""]], hidden: true }, { custom: "c2", title: "동아리", meetings: [[4, 1080, 1200, "63", "1층"]], memo: "회비" }] };
const phoneA = store({ "timetables@2026-2": [t1] });

as("google-a", "yp@snu.ac.kr");
out.userA = await account.ready();
const A = out.userA.uid;
out.statusBefore = account.syncStatus(phoneA);
out.syncA = await account.sync(phoneA);
out.statusAfter = account.syncStatus(phoneA);
out.lastSaved = phoneA.get("syncLast");
out.nickA = await account.setNick("영표");
const tagA = out.nickA.tag;
out.profileA = await account.profile();
out.serverA = [await peek(`numbers/${tagA}`), await peek(`handles/영표#${tagA}`), await peek(`profiles/${A}`)];
as("google-b", "friend@gmail.com");
const B = (await account.ready()).uid;
out.nickB = await account.setNick("친구");
const tagB = out.nickB.tag;
out.found = await account.find(`영표#${tagA}`); // 닉네임#번호로 누구인지(요청 전 확인)
out.request = await account.request(`영표#${tagA}`);
out.again = await account.request(` 영표 # ${tagA} `); // 이미 보낸 요청: 다시 써서 막히지 않고 그대로(update111). 하루 요청 수도 그대로
out.limitB = await peek(`limits/${B}`);
out.notFriendYet = await account.friendTimetables(A).then(() => "read", (e) => e.code);
out.self = await account.request(`친구#${tagB}`).catch((e) => e.code);
const unused = ["100000", "100001", "100002"].find((n) => ![tagA, tagB].includes(n));
// 번호만·닉네임이 다름·없는 번호·0 으로 시작·없는 예전 열쇠: 모두 '없는 사람'(화면은 '닉네임이나 번호가 맞지 않아요'만, 법무 11/17)
out.missing = [];
for (const text of [tagA, `#${tagA}`, `딴이름#${tagA}`, `영표#${unused}`, "영표#012345", "없는사람#0000"]) out.missing.push(await no(account.request(text)));
out.missingFind = [await no(account.find(tagA)), await no(account.find(`딴이름#${tagA}`))];
as("google-a", "yp@snu.ac.kr");
out.beforeA = await account.friends();
await account.accept(out.beforeA.incoming[0].uid);
out.afterA = await account.friends();
out.publishA = await account.sync(phoneA); // 닉네임이 있어 친구 사본도 올린다
as("google-b", "friend@gmail.com");
out.friendView = await account.friendTimetables(A);
out.alreadyFriend = await account.request(`영표#${tagA}`).catch((e) => e.code);
out.friendsOfB = await account.friends(); // A 는 snu.ac.kr 이고 보이게 둠 → school
as("google-a", "yp@snu.ac.kr");
out.sameNick = await account.setNick("영표", { showSchool: false }); // 같은 닉네임: 번호 그대로, 학교 계정 숨기기만(update112)
out.renamed = await account.setNick("영표바꿈"); // 닉네임을 바꿔도 번호 그대로, 예전 열쇠는 지운다
out.renamedKeys = [await peek(`handles/영표#${tagA}`), await peek(`handles/영표바꿈#${tagA}`)];
as("google-b", "friend@gmail.com");
out.friendsOfB2 = await account.friends();
out.afterRename = [await no(account.find(`영표#${tagA}`)), (await account.find(`영표바꿈#${tagA}`)).uid]; // 바꾸기 전 링크는 열리지 않는다
as("google-a", "yp@snu.ac.kr");
await account.setNick("영표");
// A 의 다른 기기: 비어 있다가 서버에서 받는다
as("google-a", "yp@snu.ac.kr");
const laptopA = store({});
out.laptop = await account.sync(laptopA);
out.laptopList = laptopA.get("timetables@2026-2");
// 로그아웃하며 기기 시간표를 지울 때 forget 을 같이 부르면, 다시 로그인해도 서버 것을 지우지 않고 받는다(update112)
const wiped = store({ "timetables@2026-2": [t1] });
await account.sync(wiped);
wiped.m.delete("timetables@2026-2");
account.forget(wiped);
out.forgotKeys = wiped.keys();
out.afterForget = await account.sync(wiped);
out.afterForgetList = (wiped.get("timetables@2026-2") || []).map((t) => t.id);
// 이 기기에서 지우면 다른 기기에서도 지운다
phoneA.set("timetables@2026-2", []);
out.deleteSync = await account.sync(phoneA);
out.laptop2 = await account.sync(laptopA);
out.laptopAfter = laptopA.get("timetables@2026-2");

// 예전 네 자리 번호(옛 판 앱이 만든 프로필): 새 앱이 처음 프로필을 읽을 때 번호를 받고, 네 자리 열쇠는 예전 열쇠로 남겨 그때 초대 링크가 열린다
as("google-d", "old@gmail.com");
const D = (await account.ready()).uid;
await owner("handles/옛사람#0420", { uid: str(D) });
await owner(`profiles/${D}`, { nick: str("옛사람"), tag: str("0420"), handle: str("옛사람#0420"), showSchool: { booleanValue: true }, school: { booleanValue: false } });
out.migrated = await account.profile();
out.migratedAgain = await account.profile(); // 두 번째는 그대로
const tagD = out.migrated.tag;
out.migratedDoc = await peek(`profiles/${D}`);
as("google-b", "friend@gmail.com");
out.oldLink = await account.request("옛사람#0420"); // 예전 초대 링크
out.newKeyD = await account.find(`옛사람#${tagD}`);
out.numberOnlyD = await no(account.find(tagD));
// update136 판 앱이 만든 프로필: 번호는 있는데 찾는 열쇠가 없다(S) / 열쇠 칸에 네 자리 열쇠가 있다(R). 새 앱이 처음 읽을 때 고친다
const known = () => [tagA, tagB, tagD, unused];
as("google-r", "r@gmail.com");
const R = (await account.ready()).uid;
const tagR = ["200001", "200002", "200003"].find((n) => !known().includes(n));
await owner(`numbers/${tagR}`, { uid: str(R) });
await owner("handles/옛판#0101", { uid: str(R) });
await owner(`profiles/${R}`, { nick: str("옛판"), tag: str(tagR), handle: str("옛판#0101"), showSchool: { booleanValue: true }, school: { booleanValue: false } });
out.fixedR = await account.profile();
out.fixedDocR = await peek(`profiles/${R}`);
as("google-s", "s@gmail.com");
const S = (await account.ready()).uid;
const tagS = ["200004", "200005", "200006"].find((n) => !known().includes(n) && n !== tagR);
await owner(`numbers/${tagS}`, { uid: str(S) });
await owner(`profiles/${S}`, { nick: str("새판"), tag: str(tagS), showSchool: { booleanValue: true }, school: { booleanValue: false } });
out.fixedS = await account.setNick("새판"); // 닉네임 저장에서도 고친다
out.fixedDocS = await peek(`profiles/${S}`);
as("google-b", "friend@gmail.com");
out.foundR = [(await account.find(`옛판#${tagR}`)).uid, (await account.request("옛판#0101")).uid];
out.foundS = (await account.find(`새판#${tagS}`)).uid;

// 하루 요청 수(20개): E 는 오늘 19개를 보낸 것으로 두고 시작한다
as("google-e", "e@gmail.com");
const E = (await account.ready()).uid;
out.nickE = await account.setNick("Tt_Lim");
const tagE = out.nickE.tag;
await owner(`limits/${E}`, { day: int(today), sent: int(19) });
out.twentieth = await account.request(`영표#${tagA}`);
out.limited = await no(account.request(`친구#${tagB}`));
out.limitE = await peek(`limits/${E}`);
await owner(`limits/${E}`, { day: int(today - 1), sent: int(20) }); // 어제 다 썼어도 오늘은 다시 1부터
out.nextDay = await account.request(`친구#${tagB}`);
out.limitE2 = await peek(`limits/${E}`);
as("google-b", "friend@gmail.com");
out.caseFree = await account.find(`tt_lim#${tagE}`); // 열쇠는 대소문자 차이 없이

// 관리자가 번호 바꿔 주기: 관리자는 콘솔에서 만든 admins/{uid}(에뮬레이터에서는 owner 로 쓴다). B 가 관리자
const makeAdmin = (uid) => owner(`admins/${uid}`, { on: { booleanValue: true } });
as("google-a", "yp@snu.ac.kr");
out.notAdmin = [await account.isAdmin(), await no(account.adminSetTag(`친구#${tagB}`, "100003")), await no(account.listReports())];
as("google-c", "other@gmail.com");
const C = (await account.ready()).uid;
out.nickC = await account.setNick("영표"); // 같은 닉네임의 다른 사람: 번호가 달라 서로 다른 사람이다
const tagC = out.nickC.tag;
await makeAdmin(B);
as("google-b", "friend@gmail.com");
out.isAdminB = await account.isAdmin();
out.taken = await no(account.adminSetTag(`영표#${tagA}`, tagC)); // C 가 쓰는 번호
const used = new Set([...known(), tagR, tagS, tagE, tagC]);
const fresh = () => { for (let n = 100004; ; n++) if (!used.has(String(n))) { used.add(String(n)); return String(n); } };
const newTag = fresh(), newTagC = fresh();
out.retag = await account.adminSetTag(` 영표 #${tagA}`, newTag);
out.retagByNumber = await account.adminSetTag(tagC, newTagC); // 관리자는 번호만으로도 찾는다
out.retagServer = [await peek(`numbers/${tagA}`), await peek(`numbers/${newTag}`), await peek(`handles/영표#${tagA}`), await peek(`handles/영표#${newTag}`)];
const nobody = fresh();
out.retagMissing = [await no(account.adminSetTag(`영표#${nobody}`, fresh())), await no(account.adminSetTag(nobody, fresh()))];
out.retagBad = [await no(account.adminSetTag("영표", "100008")), await no(account.adminSetTag(`영표#${newTag}`, "12a4")),
  await no(account.adminSetTag(`영표#${newTag}`, "012345"))];
out.oldHandle = await no(account.request(`영표#${tagA}`)); // 옛 번호의 열쇠는 지웠다
out.reuseRetired = await no(account.adminSetTag(`영표#${newTagC}`, tagA)); // 거둔 번호는 다시 주지 않는다
as("google-a", "yp@snu.ac.kr");
out.profileRetag = await account.profile();
out.keepTag = await account.setNick("영표", { showSchool: true }); // 바뀐 번호 그대로 쓴다
as("google-c", "other@gmail.com");
out.profileC = await account.profile();

// 닉네임 신고(앱 안 목록): 신고는 누구나, 읽고 처리 표시는 관리자(B)만
as("google-a", "yp@snu.ac.kr");
const pC = await account.find(`영표#${newTagC}`);
out.report = await account.report(pC, "impersonation", "  저랑 같은 닉네임이에요  ");
out.reportAgain = await no(account.report(pC, "nick")); // 같은 사람은 하루 한 번
out.reportBad = [await no(account.report(pC, "spam")), await no(account.report({ uid: A, nick: "영표", tag: newTag }, "nick")), await no(account.report(null, "nick"))];
out.reportList = await no(account.listReports());
as("google-d", "old@gmail.com");
out.report2 = await account.report(pC, "stranger", "가".repeat(250)); // 덧붙임 글은 200자까지
as("google-b", "friend@gmail.com");
out.open = await account.listReports();
await account.closeReport(out.report.id);
out.openAfter = (await account.listReports()).map((r) => r.id);
out.all = await account.listReports({ all: true });
as("google-a", "yp@snu.ac.kr");
out.closeNotAdmin = await no(account.closeReport(out.report2.id));

// 막기: B 가 A 를 막으면 친구가 끊기고 A 는 다시 요청 못 한다(막힌 요청은 하루 요청 수에 들지 않는다)
as("google-b", "friend@gmail.com");
await account.block(A);
out.blockedB = await account.friends();
as("google-a", "yp@snu.ac.kr");
out.blockedRequest = await no(account.request(`친구#${tagB}`));
out.limitA = await peek(`limits/${A}`);
out.cantSee = await account.friendTimetables(B).then(() => "read", (e) => e.code);
// 계정 지우기: 번호는 '안 씀'으로 남기고(다시 주지 않음), 닉네임이 든 열쇠와 프로필은 지운다
await account.deleteAccount();
as("google-b", "friend@gmail.com");
out.afterDelete = await account.friendTimetables(A).then((r) => r.length, () => "denied");
out.handleGone = await no(account.request(`영표#${newTag}`));
out.leftA = [await peek(`numbers/${newTag}`), await peek(`handles/영표#${newTag}`), await peek(`profiles/${A}`)];
// 예전 열쇠가 있던 사람(D)이 계정을 지우면 예전 열쇠도 지운다
as("google-d", "old@gmail.com");
await account.deleteAccount();
as("google-b", "friend@gmail.com");
out.oldLinkGone = [await no(account.request("옛사람#0420")), await no(account.request(`옛사람#${tagD}`))];
out.leftD = [await peek(`numbers/${tagD}`), await peek("handles/옛사람#0420"), await peek(`handles/옛사람#${tagD}`)];
// 하루 요청 수도 계정과 같이 지운다
as("google-e", "e@gmail.com");
await account.deleteAccount();
out.leftE = [await peek(`limits/${E}`), await peek(`profiles/${E}`), await peek(`handles/tt_lim#${tagE}`)];
process.stdout.write(JSON.stringify(out) + "\n");

// 결과 확인(CI 가 여기서 멈추면 실패)
assert.equal(out.userA.school, true);
assert.equal(out.syncA.uploaded, 1);
assert.match(tagA, /^[1-9]\d{5}$/);
assert.notEqual(tagA, tagB);
assert.deepEqual(out.serverA.slice(0, 2), [{ uid: A }, { uid: A }]);
assert.equal(out.serverA[2].handle, `영표#${tagA}`);
assert.ok(!("oldHandle" in out.serverA[2]));
assert.deepEqual(out.found, { uid: A, nick: "영표", tag: tagA, school: true });
assert.deepEqual(out.request, { uid: A, accepted: false });
assert.deepEqual(out.again, { uid: A, accepted: false });
assert.deepEqual(out.limitB, { day: today, sent: 1 });
assert.equal(out.notFriendYet, "NOT_FRIEND");
assert.equal(out.self, "SELF");
assert.deepEqual(out.missing, Array(6).fill("NOT_FOUND"));
assert.deepEqual(out.missingFind, ["NOT_FOUND", "NOT_FOUND"]);
assert.deepEqual(out.beforeA.incoming.map((x) => x.nick), ["친구"]);
assert.deepEqual(out.afterA.friends.map((x) => x.nick), ["친구"]);
const view = out.friendView.find((t) => t.sem === "2026-2");
assert.ok(view, "친구 사본");
assert.deepEqual(view.items.map((x) => x.name || x.title || (x.hidden && "숨김")), ["유전학", "숨김", "동아리"]);
assert.deepEqual(view.items[1], { hidden: true, meetings: [{ day: 2, start: 600, end: 660 }] }); // 숨긴 '병원'은 시간만(회색 칸, update112)
const seen = JSON.stringify(out.friendView);
assert.ok(!seen.includes("병원") && !seen.includes("회비") && !seen.includes("김교수") && !seen.includes("919"));
assert.deepEqual(view.items[2].meetings, [{ day: 4, start: 1080, end: 1200, building: "", room: "" }]); // 일정 장소는 안 보인다
assert.equal(out.alreadyFriend, "ALREADY");
assert.deepEqual(out.statusBefore, { state: "idle", last: null });
assert.equal(out.statusAfter.state, "idle");
assert.ok(out.statusAfter.last && out.lastSaved.at === out.statusAfter.last && out.lastSaved.uid === A);
assert.deepEqual(out.profileA, { nick: "영표", tag: tagA, showSchool: true });
assert.deepEqual(out.friendsOfB.friends.map((x) => [x.nick, x.school]), [["영표", true]]);
assert.deepEqual(out.sameNick, { nick: "영표", tag: tagA, showSchool: false });
assert.deepEqual(out.renamed, { nick: "영표바꿈", tag: tagA, showSchool: false });
assert.deepEqual(out.renamedKeys, [null, { uid: A }]);
assert.deepEqual(out.friendsOfB2.friends.map((x) => [x.nick, x.tag, x.school]), [["영표바꿈", tagA, false]]);
assert.deepEqual(out.afterRename, ["NOT_FOUND", A]);
assert.deepEqual(out.forgotKeys, []);
assert.deepEqual(out.afterForgetList, ["t1"]); // 지움 표시를 올리지 않고 서버 것을 받았다
assert.equal(out.laptopList.length, 1);
assert.equal(out.laptopList[0].from, undefined); // 출발 지점은 서버에 없다
assert.deepEqual(out.laptopAfter, []);
assert.match(tagD, /^[1-9]\d{5}$/);
assert.deepEqual(out.migrated, { nick: "옛사람", tag: tagD, showSchool: true });
assert.deepEqual(out.migratedAgain, out.migrated);
assert.equal(out.migratedDoc.handle, `옛사람#${tagD}`);
assert.equal(out.migratedDoc.oldHandle, "옛사람#0420");
assert.deepEqual(out.oldLink, { uid: D, accepted: false });
assert.deepEqual(out.newKeyD, { uid: D, nick: "옛사람", tag: tagD, school: false });
assert.equal(out.numberOnlyD, "NOT_FOUND");
assert.deepEqual(out.fixedR, { nick: "옛판", tag: tagR, showSchool: true });
assert.equal(out.fixedDocR.handle, `옛판#${tagR}`);
assert.equal(out.fixedDocR.oldHandle, "옛판#0101");
assert.deepEqual(out.fixedS, { nick: "새판", tag: tagS, showSchool: true });
assert.equal(out.fixedDocS.handle, `새판#${tagS}`);
assert.ok(!("oldHandle" in out.fixedDocS));
assert.deepEqual(out.foundR, [R, R]);
assert.equal(out.foundS, S);
assert.deepEqual(out.twentieth, { uid: A, accepted: false });
assert.equal(out.limited, "LIMIT");
assert.deepEqual(out.limitE, { day: today, sent: 20 });
assert.deepEqual(out.nextDay, { uid: B, accepted: false });
assert.deepEqual(out.limitE2, { day: today, sent: 1 });
assert.deepEqual(out.caseFree, { uid: E, nick: "Tt_Lim", tag: tagE, school: false });
assert.deepEqual(out.notAdmin, [false, "NOT_ADMIN", "NOT_ADMIN"]);
assert.notEqual(tagC, tagA);
assert.equal(out.isAdminB, true);
assert.equal(out.taken, "TAKEN");
assert.deepEqual(out.retag, { nick: "영표", tag: newTag, from: tagA });
assert.deepEqual(out.retagByNumber, { nick: "영표", tag: newTagC, from: tagC });
assert.deepEqual(out.retagServer, [{ retired: true }, { uid: A }, null, { uid: A }]);
assert.deepEqual(out.retagMissing, ["NOT_FOUND", "NOT_FOUND"]);
assert.deepEqual(out.retagBad, ["BAD_HANDLE", "BAD_TAG", "BAD_TAG"]);
assert.equal(out.oldHandle, "NOT_FOUND");
assert.equal(out.reuseRetired, "TAKEN");
assert.deepEqual(out.profileRetag, { nick: "영표", tag: newTag, showSchool: false });
assert.deepEqual(out.keepTag, { nick: "영표", tag: newTag, showSchool: true });
assert.deepEqual(out.profileC, { nick: "영표", tag: newTagC, showSchool: true });
assert.deepEqual(out.report, { id: `${A}_${C}_${today}` });
assert.equal(out.reportAgain, "ALREADY");
assert.deepEqual(out.reportBad, ["BAD_REASON", "SELF", "NOT_FOUND"]);
assert.equal(out.reportList, "NOT_ADMIN");
assert.deepEqual(out.report2, { id: `${D}_${C}_${today}` });
assert.deepEqual(out.open.map((r) => r.id), [out.report2.id, out.report.id]); // 새것 먼저
const r1 = out.open[1];
assert.deepEqual({ ...r1, created: typeof r1.created }, { id: out.report.id, reporter: A, target: C, handle: `영표#${newTagC}`, reason: "impersonation",
  note: "저랑 같은 닉네임이에요", state: "open", created: "string", closed: null });
assert.equal(out.open[0].note, "가".repeat(200));
assert.deepEqual(out.openAfter, [out.report2.id]);
assert.deepEqual(out.all.map((r) => [r.id, r.state, typeof r.closed]), [[out.report2.id, "open", "object"], [out.report.id, "closed", "string"]]);
assert.equal(out.closeNotAdmin, "NOT_ADMIN");
assert.equal(out.blockedB.friends.length, 0);
assert.equal(out.blockedB.blocked.length, 1);
assert.equal(out.blockedRequest, "BLOCKED");
assert.equal(out.limitA, null);
assert.equal(out.cantSee, "NOT_FRIEND");
assert.equal(out.afterDelete, "denied");
assert.equal(out.handleGone, "NOT_FOUND");
assert.deepEqual(out.leftA, [{ retired: true }, null, null]);
assert.deepEqual(out.oldLinkGone, ["NOT_FOUND", "NOT_FOUND"]);
assert.deepEqual(out.leftD, [{ retired: true }, null, null]);
assert.deepEqual(out.leftE, [null, null, null]);
process.stdout.write("account e2e ok\n");
process.exit(0);
