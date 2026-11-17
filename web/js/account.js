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
//   profile()                      → { nick, tag, showSchool } | null(친구 기능을 아직 안 켬). tag 는 계정 번호(여섯 자리).
//                                  옛 네 자리 번호면 이때 새 번호를 받는다(못 받으면 이번엔 옛 번호 그대로)
//   setNick(nick, { showSchool }?) → { nick, tag, showSchool }   2~12자 한글·영문·숫자·밑줄. 거르는 말이면 BAD_NICK(problem).
//                                  번호는 처음 정할 때 한 번 받고, 닉네임을 바꿔도 그대로다. 닉네임을 바꾸면 예전 '닉네임#번호'로는 못 찾는다.
//                                  showSchool 은 처음 true
//   friends()                      → { friends, incoming, outgoing, blocked } 각 [{ uid, nick, tag, school }](school: 그 사람이 보이게 둔 snu.ac.kr 계정)
//   find('영표#482193')             → { uid, nick, tag, school }   닉네임#번호로 찾은 사람. 닉네임이 지금 닉네임과 다르거나 번호만이면 NOT_FOUND
//                                  (화면은 '닉네임이나 번호가 맞지 않아요'만 보이고 지금 닉네임은 보이지 않는다, 법무 11/17)
//   request('영표#482193')          → { uid, accepted }. 예전 초대 링크의 '닉네임#0420' 도 된다. 상대가 먼저 보낸 요청이 있으면 그걸 수락한다(accepted: true).
//                                  이미 보냈으면 그대로, 이미 친구면 ALREADY. 하루 요청 수 제한은 없다(update138 에 넣었다가 사용자 11/17 22:54 '20개 제한 없애기로 했음
//                                  이름이랑 같이 식별하는 걸로 바꿔서', update139)
//   accept(uid) · decline(uid) · cancel(uid) · unfriend(uid) · block(uid) · unblock(uid)
//   friendTimetables(uid)          → [{ sem, title, items, updated }](새 학기가 앞). items 는 sync.js friendItems 꼴. 친구가 아니면 NOT_FRIEND
//   publish(store)                 친구 사본만 다시 올린다(sync 가 같이 한다)
//   inviteLink({ nick, tag })      → 'https://archi142857.github.io/tt-wizard/#friend=닉네임%23482193'
//   reportLink({ nick, tag })      → 닉네임 신고 메일 주소(mailto)
//   tagLink({ nick, tag })         → 번호 바꾸기 부탁 메일 주소(mailto, 본문 두 줄 TAG_MAIL_BODY). 번호는 고를 수 없고 부탁한 사람만 관리자가 바꿔 준다
//   isAdmin()                      → true | false   콘솔에서 admins/{uid} 를 만든 계정인가(웹 개발자 메뉴의 '번호 바꿔 주기')
//   adminSetTag('영표#482193', '100001') → { nick, tag, from }   관리자가 그 사람 번호를 바꾼다(닉네임은 그대로). 첫 칸은 닉네임#번호·번호(관리자만)·옛 닉네임#네 자리.
//                                  없으면 NOT_FOUND, 새 번호를 다른 사람이 쓰거나 거둔 번호면 TAKEN, 관리자가 아니면 NOT_ADMIN, 꼴이 틀리면 BAD_HANDLE·BAD_TAG
//   report({ uid, nick, tag }, reason, note?) → { id }   닉네임 신고(앱 안 목록). reason: 'nick'(부적절한 닉네임)·'impersonation'(사칭)·'stranger'(모르는 사람의 친구 요청)·
//                                  'other'. note 는 200자까지. 같은 사람은 하루 한 번(넘으면 ALREADY). 켜는 날은 처리방침 다음 판 시행일(그때까지 메일 신고)
//   listReports({ all }?)          → [{ id, reporter, target, handle, reason, note, state, created, closed }](관리자. 새것 먼저, 처음엔 처리 안 한 것만)
//   closeReport(id)                관리자가 처리 표시(state 'closed', closed 때). 처리하고 1년 지나면 콘솔에서 지운다
//   adminOrphans()                 → { numbers: [번호], handles: [열쇠] }   관리자. 프로필이 없는 uid 를 단 번호·찾는 열쇠(옛 판 앱으로 계정을 지우면 남는다)
//   adminCleanOrphans(found)       → { numbers, handles }(정리한 수)   그 번호는 '안 씀'으로 거두고 열쇠는 지운다. 법무 11/17: 지운 계정의 것이라 늦어도 5일 안에

