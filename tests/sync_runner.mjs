// tests/test_account.py 가 부른다: web/js/sync.js(로그인·동기화·친구의 순수 함수, update110)를 정한 경우마다 돌려 JSON 으로 찍는다.
import { nickProblem, parseHandle, handleKey, toServer, fromServer, mergeTimetables, friendItems, friendCopies } from "../web/js/sync.js";

const item = (course, no, extra = {}) => ({ course, no, name: course + " 과목", instructor: "김교수", credit: 3, cls: "전필", base: [[0, 540, 615, "83", "201"]], ...extra });
const tt = (id, sem, title, updated, extra = {}) => ({ v: 1, id, sem, title, created: "2026-11-01T00:00:00.000Z", updated, source: "manual", items: [], ...extra });

const out = {};
out.nick = ["가", "영표", "TT Wizard", "a_b", "한글영문12자까지인닉네임이", "관리자님", "hi!", " 공백 "].map((n) => nickProblem(n));
out.handle = [parseHandle("영표#0420"), parseHandle(" TT Wizard # 0042 "), parseHandle("영표#42"), parseHandle("#0420")];
out.key = handleKey("TT Wizard", "0042");

const mine = tt("t1", "2026-2", "시간표 1", "2026-11-10T00:00:00.000Z", { primary: true, from: { home: "919", mode: "slope" },
  items: [item("881.007", "001"), { custom: "c1", title: "동아리", meetings: [[2, 1080, 1200, "63", ""]], memo: "회비", color: 3 }] });
out.server = toServer(mine);
out.back = fromServer({ ...out.server, items: out.server.items }, mine);

// 처음 로그인: 다른 기기에서 만든 같은 이름 시간표(대표, 더 늦게 고침)가 온다
const other = toServer(tt("t2", "2026-2", "시간표 1", "2026-11-12T00:00:00.000Z", { primary: true, items: [item("034.001", "002")] }));
out.first = mergeTimetables({ "2026-2": [mine] }, [other], []);
// 이 기기에서 t3 을 지웠다(지난번 서버에 있었음) → 지움 표시를 올린다
out.deleted = mergeTimetables({ "2026-2": [mine] }, [toServer(mine), toServer(tt("t3", "2026-2", "옛 것", "2026-11-01T00:00:00.000Z"))], ["t1", "t3"],
  "2026-11-14T03:00:00.000Z");
// 다른 기기에서 지운 것: 이 기기 것이 더 옛것이면 지우고, 그 뒤에 고쳤으면 살린다
const old = tt("t4", "2026-2", "지운 것", "2026-11-01T00:00:00.000Z");
const tomb = { id: "t4", sem: "2026-2", deleted: true, updated: "2026-11-05T00:00:00.000Z" };
out.gone = mergeTimetables({ "2026-2": [mine, old] }, [toServer(mine), tomb], ["t1", "t4"]);
out.revived = mergeTimetables({ "2026-2": [mine, { ...old, updated: "2026-11-06T00:00:00.000Z" }] }, [toServer(mine), tomb], ["t1", "t4"]);
// 서버가 새것: 바꿔 쓰되 이 기기의 출발 지점과 교수 이름은 남긴다
out.newer = mergeTimetables({ "2026-2": [mine] }, [{ ...toServer(mine), title: "고친 이름", updated: "2026-11-13T00:00:00.000Z" }], ["t1"]);
// 친구 사본
const shown = tt("t5", "2026-2", "대표", "2026-11-10T00:00:00.000Z", { primary: true, items: [item("881.007", "001", { own: [[1, 600, 675, "25", "102"]], color: 2 }),
  item("034.001", "002", { hidden: true }), { custom: "c2", title: "알바", meetings: [[4, 1080, 1200, "63", "1층"]], memo: "사장님 번호" }] });
out.items = friendItems(shown);
out.copies = friendCopies({ "2026-2": [shown], "2027-1": [tt("t6", "2027-1", "끔", "2026-11-10T00:00:00.000Z", { primary: true, shareOff: true })], "2026-W": [] });
process.stdout.write(JSON.stringify(out));
