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
const db = (uid) => env.authenticatedContext(uid).firestore();
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
await env.cleanup();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every(([, r]) => r === "ok") ? 0 : 1;