import FIREBASE from "./firebase-config.js";
import { mergeTimetables, friendCopies, nickProblem, parseHandle, handleKey, randomNumber, isNumber } from "./sync.js";
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

// Firebase SDK 는 이 기기에서 로그인한 적이 있을 때만 받는다(법무 11/15 'SDK 를 로그인 때만 gstatic 에서', update115): 로그인하면 표시(MARK)를 두고
// 로그아웃·계정 삭제 때 지운다. 표시가 없으면 ready()·onUser 는 SDK 없이 '로그인 안 함'이고, signIn() 이 그때 받는다.
// 표시를 두기 전 판에서 로그인한 기기는 Firebase 가 남긴 저장소(firebaseLocalStorageDb)에 로그인한 사용자가 있을 때만 이어 간다(update116: 저장소는
// Firebase 를 한 번 켜기만 해도 생기고 로그아웃해도 남아서, 있는지만 보면 로그아웃한 기기도 늘 받았다. 처리방침 12절 '로그인하지 않으면 접속하지 않습니다').
const MARK = "ttw.signedIn";
const pending = new Set(); // 로그인 전에 붙은 onUser: 로그인하면 붙인다
function marked() {
  if (injected && injected.connect) return true; // 에뮬레이터 시험
  try { return !!globalThis.localStorage && globalThis.localStorage.getItem(MARK) === "1"; } catch { return false; }
}
function setMark(on) {
  try { if (on) globalThis.localStorage.setItem(MARK, "1"); else globalThis.localStorage.removeItem(MARK); } catch { /* 저장소가 막혀도 로그인은 된다 */ }
}
/** Firebase 가 기기에 둔 로그인 사용자가 있나(firebaseLocalStorageDb 의 firebaseLocalStorage 에 'firebase:authUser:' 열쇠). 없는 저장소는 만들지 않는다 */
async function storedUser() {
  const idb = globalThis.indexedDB;
  if (!idb || typeof idb.databases !== "function") return false;
  const dbs = await idb.databases();
  if (!dbs.some((d) => d && d.name === "firebaseLocalStorageDb")) return false;
  return new Promise((resolve) => {
    const req = idb.open("firebaseLocalStorageDb");
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch { /* 그사이 지워졌으면 만들지 않는다 */ } };
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      const done = (v) => { try { db.close(); } catch { /* 닫혀 있음 */ } resolve(v); };
      try {
        if (!db.objectStoreNames.contains("firebaseLocalStorage")) return done(false);
        const keys = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAllKeys();
        keys.onsuccess = () => done((keys.result || []).some((k) => String(k).startsWith("firebase:authUser:")));
        keys.onerror = () => done(false);
      } catch { done(false); }
    };
  });
}
async function wanted() {
  if (fb || marked()) return true;
  try {
    if (await storedUser()) { setMark(true); return true; }
  } catch { /* 모르면 로그인 안 함으로 */ }
  return false;
}

async function me() {
  if (!(await wanted())) throw err("SIGNED_OUT");
  const { auth } = await load();
  if (!auth.currentUser) throw err("SIGNED_OUT");
  return auth.currentUser.uid;
}

export async function ready() {
  if (!(await wanted())) return null;
  const { auth } = await load();
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  if (!auth.currentUser) setMark(false); // 표시는 있는데 로그인 사용자가 없다(로그인해 둔 것이 풀렸거나 update115 가 빈 저장소를 보고 둔 표시): 다음부터 받지 않는다
  return userOf(auth.currentUser);
}

export function onUser(cb) {
  let off = null, closed = false;
  const attach = () => {
    pending.delete(attach);
    load().then(({ auth, A }) => {
      if (closed) return;
      off = A.onAuthStateChanged(auth, (u) => { if (!u) setMark(false); cb(userOf(u)); }); // 사용자가 없으면 표시를 지운다(ready 와 같다)
    }).catch(() => cb(null));
  };
  wanted().then((yes) => {
    if (closed) return;
    if (yes) attach();
    else { pending.add(attach); cb(null); }
  });
  return () => { closed = true; pending.delete(attach); if (off) off(); };
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
  if (!r) return null;
  setMark(true);
  for (const attach of [...pending]) attach(); // 로그인 전에 붙은 onUser 를 이제 붙인다
  return userOf(r.user);
}

