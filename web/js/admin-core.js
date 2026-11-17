// TT Wizard 관리자 화면의 서버 일(웹만). 화면은 admin.js, 로그인과 Firestore 는 account.js 의 것을 같이 쓴다(firestore()).
// 스토어 앱 묶음에는 넣지 않는다(scripts/build_app.py. 사용자 11/18 '앱에까지 넣으면 앱이 나 하나 때문에 무거워질테니 웹에서만').
// 사용자 11/18: '웹에서 내 구글계정으로 로그인한 상황이면 개발자 화면으로 진입하는 버튼을 띄우고, 비밀번호를 입력했을 때만 진입할 수 있도록 …
// 나중에 관리자를 추가할 수 있도록 … 보안을 아주 빡세게 잡아서 앱을 뜯어본다거나 웹을 뜯어보는 방식으로는 절대 알 수 없도록'.
//
// 어떻게 지키나(서버 규칙 firebase/firestore.rules 가 모두 본다. 이 파일을 고쳐 돌려도 서버는 속지 않는다)
//   1. 관리자 문서 admins/{uid}: 콘솔에서 만든 사람(주인)과 주인이 더한 사람만. 남은 누가 관리자인지 못 읽는다.
//   2. 비밀번호: 그 사람 기기에서 PBKDF2-SHA256(21만 번, 소금은 uid)로 섞은 값 h 만 adminKeys/{uid} 에 둔다. 이 문서는 아무 앱도 못 읽는다(규칙 안에서만 읽힌다).
//      비밀번호도 h 도 코드·저장소·앱 어디에도 없다.
//   3. 잠금 풀기: 끝나는 때 until(지금부터 SESSION_MINUTES 분)과 차례 n 으로 sha256(h|until|n) 을 만들어 adminSessions/{uid} 에 쓰면, 규칙이 같은 셈으로 맞춰 본다.
//      until 은 60분 안이어야 하고 n 은 하나씩만 올라서, 지난 증명을 다시 보내도 열리지 않는다. 관리자 일은 모두 이 시간 안에만 된다.
//   한계: 규칙은 틀린 비밀번호를 몇 번 넣었는지 셀 수 없다(틀린 쓰기는 아무것도 남기지 않는다). 관리자 구글 계정을 가진 사람만 넣어 볼 수 있지만,
//   비밀번호는 길게 정한다(MIN_PASSWORD 자 이상, 문장처럼).
//
//   state()                        → { role: 'owner'|'admin'|null, key: 'set'|'none', until: ISO|null }   관리자인가·비밀번호를 정했나·언제까지 열려 있나
//   setPassword(pw)                → { until }   처음 한 번(비밀번호가 없을 때). 정하면 바로 연다. 짧으면 SHORT, 관리자가 아니거나 이미 정했으면 NOT_ALLOWED
//   unlock(pw)                     → { until }   SESSION_MINUTES 분 동안 연다. 틀리면 WRONG_PASSWORD(기기 시계가 많이 틀려도 같다)
//   lock()                         바로 잠근다(로그아웃할 때 account.signOut 도 잠근다). 잠근 뒤 연결을 한 번 끊었다 잇는다(reconnect)
//   reconnect()                    열린 시간이 끝났을 때 관리자 화면이 부른다
//   changePassword(pw)             열려 있을 때 내 비밀번호를 바꾼다(지금 열린 시간은 그대로). 잠겼으면 LOCKED
//   retag(text, tag)               → { nick, tag, from }   번호 바꿔 주기(닉네임#번호·번호만·옛 닉네임#네 자리). BAD_HANDLE·BAD_TAG·NOT_FOUND·TAKEN·LOCKED
//   reports({ all }?)              → [{ id, reporter, target, handle, reason, note, state, created, closed }]   닉네임 신고(새것 먼저, 처음엔 처리 안 한 것만)
//   closeReport(id)                처리 표시
//   orphans()                      → { numbers, handles }   지운 계정이 남긴 번호·찾는 열쇠(그 uid 의 프로필이 없는 것)
//   cleanOrphans(found)            → { numbers, handles }(정리한 수)   번호는 '안 씀', 열쇠는 지운다
//   admins()                       → [{ uid, role, nick, tag, added, me }]   주인만. 주인 먼저
//   addAdmin('닉네임#번호')         → { uid, nick, tag }   주인만. 그 사람은 처음 들어올 때 자기 비밀번호를 정한다. BAD_HANDLE·NOT_FOUND·SELF·ALREADY
//   removeAdmin(uid)               주인만, 나는 못 뺀다. 그 사람의 비밀번호·열린 시간도 같이 지운다
//   resetPassword(uid)             주인만. 그 사람 비밀번호를 처음으로(다음에 들어올 때 새로 정한다)
// 잠겼거나(시간이 지났거나) 그 일을 할 수 없는 계정이면 LOCKED

