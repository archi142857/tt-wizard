// 로그인·기기 간 동기화·친구 시간표 — 백엔드 update110(사용자 11/14 '로그인이랑 친구 시간표도 지금 작업 시작하라고', 16일 데모데이).
// Firebase: Authentication(구글 로그인), Cloud Firestore(서울 asia-northeast3). SDK 는 로그인을 쓸 때만 gstatic 에서 받는다(앱 첫 화면에 넣지 않음).
// 설정 값은 web/js/firebase-config.js(배포 때 GitHub 변수 FIREBASE_WEB_CONFIG 로 채운다. 저장소에는 null). 없으면 available() 이 false.
// 서버 규칙은 firebase/firestore.rules(남의 시간표는 못 읽고, 친구 사본은 친구만). 순수 셈(합치기·사본·닉네임)은 sync.js. 자세한 건 docs/account.md.
//
// 화면이 부르는 것(모두 Promise. 실패는 Error 에 code: NO_CONFIG·OFFLINE·SIGNED_OUT·NOT_FOUND·SELF·BLOCKED·NOT_FRIEND·ALREADY(이미 친구)·BAD_NICK·
//   APP_LOGIN(앱이 옛 판이라 앱 안 로그인이 없음)·NO_ACCOUNT(폰에 구글 계정이 없거나 이 앱 서명이 Firebase 에 없음)·CANCELLED·FAILED):
//   available()                    로그인을 쓸 수 있나(설정이 있나). 동기
//   ready()                        → user | null   지금 로그인 상태(앱을 켤 때 이어진다)
//   onUser(cb)                     → 끊기 함수. cb(user | null). user = { uid, email, name, school(snu.ac.kr 계정. 화면 글은 '학교 계정(snu.ac.kr)') }
//   signIn()                       → user | null(취소)   웹: 구글 창, 앱: 폰의 구글 계정 고르기(TTW_APP.googleSignIn, update111)
//   signOut()                      기기 자료는 그대로
//   deleteAccount()                서버의 시간표·프로필·친구·친구 사본과 계정을 지운다(기기 자료는 그대로). 오래전에 로그인했으면 다시 로그인을 묻는다
//   sync(store)                    store = { get(k), set(k, v), keys(), remove?(k) }(화면의 기기 저장소, 'ttw.' 를 뗀 열쇠) → { changed: [학기], uploaded, downloaded }
//                                  기기 시간표('timetables@<학기>')와 서버를 합쳐 둘 다 맞추고, 친구 기능을 켰으면 친구 사본도 올린다
//   syncStatus(store?)             → { state: 'idle'|'syncing'|'offline'|'error'|'signedOut', last: ISO | null }(마지막으로 맞춘 때, 동기화 줄 '방금'·'3분 전')
//   onSyncStatus(cb)               → 끊기 함수. cb(syncStatus()) 를 바로 한 번, 바뀔 때마다
//   forget(store)                  이 기기의 맞추기 기록(지난번 서버에 있던 id·마지막 시각)을 지운다. 로그아웃·계정 삭제 때 기기 시간표를 지우면 같이 부른다
//                                  (안 지우면 다시 로그인할 때 '이 기기에서 지운 시간표'로 보고 서버 것을 지운다)
//   profile()                      → { nick, tag, showSchool } | null(친구 기능을 아직 안 켬)
//   setNick(nick, { showSchool }?) → { nick, tag, showSchool }   2~12자 한글·영문·숫자·밑줄, #네 자리는 저절로. 거르는 말이면 BAD_NICK(problem).
//                                  같은 닉네임이면 태그 그대로(학교 계정 보이기만 바꿀 때도 이것). showSchool 은 처음 true
//   friends()                      → { friends, incoming, outgoing, blocked } 각 [{ uid, nick, tag, school }](school: 그 사람이 보이게 둔 snu.ac.kr 계정)
//   request('닉네임#1234')          → { uid, accepted }. 상대가 먼저 보낸 요청이 있으면 그걸 수락한다(accepted: true). 이미 보냈으면 그대로, 이미 친구면 ALREADY
//   accept(uid) · decline(uid) · cancel(uid) · unfriend(uid) · block(uid) · unblock(uid)
//   friendTimetables(uid)          → [{ sem, title, items, updated }](새 학기가 앞). items 는 sync.js friendItems 꼴. 친구가 아니면 NOT_FRIEND
//   publish(store)                 친구 사본만 다시 올린다(sync 가 같이 한다)
//   inviteLink({ nick, tag })      → 'https://archi142857.github.io/tt-wizard/#friend=닉네임%231234'
//   reportLink({ nick, tag })      → 닉네임 신고 메일 주소(mailto)

