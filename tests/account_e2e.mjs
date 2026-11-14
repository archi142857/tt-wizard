// 로그인·동기화·친구 끝까지 시험(update110): Firebase 에뮬레이터(Auth 9099, Firestore 8085)에서 web/js/account.js 를 두 사람(A·B)으로 돌린다.
//   cd firebase && npx firebase emulators:exec --only auth,firestore --project demo-ttw "node ../tests/account_e2e.mjs"
import * as appM from "firebase/app";
import * as authM from "firebase/auth";
import * as fsM from "firebase/firestore";
import * as account from "../web/js/account.js";

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { get: (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), keys: () => [...m.keys()], m };
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
out.syncA = await account.sync(phoneA);
out.nickA = await account.setNick("영표");
as("google-b", "friend@gmail.com");
const B = (await account.ready()).uid;
out.nickB = await account.setNick("친구");
out.request = await account.request(`영표#${out.nickA.tag}`);
out.self = await account.request(`친구#${out.nickB.tag}`).catch((e) => e.code);
out.missing = await account.request("없는사람#0000").catch((e) => e.code);
as("google-a", "yp@snu.ac.kr");
out.beforeA = await account.friends();
await account.accept(out.beforeA.incoming[0].uid);
out.afterA = await account.friends();
out.publishA = await account.sync(phoneA); // 닉네임이 있어 친구 사본도 올린다
as("google-b", "friend@gmail.com");
out.friendView = await account.friendTimetables(A);
// A 의 다른 기기: 비어 있다가 서버에서 받는다
as("google-a", "yp@snu.ac.kr");
const laptopA = store({});
out.laptop = await account.sync(laptopA);
out.laptopList = laptopA.get("timetables@2026-2");
// 이 기기에서 지우면 다른 기기에서도 지운다
phoneA.set("timetables@2026-2", []);
out.deleteSync = await account.sync(phoneA);
out.laptop2 = await account.sync(laptopA);
out.laptopAfter = laptopA.get("timetables@2026-2");
// 막기: B 가 A 를 막으면 친구가 끊기고 A 는 다시 요청 못 한다
as("google-b", "friend@gmail.com");
await account.block(A);
out.blockedB = await account.friends();
as("google-a", "yp@snu.ac.kr");
out.blockedRequest = await account.request(`친구#${out.nickB.tag}`).catch((e) => e.code);
out.cantSee = await account.friendTimetables(B).then(() => "read", (e) => "denied");
// 계정 지우기
await account.deleteAccount();
as("google-b", "friend@gmail.com");
out.afterDelete = await account.friendTimetables(A).then((r) => r.length, () => "denied");
out.handleGone = await account.request(`영표#${out.nickA.tag}`).catch((e) => e.code);
process.stdout.write(JSON.stringify(out));
process.exit(0);