import { firestore } from "./account.js";
import { parseHandle, handleKey, isNumber } from "./sync.js";

export const SESSION_MINUTES = 30;
export const MIN_PASSWORD = 10;
const ROUNDS = 210000;

function err(code, extra = {}) {
  const e = new Error(code);
  e.code = code;
  return Object.assign(e, extra);
}
const denied = (e) => err(e && e.code === "permission-denied" ? "LOCKED" : e && e.code === "unavailable" ? "OFFLINE" : "FAILED", { cause: e });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw err("NO_CRYPTO"); // https 가 아닌 곳(웹 개발 서버의 http 등)
  return c.subtle;
}
const isoOf = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : null);

/** 비밀번호 → h(PBKDF2-SHA256, 21만 번, 소금 'ttw-admin:'+uid, 64자 16진수). 비밀번호 자체는 어디에도 보내거나 두지 않는다 */
async function derive(uid, password) {
  const enc = new TextEncoder();
  const key = await subtle().importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  return hex(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`ttw-admin:${uid}`), iterations: ROUNDS }, key, 256));
}
const sha256 = async (text) => hex(await subtle().digest("SHA-256", new TextEncoder().encode(text)));

async function sessionOf(db, F, uid) {
  try {
    const s = await F.getDoc(F.doc(db, "adminSessions", uid));
    return s.exists() ? s.data() : null;
  } catch {
    return null;
  }
}
const untilOf = (s) => (s && s.until && typeof s.until.toMillis === "function" && s.until.toMillis() > Date.now() ? new Date(s.until.toMillis()).toISOString() : null);

// ---------------------------------------------------------------- 잠금

export async function state() {
  const { uid, db, F } = await firestore();
  let a = null;
  try {
    a = await F.getDoc(F.doc(db, "admins", uid));
  } catch (e) {
    if (e && e.code === "unavailable") throw err("OFFLINE", { cause: e });
  }
  if (!a || !a.exists()) return { role: null, key: "none", until: null };
  let key = "set";
  try {
    key = (await F.getDoc(F.doc(db, "adminKeys", uid))).exists() ? "set" : "none";
  } catch {
    key = "set"; // 정해 둔 비밀번호 문서는 아무도 못 읽는다(없을 때만 '없음'으로 읽힌다)
  }
  return { role: a.data().role === "admin" ? "admin" : "owner", key, until: untilOf(await sessionOf(db, F, uid)) };
}

export async function setPassword(password) {
  if (String(password ?? "").length < MIN_PASSWORD) throw err("SHORT");
  const { uid, db, F } = await firestore();
  let had = true;
  try {
    had = (await F.getDoc(F.doc(db, "adminKeys", uid))).exists();
  } catch {
    had = true; // 정해 둔 비밀번호는 못 읽는다: 이미 있다(바꾸기는 열린 동안 changePassword 로만)
  }
  if (had) throw err("NOT_ALLOWED");
  const h = await derive(uid, password);
  try {
    await F.setDoc(F.doc(db, "adminKeys", uid), { h });
  } catch (e) {
    throw err(e && e.code === "permission-denied" ? "NOT_ALLOWED" : "FAILED", { cause: e }); // 관리자가 아니거나 이미 정했다
  }
  return unlock(password);
}

export async function unlock(password) {
  const { uid, db, F } = await firestore();
  const h = await derive(uid, String(password ?? ""));
  const s = await sessionOf(db, F, uid), n = ((s && s.n) || 0) + 1;
  const until = Date.now() + SESSION_MINUTES * 60000;
  const proof = await sha256(`${h}|${until}|${n}`);
  try {
    await F.setDoc(F.doc(db, "adminSessions", uid), { until: F.Timestamp.fromMillis(until), proof, n });
  } catch (e) {
    throw err(e && e.code === "permission-denied" ? "WRONG_PASSWORD" : "FAILED", { cause: e });
  }
  return { until: new Date(until).toISOString() };
}