import FIREBASE from "./firebase-config.js";
import { mergeTimetables, friendCopies, nickProblem, parseHandle, handleKey, randomTag } from "./sync.js";
import { parseList, serialize, STORE_KEYS } from "./timetables.js";

export const SDK_URL = "https://www.gstatic.com/firebasejs/12.19.0"; // Firebase JS SDK(Apache-2.0). 판을 올리면 docs/account.md 도
export const APP_URL = "https://archi142857.github.io/tt-wizard/";
export const REPORT_MAIL = "sanger.lee138@gmail.com"; // 정보 화면의 개발자 메일과 같다
const SYNC_KEY = "syncKnown"; // 기기 저장소: { uid, ids }(지난번 맞춘 뒤 서버에 있던 시간표 id)
const LAST_KEY = "syncLast"; // 기기 저장소: { uid, at }(마지막으로 맞춘 때, update112)

let fb = null;
let injected = null; // 시험용: { sdk: { app, auth, firestore }, config, connect }
let apps = 0;

/** 시험(node·에뮬레이터)에서 SDK 와 설정을 넣는다 */
export function configure({ sdk = null, config = null, connect = null } = {}) {
  injected = { sdk, config, connect };
  fb = null;
  apps += 1;
}

const conf = () => (injected && injected.config) || FIREBASE;
export const available = () => !!(conf() && conf().apiKey && conf().projectId);

