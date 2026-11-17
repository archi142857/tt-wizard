// Firestore 규칙 시험: 에뮬레이터에서 firebase/firestore.rules 가 남의 자료를 막는지 본다.
//   cd firebase && npx firebase emulators:exec --only firestore --project demo-ttw "node ../tests/rules_test.mjs"
// (@firebase/rules-unit-testing, firebase 가 깔린 곳에서. 저장소의 시험(pytest)은 이 둘이 없으면 건너뛴다)
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-ttw",
  firestore: { rules: readFileSync(new URL("../firebase/firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
});
await env.clearFirestore();
const db = (uid, token = {}) => env.authenticatedContext(uid, token).firestore();
const anon = env.unauthenticatedContext().firestore();
const results = [];
const check = async (name, p) => { try { await p; results.push([name, "ok"]); } catch (e) { results.push([name, "FAIL " + (e && e.message)]); } };

// 지금 방식: 번호 문서와 프로필을 한 번에(account.js claimNumber)
const claim = (uid, name, n, extra = {}) => {
  const d = db(uid), b = writeBatch(d);
  b.set(doc(d, "numbers", n), { uid });
  b.set(doc(d, "profiles", uid), { nick: name, tag: n, updated: new Date(), ...extra });
  return b.commit();
};
// 옛 판 앱: 닉네임#네 자리 열쇠와 프로필
const legacy = (uid, name, tag) => {
  const d = db(uid), b = writeBatch(d), key = `${name.toLowerCase()}#${tag}`;
  b.set(doc(d, "handles", key), { uid });
  b.set(doc(d, "profiles", uid), { nick: name, tag, handle: key, updated: new Date() });
  return b.commit();
};
const prof = (name, tag, extra) => ({ nick: name, tag, updated: new Date(), ...extra });
const tt = { id: "t1", sem: "2026-2", title: "시간표", updated: "2026-11-14T00:00:00.000Z", items: [] };

// 내 시간표
await check("내 시간표 쓰기", assertSucceeds(setDoc(doc(db("A"), "users", "A", "timetables", "t1"), tt)));
await check("남의 시간표 읽기 막음", assertFails(getDoc(doc(db("B"), "users", "A", "timetables", "t1"))));
await check("로그인 안 하면 막음", assertFails(getDoc(doc(anon, "profiles", "A"))));
await check("id 다른 문서 막음", assertFails(setDoc(doc(db("A"), "users", "A", "timetables", "t2"), tt)));

// 계정 번호
await check("번호 받기 A", assertSucceeds(claim("A", "영표", "482193")));
await check("번호 받기 B", assertSucceeds(claim("B", "친구", "123456")));
await check("번호 받기 C", assertSucceeds(claim("C", "남남", "300000")));
await check("한 글자 닉네임 막음", assertFails(claim("D", "남", "200000")));
await check("남의 번호 뺏기 막음", assertFails(claim("D", "도둑", "482193")));
await check("0으로 시작하는 번호 막음", assertFails(claim("D", "도둑", "012345")));
await check("번호 문서 없이 프로필 막음", assertFails(setDoc(doc(db("D"), "profiles", "D"), prof("가짜", "999999"))));
await check("남 몫의 번호 만들기 막음", assertFails(setDoc(doc(db("D"), "numbers", "400000"), { uid: "A" })));
await check("프로필 없이 번호만 만들기 막음", assertFails(setDoc(doc(db("D"), "numbers", "400001"), { uid: "D" })));
await check("내 번호 바꾸기 막음", assertFails(claim("A", "영표", "482194")));
await check("번호로 찾기(하나 읽기)", assertSucceeds(getDoc(doc(db("B"), "numbers", "482193"))));
await check("번호 표 목록 막음", assertFails(getDocs(collection(db("B"), "numbers"))));
await check("닉네임 바꿔도 번호 그대로", assertSucceeds(setDoc(doc(db("A"), "profiles", "A"), prof("영표2", "482193"))));
await check("다시 원래 닉네임", assertSucceeds(setDoc(doc(db("A"), "profiles", "A"), prof("영표", "482193"))));
await check("번호만 지우기 막음(프로필이 쓰는 중)", assertFails(deleteDoc(doc(db("A"), "numbers", "482193"))));
await check("남의 번호 지우기 막음", assertFails(deleteDoc(doc(db("B"), "numbers", "482193"))));
await check("프로필 하나 읽기", assertSucceeds(getDoc(doc(db("B"), "profiles", "A"))));
// 목록째 읽기는 막는다: 로그인한 사람이 닉네임·학교 계정 표시를 모두 받아 가지 못하게
await check("프로필 목록 막음", assertFails(getDocs(collection(db("B"), "profiles"))));
await check("프로필 찾기(조건) 막음", assertFails(getDocs(query(collection(db("B"), "profiles"), where("nick", "==", "영표")))));

// 학교 계정 표시: 확인된 snu.ac.kr 메일이고 본인이 보이게 둔 때만 school: true
const snu = { email: "yp@snu.ac.kr", email_verified: true };
await check("학교 계정 표시(snu.ac.kr)", assertSucceeds(setDoc(doc(db("A", snu), "profiles", "A"), prof("영표", "482193", { showSchool: true, school: true }))));
await check("학교 계정 숨기기", assertSucceeds(setDoc(doc(db("A", snu), "profiles", "A"), prof("영표", "482193", { showSchool: false, school: false }))));
await check("숨겼는데 학교 표시 막음", assertFails(setDoc(doc(db("A", snu), "profiles", "A"), prof("영표", "482193", { showSchool: false, school: true }))));
await check("gmail 이 학교 표시 막음", assertFails(setDoc(doc(db("B", { email: "x@gmail.com", email_verified: true }), "profiles", "B"), prof("친구", "123456", { showSchool: true, school: true }))));
await check("확인 안 된 메일 학교 표시 막음", assertFails(setDoc(doc(db("B", { email: "x@snu.ac.kr", email_verified: false }), "profiles", "B"), prof("친구", "123456", { showSchool: true, school: true }))));
await check("비슷한 도메인 막음", assertFails(setDoc(doc(db("B", { email: "x@snu.ac.kr.evil.com", email_verified: true }), "profiles", "B"), prof("친구", "123456", { showSchool: true, school: true }))));
await check("모르는 칸 막음", assertFails(setDoc(doc(db("B"), "profiles", "B"), prof("친구", "123456", { email: "x@gmail.com" }))));
await check("예전 열쇠 새로 달기 막음", assertFails(setDoc(doc(db("A"), "profiles", "A"), prof("영표", "482193", { handle: "영표#0001" }))));

// 옛 판 앱(닉네임#네 자리): 번호를 받기 전에는 예전처럼, 받은 뒤에는 되돌리지 못한다
await check("옛 앱 닉네임", assertSucceeds(legacy("E", "옛사람", "0420")));
// 옛 앱은 닉네임을 바꾸면 예전 열쇠를 지우고 새 네 자리를 뽑았다. 풀린 열쇠를 남이 받으면 옛 초대 링크가 엉뚱한 사람에게 가서 막는다(법무 11/17 ⓓ)
await check("옛 앱 닉네임 바꾸기(예전 열쇠 풀기) 막음", assertFails((async () => {
  const d = db("E"), b = writeBatch(d);
  b.delete(doc(d, "handles", "옛사람#0420"));
  b.set(doc(d, "handles", "새이름#0777"), { uid: "E" });
  b.set(doc(d, "profiles", "E"), { nick: "새이름", tag: "0777", handle: "새이름#0777", updated: new Date() });
  await b.commit();
})()));
await check("옛 앱 학교 계정 보이기만", assertSucceeds(setDoc(doc(db("E"), "profiles", "E"), { nick: "옛사람", tag: "0420", handle: "옛사람#0420", updated: new Date(), showSchool: false, school: false })));
await check("예전 열쇠만 지우기 막음", assertFails(deleteDoc(doc(db("E"), "handles", "옛사람#0420"))));
await check("프로필 없이 예전 열쇠 만들기 막음", assertFails(setDoc(doc(db("D"), "handles", "가짜#1111"), { uid: "D" })));
await check("번호 받은 사람의 예전 열쇠 만들기 막음", assertFails((async () => {
  const d = db("A"), b = writeBatch(d);
  b.set(doc(d, "handles", "영표#1111"), { uid: "A" });
  b.set(doc(d, "profiles", "A"), { nick: "영표", tag: "1111", handle: "영표#1111", updated: new Date() });
  await b.commit();
})()));
await check("예전 열쇠로 찾기(옛 초대 링크)", assertSucceeds(getDoc(doc(db("B"), "handles", "옛사람#0420"))));
await check("예전 열쇠 목록 막음", assertFails(getDocs(collection(db("B"), "handles"))));
await check("옛 네 자리에서 새 번호로 한 번", assertSucceeds(claim("E", "옛사람", "555555", { handle: "옛사람#0420" })));
await check("새 번호를 네 자리로 되돌리기 막음", assertFails(setDoc(doc(db("E"), "profiles", "E"), { nick: "옛사람", tag: "0420", handle: "옛사람#0420", updated: new Date() })));
await check("넘어온 뒤에도 예전 열쇠로 찾기", (async () => {
  const s = await getDoc(doc(db("B"), "handles", "옛사람#0420"));
  if (!s.exists() || s.data().uid !== "E") throw new Error("예전 열쇠 없음");
})());

// 친구 요청·사본·차단
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

// 관리자가 번호 바꿔 주기: 콘솔에서 만든 admins/{uid} 만. 번호만 바꾸고 닉네임은 그대로
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "admins", "ADM"), { on: true }));
const retag = (by, uid, from, to, extra = {}) => {
  const d = db(by), b = writeBatch(d);
  if (from) b.set(doc(d, "numbers", from), { retired: true }); // 옛 번호는 '안 씀'으로
  b.set(doc(d, "numbers", to), { uid });
  b.update(doc(d, "profiles", uid), { tag: to, updated: new Date(), ...extra });
  return b.commit();
};
await check("관리자 문서 만들기 막음", assertFails(setDoc(doc(db("A"), "admins", "A"), { on: true })));
await check("내 관리자 문서 읽기", assertSucceeds(getDoc(doc(db("ADM"), "admins", "ADM"))));
await check("남의 관리자 문서 읽기 막음", assertFails(getDoc(doc(db("A"), "admins", "ADM"))));
await check("관리자 아니면 남의 번호 바꾸기 막음", assertFails(retag("C", "B", "123456", "100007")));
await check("관리자도 닉네임은 못 바꿈", assertFails(retag("ADM", "B", "123456", "100007", { nick: "딴이름" })));
await check("관리자도 번호 표만 바꾸기 막음", assertFails(setDoc(doc(db("ADM"), "numbers", "100008"), { uid: "B" })));
await check("관리자도 쓰는 번호 거두기 막음", assertFails(setDoc(doc(db("ADM"), "numbers", "123456"), { retired: true })));
await check("번호 지우기는 아무도 못 함", assertFails(deleteDoc(doc(db("ADM"), "numbers", "123456"))));
await check("관리자가 번호 바꿔 주기", assertSucceeds(retag("ADM", "B", "123456", "100007")));
await check("바뀐 번호로 찾기", (async () => {
  const s = await getDoc(doc(db("A"), "numbers", "100007"));
  if (!s.exists() || s.data().uid !== "B") throw new Error("새 번호 없음");
  const old = await getDoc(doc(db("A"), "numbers", "123456"));
  if (!old.exists() || old.data().uid || old.data().retired !== true) throw new Error("옛 번호가 '안 씀'이 아님");
  if ((await getDoc(doc(db("A"), "profiles", "B"))).data().tag !== "100007") throw new Error("프로필 번호 그대로");
})());
await check("거둔 번호 다시 받기 막음", assertFails(claim("D", "도둑", "123456")));
await check("관리자도 거둔 번호 다시 주기 막음", assertFails(retag("ADM", "B", "100007", "123456")));
await check("바뀐 뒤 본인은 그대로 쓴다", assertSucceeds(setDoc(doc(db("B"), "profiles", "B"), prof("친구", "100007", { showSchool: false, school: false }))));
await check("관리자가 옛 네 자리 사람에게 번호", assertSucceeds((async () => {
  await legacy("F", "옛친구", "0001");
  await retag("ADM", "F", null, "100009");
  const p = (await getDoc(doc(db("A"), "profiles", "F"))).data();
  if (p.tag !== "100009" || p.handle !== "옛친구#0001") throw new Error("번호·예전 열쇠");
})()));