export async function signOut() {
  setMark(false);
  if (!fb) return; // SDK 를 받은 적이 없다: 로그인한 적도 없다
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

// ---------------------------------------------------------------- 닉네임과 계정 번호
// profiles/{uid} = { nick, tag(계정 번호), handle(찾는 열쇠 '닉네임#번호'), oldHandle?(예전 '닉네임#네 자리' 열쇠), updated, showSchool, school }
// numbers/{번호} = { uid }(겹치지 않게만, 남은 못 읽는다), handles/{닉네임#번호} = { uid }(친구 찾기).
// 번호는 처음 닉네임을 정할 때 한 번 받고 닉네임을 바꿔도 그대로다(사용자 11/17 '계정마다 고유 번호 부여하고'). 친구는 지금 닉네임#번호로만 찾는다
// (사용자 11/17 법무 채팅 '닉네임 + 번호로 친구추가 되게 하고, 현재 닉네임과 다르면 초대 발송이 안되는 걸로'): 닉네임을 바꾸면 예전 열쇠를 지워서
// 예전 링크·QR 은 열리지 않는다. 번호는 다시 주지 않아 지운 열쇠가 남에게 갈 일은 없다.
// 그 전의 네 자리 번호로 만든 프로필은 profile()·setNick() 이 처음 부를 때 새 번호로 옮기고, 네 자리 열쇠는 닉네임을 바꾸거나 계정을 지울 때까지 남긴다.

/** 번호를 하나 받아 프로필에 붙인다(처음이거나 옛 네 자리 번호일 때). 이미 번호가 있으면(다른 기기가 먼저 받음) 그 프로필 그대로 */
async function claimNumber(uid, fields) {
  const { db, F } = await load();
  for (let i = 0; i < 8; i++) {
    const n = randomNumber(), key = handleKey(fields.nick, n);
    // 남의 번호는 읽을 수 없다(못 읽으면 쓰는 번호). 비었으면 아래 쓰기에서 만든다(그새 누가 가져가면 규칙이 막아 다시 뽑는다)
    const free = await F.getDoc(F.doc(db, "numbers", n)).then((s) => !s.exists(), () => false);
    if (!free) continue;
    try {
      return await F.runTransaction(db, async (tx) => {
        const ps = await tx.get(F.doc(db, "profiles", uid));
        const old = ps.exists() ? ps.data() : null;
        if (old && isNumber(old.tag)) return old;
        const next = { nick: fields.nick, tag: n, handle: key, showSchool: fields.showSchool, school: fields.school, updated: F.serverTimestamp() };
        if (old && old.handle) next.oldHandle = old.handle; // 네 자리 때 열쇠는 예전 열쇠로 남긴다(예전 초대 링크)
        tx.set(F.doc(db, "numbers", n), { uid });
        tx.set(F.doc(db, "handles", key), { uid });
        tx.set(F.doc(db, "profiles", uid), next);
        return next;
      });
    } catch (e) {
      if (e && e.code === "permission-denied") continue;
      throw err("FAILED", { cause: e });
    }
  }
  throw err("FAILED");
}

/** 번호는 있는데 찾는 열쇠가 없거나 맞지 않는 프로필(update136 때 꼴: handle 칸에 예전 열쇠)을 고친다 */
async function fixHandle(uid, p) {
  const { db, F } = await load();
  const key = handleKey(p.nick, p.tag);
  const next = { nick: p.nick, tag: p.tag, handle: key, showSchool: p.showSchool !== false, school: p.school === true, updated: F.serverTimestamp() };
  const old = p.oldHandle || (p.handle && /#[0-9]{4}$/.test(p.handle) ? p.handle : null);
  if (old) next.oldHandle = old;
  const b = F.writeBatch(db);
  b.set(F.doc(db, "handles", key), { uid });
  b.set(F.doc(db, "profiles", uid), next);
  await b.commit();
  return next;
}

export async function profile() {
  const uid = await me();
  let p = await readProfile(uid);
  // 옛 네 자리 번호는 새 번호로, 열쇠가 맞지 않으면 고친다. 못 하면(연결이 끊김 등) 이번엔 그대로 보이고 다음에 다시
  if (p && !isNumber(p.tag)) p = await claimNumber(uid, { nick: p.nick, showSchool: p.showSchool !== false, school: p.school === true }).catch(() => p);
  else if (p && p.handle !== handleKey(p.nick, p.tag)) p = await fixHandle(uid, p).catch(() => p);
  return p ? { nick: p.nick, tag: p.tag, showSchool: p.showSchool !== false } : null;
}

export async function setNick(nick, opts = {}) {
  const name = String(nick ?? "").trim();
  const problem = nickProblem(name);
  if (problem) throw err("BAD_NICK", { problem });
  const uid = await me();
  const { db, F, auth } = await load();
  const cur = await readProfile(uid);
  const showSchool = typeof opts.showSchool === "boolean" ? opts.showSchool : cur ? cur.showSchool !== false : true;
  // 학교 계정 표시는 본인이 보이게 둔 snu.ac.kr 계정만(규칙이 로그인 토큰의 메일로 다시 본다)
  const school = !!(showSchool && schoolMail(auth.currentUser));
  try {
    let p = cur && isNumber(cur.tag) ? cur : await claimNumber(uid, { nick: name, showSchool, school });
    if (p.handle !== handleKey(p.nick, p.tag)) p = await fixHandle(uid, p);
    if (p.nick === name && (p.showSchool !== false) === showSchool && (p.school === true) === school) return { nick: name, tag: p.tag, showSchool };
    // 번호는 그대로. 닉네임이 바뀌면 찾는 열쇠도 바꾸고, 예전 열쇠들은 지운다(지금 닉네임#번호로만 찾는다)
    const key = handleKey(name, p.tag), next = { nick: name, tag: p.tag, handle: key, showSchool, school, updated: F.serverTimestamp() };
    const b = F.writeBatch(db);
    if (key !== p.handle) {
      b.set(F.doc(db, "handles", key), { uid });
      b.delete(F.doc(db, "handles", p.handle));
      if (p.oldHandle) b.delete(F.doc(db, "handles", p.oldHandle));
    } else if (p.oldHandle) {
      next.oldHandle = p.oldHandle;
    }
    b.set(F.doc(db, "profiles", uid), next);
    await b.commit();
    return { nick: name, tag: p.tag, showSchool };
  } catch (e) {
    if (e && e.code && /^[A-Z_]+$/.test(e.code)) throw e;
    throw err("FAILED", { cause: e });
  }
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

/** 친구 찾기 칸의 글 → 그 사람 uid. '닉네임#번호'(예전 '닉네임#네 자리'도)의 열쇠로 찾는다. 닉네임이 지금 것과 다르면 열쇠가 없어 NOT_FOUND */
async function lookup(text) {
  const h = parseHandle(text);
  if (!h) throw err("NOT_FOUND");
  await me();
  const { db, F } = await load();
  const s = await F.getDoc(F.doc(db, "handles", handleKey(h.nick, h.tag)));
  if (!s.exists() || !s.data().uid) throw err("NOT_FOUND"); // 거둔 번호·열쇠({ retired: true })는 없는 사람
  return s.data().uid;
}

export async function find(text) {
  const other = await lookup(text);
  const p = await readProfile(other).catch(() => null);
  if (!p) throw err("NOT_FOUND");
  return { uid: other, nick: p.nick, tag: p.tag, school: p.school === true };
}

export async function request(text) {
  const other = await lookup(text);
  const uid = await me();
  const { db, F } = await load();
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
    if (e && e.code === "permission-denied") throw err("BLOCKED"); // 나를 막아 둔 사람이거나 그 사람 계정이 없다
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
// 번호 바꾸기 부탁(법무 11/17 ③): 본문에 두 줄을 미리 채운다
export const TAG_MAIL_BODY = "바꾸고 싶은 번호(여섯 자리):\n\n이 계정에 로그인한 Google 메일 주소로 보내 주세요. 다른 사람과 헷갈리거나 규칙에 어긋나는 번호는 바꿔 드리지 않을 수 있어요.";
export const tagLink = (p) => `mailto:${REPORT_MAIL}?subject=${encodeURIComponent(`[번호 바꾸기] 닉네임 ${p.nick}#${p.tag}`)}&body=${encodeURIComponent(TAG_MAIL_BODY)}`;

// ---------------------------------------------------------------- 번호 바꿔 주기(관리자)
// 사용자 11/17 '태그 번호는 아무나 원하는 걸 할 수 없고 원하는 사람에 한해서 내가 바꿔줄 수 있는 번호로 바꿔주는 방식'. 관리자는 콘솔에서
// admins/{uid} 문서를 만든 계정이다(저장소에는 누구인지 적지 않는다). 규칙(firestore.rules)이 번호만 바꾸게 하고 닉네임은 못 바꾼다.
// 바뀐 사람의 앱은 프로필을 서버에서 다시 읽을 때(profile(): 친구 화면) 새 번호를 본다. 친구 관계는 uid 로 이어져 그대로다.
// 법무 11/17: 옛 번호는 적어도 1년 남에게 주지 않는다(옛 초대 링크·QR 이 엉뚱한 사람에게 가지 않게) → 지우지 않고 { retired: true } 로 남긴다(다시 주지 않음).
// 부탁은 그 계정에 로그인한 Google 메일에서 온 것만, 무료로만, 남과 헷갈리거나 운영자처럼 보이거나 나쁜 뜻으로 읽히는 번호는 거절(사람이 판단)

export async function isAdmin() {
  const uid = await me();
  const { db, F } = await load();
  try {
    return (await F.getDoc(F.doc(db, "admins", uid))).exists();
  } catch {
    return false;
  }
}

export async function adminSetTag(text, tag) {
  const only = /^\s*#?\s*([0-9]{6})\s*$/.exec(String(text ?? "")); // 관리자는 번호만으로도 찾는다(번호 문서를 읽을 수 있다)
  const h = only ? null : parseHandle(text), next = String(tag ?? "").trim();
  if (!only && !h) throw err("BAD_HANDLE");
  if (!isNumber(next)) throw err("BAD_TAG");
  await me();
  const { db, F } = await load();
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
    throw err(e && e.code === "permission-denied" ? "NOT_ADMIN" : "FAILED", { cause: e });
  }
}

// ---------------------------------------------------------------- 닉네임 신고(앱 안 목록)
// 사용자 11/17 '목록으로 모아 보는 이 방식으로 가자', 법무 11/17: 받는 것은 신고한 사람·신고된 사람 uid, 그때 닉네임#번호, 까닭, 덧붙임 글(선택, 200자),
// 보낸 때. 관리자만 읽고 처리 표시를 한다. 신고한 사람은 신고된 사람에게 알리지 않는다. 처리를 마치고 1년이 지나면 지운다(콘솔).
// 같은 사람은 하루 한 번(문서 이름에 날). 켜는 날은 처리방침 다음 판 시행일, 그때까지 화면은 메일 신고(reportLink)

export const REPORT_REASONS = ["nick", "impersonation", "stranger", "other"];
const isoOf = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : null);

export async function report(p, reason, note = "") {
  if (!p || !p.uid) throw err("NOT_FOUND");
  if (!REPORT_REASONS.includes(reason)) throw err("BAD_REASON");
  const uid = await me();
  if (p.uid === uid) throw err("SELF");
  const { db, F } = await load();
  const text = String(note ?? "").trim().slice(0, 200), handle = `${p.nick || ""}#${p.tag || ""}`.slice(0, 24);
  const today = Math.floor(Date.now() / 86400000);
  for (const day of [today, today + 1, today - 1]) { // 날은 서버 시각 기준이라 기기 시계가 날을 넘나들면 앞뒤 날로 한 번씩 더
    const id = `${uid}_${p.uid}_${day}`;
    try {
      await F.setDoc(F.doc(db, "reports", id), { reporter: uid, target: p.uid, handle, reason, note: text, created: F.serverTimestamp(), state: "open" });
      return { id };
    } catch (e) {
      if (!e || e.code !== "permission-denied") throw err("FAILED", { cause: e });
    }
  }
  throw err("ALREADY"); // 오늘 이미 그 사람을 신고했다
}

export async function listReports({ all = false } = {}) {
  await me();
  const { db, F } = await load();
  const col = F.collection(db, "reports");
  try {
    const snap = await F.getDocs(all ? col : F.query(col, F.where("state", "==", "open")));
    return snap.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, created: isoOf(x.created), closed: isoOf(x.closed) }; })
      .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  } catch (e) {
    throw err(e && e.code === "permission-denied" ? "NOT_ADMIN" : "FAILED", { cause: e });
  }
}

