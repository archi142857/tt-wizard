// Firestore 규칙 시험(update110): 에뮬레이터에서 firebase/firestore.rules 가 남의 자료를 막는지 본다.
//   cd firebase && npx firebase emulators:exec --only firestore --project demo-ttw "node ../tests/rules_test.mjs"
// (@firebase/rules-unit-testing, firebase 가 깔린 곳에서. 저장소의 시험(pytest)은 이 둘이 없으면 건너뛴다)
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-ttw",
  firestore: { rules: readFileSync(new URL("../firebase/firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
});
const db = (uid, token = {}) => env.authenticatedContext(uid, token).firestore();
const anon = env.unauthenticatedContext().firestore();
const results = [];
const check = async (name, p) => { try { await p; results.push([name, "ok"]); } catch (e) { results.push([name, "FAIL " + (e && e.message)]); } };

const nick = async (uid, name, tag) => {
  const d = db(uid), b = writeBatch(d), key = `${name.toLowerCase()}#${tag}`;
  b.set(doc(d, "handles", key), { uid });
  b.set(doc(d, "profiles", uid), { nick: name, tag, handle: key, updated: new Date() });
  return b.commit();
};
const tt = { id: "t1", sem: "2026-2", title: "시간표", updated: "2026-11-14T00:00:00.000Z", items: [] };

await check("내 시간표 쓰기", assertSucceeds(setDoc(doc(db("A"), "users", "A", "timetables", "t1"), tt)));
await check("남의 시간표 읽기 막음", assertFails(getDoc(doc(db("B"), "users", "A", "timetables", "t1"))));
await check("로그인 안 하면 막음", assertFails(getDoc(doc(anon, "profiles", "A"))));
await check("id 다른 문서 막음", assertFails(setDoc(doc(db("A"), "users", "A", "timetables", "t2"), tt)));
await check("닉네임 A", assertSucceeds(nick("A", "영표", "0420")));
await check("닉네임 B", assertSucceeds(nick("B", "친구", "1234")));
await check("닉네임 C", assertSucceeds(nick("C", "남남", "0001")));
await check("한 글자 닉네임 막음", assertFails(nick("D", "남", "0002")));
await check("남의 닉네임 열쇠 뺏기 막음", assertFails(nick("C", "영표", "0420")));
await check("열쇠 없이 프로필 막음", assertFails(setDoc(doc(db("C"), "profiles", "C"), { nick: "가짜", tag: "9999", handle: "가짜#9999", updated: new Date() })));
await check("친구 찾기(열쇠 읽기)", assertSucceeds(getDoc(doc(db("B"), "handles", "영표#0420"))));
await check("프로필 하나 읽기", assertSucceeds(getDoc(doc(db("B"), "profiles", "A"))));
// 목록째 읽기는 막는다(update116 보안 마무리): 로그인한 사람이 닉네임·학교 계정 표시를 모두 받아 가지 못하게
await check("닉네임 표 목록 막음", assertFails(getDocs(collection(db("B"), "handles"))));
await check("프로필 목록 막음", assertFails(getDocs(collection(db("B"), "profiles"))));
await check("프로필 찾기(조건) 막음", assertFails(getDocs(query(collection(db("B"), "profiles"), where("nick", "==", "영표")))));
// 학교 계정 표시(update112): 확인된 snu.ac.kr 메일이고 본인이 보이게 둔 때만 school: true
const prof = (name, tag, extra) => ({ nick: name, tag, handle: `${name.toLowerCase()}#${tag}`, updated: new Date(), ...extra });
const snu = { email: "yp@snu.ac.kr", email_verified: true };
await check("학교 계정 표시(snu.ac.kr)", assertSucceeds(setDoc(doc(db("A", snu), "profiles", "A"), prof("영표", "0420", { showSchool: true, school: true }))));
await check("학교 계정 숨기기", assertSucceeds(setDoc(doc(db("A", snu), "profiles", "A"), prof("영표", "0420", { showSchool: false, school: false }))));
await check("숨겼는데 학교 표시 막음", assertFails(setDoc(doc(db("A", snu), "profiles", "A"), prof("영표", "0420", { showSchool: false, school: true }))));
await check("gmail 이 학교 표시 막음", assertFails(setDoc(doc(db("B", { email: "x@gmail.com", email_verified: true }), "profiles", "B"), prof("친구", "1234", { showSchool: true, school: true }))));
await check("확인 안 된 메일 학교 표시 막음", assertFails(setDoc(doc(db("B", { email: "x@snu.ac.kr", email_verified: false }), "profiles", "B"), prof("친구", "1234", { showSchool: true, school: true }))));
await check("비슷한 도메인 막음", assertFails(setDoc(doc(db("B", { email: "x@snu.ac.kr.evil.com", email_verified: true }), "profiles", "B"), prof("친구", "1234", { showSchool: true, school: true }))));
await check("모르는 칸 막음", assertFails(setDoc(doc(db("B"), "profiles", "B"), prof("친구", "1234", { email: "x@gmail.com" }))));
await check("A→B 요청", assertSucceeds(setDoc(doc(db("A"), "requests", "A_B"), { from: "A", to: "B", state: "pending", created: new Date(), updated: new Date() })));
await check("남 이름으로 요청 막음", assertFails(setDoc(doc(db("C"), "requests", "B_C"), { from: "B", to: "C", state: "pending", created: new Date(), updated: new Date() })));
await check("보낸 사람이 수락 막음", assertFails(updateDoc(doc(db("A"), "requests", "A_B"), { state: "accepted", updated: new Date() })));
await check("남의 요청 읽기 막음", assertFails(getDoc(doc(db("C"), "requests", "A_B"))));
await check("받은 요청 목록", assertSucceeds(getDocs(query(collection(db("B"), "requests"), where("to", "==", "B")))));
await check("친구 되기 전 사본 읽기 막음", (async () => {
  await assertSucceeds(setDoc(doc(db("B"), "shared", "B", "terms", "2026-2"), { sem: "2026-2", title: "대표", items: [], updated: "x" }));
  await assertFails(getDoc(doc(db("A"), "shared", "B", "terms", "2026-2")));
})());
await check("받은 사람이 수락", assertSucceeds(updateDoc(doc(db("B"), "requests", "A_B"), { state: "accepted", updated: new Date() })));
await check("친구는 사본 읽음", assertSucceeds(getDocs(collection(db("A"), "shared", "B", "terms"))));
await check("친구 아니면 사본 막음", assertFails(getDocs(collection(db("C"), "shared", "B", "terms"))));
await check("남의 사본 쓰기 막음", assertFails(setDoc(doc(db("A"), "shared", "B", "terms", "2026-2"), { sem: "2026-2", title: "x", items: [], updated: "x" })));
await check("C 를 B 가 막음", assertSucceeds(setDoc(doc(db("B"), "blocks", "B", "list", "C"), { at: new Date() })));
await check("막힌 사람의 요청 막음", assertFails(setDoc(doc(db("C"), "requests", "C_B"), { from: "C", to: "B", state: "pending", created: new Date(), updated: new Date() })));
await check("남의 차단 목록 읽기 막음", assertFails(getDocs(collection(db("C"), "blocks", "B", "list"))));
await check("끊기(지우기)", assertSucceeds(deleteDoc(doc(db("A"), "requests", "A_B"))));
await check("끊은 뒤 사본 막음", assertFails(getDocs(collection(db("A"), "shared", "B", "terms"))));

// 관리자가 번호 바꿔 주기(update134): 콘솔에서 만든 admins/{uid} 만. 번호·열쇠만 바꾸고 닉네임은 그대로, 새 열쇠는 '닉네임#번호'
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "admins", "ADM"), { on: true }));
const retag = (uid, from, to, tag, extra = {}) => {
  const d = db(uid), b = writeBatch(d);
  b.delete(doc(d, "handles", from));
  b.set(doc(d, "handles", to), { uid: "B" });
  b.update(doc(d, "profiles", "B"), { tag, handle: to, updated: new Date(), ...extra });
  return b.commit();
};
await check("관리자 문서 만들기 막음", assertFails(setDoc(doc(db("A"), "admins", "A"), { on: true })));
await check("내 관리자 문서 읽기", assertSucceeds(getDoc(doc(db("ADM"), "admins", "ADM"))));
await check("남의 관리자 문서 읽기 막음", assertFails(getDoc(doc(db("A"), "admins", "ADM"))));
await check("관리자 아니면 남의 번호 바꾸기 막음", assertFails(retag("C", "친구#1234", "친구#0007", "0007")));
await check("관리자도 닉네임은 못 바꿈", assertFails(retag("ADM", "친구#1234", "딴이름#0007", "0007", { nick: "딴이름" })));
await check("관리자도 닉네임과 다른 열쇠 막음", assertFails(retag("ADM", "친구#1234", "남남#0007", "0007")));
await check("관리자도 열쇠만 바꾸기 막음", assertFails(setDoc(doc(db("ADM"), "handles", "친구#0008"), { uid: "B" })));
await check("관리자가 번호 바꿔 주기", assertSucceeds(retag("ADM", "친구#1234", "친구#0007", "0007")));
await check("바뀐 번호로 찾기", (async () => {
  const s = await getDoc(doc(db("A"), "handles", "친구#0007"));
  if (!s.exists() || s.data().uid !== "B") throw new Error("새 열쇠 없음");
  if ((await getDoc(doc(db("A"), "handles", "친구#1234"))).exists()) throw new Error("옛 열쇠 남음");
  if ((await getDoc(doc(db("A"), "profiles", "B"))).data().tag !== "0007") throw new Error("프로필 번호 그대로");
})());
await check("바뀐 뒤 본인은 그대로 쓴다", assertSucceeds(setDoc(doc(db("B"), "profiles", "B"), prof("친구", "0007", { showSchool: false, school: false }))));
await check("대문자·띄어 쓴 닉네임도 번호 바꿔 주기", assertSucceeds((async () => { // 열쇠는 소문자, 띄어쓰기 없이(sync.js handleKey)
  const d = db("D"), b = writeBatch(d);
  b.set(doc(d, "handles", "ttwizard#1111"), { uid: "D" });
  b.set(doc(d, "profiles", "D"), { nick: "TT Wizard", tag: "1111", handle: "ttwizard#1111", updated: new Date() });
  await b.commit();
  const a = db("ADM"), c = writeBatch(a);
  c.delete(doc(a, "handles", "ttwizard#1111"));
  c.set(doc(a, "handles", "ttwizard#2222"), { uid: "D" });
  c.update(doc(a, "profiles", "D"), { tag: "2222", handle: "ttwizard#2222", updated: new Date() });
  await c.commit();
})()));
await env.cleanup();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every(([, r]) => r === "ok") ? 0 : 1;