function err(code, extra = {}) {
  const e = new Error(code);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

const inApp = () => !!(globalThis.Capacitor && globalThis.Capacitor.isNativePlatform && globalThis.Capacitor.isNativePlatform());

async function load() {
  if (fb) return fb;
  if (!available()) throw err("NO_CONFIG");
  const [appM, authM, fsM] = injected && injected.sdk
    ? [injected.sdk.app, injected.sdk.auth, injected.sdk.firestore]
    : await Promise.all([import(`${SDK_URL}/firebase-app.js`), import(`${SDK_URL}/firebase-auth.js`), import(`${SDK_URL}/firebase-firestore.js`)])
      .catch(() => { throw err("OFFLINE"); });
  const { googleClientId, ...options } = conf();
  const app = appM.initializeApp(options, injected ? `ttw-test-${apps}` : "ttw");
  // 앱(웹뷰)은 구글 창을 못 띄워 폰의 계정 고르기 → id 토큰으로 들어온다: 창·리다이렉트 처리 없이(인증 iframe 을 부르지 않게)
  const auth = inApp() && !injected ? authM.initializeAuth(app, { persistence: authM.indexedDBLocalPersistence }) : authM.getAuth(app);
  const db = fsM.getFirestore(app);
  if (injected && typeof injected.connect === "function") await injected.connect({ auth, db, authM, fsM });
  fb = { app, auth, db, A: authM, F: fsM };
  return fb;
}

const schoolMail = (u) => !!(u && u.emailVerified !== false && /^[^@\s]+@snu\.ac\.kr$/i.test(u.email || ""));
const userOf = (u) => (u ? { uid: u.uid, email: u.email || "", name: u.displayName || "", school: schoolMail(u) } : null);

async function me() {
  const { auth } = await load();
  if (!auth.currentUser) throw err("SIGNED_OUT");
  return auth.currentUser.uid;
}

export async function ready() {
  const { auth, A } = await load();
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  return userOf(auth.currentUser);
}

export function onUser(cb) {
  let off = null, closed = false;
  load().then(({ auth, A }) => {
    if (closed) return;
    off = A.onAuthStateChanged(auth, (u) => cb(userOf(u)));
  }).catch(() => cb(null));
  return () => { closed = true; if (off) off(); };
}


/** 구글 자격 얻기: 앱은 폰의 계정 고르기(id 토큰), 웹은 구글 창 */
async function google(reauth = false) {
  const { auth, A } = await load();
  if (inApp()) {
    const app = globalThis.TTW_APP;
    if (!app || typeof app.googleSignIn !== "function") throw err("APP_LOGIN");
    const clientId = conf().googleClientId || "";
    if (!clientId) throw err("NO_CONFIG");
    let r;
    try {
      r = await app.googleSignIn({ clientId });
    } catch (e) {
      throw err(e && (e.code === "NO_ACCOUNT" || e.code === "NO_CONFIG") ? e.code : "FAILED", { cause: e });
    }
    if (!r || !r.idToken) return null;
    const cred = A.GoogleAuthProvider.credential(r.idToken);
    try {
      return reauth ? await A.reauthenticateWithCredential(auth.currentUser, cred) : await A.signInWithCredential(auth, cred);
    } catch (e) {
      if (e && /network/.test(e.code || "")) throw err("OFFLINE");
      throw err("FAILED", { cause: e });
    }
  }
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return reauth ? await A.reauthenticateWithPopup(auth.currentUser, provider) : await A.signInWithPopup(auth, provider);
  } catch (e) {
    if (e && /popup-closed|cancelled-popup|user-cancelled/.test(e.code || "")) return null;
    if (e && /network/.test(e.code || "")) throw err("OFFLINE");
    throw err("FAILED", { cause: e });
  }
}

export async function signIn() {
  const r = await google(false);
  return r ? userOf(r.user) : null;
}

export async function signOut() {
  const { auth, A } = await load();
  await A.signOut(auth);
  if (inApp() && globalThis.TTW_APP && typeof globalThis.TTW_APP.googleSignOut === "function") globalThis.TTW_APP.googleSignOut();
}

// ---------------------------------------------------------------- 시간표 맞추기

const semsOf = (store) => (store.keys() || []).map((k) => /^timetables@(\d{4}-[12SW])$/.exec(k)).filter(Boolean).map((m) => m[1]);

function localLists(store) {
  const lists = {};
  for (const sem of semsOf(store)) lists[sem] = parseList(store.get(`${STORE_KEYS.list}@${sem}`), sem);
  return lists;
}

// 동기화 상태(디자인 130판 동기화 줄: '방금'·'3분 전'·'14:05'·'맞추는 중'·'연결되면 맞춰요')
let status = { state: "idle", last: null, uid: null };
const listeners = new Set();
function setStatus(next) {
  status = { ...status, ...next };
  const view = syncStatus();
  for (const cb of listeners) { try { cb(view); } catch { /* 화면 쪽 오류는 무시 */ } }
}

export function syncStatus(store = null) {
  let last = status.last;
  if (!last && store) {
    const saved = store.get(LAST_KEY);
    if (saved && saved.at && (!status.uid || saved.uid === status.uid)) last = saved.at;
  }
  return { state: status.state, last: last || null };
}

export function onSyncStatus(cb) {
  listeners.add(cb);
  cb(syncStatus());
  return () => listeners.delete(cb);
}

const offline = () => typeof navigator !== "undefined" && navigator && navigator.onLine === false;

export function forget(store) {
  for (const k of [SYNC_KEY, LAST_KEY]) {
    if (typeof store.remove === "function") store.remove(k);
    else store.set(k, null);
  }
  status = { state: "idle", last: null, uid: null };
  setStatus({});
}