export async function closeReport(id) {
  await me();
  const { db, F } = await load();
  try {
    await F.updateDoc(F.doc(db, "reports", String(id)), { state: "closed", closed: F.serverTimestamp() });
  } catch (e) {
    throw err(e && e.code === "permission-denied" ? "NOT_ADMIN" : e && e.code === "not-found" ? "NOT_FOUND" : "FAILED", { cause: e });
  }
}

/**
 * 관리자: 프로필이 없는 uid 를 단 번호·찾는 열쇠. 옛 판 앱(번호를 받기 전 판)으로 계정을 지우면 그 앱이 모르는 번호 문서와 예전 열쇠가 남는다.
 * 지운 계정의 것이라 늦어도 5일 안에 지운다(법무 11/17, 개인정보 보호법 제21조). 옛 판이 남아 있는 동안 며칠에 한 번 본다
 */
export async function adminOrphans() {
  await me();
  const { db, F } = await load();
  let nums, keys;
  try {
    [nums, keys] = await Promise.all([F.getDocs(F.collection(db, "numbers")), F.getDocs(F.collection(db, "handles"))]);
  } catch (e) {
    throw err(e && e.code === "permission-denied" ? "NOT_ADMIN" : "FAILED", { cause: e });
  }
  const owner = (d) => String((d.data() || {}).uid || "");
  const uids = [...new Set([...nums.docs, ...keys.docs].map(owner).filter(Boolean))];
  const gone = new Set();
  for (const u of uids) if (!(await readProfile(u))) gone.add(u);
  return { numbers: nums.docs.filter((d) => gone.has(owner(d))).map((d) => d.id), handles: keys.docs.filter((d) => gone.has(owner(d))).map((d) => d.id) };
}

