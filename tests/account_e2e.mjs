// 로그인·동기화·친구 끝까지 시험: Firebase 에뮬레이터(Auth 9099, Firestore 8085)에서 web/js/account.js 를 여러 사람(A·B·C·D)으로 돌린다.
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
out.profileA = await account.profile();
as("google-b", "friend@gmail.com");
const B = (await account.ready()).uid;
out.nickB = await account.setNick("친구");
out.found = await account.find(out.nickA.tag); // 번호만으로 누구인지(요청 전 확인)
out.request = await account.request(out.nickA.tag); // 번호만 넣어도 요청이 간다(사용자 11/17)
out.again = await account.request(`영표 #${out.nickA.tag}`); // 이미 보낸 요청: 다시 써서 막히지 않고 그대로(update111)
out.otherNick = await account.request(`딴이름#${out.nickA.tag}`); // 닉네임이 달라도 번호로 찾는다(바뀌기 전 초대 링크)
out.notFriendYet = await account.friendTimetables(out.request.uid).then(() => "read", (e) => e.code);
out.self = await account.request(`#${out.nickB.tag}`).catch((e) => e.code);
const unused = ["100000", "100001", "100002"].find((n) => ![out.nickA.tag, out.nickB.tag].includes(n));
out.missing = [await account.request("없는사람#0000").catch((e) => e.code), await account.request(unused).catch((e) => e.code),
  await account.request("012345").catch((e) => e.code), await account.find(unused).catch((e) => e.code)];