// 계정 지우기: 번호는 프로필을 같이 지울 때만 거둔다(누구 것이었는지만 지우고 '안 씀'으로 남김)
await check("프로필 두고 내 번호 거두기 막음", assertFails(setDoc(doc(db("A"), "numbers", "482193"), { retired: true })));
await check("남의 번호 거두기 막음", assertFails(setDoc(doc(db("B"), "numbers", "100009"), { retired: true })));
await check("계정 지울 때 번호 거두고 프로필 지우기", assertSucceeds((async () => {
  const d = db("A"), b = writeBatch(d);
  b.set(doc(d, "numbers", "482193"), { retired: true });
  b.delete(doc(d, "profiles", "A"));
  await b.commit();
})()));
await check("거둔 번호는 누구 것인지 없이 남는다", (async () => {
  const s = await getDoc(doc(db("B"), "numbers", "482193"));
  if (!s.exists() || s.data().uid || s.data().retired !== true) throw new Error("거둔 번호");
})());
await check("거둔 번호 남이 받기 막음", assertFails(claim("D", "도둑", "482193")));
await check("옛 판 앱의 계정 지우기(새 번호 받은 뒤)", assertSucceeds((async () => { // 옛 앱은 '닉네임#번호' 열쇠(없음)와 프로필을 지운다
  const d = db("E"), b = writeBatch(d);
  b.delete(doc(d, "handles", "옛사람#555555"));
  b.delete(doc(d, "profiles", "E"));
  await b.commit();
})()));
await check("남은 예전 열쇠 거두기(본인)", assertSucceeds(setDoc(doc(db("E"), "handles", "옛사람#0420"), { retired: true })));
await check("거둔 예전 열쇠 남이 받기 막음", assertFails(legacy("G", "옛사람", "0420")));
await check("옛 판 앱의 계정 지우기(번호 받기 전)", assertSucceeds((async () => {
  await legacy("H", "지울사람", "0042");
  const d = db("H"), b = writeBatch(d);
  b.delete(doc(d, "handles", "지울사람#0042"));
  b.delete(doc(d, "profiles", "H"));
  await b.commit();
})()));
await env.cleanup();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every(([, r]) => r === "ok") ? 0 : 1;
