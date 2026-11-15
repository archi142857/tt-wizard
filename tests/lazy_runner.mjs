// account.js 가 Firebase SDK 를 로그인한 적이 있을 때만 받는지(update115, 법무 11/15) — 네트워크 없이. tests/test_account.py 가 부른다
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
let dbs = [], keys = []; // 기기의 IndexedDB 목록과 Firebase 저장소(firebaseLocalStorage)의 열쇠
const later = (f) => setTimeout(f, 0);
globalThis.indexedDB = {
  databases: async () => dbs,
  open: (name) => {
    const req = {};
    later(() => {
      if (!dbs.some((d) => d.name === name)) { req.error = new Error("없음"); req.onerror && req.onerror(); return; }
      req.result = {
        objectStoreNames: { contains: (n) => n === "firebaseLocalStorage" },
        transaction: () => ({ objectStore: () => ({ getAllKeys: () => { const r = {}; later(() => { r.result = keys.slice(); r.onsuccess && r.onsuccess(); }); return r; } }) }),
        close() {},
      };
      req.onsuccess && req.onsuccess();
    });
    return req;
  },
};
const account = await import("../web/js/account.js");
account.configure({ config: { apiKey: "x", projectId: "p" } }); // 설정은 있지만 에뮬레이터 연결은 없다 → SDK 를 받으려 하면 OFFLINE
const out = {};
out.available = account.available();
out.ready = await account.ready().catch((e) => e.code);
const calls = [];
const off = account.onUser((u) => calls.push(u));
await new Promise((r) => setTimeout(r, 20));
out.onUser = calls;
off();
out.sync = await account.sync({ get: () => null, set() {}, keys: () => [] }).catch((e) => e.code);
out.signOut = await account.signOut().then(() => "ok", (e) => e.code);
out.markAfterSignOut = localStorage.getItem("ttw.signedIn");
dbs = [{ name: "firebaseLocalStorageDb" }]; // Firebase 를 켜기만 했거나 로그아웃한 기기: 저장소는 있지만 사용자가 없다(update116)
keys = ["firebase:persistence"];
out.readyEmpty = await account.ready().catch((e) => e.code);
out.markEmpty = localStorage.getItem("ttw.signedIn");
keys = ["firebase:authUser:x:[DEFAULT]"]; // 표시 전 판에서 로그인해 둔 기기
out.readyOld = await account.ready().catch((e) => e.code);
out.markOld = localStorage.getItem("ttw.signedIn");
process.stdout.write(JSON.stringify(out));
