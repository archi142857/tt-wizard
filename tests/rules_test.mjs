// Firestore 규칙 시험: 에뮬레이터에서 firebase/firestore.rules 가 남의 자료를 막는지 본다.
//   cd firebase && npx firebase emulators:exec --only firestore --project demo-ttw "node ../tests/rules_test.mjs"
// (@firebase/rules-unit-testing, firebase 가 깔린 곳에서. 저장소의 시험(pytest)은 이 둘이 없으면 건너뛴다)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch, Timestamp, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-ttw",
  firestore: { rules: readFileSync(new URL("../firebase/firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
});
await env.clearFirestore();
const db = (uid, token = {}) => env.authenticatedContext(uid, token).firestore();
const anon = env.unauthenticatedContext().firestore();
const owner = (f) => env.withSecurityRulesDisabled((ctx) => f(ctx.firestore()));
const results = [];
const check = async (name, p) => { try { await p; results.push([name, "ok"]); } catch (e) { results.push([name, "FAIL " + (e && e.message)]); } };
const today = Math.floor(Date.now() / 86400000); // 규칙의 today()(세계 표준시 날짜)
const key = (nick, tag) => `${nick.toLowerCase().replace(/\s/g, "")}#${tag}`; // sync.js handleKey

// 지금 방식: 번호·찾는 열쇠·프로필을 한 번에(account.js claimNumber)
const claim = (uid, nick, n, extra = {}) => {
  const d = db(uid), b = writeBatch(d);
  b.set(doc(d, "numbers", n), { uid });
  b.set(doc(d, "handles", key(nick, n)), { uid });
  b.set(doc(d, "profiles", uid), { nick, tag: n, handle: key(nick, n), updated: new Date(), ...extra });
  return b.commit();
};
// 옛 판 앱: 닉네임#네 자리 열쇠와 프로필
const legacy = (uid, nick, tag) => {
  const d = db(uid), b = writeBatch(d);
  b.set(doc(d, "handles", key(nick, tag)), { uid });
  b.set(doc(d, "profiles", uid), { nick, tag, handle: key(nick, tag), updated: new Date() });
  return b.commit();
};
const prof = (nick, tag, extra) => ({ nick, tag, handle: key(nick, tag), updated: new Date(), ...extra });
// 친구 요청(account.js request). 하루 요청 수는 update139 에서 없앴다
const send = (from, to) => setDoc(doc(db(from), "requests", `${from}_${to}`), { from, to, state: "pending", created: new Date(), updated: new Date() });
const tt = { id: "t1", sem: "2026-2", title: "시간표", updated: "2026-11-14T00:00:00.000Z", items: [] };

// 내 시간표
await check("내 시간표 쓰기", assertSucceeds(setDoc(doc(db("A"), "users", "A", "timetables", "t1"), tt)));
await check("남의 시간표 읽기 막음", assertFails(getDoc(doc(db("B"), "users", "A", "timetables", "t1"))));
await check("로그인 안 하면 막음", assertFails(getDoc(doc(anon, "profiles", "A"))));
await check("id 다른 문서 막음", assertFails(setDoc(doc(db("A"), "users", "A", "timetables", "t2"), tt)));

// 계정 번호와 찾는 열쇠
await check("번호 받기 A", assertSucceeds(claim("A", "영표", "482193")));
await check("번호 받기 B", assertSucceeds(claim("B", "친구", "123456")));
await check("번호 받기 C", assertSucceeds(claim("C", "남남", "300000")));
await check("한 글자 닉네임 막음", assertFails(claim("D", "남", "200000")));
await check("남의 번호 뺏기 막음", assertFails(claim("D", "도둑", "482193")));
await check("0으로 시작하는 번호도 받기", assertSucceeds(claim("Z", "영번", "012345")));
await check("다섯 자리 번호 막음", assertFails(claim("D", "도둑", "12345")));
await check("일곱 자리 번호 막음", assertFails(claim("D", "도둑", "1234567")));
await check("닉네임과 다른 열쇠 막음", assertFails((async () => {
  const d = db("D"), b = writeBatch(d);
  b.set(doc(d, "numbers", "400002"), { uid: "D" });
  b.set(doc(d, "handles", "딴이름#400002"), { uid: "D" });
  b.set(doc(d, "profiles", "D"), { nick: "도둑", tag: "400002", handle: "딴이름#400002", updated: new Date() });
  await b.commit();
})()));
await check("남 몫의 번호 만들기 막음", assertFails(setDoc(doc(db("D"), "numbers", "400000"), { uid: "A" })));
await check("프로필 없이 번호만 만들기 막음", assertFails(setDoc(doc(db("D"), "numbers", "400001"), { uid: "D" })));
await check("내 번호 바꾸기 막음", assertFails(claim("A", "영표", "482194")));
await check("남의 번호 문서 읽기 막음(번호만으로 누구인지 모르게)", assertFails(getDoc(doc(db("B"), "numbers", "482193"))));
await check("내 번호 문서 읽기", assertSucceeds(getDoc(doc(db("A"), "numbers", "482193"))));
await check("빈 번호인지 보기", assertSucceeds(getDoc(doc(db("B"), "numbers", "777777"))));
await check("번호 표 목록 막음", assertFails(getDocs(collection(db("B"), "numbers"))));
await check("닉네임#번호로 찾기", (async () => {
  const s = await getDoc(doc(db("B"), "handles", "영표#482193"));
  if (!s.exists() || s.data().uid !== "A") throw new Error("열쇠");
})());
await check("열쇠 목록 막음", assertFails(getDocs(collection(db("B"), "handles"))));
await check("남 이름으로 열쇠 만들기 막음", assertFails(setDoc(doc(db("D"), "handles", "영표#999999"), { uid: "A" })));
await check("프로필 없이 열쇠 만들기 막음", assertFails(setDoc(doc(db("D"), "handles", "도둑#999999"), { uid: "D" })));

// 닉네임 바꾸기: 번호 그대로, 열쇠는 새 닉네임으로(예전 '닉네임#번호'로는 못 찾는다)
const rename = (uid, from, to, n, extra = {}) => {
  const d = db(uid), b = writeBatch(d);
  b.set(doc(d, "handles", key(to, n)), { uid });
  b.delete(doc(d, "handles", key(from, n)));
  b.set(doc(d, "profiles", uid), prof(to, n, extra));
  return b.commit();
};
await check("닉네임 바꾸기(번호 그대로)", assertSucceeds(rename("A", "영표", "영표2", "482193")));
await check("예전 닉네임#번호로는 못 찾음", (async () => {
  if ((await getDoc(doc(db("B"), "handles", "영표#482193"))).exists()) throw new Error("예전 열쇠 남음");
})());
await check("열쇠 안 바꾸고 닉네임만 바꾸기 막음", assertFails(setDoc(doc(db("A"), "profiles", "A"), { ...prof("영표3", "482193"), handle: "영표2#482193" })));
await check("쓰는 열쇠 지우기 막음", assertFails(deleteDoc(doc(db("A"), "handles", "영표2#482193"))));
await check("남의 열쇠 지우기 막음", assertFails(deleteDoc(doc(db("B"), "handles", "영표2#482193"))));
await check("다시 원래 닉네임", assertSucceeds(rename("A", "영표2", "영표", "482193")));
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
await check("예전 열쇠 새로 달기 막음", assertFails(setDoc(doc(db("A"), "profiles", "A"), prof("영표", "482193", { oldHandle: "영표#0001" }))));

// 옛 판 앱(닉네임#네 자리): 번호를 받기 전에는 예전처럼, 받은 뒤에는 네 자리로 되돌리지 못한다
await check("옛 앱 닉네임", assertSucceeds(legacy("E", "옛사람", "0420")));
await check("옛 앱 닉네임 바꾸기(번호 받기 전)", assertSucceeds((async () => {
  const d = db("E"), b = writeBatch(d);
  b.delete(doc(d, "handles", "옛사람#0420"));
  b.set(doc(d, "handles", "새이름#0777"), { uid: "E" });
  b.set(doc(d, "profiles", "E"), { nick: "새이름", tag: "0777", handle: "새이름#0777", updated: new Date() });
  await b.commit();
})()));
await check("옛 앱 학교 계정 보이기만", assertSucceeds(setDoc(doc(db("E"), "profiles", "E"), { nick: "새이름", tag: "0777", handle: "새이름#0777", updated: new Date(), showSchool: false, school: false })));
await check("번호 받은 사람의 네 자리 열쇠 막음", assertFails((async () => {
  const d = db("A"), b = writeBatch(d);
  b.set(doc(d, "handles", "영표#1111"), { uid: "A" });
  b.set(doc(d, "profiles", "A"), { nick: "영표", tag: "1111", handle: "영표#1111", updated: new Date() });
  await b.commit();
})()));
await check("예전 열쇠로 찾기(옛 초대 링크)", assertSucceeds(getDoc(doc(db("B"), "handles", "새이름#0777"))));
await check("네 자리에서 새 번호로 한 번(예전 열쇠는 oldHandle 로)", assertSucceeds(claim("E", "새이름", "555555", { oldHandle: "새이름#0777" })));
await check("새 번호를 네 자리로 되돌리기 막음", assertFails(setDoc(doc(db("E"), "profiles", "E"), { nick: "새이름", tag: "0777", handle: "새이름#0777", updated: new Date() })));
await check("넘어온 뒤에도 예전 열쇠로 찾기", (async () => {
  const s = await getDoc(doc(db("B"), "handles", "새이름#0777"));
  if (!s.exists() || s.data().uid !== "E") throw new Error("예전 열쇠 없음");
})());
await check("예전 열쇠를 다른 것으로 바꾸기 막음", assertFails(setDoc(doc(db("E"), "profiles", "E"), prof("새이름", "555555", { oldHandle: "가짜#0001" }))));
await check("예전 열쇠 문서를 두고 떼기 막음", assertFails(setDoc(doc(db("E"), "profiles", "E"), prof("새이름", "555555"))));
await check("쓰는 예전 열쇠 지우기 막음", assertFails(deleteDoc(doc(db("E"), "handles", "새이름#0777"))));
// update136 때 꼴(번호는 있고 handle 칸에 예전 열쇠): 지금 열쇠를 만들고 예전 열쇠를 oldHandle 로 옮긴다(account.js fixHandle)
await owner(async (d) => {
  await setDoc(doc(d, "numbers", "600000"), { uid: "R" });
  await setDoc(doc(d, "handles", "고칠사람#0101"), { uid: "R" });
  await setDoc(doc(d, "profiles", "R"), { nick: "고칠사람", tag: "600000", handle: "고칠사람#0101", updated: new Date() });
});
await check("update136 꼴 프로필 고치기", assertSucceeds((async () => {
  const d = db("R"), b = writeBatch(d);
  b.set(doc(d, "handles", "고칠사람#600000"), { uid: "R" });
  b.set(doc(d, "profiles", "R"), prof("고칠사람", "600000", { oldHandle: "고칠사람#0101" }));
  await b.commit();
})()));

// 친구 요청·사본·차단
await check("A→B 요청", assertSucceeds(send("A", "B")));
await check("C→A 요청(하루 요청 수 없이)", assertSucceeds(send("C", "A")));
// update138 때 잠깐 센 하루 요청 수: 새로 쓰지 못하고 본인이 지우기만
await check("하루 요청 수 새로 쓰기 막음", assertFails(setDoc(doc(db("C"), "limits", "C"), { day: today, sent: 1 })));
await owner((d) => setDoc(doc(d, "limits", "C"), { day: today, sent: 3 }));
await check("남은 하루 요청 수 읽기 막음(본인도)", assertFails(getDoc(doc(db("C"), "limits", "C"))));
await check("남의 하루 요청 수 지우기 막음", assertFails(deleteDoc(doc(db("B"), "limits", "C"))));
await check("남은 하루 요청 수 본인이 지우기", assertSucceeds(deleteDoc(doc(db("C"), "limits", "C"))));
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
await check("막힌 사람의 요청 막음", assertFails(send("C", "B")));
await check("남의 차단 목록 읽기 막음", assertFails(getDocs(collection(db("C"), "blocks", "B", "list"))));
await check("끊기(지우기)", assertSucceeds(deleteDoc(doc(db("A"), "requests", "A_B"))));
await check("끊은 뒤 사본 막음", assertFails(getDocs(collection(db("A"), "shared", "B", "terms"))));

// 관리자 화면(update140): admins/{uid} 문서가 있고 비밀번호로 잠금을 푼 동안만 관리자. 비밀번호는 기기에서 섞은 값 h 만 adminKeys 에(아무도 못 읽음),
// 잠금 풀기는 sha256(h|끝나는 때|차례) 증명(admin-core.js unlock 과 같은 셈)
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const H1 = "a".repeat(64), H2 = "b".repeat(64);
const session = (uid, h, n, minutes = 30, proof = null) => {
  const until = Timestamp.fromMillis(Date.now() + minutes * 60000);
  return setDoc(doc(db(uid), "adminSessions", uid), { until, proof: proof ?? sha(`${h}|${until.toMillis()}|${n}`), n });
};
await owner(async (d) => {
  await setDoc(doc(d, "admins", "OWN"), { on: true }); // 콘솔에서 만든 주인(role 칸 없음)
  await setDoc(doc(d, "admins", "AD2"), { role: "admin", added: new Date(), by: "OWN" }); // 주인이 더한 관리자
});
await check("관리자 아닌 사람 비밀번호 정하기 막음", assertFails(setDoc(doc(db("B"), "adminKeys", "B"), { h: H1 })));
await check("남의 비밀번호 정하기 막음", assertFails(setDoc(doc(db("B"), "adminKeys", "OWN"), { h: H1 })));
await check("비밀번호 꼴 아님 막음", assertFails(setDoc(doc(db("OWN"), "adminKeys", "OWN"), { h: "1234" })));
await check("아직 없는 비밀번호는 본인이 '없음'으로 읽음", assertSucceeds(getDoc(doc(db("OWN"), "adminKeys", "OWN"))));
await check("주인 비밀번호 처음 정하기", assertSucceeds(setDoc(doc(db("OWN"), "adminKeys", "OWN"), { h: H1 })));
await check("관리자 비밀번호 처음 정하기", assertSucceeds(setDoc(doc(db("AD2"), "adminKeys", "AD2"), { h: H2 })));
await check("정한 비밀번호 읽기 막음(본인도)", assertFails(getDoc(doc(db("OWN"), "adminKeys", "OWN"))));
await check("잠긴 동안 비밀번호 바꾸기 막음", assertFails(setDoc(doc(db("OWN"), "adminKeys", "OWN"), { h: H2 })));
await check("잠긴 관리자는 번호 문서 못 읽음", assertFails(getDoc(doc(db("OWN"), "numbers", "123456"))));
await check("틀린 증명 막음", assertFails(session("OWN", H2, 1)));
await check("차례 건너뛰기 막음", assertFails(session("OWN", H1, 2)));
await check("60분 넘게 열기 막음", assertFails(session("OWN", H1, 1, 90)));
await check("지난 때로 열기 막음", assertFails(session("OWN", H1, 1, -1)));
await check("관리자 아닌 사람 열기 막음", assertFails(session("B", H1, 1)));
const first = Timestamp.fromMillis(Date.now() + 20 * 60000), firstProof = sha(`${H1}|${first.toMillis()}|1`);
await check("맞는 비밀번호로 열기", assertSucceeds(setDoc(doc(db("OWN"), "adminSessions", "OWN"), { until: first, proof: firstProof, n: 1 })));
await check("열린 관리자는 번호 문서 읽음", assertSucceeds(getDoc(doc(db("OWN"), "numbers", "123456"))));
await check("잠그기", assertSucceeds(setDoc(doc(db("OWN"), "adminSessions", "OWN"), { until: serverTimestamp(), proof: "", n: 2 })));
await check("잠근 뒤 번호 문서 막음", assertFails(getDoc(doc(db("OWN"), "numbers", "123456"))));
await check("지난 증명 다시 쓰기 막음", assertFails(setDoc(doc(db("OWN"), "adminSessions", "OWN"), { until: first, proof: firstProof, n: 1 })));
await check("다시 열기", assertSucceeds(session("OWN", H1, 3)));
await check("열린 동안 비밀번호 바꾸기", assertSucceeds(setDoc(doc(db("OWN"), "adminKeys", "OWN"), { h: H1 })));
await check("남의 열린 시간 읽기 막음", assertFails(getDoc(doc(db("B"), "adminSessions", "OWN"))));
await check("관리자(주인 아님) 열기", assertSucceeds(session("AD2", H2, 1)));
await check("주인 아닌 관리자는 관리자 목록 막음", assertFails(getDocs(collection(db("AD2"), "admins"))));
await check("주인은 관리자 목록", assertSucceeds(getDocs(collection(db("OWN"), "admins"))));
await check("주인 아닌 관리자는 관리자 더하기 막음", assertFails(setDoc(doc(db("AD2"), "admins", "C"), { role: "admin", added: serverTimestamp(), by: "AD2" })));
await check("주인으로 더하기 막음", assertFails(setDoc(doc(db("OWN"), "admins", "C"), { role: "owner", added: serverTimestamp(), by: "OWN" })));
await check("닉네임 없는 계정 더하기 막음", assertFails(setDoc(doc(db("OWN"), "admins", "NOPROFILE"), { role: "admin", added: serverTimestamp(), by: "OWN" })));
await check("주인이 관리자 더하기", assertSucceeds(setDoc(doc(db("OWN"), "admins", "C"), { role: "admin", added: serverTimestamp(), by: "OWN" })));
await check("관리자 문서 고치기 막음", assertFails(setDoc(doc(db("OWN"), "admins", "C"), { role: "owner", added: serverTimestamp(), by: "OWN" })));
await check("주인 아닌 관리자는 남의 비밀번호 처음으로 막음", assertFails(deleteDoc(doc(db("AD2"), "adminKeys", "OWN"))));
await check("나를 빼기 막음", assertFails(deleteDoc(doc(db("OWN"), "admins", "OWN"))));
await check("주인이 비밀번호 처음으로 돌리고 잠금", assertSucceeds((async () => {
  const d = db("OWN"), b = writeBatch(d);
  b.delete(doc(d, "adminSessions", "AD2"));
  b.delete(doc(d, "adminKeys", "AD2"));
  await b.commit();
})()));
await check("처음으로 돌린 관리자는 못 읽음", assertFails(getDocs(query(collection(db("AD2"), "reports"), where("state", "==", "open")))));
await check("주인이 관리자 빼기", assertSucceeds((async () => {
  const d = db("OWN"), b = writeBatch(d);
  for (const c of ["adminSessions", "adminKeys", "admins"]) b.delete(doc(d, c, "C"));
  await b.commit();
})()));

// 관리자가 번호 바꿔 주기: 번호와 열쇠만 바꾸고 닉네임은 그대로, 옛 번호는 거두고 옛 열쇠는 지운다(아래 ADM 은 열린 주인)
await owner(async (d) => {
  await setDoc(doc(d, "admins", "ADM"), { on: true });
  await setDoc(doc(d, "adminKeys", "ADM"), { h: H1 });
  await setDoc(doc(d, "adminSessions", "ADM"), { until: Timestamp.fromMillis(Date.now() + 30 * 60000), proof: "x", n: 1 });
});
const retag = (by, uid, nick, from, to, extra = {}) => {
  const d = db(by), b = writeBatch(d);
  if (from) b.set(doc(d, "numbers", from), { retired: true });
  b.set(doc(d, "numbers", to), { uid });
  b.set(doc(d, "handles", key(nick, to)), { uid });
  if (from) b.delete(doc(d, "handles", key(nick, from)));
  b.update(doc(d, "profiles", uid), { tag: to, handle: key(nick, to), updated: new Date(), ...extra });
  return b.commit();
};
await check("관리자 문서 스스로 만들기 막음", assertFails(setDoc(doc(db("A"), "admins", "A"), { role: "admin", added: serverTimestamp(), by: "A" })));
await check("내 관리자 문서 읽기", assertSucceeds(getDoc(doc(db("ADM"), "admins", "ADM"))));
await check("남의 관리자 문서 읽기 막음", assertFails(getDoc(doc(db("A"), "admins", "ADM"))));
await check("관리자는 번호 문서 읽음", assertSucceeds(getDoc(doc(db("ADM"), "numbers", "123456"))));
// 지운 계정이 남긴 번호·열쇠 정리(옛 판 앱으로 계정을 지우면 남는다, 법무 11/17): 목록은 관리자만, 프로필 없는 uid 의 것만 거두고 지운다
await check("번호 목록 막음(관리자 아님)", assertFails(getDocs(collection(db("B"), "numbers"))));
await check("열쇠 목록 막음(관리자 아님)", assertFails(getDocs(collection(db("B"), "handles"))));
await check("관리자 번호·열쇠 목록", assertSucceeds(Promise.all([getDocs(collection(db("ADM"), "numbers")), getDocs(collection(db("ADM"), "handles"))])));
await owner(async (d) => {
  await setDoc(doc(d, "numbers", "777777"), { uid: "GONE" });
  await setDoc(doc(d, "handles", "유령#0777"), { uid: "GONE" });
});
await check("남은 번호·열쇠 남이 정리 막음", assertFails((async () => {
  const d = db("B"), b = writeBatch(d);
  b.set(doc(d, "numbers", "777777"), { retired: true });
  b.delete(doc(d, "handles", "유령#0777"));
  await b.commit();
})()));
await check("관리자도 쓰는 열쇠 지우기 막음", assertFails(deleteDoc(doc(db("ADM"), "handles", "친구#123456"))));
await check("관리자가 지운 계정의 번호·열쇠 정리", assertSucceeds((async () => {
  const d = db("ADM"), b = writeBatch(d);
  b.set(doc(d, "numbers", "777777"), { retired: true });
  b.delete(doc(d, "handles", "유령#0777"));
  await b.commit();
})()));
await check("관리자 아니면 남의 번호 바꾸기 막음", assertFails(retag("C", "B", "친구", "123456", "100007")));
await check("관리자도 닉네임은 못 바꿈", assertFails(retag("ADM", "B", "친구", "123456", "100007", { nick: "딴이름" })));
await check("관리자도 번호 표만 바꾸기 막음", assertFails(setDoc(doc(db("ADM"), "numbers", "100008"), { uid: "B" })));
await check("관리자도 쓰는 번호 거두기 막음", assertFails(setDoc(doc(db("ADM"), "numbers", "123456"), { retired: true })));
await check("번호 지우기는 아무도 못 함", assertFails(deleteDoc(doc(db("ADM"), "numbers", "123456"))));
await check("관리자가 번호 바꿔 주기", assertSucceeds(retag("ADM", "B", "친구", "123456", "100007")));
await check("바뀐 번호로 찾기", (async () => {
  const s = await getDoc(doc(db("A"), "handles", "친구#100007"));
  if (!s.exists() || s.data().uid !== "B") throw new Error("새 열쇠 없음");
  if ((await getDoc(doc(db("A"), "handles", "친구#123456"))).exists()) throw new Error("옛 열쇠 남음");
  const old = await getDoc(doc(db("ADM"), "numbers", "123456"));
  if (!old.exists() || old.data().uid || old.data().retired !== true) throw new Error("옛 번호가 '안 씀'이 아님");
  if ((await getDoc(doc(db("A"), "profiles", "B"))).data().tag !== "100007") throw new Error("프로필 번호 그대로");
})());
await check("거둔 번호 다시 받기 막음", assertFails(claim("D", "도둑", "123456")));
await check("관리자도 거둔 번호 다시 주기 막음", assertFails(retag("ADM", "B", "친구", "100007", "123456")));
await check("바뀐 뒤 본인은 그대로 쓴다", assertSucceeds(setDoc(doc(db("B"), "profiles", "B"), prof("친구", "100007", { showSchool: false, school: false }))));
await check("관리자가 옛 네 자리 사람에게 번호", assertSucceeds((async () => {
  await legacy("F", "옛친구", "0001");
  const d = db("ADM"), b = writeBatch(d);
  b.set(doc(d, "numbers", "100009"), { uid: "F" });
  b.set(doc(d, "handles", "옛친구#100009"), { uid: "F" });
  b.delete(doc(d, "handles", "옛친구#0001"));
  b.update(doc(d, "profiles", "F"), { tag: "100009", handle: "옛친구#100009", updated: new Date() });
  await b.commit();
})()));

// 닉네임 신고: 본인 이름으로 만들기만, 같은 사람은 하루 한 번. 읽기·처리 표시·지우기는 관리자만
const rep = (by, target, extra = {}, day = today) => setDoc(doc(db(by), "reports", `${by}_${target}_${day}`),
  { reporter: by, target, handle: "친구#100007", reason: "nick", note: "", created: new Date(), state: "open", ...extra });
await check("신고하기", assertSucceeds(rep("A", "B")));
await check("같은 사람 하루 두 번 막음", assertFails(rep("A", "B", { reason: "other" })));
await check("다른 날 이름 막음", assertFails(rep("A", "C", {}, today + 1)));
await check("남 이름으로 신고 막음", assertFails(setDoc(doc(db("A"), "reports", `B_C_${today}`), { reporter: "B", target: "C", handle: "남남#300000", reason: "nick", note: "", created: new Date(), state: "open" })));
await check("모르는 까닭 막음", assertFails(rep("C", "A", { reason: "spam" })));
await check("긴 덧붙임 글 막음", assertFails(rep("C", "A", { note: "가".repeat(201) })));
await check("처리된 것으로 만들기 막음", assertFails(rep("C", "A", { state: "closed" })));
await check("나를 신고 막음", assertFails(rep("A", "A")));
await check("신고 읽기 막음(신고한 사람도)", assertFails(getDoc(doc(db("A"), "reports", `A_B_${today}`))));
await check("신고 목록 막음", assertFails(getDocs(collection(db("B"), "reports"))));
await check("관리자는 신고 목록 읽음", assertSucceeds(getDocs(query(collection(db("ADM"), "reports"), where("state", "==", "open")))));
await check("신고 고치기·지우기 막음(신고한 사람도)", (async () => {
  await assertFails(updateDoc(doc(db("A"), "reports", `A_B_${today}`), { note: "고침" }));
  await assertFails(deleteDoc(doc(db("A"), "reports", `A_B_${today}`)));
})());
await check("관리자도 신고 내용 고치기 막음", assertFails(updateDoc(doc(db("ADM"), "reports", `A_B_${today}`), { note: "고침" })));
await check("관리자 처리 표시", assertSucceeds(updateDoc(doc(db("ADM"), "reports", `A_B_${today}`), { state: "closed", closed: new Date() })));
await check("관리자는 지운다(처리하고 1년 뒤)", assertSucceeds(deleteDoc(doc(db("ADM"), "reports", `A_B_${today}`))));

// 계정 지우기: 번호는 프로필을 같이 지울 때만 거둔다('안 씀'으로 남김). 닉네임이 든 열쇠는 지운다
await check("프로필 두고 내 번호 거두기 막음", assertFails(setDoc(doc(db("A"), "numbers", "482193"), { retired: true })));
await check("남의 번호 거두기 막음", assertFails(setDoc(doc(db("B"), "numbers", "100009"), { retired: true })));
await check("계정 지울 때 번호 거두고 열쇠·하루 요청 수·프로필 지우기", assertSucceeds((async () => {
  const d = db("A"), b = writeBatch(d);
  b.set(doc(d, "numbers", "482193"), { retired: true });
  b.delete(doc(d, "handles", "영표#482193"));
  b.delete(doc(d, "limits", "A"));
  b.delete(doc(d, "profiles", "A"));
  await b.commit();
})()));
await check("지운 계정: 번호는 '안 씀', 열쇠는 없음", (async () => {
  const n = await getDoc(doc(db("ADM"), "numbers", "482193"));
  if (!n.exists() || n.data().uid || n.data().retired !== true) throw new Error("거둔 번호");
  if ((await getDoc(doc(db("B"), "handles", "영표#482193"))).exists()) throw new Error("열쇠 남음");
})());
await check("거둔 번호 남이 받기 막음", assertFails(claim("D", "도둑", "482193")));
await check("예전 열쇠 있는 사람 지우기(예전 열쇠도 지움)", assertSucceeds((async () => {
  const d = db("E"), b = writeBatch(d);
  b.set(doc(d, "numbers", "555555"), { retired: true });
  b.delete(doc(d, "handles", "새이름#555555"));
  b.delete(doc(d, "handles", "새이름#0777"));
  b.delete(doc(d, "profiles", "E"));
  await b.commit();
  if ((await getDoc(doc(db("B"), "handles", "새이름#0777"))).exists()) throw new Error("예전 열쇠 남음");
})()));
await check("옛 판 앱의 계정 지우기(번호 받기 전)", assertSucceeds((async () => {
  await legacy("H", "지울사람", "0042");
  const d = db("H"), b = writeBatch(d);
  b.delete(doc(d, "handles", "지울사람#0042"));
  b.delete(doc(d, "profiles", "H"));
  await b.commit();
})()));
await check("옛 판 앱의 계정 지우기(번호 받은 뒤)", assertSucceeds((async () => { // 옛 앱은 '닉네임#번호' 열쇠와 프로필만 지운다
  const d = db("R"), b = writeBatch(d);
  b.delete(doc(d, "handles", "고칠사람#600000"));
  b.delete(doc(d, "profiles", "R"));
  await b.commit();
})()));
await env.cleanup();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every(([, r]) => r === "ok") ? 0 : 1;