export async function sync(store) {
  let uid;
  try {
    uid = await me();
  } catch (e) {
    if (e && e.code === "SIGNED_OUT") setStatus({ state: "signedOut", last: null, uid: null });
    throw e;
  }
  const saved = store.get(LAST_KEY);
  setStatus({ state: "syncing", uid, last: status.uid === uid && status.last ? status.last : saved && saved.uid === uid ? saved.at : null });
  if (offline()) {
    setStatus({ state: "offline" });
    throw err("OFFLINE");
  }
  try {
    const r = await syncNow(uid, store);
    const at = new Date().toISOString();
    store.set(LAST_KEY, { uid, at });
    setStatus({ state: "idle", last: at });
    return r;
  } catch (e) {
    const code = e && e.code;
    if (code === "OFFLINE" || code === "unavailable" || offline()) {
      setStatus({ state: "offline" });
      throw err("OFFLINE", { cause: e });
    }
    setStatus({ state: "error" });
    throw code && /^[A-Z_]+$/.test(code) ? e : err("FAILED", { cause: e });
  }
}

async function syncNow(uid, store) {
  const { db, F } = await load();
  const col = F.collection(db, "users", uid, "timetables");
  const snap = await F.getDocs(col);
  const remote = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const saved = store.get(SYNC_KEY) || {};
  const known = saved.uid === uid && Array.isArray(saved.ids) ? saved.ids : [];
  const lists = localLists(store);
  const r = mergeTimetables(lists, remote, known);
  for (const [sem, list] of Object.entries(r.local)) {
    store.set(`${STORE_KEYS.list}@${sem}`, serialize(list));
    lists[sem] = list;
  }
  if (r.upload.length) {
    const batch = F.writeBatch(db);
    for (const d of r.upload) batch.set(F.doc(col, d.id), d);
    batch.set(F.doc(db, "users", uid), { updated: F.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
  store.set(SYNC_KEY, { uid, ids: r.known });
  if (await profile()) await publishLists(uid, lists);
  return { changed: Object.keys(r.local), uploaded: r.upload.length, downloaded: Object.keys(r.local).length };
}

async function publishLists(uid, lists) {
  const { db, F } = await load();
  const col = F.collection(db, "shared", uid, "terms");
  const have = (await F.getDocs(col)).docs.map((d) => d.id);
  const copies = friendCopies(lists);
  const batch = F.writeBatch(db);
  let n = 0;
  for (const [sem, copy] of Object.entries(copies)) {
    if (copy) batch.set(F.doc(col, sem), copy);
    else if (have.includes(sem)) batch.delete(F.doc(col, sem));
    n++;
  }
  for (const sem of have) if (!(sem in copies)) { batch.delete(F.doc(col, sem)); n++; }
  if (n) await batch.commit();
}

export async function publish(store) {
  const uid = await me();
  if (!(await profile())) return;
  await publishLists(uid, localLists(store));
}

// ---------------------------------------------------------------- 친구

async function readProfile(id) {
  const { db, F } = await load();
  const s = await F.getDoc(F.doc(db, "profiles", id));
  return s.exists() ? s.data() : null;
}

export async function profile() {
  const p = await readProfile(await me());
  return p ? { nick: p.nick, tag: p.tag, showSchool: p.showSchool !== false } : null;
}

export async function setNick(nick, opts = {}) {
  const name = String(nick ?? "").trim();
  const problem = nickProblem(name);
  if (problem) throw err("BAD_NICK", { problem });
  const uid = await me();
  const { db, F, auth } = await load();
  const old = await profile();
  const showSchool = typeof opts.showSchool === "boolean" ? opts.showSchool : old ? old.showSchool : true;
  // 학교 계정 표시는 본인이 보이게 둔 snu.ac.kr 계정만(규칙이 로그인 토큰의 메일로 다시 본다)
  const school = showSchool && schoolMail(auth.currentUser);
  const sameName = old && handleKey(old.nick, "0") === handleKey(name, "0");
  if (sameName) { // 태그·열쇠는 그대로, 글자 모양(대소문자)과 학교 계정 보이기만
    try {
      await F.setDoc(F.doc(db, "profiles", uid), { nick: name, tag: old.tag, handle: handleKey(name, old.tag), updated: F.serverTimestamp(), showSchool, school });
    } catch (e) {
      throw err("FAILED", { cause: e });
    }
    return { nick: name, tag: old.tag, showSchool };
  }
  for (let i = 0; i < 8; i++) {
    const tag = randomTag();
    const key = handleKey(name, tag);
    try {
      await F.runTransaction(db, async (tx) => {
        const h = await tx.get(F.doc(db, "handles", key));
        if (h.exists()) throw err("TAKEN");
        if (old) tx.delete(F.doc(db, "handles", handleKey(old.nick, old.tag)));
        tx.set(F.doc(db, "handles", key), { uid });
        tx.set(F.doc(db, "profiles", uid), { nick: name, tag, handle: key, updated: F.serverTimestamp(), showSchool, school });
      });
      return { nick: name, tag, showSchool };
    } catch (e) {
      if (e && e.code === "TAKEN") continue;
      throw err("FAILED", { cause: e });
    }
  }
  throw err("FAILED");
}

const reqId = (from, to) => `${from}_${to}`;

async function people(uids) {
  const out = new Map();
  await Promise.all([...new Set(uids)].map(async (u) => {
    const p = await readProfile(u).catch(() => null);
    out.set(u, p ? { nick: p.nick, tag: p.tag, school: p.school === true } : null);
  }));
  return out;
}

export async function friends() {
  const uid = await me();
  const { db, F } = await load();
  const reqs = F.collection(db, "requests");
  const [sent, got, blocks] = await Promise.all([
    F.getDocs(F.query(reqs, F.where("from", "==", uid))),
    F.getDocs(F.query(reqs, F.where("to", "==", uid))),
    F.getDocs(F.collection(db, "blocks", uid, "list")),
  ]);
  const rows = [...sent.docs.map((d) => d.data()), ...got.docs.map((d) => d.data())];
  const blocked = blocks.docs.map((d) => d.id);
  const names = await people([...rows.map((r) => (r.from === uid ? r.to : r.from)), ...blocked]);
  const row = (other) => ({ uid: other, ...(names.get(other) || { nick: "", tag: "", school: false }) });
  const out = { friends: [], incoming: [], outgoing: [], blocked: blocked.map(row) };
  const seen = new Set();
  for (const r of rows) {
    const other = r.from === uid ? r.to : r.from;
    if (r.state === "accepted") { if (!seen.has(other)) out.friends.push(row(other)); seen.add(other); }
    else if (r.to === uid) out.incoming.push(row(other));
    else out.outgoing.push(row(other));
  }
  const byName = (a, b) => `${a.nick}#${a.tag}`.localeCompare(`${b.nick}#${b.tag}`);
  for (const k of ["friends", "incoming", "outgoing", "blocked"]) out[k].sort(byName);
  return out;
}

export async function request(text) {
  const h = parseHandle(text);
  if (!h) throw err("NOT_FOUND");
  const uid = await me();
  const { db, F } = await load();
  const s = await F.getDoc(F.doc(db, "handles", handleKey(h.nick, h.tag)));
  if (!s.exists()) throw err("NOT_FOUND");
  const other = s.data().uid;
  if (other === uid) throw err("SELF");
  const theirs = await F.getDoc(F.doc(db, "requests", reqId(other, uid)));
  if (theirs.exists()) {
    if (theirs.data().state === "accepted") throw err("ALREADY", { uid: other });
    await accept(other);
    return { uid: other, accepted: true };
  }
  const mine = await F.getDoc(F.doc(db, "requests", reqId(uid, other))); // 이미 보냈거나 친구다: 다시 쓰면 규칙이 막는다(받은 사람만 고친다)
  if (mine.exists()) {
    if (mine.data().state === "accepted") throw err("ALREADY", { uid: other });
    return { uid: other, accepted: false };
  }
  try {
    await F.setDoc(F.doc(db, "requests", reqId(uid, other)), { from: uid, to: other, state: "pending", created: F.serverTimestamp(), updated: F.serverTimestamp() });
  } catch (e) {
    if (e && e.code === "permission-denied") throw err("BLOCKED");
    throw err("FAILED", { cause: e });
  }
  return { uid: other, accepted: false };
}

export async function accept(other) {
  const uid = await me();
  const { db, F } = await load();
  await F.updateDoc(F.doc(db, "requests", reqId(other, uid)), { state: "accepted", updated: F.serverTimestamp() });
}

async function dropRequests(other) {
  const uid = await me();
  const { db, F } = await load();
  await Promise.all([reqId(uid, other), reqId(other, uid)].map(async (id) => {
    const ref = F.doc(db, "requests", id);
    const s = await F.getDoc(ref).catch(() => null);
    if (s && s.exists()) await F.deleteDoc(ref);
  }));
}

export const decline = (other) => dropRequests(other);
export const cancel = (other) => dropRequests(other);
export const unfriend = (other) => dropRequests(other);

export async function block(other) {
  const uid = await me();
  const { db, F } = await load();
  await F.setDoc(F.doc(db, "blocks", uid, "list", other), { at: F.serverTimestamp() });
  await dropRequests(other);
}

export async function unblock(other) {
  const uid = await me();
  const { db, F } = await load();
  await F.deleteDoc(F.doc(db, "blocks", uid, "list", other));
}

export async function friendTimetables(other) {
  await me();
  const { db, F } = await load();
  let snap;
  try {
    snap = await F.getDocs(F.collection(db, "shared", other, "terms"));
  } catch (e) {
    if (e && e.code === "permission-denied") throw err("NOT_FRIEND"); // 친구가 아니다(끊겼거나 막혔다)
    if (e && e.code === "unavailable") throw err("OFFLINE");
    throw err("FAILED", { cause: e });
  }
  return snap.docs.map((d) => d.data()).sort((a, b) => String(b.sem).localeCompare(String(a.sem)));
}

export const inviteLink = (p) => `${APP_URL}#friend=${encodeURIComponent(`${p.nick}#${p.tag}`)}`;
export const reportLink = (p) => `mailto:${REPORT_MAIL}?subject=${encodeURIComponent(`[신고] 닉네임 ${p.nick}#${p.tag}`)}`; // 디자인 130판

// ---------------------------------------------------------------- 계정 지우기

export async function deleteAccount() {
  const uid = await me();
  const { db, F, auth, A } = await load();
  const p = await profile();
  const refs = [];
  for (const sub of [["users", uid, "timetables"], ["shared", uid, "terms"], ["blocks", uid, "list"]]) {
    refs.push(...(await F.getDocs(F.collection(db, ...sub))).docs.map((d) => d.ref));
  }
  const reqs = F.collection(db, "requests");
  for (const field of ["from", "to"]) refs.push(...(await F.getDocs(F.query(reqs, F.where(field, "==", uid)))).docs.map((d) => d.ref));
  if (p) refs.push(F.doc(db, "handles", handleKey(p.nick, p.tag)));
  refs.push(F.doc(db, "profiles", uid), F.doc(db, "users", uid));
  for (let i = 0; i < refs.length; i += 400) {
    const batch = F.writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  try {
    await A.deleteUser(auth.currentUser);
  } catch (e) {
    if (!e || e.code !== "auth/requires-recent-login") throw err("FAILED", { cause: e });
    if (!(await google(true))) throw err("CANCELLED");
    await A.deleteUser(auth.currentUser);
  }
}