export async function lock() {
  const { uid, db, F } = await firestore();
  const s = await sessionOf(db, F, uid);
  if (s) {
    try {
      await F.setDoc(F.doc(db, "adminSessions", uid), { until: F.serverTimestamp(), proof: "", n: (s.n || 0) + 1 });
    } catch (e) {
      throw denied(e);
    }
  }
  await reconnect(db, F);
}

/** 연결을 한 번 끊었다 잇는다: 열려 있던 동안 맺은 읽기 연결이 잠근 뒤에도 남아 읽히는 일이 없게(에뮬레이터에서 본 것, 쓰기는 바로 막힌다).
 *  앱의 다른 연결(시간표 맞추기·친구)은 저절로 다시 잇는다. 열린 시간이 끝났을 때 관리자 화면도 부른다 */
export async function reconnect(db = null, F = null) {
  if (!db || !F) ({ db, F } = await firestore());
  try {
    await F.disableNetwork(db);
  } finally {
    await F.enableNetwork(db);
  }
}

export async function changePassword(password) {
  if (String(password ?? "").length < MIN_PASSWORD) throw err("SHORT");
  const { uid, db, F } = await firestore();
  const h = await derive(uid, password);
  try {
    await F.setDoc(F.doc(db, "adminKeys", uid), { h });
  } catch (e) {
    throw denied(e);
  }
}

// ---------------------------------------------------------------- 번호 바꿔 주기
// 사용자 11/17 '태그 번호는 아무나 원하는 걸 할 수 없고 원하는 사람에 한해서 내가 바꿔줄 수 있는 번호로'. 규칙이 번호·열쇠만 바꾸게 하고 닉네임은 못 바꾼다.
// 법무 11/17: 옛 번호는 적어도 1년 남에게 주지 않는다 → 지우지 않고 { retired: true } 로 남긴다. 부탁은 아는 사람에게서, 무료로만(돈·선물 받지 않기)

export async function retag(text, tag) {
  const only = /^\s*#?\s*([0-9]{6})\s*$/.exec(String(text ?? "")); // 관리자는 번호만으로도 찾는다(번호 문서를 읽을 수 있다)
  const h = only ? null : parseHandle(text), next = String(tag ?? "").trim();
  if (!only && !h) throw err("BAD_HANDLE");
  if (!isNumber(next)) throw err("BAD_TAG");
  const { db, F } = await firestore();
  const from = only ? F.doc(db, "numbers", only[1]) : F.doc(db, "handles", handleKey(h.nick, h.tag));
  try {
    return await F.runTransaction(db, async (tx) => {
      const hs = await tx.get(from);
      if (!hs.exists() || !hs.data().uid) throw err("NOT_FOUND");
      const uid = hs.data().uid, ps = await tx.get(F.doc(db, "profiles", uid));
      if (!ps.exists()) throw err("NOT_FOUND");
      const p = ps.data();
      if (p.tag === next) return { nick: p.nick, tag: next, from: p.tag };
      if ((await tx.get(F.doc(db, "numbers", next))).exists()) throw err("TAKEN"); // 거둔 번호도 다시 주지 않는다
      const key = handleKey(p.nick, next);
      if (isNumber(p.tag)) tx.set(F.doc(db, "numbers", p.tag), { retired: true }); // 옛 번호는 '안 씀'으로(옛 초대 링크가 남에게 가지 않게)
      tx.set(F.doc(db, "numbers", next), { uid });
      tx.set(F.doc(db, "handles", key), { uid });
      if (p.handle && p.handle !== key && p.handle !== p.oldHandle) tx.delete(F.doc(db, "handles", p.handle)); // 옛 번호의 열쇠는 지운다
      tx.update(F.doc(db, "profiles", uid), { tag: next, handle: key, updated: F.serverTimestamp() });
      return { nick: p.nick, tag: next, from: p.tag };
    });
  } catch (e) {
    if (e && ["NOT_FOUND", "TAKEN"].includes(e.code)) throw e;
    throw denied(e);
  }
}

// ---------------------------------------------------------------- 닉네임 신고(법무 11/17: 읽기·처리는 관리자만, 신고한 사람은 알리지 않는다)

export async function reports({ all = false } = {}) {
  const { db, F } = await firestore();
  const col = F.collection(db, "reports");
  try {
    const snap = await F.getDocs(all ? col : F.query(col, F.where("state", "==", "open")));
    return snap.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, created: isoOf(x.created), closed: isoOf(x.closed) }; })
      .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  } catch (e) {
    throw denied(e);
  }
}