/** 관리자: adminOrphans 로 찾은 번호는 '안 씀'으로 거두고(다시 주지 않음) 열쇠는 지운다. 규칙은 프로필이 없을 때만 받는다 */
export async function adminCleanOrphans(found) {
  await me();
  const { db, F } = await load();
  const numbers = [...((found && found.numbers) || [])], handles = [...((found && found.handles) || [])];
  const writes = [...numbers.map((n) => (b) => b.set(F.doc(db, "numbers", n), { retired: true })), ...handles.map((k) => (b) => b.delete(F.doc(db, "handles", k)))];
  try {
    for (let i = 0; i < writes.length; i += 400) {
      const b = F.writeBatch(db);
      for (const w of writes.slice(i, i + 400)) w(b);
      await b.commit();
    }
  } catch (e) {
    throw err(e && e.code === "permission-denied" ? "NOT_ADMIN" : "FAILED", { cause: e });
  }
  return { numbers: numbers.length, handles: handles.length };
}

// ---------------------------------------------------------------- 계정 지우기

export async function deleteAccount() {
  const uid = await me();
  const { db, F, auth, A } = await load();
  const p = await readProfile(uid);
  const refs = [];
  for (const sub of [["users", uid, "timetables"], ["shared", uid, "terms"], ["blocks", uid, "list"]]) {
    refs.push(...(await F.getDocs(F.collection(db, ...sub))).docs.map((d) => d.ref));
  }
  const reqs = F.collection(db, "requests");
  for (const field of ["from", "to"]) refs.push(...(await F.getDocs(F.query(reqs, F.where(field, "==", uid)))).docs.map((d) => d.ref));
  for (let i = 0; i < refs.length; i += 400) {
    const batch = F.writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  // 번호·열쇠·프로필(과 update138 때 남은 하루 요청 수)은 마지막에 한 번에. 번호는 누구 것이었는지만 지워 '안 씀'으로 남기고(다시 남에게 주지 않는다),
  // 닉네임이 든 열쇠는 지운다(법무 11/17). 규칙은 프로필을 같이 지울 때만 거두고 지우게 한다
  const last = F.writeBatch(db);
  const mine = async (ref) => { const s = await F.getDoc(ref).catch(() => null); return !!(s && s.exists() && s.data().uid === uid); };
  if (p && isNumber(p.tag) && (await mine(F.doc(db, "numbers", p.tag)))) last.set(F.doc(db, "numbers", p.tag), { retired: true });
  const keys = p ? [p.handle, p.oldHandle, p.tag && !isNumber(p.tag) ? handleKey(p.nick, p.tag) : null] : [];
  for (const key of [...new Set(keys.filter(Boolean))]) if (await mine(F.doc(db, "handles", key))) last.delete(F.doc(db, "handles", key));
  last.delete(F.doc(db, "limits", uid));
  last.delete(F.doc(db, "profiles", uid));
  last.delete(F.doc(db, "users", uid));
  await last.commit();
  try {
    await A.deleteUser(auth.currentUser);
  } catch (e) {
    if (!e || e.code !== "auth/requires-recent-login") throw err("FAILED", { cause: e });
    if (!(await google(true))) throw err("CANCELLED");
    await A.deleteUser(auth.currentUser);
  }
  setMark(false);
}