as("google-a", "yp@snu.ac.kr");
out.beforeA = await account.friends();
await account.accept(out.beforeA.incoming[0].uid);
out.afterA = await account.friends();
out.publishA = await account.sync(phoneA); // 닉네임이 있어 친구 사본도 올린다
as("google-b", "friend@gmail.com");
out.friendView = await account.friendTimetables(A);
out.alreadyFriend = await account.request(`영표#${out.nickA.tag}`).catch((e) => e.code);
out.friendsOfB = await account.friends(); // A 는 snu.ac.kr 이고 보이게 둠 → school
as("google-a", "yp@snu.ac.kr");
out.sameNick = await account.setNick("영표", { showSchool: false }); // 같은 닉네임: 번호 그대로, 학교 계정 숨기기만(update112)
out.renamed = await account.setNick("영표바꿈"); // 닉네임을 바꿔도 번호 그대로
as("google-b", "friend@gmail.com");
out.friendsOfB2 = await account.friends();
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
// 예전 네 자리 번호(옛 판 앱이 만든 프로필): 새 앱이 처음 프로필을 읽을 때 번호로 옮기고, 예전 초대 링크(닉네임#네 자리)는 계속 그 사람에게 간다
const owner = (path, fields) => fetch(`http://127.0.0.1:8085/v1/projects/demo-ttw/databases/(default)/documents/${path}`, {
  method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
as("google-d", "old@gmail.com");
const D = (await account.ready()).uid;
await owner(`handles/${encodeURIComponent("옛사람#0420")}`, { uid: { stringValue: D } });
await owner(`profiles/${D}`, { nick: { stringValue: "옛사람" }, tag: { stringValue: "0420" }, handle: { stringValue: "옛사람#0420" },
  showSchool: { booleanValue: true }, school: { booleanValue: false } });
out.migrated = await account.profile();
out.migratedAgain = await account.profile(); // 두 번째는 그대로
as("google-b", "friend@gmail.com");
out.oldLink = await account.request("옛사람#0420"); // 예전 초대 링크
out.newNumberD = await account.find(out.migrated.tag);
// 관리자가 번호 바꿔 주기: 관리자는 콘솔에서 만든 admins/{uid}(에뮬레이터에서는 owner 로 쓴다). B 가 관리자
const makeAdmin = (uid) => owner(`admins/${uid}`, { on: { booleanValue: true } });
as("google-a", "yp@snu.ac.kr");
out.notAdmin = [await account.isAdmin(), await account.adminSetTag(out.nickB.tag, "100003").catch((e) => e.code)];
as("google-c", "other@gmail.com");
out.nickC = await account.setNick("영표"); // 같은 닉네임의 다른 사람: 번호가 달라 서로 다른 사람이다
await makeAdmin(B);
as("google-b", "friend@gmail.com");
out.isAdminB = await account.isAdmin();
out.taken = await account.adminSetTag(out.nickA.tag, out.nickC.tag).catch((e) => e.code); // C 가 쓰는 번호
const newTag = ["100004", "100005", "100006"].find((t) => ![out.nickA.tag, out.nickB.tag, out.nickC.tag, out.migrated.tag].includes(t));
out.retag = await account.adminSetTag(` 영표 #${out.nickA.tag}`, newTag);
out.retagMissing = await account.adminSetTag(unused, "100007").catch((e) => e.code);
out.retagBad = [await account.adminSetTag("영표", "100008").catch((e) => e.code), await account.adminSetTag(newTag, "12a4").catch((e) => e.code),
  await account.adminSetTag(newTag, "012345").catch((e) => e.code)];
out.oldHandle = await account.request(out.nickA.tag).catch((e) => e.code); // 옛 번호는 '안 씀'(법무 11/17: 옛 링크가 남에게 가지 않게)
out.reuseRetired = await account.adminSetTag(out.nickC.tag, out.nickA.tag).catch((e) => e.code); // 거둔 번호는 다시 주지 않는다
as("google-a", "yp@snu.ac.kr");
out.profileRetag = await account.profile();
out.keepTag = await account.setNick("영표", { showSchool: true }); // 바뀐 번호 그대로 쓴다
// 막기: B 가 A 를 막으면 친구가 끊기고 A 는 다시 요청 못 한다
as("google-b", "friend@gmail.com");
await account.block(A);
out.blockedB = await account.friends();
as("google-a", "yp@snu.ac.kr");
out.blockedRequest = await account.request(`친구#${out.nickB.tag}`).catch((e) => e.code);
out.cantSee = await account.friendTimetables(B).then(() => "read", (e) => e.code);
// 계정 지우기
await account.deleteAccount();
as("google-b", "friend@gmail.com");
out.afterDelete = await account.friendTimetables(A).then((r) => r.length, () => "denied");
out.handleGone = await account.request(newTag).catch((e) => e.code); // 지운 계정의 번호도 '안 씀'으로 남아 없는 사람
// 예전 열쇠가 있던 사람(D)이 계정을 지우면 번호와 예전 열쇠도 같이 지운다
as("google-d", "old@gmail.com");
await account.deleteAccount();
as("google-b", "friend@gmail.com");
out.oldLinkGone = [await account.request("옛사람#0420").catch((e) => e.code), await account.request(out.migrated.tag).catch((e) => e.code)];
process.stdout.write(JSON.stringify(out) + "\n");

// 결과 확인(CI 가 여기서 멈추면 실패)
assert.equal(out.userA.school, true);
assert.equal(out.syncA.uploaded, 1);
assert.match(out.nickA.tag, /^[1-9]\d{5}$/);
assert.notEqual(out.nickA.tag, out.nickB.tag);
assert.deepEqual(out.found, { uid: A, nick: "영표", tag: out.nickA.tag, school: true });
assert.deepEqual(out.request, { uid: A, accepted: false });
assert.deepEqual(out.again, { uid: A, accepted: false });
assert.deepEqual(out.otherNick, { uid: A, accepted: false });
assert.equal(out.notFriendYet, "NOT_FRIEND");
assert.equal(out.self, "SELF");
assert.deepEqual(out.missing, ["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
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
assert.deepEqual(out.profileA, { nick: "영표", tag: out.nickA.tag, showSchool: true });
assert.deepEqual(out.friendsOfB.friends.map((x) => [x.nick, x.school]), [["영표", true]]);
assert.deepEqual(out.sameNick, { nick: "영표", tag: out.nickA.tag, showSchool: false });
assert.deepEqual(out.renamed, { nick: "영표바꿈", tag: out.nickA.tag, showSchool: false });
assert.deepEqual(out.friendsOfB2.friends.map((x) => [x.nick, x.tag, x.school]), [["영표바꿈", out.nickA.tag, false]]);
assert.deepEqual(out.forgotKeys, []);
assert.deepEqual(out.afterForgetList, ["t1"]); // 지움 표시를 올리지 않고 서버 것을 받았다
assert.equal(out.laptopList.length, 1);
assert.equal(out.laptopList[0].from, undefined); // 출발 지점은 서버에 없다
assert.deepEqual(out.laptopAfter, []);
assert.equal(out.blockedB.friends.length, 0);
assert.equal(out.blockedB.blocked.length, 1);
assert.equal(out.blockedRequest, "BLOCKED");
assert.equal(out.cantSee, "NOT_FRIEND");
assert.equal(out.afterDelete, "denied");
assert.equal(out.handleGone, "NOT_FOUND");
assert.match(out.migrated.tag, /^[1-9]\d{5}$/);
assert.deepEqual(out.migrated, { nick: "옛사람", tag: out.migrated.tag, showSchool: true });
assert.deepEqual(out.migratedAgain, out.migrated);
assert.deepEqual(out.oldLink, { uid: D, accepted: false });
assert.deepEqual(out.newNumberD, { uid: D, nick: "옛사람", tag: out.migrated.tag, school: false });
assert.deepEqual(out.oldLinkGone, ["NOT_FOUND", "NOT_FOUND"]);
assert.deepEqual(out.notAdmin, [false, "NOT_ADMIN"]);
assert.notEqual(out.nickC.tag, out.nickA.tag);
assert.equal(out.isAdminB, true);
assert.equal(out.taken, "TAKEN");
assert.deepEqual(out.retag, { nick: "영표", tag: newTag, from: out.nickA.tag });
assert.equal(out.retagMissing, "NOT_FOUND");
assert.deepEqual(out.retagBad, ["BAD_HANDLE", "BAD_TAG", "BAD_TAG"]);
assert.equal(out.oldHandle, "NOT_FOUND");
assert.equal(out.reuseRetired, "TAKEN");
assert.deepEqual(out.profileRetag, { nick: "영표", tag: newTag, showSchool: false });
assert.deepEqual(out.keepTag, { nick: "영표", tag: newTag, showSchool: true });
process.stdout.write("account e2e ok\n");
process.exit(0);