export async function closeReport(id) {
  const { db, F } = await firestore();
  try {
    await F.updateDoc(F.doc(db, "reports", String(id)), { state: "closed", closed: F.serverTimestamp() });
  } catch (e) {
    throw e && e.code === "not-found" ? err("NOT_FOUND", { cause: e }) : denied(e);
  }
}

// ---------------------------------------------------------------- 지운 계정이 남긴 번호·열쇠
// 옛 판 앱(번호를 받기 전 판)으로 계정을 지우면 그 앱이 모르는 번호 문서와 예전 열쇠가 uid 를 단 채 남는다. 지운 계정의 것이라 늦어도 5일 안에 지운다
// (법무 11/17, 개인정보 보호법 제21조). 옛 판이 남아 있는 동안 며칠에 한 번 본다

export async function orphans() {
  const { db, F } = await firestore();
  let nums, keys;
  try {
    [nums, keys] = await Promise.all([F.getDocs(F.collection(db, "numbers")), F.getDocs(F.collection(db, "handles"))]);
  } catch (e) {
    throw denied(e);
  }
  const owner = (d) => String((d.data() || {}).uid || "");
  const uids = [...new Set([...nums.docs, ...keys.docs].map(owner).filter(Boolean))];
  const gone = new Set();
  for (const u of uids) if (!(await F.getDoc(F.doc(db, "profiles", u))).exists()) gone.add(u);
  return { numbers: nums.docs.filter((d) => gone.has(owner(d))).map((d) => d.id), handles: keys.docs.filter((d) => gone.has(owner(d))).map((d) => d.id) };
}

export async function cleanOrphans(found) {
  const { db, F } = await firestore();
  const numbers = [...((found && found.numbers) || [])], handles = [...((found && found.handles) || [])];
  const writes = [...numbers.map((n) => (b) => b.set(F.doc(db, "numbers", n), { retired: true })), ...handles.map((k) => (b) => b.delete(F.doc(db, "handles", k)))];
  try {
    for (let i = 0; i < writes.length; i += 400) {
      const b = F.writeBatch(db);
      for (const w of writes.slice(i, i + 400)) w(b);
      await b.commit();
    }
  } catch (e) {
    throw denied(e);
  }
  return { numbers: numbers.length, handles: handles.length };
}

// ---------------------------------------------------------------- 관리자 더하기·빼기(주인만)

export async function admins() {
  const { uid, db, F } = await firestore();
  let snap;
  try {
    snap = await F.getDocs(F.collection(db, "admins"));
  } catch (e) {
    throw denied(e);
  }
  const rows = [];
  for (const d of snap.docs) {
    const a = d.data(), p = await F.getDoc(F.doc(db, "profiles", d.id)).then((x) => (x.exists() ? x.data() : null), () => null);
    rows.push({ uid: d.id, role: a.role === "admin" ? "admin" : "owner", nick: p ? p.nick : "", tag: p ? p.tag : "", added: isoOf(a.added), me: d.id === uid });
  }
  return rows.sort((x, y) => (x.role === y.role ? String(x.added || "").localeCompare(String(y.added || "")) : x.role === "owner" ? -1 : 1));
}

export async function addAdmin(text) {
  const h = parseHandle(text);
  if (!h) throw err("BAD_HANDLE");
  const { uid, db, F } = await firestore();
  let other = null;
  try {
    const k = await F.getDoc(F.doc(db, "handles", handleKey(h.nick, h.tag)));
    other = k.exists() ? k.data().uid || null : null;
  } catch (e) {
    throw denied(e);
  }
  if (!other) throw err("NOT_FOUND");
  if (other === uid) throw err("SELF");
  try {
    if ((await F.getDoc(F.doc(db, "admins", other))).exists()) throw err("ALREADY");
    await F.setDoc(F.doc(db, "admins", other), { role: "admin", added: F.serverTimestamp(), by: uid });
  } catch (e) {
    if (e && e.code === "ALREADY") throw e;
    throw denied(e);
  }
  return { uid: other, nick: h.nick, tag: h.tag };
}

async function dropAdmin(other, collections) {
  const { uid, db, F } = await firestore();
  if (!other || other === uid) throw err("SELF");
  const b = F.writeBatch(db);
  for (const c of collections) b.delete(F.doc(db, c, other));
  try {
    await b.commit();
  } catch (e) {
    throw denied(e);
  }
}
export const removeAdmin = (other) => dropAdmin(other, ["adminSessions", "adminKeys", "admins"]);
export const resetPassword = (other) => dropAdmin(other, ["adminSessions", "adminKeys"]);
