"""로그인·기기 간 동기화·친구 시간표(update110): 순수 함수(web/js/sync.js, node), Firebase 연결 모듈(web/js/account.js)의 꼴,
Firestore 규칙(firebase/firestore.rules)의 지킴, 배포 때 Firebase 설정을 채우는 길(export_web, GitHub 변수).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import export_web as ew  # noqa: E402


@pytest.fixture(scope="module")
def r():
    if shutil.which("node") is None:
        pytest.skip("node 없음")
    run = subprocess.run(["node", str(ROOT / "tests" / "sync_runner.mjs")], capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(run.stdout)


def test_nick_and_handle(r):
    assert r["nick"] == ["short", None, "banned", None, "long", "banned", "chars", None]
    assert r["handle"] == [{"nick": "영표", "tag": "0420"}, {"nick": "TT Wizard", "tag": "0042"}, None, None]
    assert r["key"] == "ttwizard#0042"


def test_account_numbers(r):
    """계정 번호(사용자 11/17 '계정마다 고유 번호 부여하고'): 숫자 여섯 자리(11/18 '0도 처음에 쓸 수 있게'), 닉네임을 바꿔도 그대로. 친구는 지금 닉네임#번호로만 찾는다
    (사용자 11/17 법무 채팅 '닉네임 + 번호로 친구추가 되게 하고, 현재 닉네임과 다르면 초대 발송이 안되는 걸로', update138). 번호만은 읽지 않는다"""
    assert r["number"] == [{"nick": "영표", "tag": "482193"}, None, None, None, None, {"nick": "영표", "tag": "012345"}, None, {"nick": "영표", "tag": "482193"}]
    assert r["numberKey"] == ["영표#482193", "tt_wizard#482193", "다른이름#482193"]
    assert r["random"] == ["000000", "999999", "500000"]
    assert r["isNumber"] == [True, True, True, True, False, False, False, True]


def test_server_copy_drops_instructor_and_home(r):
    """서버에는 교수 이름·출발 지점을 올리지 않고(설계안 5절), 받을 때 기기 값을 이어 쓴다. 메모는 내 사본에만 남는다"""
    s = r["server"]
    assert "from" not in s and all("instructor" not in it for it in s["items"]) and s["primary"] is True
    assert s["items"][0]["base"] == [{"day": 0, "start": 540, "end": 615, "building": "83", "room": "201"}]  # Firestore 는 배열 안 배열을 못 둔다
    assert r["back"]["items"][0]["base"] == [[0, 540, 615, "83", "201"]]
    assert s["items"][1]["memo"] == "회비"
    b = r["back"]
    assert b["from"] == {"home": "919", "mode": "slope"} and b["items"][0]["instructor"] == "김교수"


def test_merge(r):
    first = r["first"]
    a, b = first["local"]["2026-2"]
    assert (a["id"], b["id"], b["title"]) == ("t1", "t2", "시간표 1 (2)")  # 같은 이름이면 '(2)'
    assert "primary" not in a and b["primary"] is True  # 학기마다 대표 하나: 늦게 고친 쪽
    assert [u["id"] for u in first["upload"]] == ["t1"] and sorted(first["known"]) == ["t1", "t2"]
    assert r["deleted"]["upload"] == [{"id": "t3", "sem": "2026-2", "deleted": True, "updated": "2026-11-14T03:00:00.000Z"}]
    assert [t["id"] for t in r["gone"]["local"]["2026-2"]] == ["t1"] and r["gone"]["upload"] == []
    assert [u["id"] for u in r["revived"]["upload"]] == ["t4"] and r["revived"]["local"] == {}
    t = r["newer"]["local"]["2026-2"][0]
    assert t["title"] == "고친 이름" and t["from"]["home"] == "919" and t["items"][0]["instructor"] == "김교수" and r["newer"]["upload"] == []


def test_friend_copy(r):
    """친구에게: 대표 시간표의 강좌(정한 시간·강의실)와 직접 넣은 일정의 제목·시간만. 메모·일정 장소·보이기 끈 시간표는 안 보인다.
    숨긴 항목은 시간만(이름·과목 번호·강의실·색 없이, 친구 화면의 회색 칸. 디자인 130판, update112)"""
    assert r["items"] == [{"course": "881.007", "no": "001", "name": "881.007 과목", "color": 2,
                           "meetings": [{"day": 1, "start": 600, "end": 675, "building": "25", "room": "102"}]},
                          {"hidden": True, "meetings": [{"day": 0, "start": 540, "end": 615}]},
                          {"title": "알바", "meetings": [{"day": 4, "start": 1080, "end": 1200, "building": "", "room": ""}]}]
    assert r["copies"]["2027-1"] is None and r["copies"]["2026-W"] is None
    assert r["copies"]["2026-2"]["title"] == "대표" and "memo" not in json.dumps(r["copies"], ensure_ascii=False)
    assert r["looks"] == ["xmas", "dark", None, None, None] and "look" not in r["copies"]["2026-2"]  # 친구 사본의 테마(update141)
    # 친구 시간표 학기 차례(update142, 사용자 11/20 '이거 순서 왜 이럼'): 새 학기가 앞, 글자 차례가 아니다(2026-S 가 2026-2 앞에 오지 않는다)
    assert r["semOrder"] == [8104, 8105, 8106, 8107, 8103, -1, -1, -1]
    assert r["friendOrder"] == ["2027-1", "2026-W", "2026-2", "2026-S", "2026-1", "2025-W", "x"]
    acc = (ROOT / "web" / "js" / "account.js").read_text(encoding="utf-8")
    assert ".sort(newerSemFirst)" in acc and "String(b.sem).localeCompare(String(a.sem))" not in acc


def test_account_module_surface():
    js = (ROOT / "web" / "js" / "account.js").read_text(encoding="utf-8")
    # 앱 안 로그인(update111): 앱 플러그인이 없으면 APP_LOGIN, 폰 계정 오류는 NO_ACCOUNT 로. 이미 보낸 요청은 다시 쓰지 않는다(규칙이 막는다)
    assert 'throw err("APP_LOGIN")' in js and '"NO_ACCOUNT"' in js and "NOT_FRIEND" in js
    assert 'const mine = await F.getDoc(F.doc(db, "requests", reqId(uid, other)));' in js
    assert 'throw err("ALREADY", { uid: other })' in js and "[신고] 닉네임 " in js  # 디자인 130판(update112)
    # 번호 바꾸기 부탁 메일 본문 두 줄(법무 11/17 ③), 옛 번호·지운 계정의 번호는 지우지 않고 '안 씀'으로(법무 11/17 ⓓ)
    assert "바꾸고 싶은 번호(여섯 자리):" in js and "&body=${encodeURIComponent(TAG_MAIL_BODY)}" in js
    assert 'last.set(F.doc(db, "numbers", p.tag), { retired: true })' in js
    # 지운 계정의 열쇠(닉네임이 든 이름)는 '안 씀'으로 남기지 않고 지우고, 하루 요청 수도 지운다(법무 11/17, update138)
    assert 'last.delete(F.doc(db, "handles", key))' in js and '"handles", oldKey), { retired: true }' not in js
    assert 'last.delete(F.doc(db, "limits", uid))' in js
    # 하루 요청 수는 없앴다(update138 에 넣었다가 사용자 11/17 22:54, update139). 신고 까닭 네 가지(법무 11/17)
    assert "REQUEST_DAY_LIMIT" not in js and '"LIMIT"' not in js and 'F.doc(db, "limits"' not in js.replace('last.delete(F.doc(db, "limits", uid))', "")
    assert 'export const REPORT_REASONS = ["nick", "impersonation", "stranger", "other"];' in js and ".slice(0, 200)" in js
    for name in ("available", "ready", "onUser", "signIn", "signOut", "deleteAccount", "sync", "profile", "setNick", "friends",
                 "find", "request", "accept", "decline", "cancel", "unfriend", "block", "unblock", "friendTimetables", "publish", "inviteLink", "reportLink",
                 "tagLink", "isAdmin", "firestore", "report", "syncStatus", "onSyncStatus", "forget"):
        assert re.search(rf"export (?:async function|function|const) {name}\b", js), name
    # 관리자 일은 웹에만 있는 admin-core.js 로 옮겼다(앱 묶음에 들어가지 않게, update140). 로그아웃하면 관리자 시간을 먼저 닫는다
    for name in ("adminSetTag", "listReports", "closeReport", "adminOrphans", "adminCleanOrphans"):
        assert f"export async function {name}" not in js, name
    assert "if (!inApp() && auth.currentUser) await lockAdmin(auth.currentUser.uid, db, F)" in js
    assert re.search(r'SDK_URL = "https://www\.gstatic\.com/firebasejs/\d+\.\d+\.\d+"', js)  # 판을 고정
    assert 'import FIREBASE from "./firebase-config.js"' in js
    assert (ROOT / "web" / "js" / "firebase-config.js").read_text(encoding="utf-8").rstrip().endswith("export default null;")  # 저장소에는 값이 없다


def test_admin_core_surface():
    """관리자 화면(사용자 11/18): 비밀번호는 기기에서 PBKDF2 로 섞은 값만 서버에 두고, 잠금 풀기는 sha256(h|끝나는 때|차례) 증명. 코드에 비밀번호·섞은 값이 없다"""
    core = (ROOT / "web" / "js" / "admin-core.js").read_text(encoding="utf-8")
    ui = (ROOT / "web" / "js" / "admin.js").read_text(encoding="utf-8")
    for name in ("state", "setPassword", "unlock", "lock", "reconnect", "changePassword", "retag", "reports", "closeReport", "orphans", "cleanOrphans",
                 "admins", "addAdmin", "removeAdmin", "resetPassword"):
        assert re.search(rf"export (?:async function|function|const) {name}\b", core), name
    assert 'name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`ttw-admin:${uid}`), iterations: ROUNDS' in core and "const ROUNDS = 210000;" in core
    assert "const proof = await sha256(`${h}|${until}|${n}`);" in core
    assert "export const SESSION_MINUTES = 30;" in core and "export const MIN_PASSWORD = 10;" in core
    assert not re.search(r"[0-9a-f]{64}", core + ui)  # 섞은 값이나 비밀번호를 코드에 두지 않는다
    assert 'import("./admin-core.js")' in ui and 'id: "admin-sheet"' in ui and '"관리자 화면"' in ui
    app = (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")
    assert 'adminMod = adminMod || await import("./admin.js");' in app
    # 웹에서 관리자 문서가 있는 계정만. 카드는 로그아웃 글(#account-foot) 아래 따로 둔 자리(디자인 156판 ㉢, update142)
    assert 'const admin = !!u && !IN_APP && acctAdmin, slot = acctAdminSlot();' in app
    assert 'slot.replaceChildren(...(admin ? [card(h("button", { type: "button", class: "info-row", "data-acct": "admin"' in app
    assert '$("account-foot").after(el);' in app and 'el.addEventListener("click", onAcctClick);' in app
    css = (ROOT / "web" / "style.css").read_text(encoding="utf-8")
    assert ".acct-admin { margin-top: var(--space-5); }" in css
    # 개발자 메뉴는 열린 관리자 화면에서만 연다. 시간표에 과목 하나 + 동선 확인하기로 열던 옛 길(개발자 루트)은 없앴다(사용자 11/18)
    assert "DEV_KEY" not in app and "devKey" not in app and "806.508A" not in app and 'import("./dev.js")' not in app
    assert '$("route-run").addEventListener("click", () => routeTt(curTt()));' in app
    assert 'if (k === "dev") return await openDev(b);' in ui and 'try { dev = await import("./dev.js"); }' in ui and "if (!now.until) { await refresh();" in ui
    # 디자인 154판(update141): 화면 글 규칙('처리' 대신 '남은 신고 보기'·'끝내기', '→' 대신 '…으로 바꿨어요', 도움말 끝 마침표·'님' 빼기),
    # 칸 오류는 칸 아래 오류 줄, 진행은 버튼 안(aria-busy)
    code = "\n".join(l for l in ui.splitlines() if not l.lstrip().startswith(("//", "*", "/**")))
    assert not re.search(r"처리|→|님", code)
    for text in ('"남은 신고 보기"', '"끝내기"', '`끝냈어요 · 남은 신고 ${n.toLocaleString("ko-KR")}건`', '"남은 신고가 없어요"', '"끝내지 못했어요"',
                 '`${r.nick}#${r.tag}${ro(r.tag)} 바꿨어요`', '`관리자로 더했어요 · ${r.nick}#${r.tag}`',
                 '"옛 판 앱으로 계정을 지우면 남아요. 5일 안에 한 번씩 찾아 정리해 주세요"', '"테마·시험·이 기기 정보예요. 이 기기에서만 바뀌어요"',
                 '"더한 사람은 처음 들어올 때 자기 비밀번호를 정해요"', "잊으면 주인이 처음으로 돌려야 해요`"):
        assert text in ui, text
    assert 'h("p", { class: "error-line", id: "adm-gate-err", hidden: true })' in ui and 'b.setAttribute("aria-busy", "true")' in ui
    assert '.adm-sheet .adm-label { margin: 0; font-size: 0.9375rem; line-height: 1.375rem; font-weight: 700; color: var(--heading); }' in ui
    # 디자인 156판(update142): 빈 결과 줄은 자리를 차지하지 않고(알림은 시트의 status 영역), 신고·관리자 줄은 칸 폭 안, 텍스트 버튼 글 끝은 칸 끝
    assert ".adm-sheet .adm-msg:empty { display: none; }" in ui and "min-height: 1.25rem" not in ui and 'if (text) tell("status", text);' in ui
    assert '.adm-sheet .adm-box .sheet-list { margin: 0; }' in ui and '.adm-sheet .adm-row { padding: var(--space-2) 0; }' in ui
    assert "margin-left: auto; margin-right: calc(var(--space-3) * -1); }" in ui
    # 넓은 화면 과목 추가 둘러보기 선택칸: 전체 과목 → 남은 요건 과목 → 교양 전체 → 학과(사용자 11/20)
    assert 'all = sel.querySelector(`option[value="${ALL_COURSES}"]`);' in app and "if (all) all.after(opt); else sel.prepend(opt);" in app


def test_firestore_rules():
    rules = (ROOT / "firebase" / "firestore.rules").read_text(encoding="utf-8")
    assert "rules_version = '2';" in rules and "allow read, write: if true" not in rules
    assert re.search(r"match /users/\{uid\} \{\s*allow read, write: if isMe\(uid\);", rules)
    assert "allow read: if isMe(uid) || (signedIn() && friends(request.auth.uid, uid));" in rules  # 친구 사본은 친구만
    assert "!exists(/databases/$(database)/documents/blocks/$(request.resource.data.to)/list/$(request.auth.uid))" in rules  # 막은 사람은 요청 못 함
    assert "resource.data.to == request.auth.uid && resource.data.state == 'pending'" in rules  # 받은 사람만 수락
    # 학교 계정 표시는 본인이 보이게 둔 확인된 snu.ac.kr 메일만(update112)
    assert "request.auth.token.get('email', '').lower().matches('^[^@]+@snu[.]ac[.]kr$')" in rules and "schoolOk(d)" in rules
    assert rules.count("validProfile(request.resource.data)") == 2  # 지금 방식·옛 판 앱 둘 다
    # 계정 번호(2026-11-17): 여섯 자리, 내 번호는 내 프로필이 가리킬 때만 만들고, 한번 받은 번호는 내가 못 바꾼다
    assert "n.matches('^[0-9]{6}$')" in rules
    assert "profileAfter(request.resource.data.uid).data.tag == n" in rules
    assert "resource.data.tag == request.resource.data.tag" in rules and "isOldTag(resource.data.tag))" in rules
    assert "update" + "134" not in rules and "법무" not in rules  # 사람이 읽는 설명만(세션·판 번호 없이)
    # 번호 문서는 남이 못 읽고(번호만으로 누구인지 모르게), 지우지 못한다(거두기만). 찾기는 닉네임#번호 열쇠로만(update138)
    numbers = rules[rules.index("match /numbers/{n}"):rules.index("// ===== 찾는 열쇠")]
    assert "allow get: if signedIn() && (resource == null || resource.data.get('uid', '') == request.auth.uid || isAdmin());" in numbers
    assert "allow delete" not in numbers
    assert "return nick.lower().replace(' ', '') + '#' + tag;" in rules
    assert "request.resource.data.get('handle', '') == keyOf(request.resource.data.nick, request.resource.data.tag)" in rules
    # 하루 요청 수는 없앴다(update139): 요청은 limits 없이, 그때 남은 문서는 본인이 지우기만
    assert "countsOne" not in rules and "sent <= 20" not in rules
    assert "match /limits/{uid} {\n      allow delete: if isMe(uid);\n    }" in rules
    # 지운 계정이 남긴 번호·열쇠를 찾는 목록은 관리자만(법무 11/17)
    assert rules.count("allow list: if isAdmin();") == 2
    # 관리자 화면(update140): 관리자 문서가 있고 비밀번호로 연 시간 안에만. 비밀번호를 섞은 값은 아무도 못 읽고, 증명은 규칙이 같은 셈으로 본다
    assert "get(/databases/$(database)/documents/adminSessions/$(request.auth.uid)).data.until > request.time;" in rules
    assert "get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.get('role', 'owner') == 'owner';" in rules
    keys = rules[rules.index("match /adminKeys/{uid}"):rules.index("function unlocks()")]
    assert "allow get: if isMe(uid) && resource == null;" in keys and "allow read" not in keys and "allow list" not in keys
    assert "d.proof == hashing.sha256(get(key).data.h + '|' + string(d.until.toMillis()) + '|' + string(d.n)).toHexString().lower();" in rules
    assert "d.until <= request.time + duration.value(60, 'm')" in rules
    assert "request.resource.data.n == (resource == null ? 1 : resource.data.n + 1)" in rules
    admins = rules[rules.index("match /admins/{uid}"):rules.index("function keyShape()")]
    assert "request.resource.data.role == 'admin'" in admins and "allow update" not in admins and "allow delete: if isOwner() && uid != request.auth.uid;" in admins
    # 신고: 본인 이름으로 만들기만, 읽기·처리 표시·지우기는 관리자만
    reports = rules[rules.index("match /reports/{id}"):]
    assert "allow read: if isAdmin();" in reports and "allow delete: if isAdmin();" in reports
    assert "request.resource.data.reason in ['nick', 'impersonation', 'stranger', 'other']" in reports and "note.size() <= 200" in reports
    assert "allow get: if signedIn() && (id.split('_')[0] == request.auth.uid || id.split('_')[1] == request.auth.uid);" in rules
    assert json.loads((ROOT / "firebase" / "firebase.json").read_text(encoding="utf-8"))["firestore"]["rules"] == "firestore.rules"


def test_firebase_config_from_variable(tmp_path):
    f = tmp_path / "c.js"
    snippet = 'const firebaseConfig = {\n  apiKey: "AIzaTEST",\n  authDomain: "tt-wizard.firebaseapp.com",\n  projectId: "tt-wizard",\n  appId: "1:2:web:3",\n};'
    assert ew.write_firebase_config(snippet, f)
    text = f.read_text(encoding="utf-8")
    assert json.loads(text.split("export default ", 1)[1].rstrip().rstrip(";")) == {
        "apiKey": "AIzaTEST", "authDomain": "tt-wizard.firebaseapp.com", "projectId": "tt-wizard", "appId": "1:2:web:3"}
    assert ew.write_firebase_config('{"apiKey":"x","projectId":"p","googleClientId":"g","other":1}', f)
    assert '"googleClientId": "g"' in f.read_text(encoding="utf-8") and "other" not in f.read_text(encoding="utf-8")
    assert not ew.write_firebase_config("", f) and not ew.write_firebase_config("nope", f) and not ew.write_firebase_config('{"apiKey":"x"}', f)
    # 콘솔 코드 조각 전체(import·주석·initializeApp 줄, https:// 값)를 붙여도 설정 객체만 읽는다(update111)
    whole = ('// Import the functions you need from the SDKs you need\nimport { initializeApp } from "firebase/app";\n'
             'const firebaseConfig = {\n  apiKey: "AIzaTEST",\n  databaseURL: "https://x.firebaseio.com",\n  projectId: "tt-wizard",\n'
             '  googleClientId: "621792010542-abc.apps.googleusercontent.com"\n};\nconst app = initializeApp(firebaseConfig);')
    assert ew.write_firebase_config(whole, f)
    got = json.loads(f.read_text(encoding="utf-8").split("export default ", 1)[1].rstrip().rstrip(";"))
    assert got == {"apiKey": "AIzaTEST", "projectId": "tt-wizard", "googleClientId": "621792010542-abc.apps.googleusercontent.com"}
    # googleClientId 를 중괄호 밖에 둔 것도 꼴로 찾는다. 다른 값(보안 비밀번호 같은 것)은 버린다
    outside = 'const firebaseConfig = {\n  apiKey: "AIzaTEST",\n  projectId: "tt-wizard",\n};\ngoogleClientId: "621792010542-abc.apps.googleusercontent.com"\nGOCSPX-secret'
    assert ew.write_firebase_config(outside, f)
    text = f.read_text(encoding="utf-8")
    assert '"googleClientId": "621792010542-abc.apps.googleusercontent.com"' in text and "GOCSPX" not in text
    for wf in ("pages.yml", "app.yml", "release.yml"):
        text = (ROOT / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert "FIREBASE_WEB_CONFIG: ${{ vars.FIREBASE_WEB_CONFIG }}" in text, wf
        assert "FIREBASE_WEB_CONFIG_SECRET: ${{ secrets.FIREBASE_WEB_CONFIG }}" in text, wf  # 비밀값 탭에 넣었어도(update113)
    # 중괄호 없이 '열쇠: 값' 줄만 붙여도, 작은따옴표여도 읽는다(update113)
    bare = 'apiKey: "AIzaTEST",\n  projectId: \'tt-wizard\',\n  googleClientId: "621792010542-abc.apps.googleusercontent.com"'
    assert ew.write_firebase_config(bare, f)
    got = json.loads(f.read_text(encoding="utf-8").split("export default ", 1)[1].rstrip().rstrip(";"))
    assert got == {"apiKey": "AIzaTEST", "projectId": "tt-wizard", "googleClientId": "621792010542-abc.apps.googleusercontent.com"}
    # 줄 사이 쉼표가 빠졌거나 둥근 따옴표여도 아는 열쇠의 값만 하나씩 읽는다(update114, 사용자 변수 390자를 못 읽던 것)
    no_comma = 'const firebaseConfig = {\n  apiKey: "AIzaTEST",\n  projectId: "tt-wizard",\n  appId: "1:6:web:a"\n  googleClientId: "621792010542-abc.apps.googleusercontent.com"\n};'
    curly = 'const firebaseConfig = {\n  apiKey: \u201cAIzaTEST\u201d,\n  projectId: \u201ctt-wizard\u201d\n};'
    for raw in (no_comma, curly):
        assert ew.write_firebase_config(raw, f), raw
        got = json.loads(f.read_text(encoding="utf-8").split("export default ", 1)[1].rstrip().rstrip(";"))
        assert got["apiKey"] == "AIzaTEST" and got["projectId"] == "tt-wizard"
    assert got == {"apiKey": "AIzaTEST", "projectId": "tt-wizard"}
    assert ew.write_firebase_config(no_comma, f) and '"googleClientId": "621792010542-abc.apps.googleusercontent.com"' in f.read_text(encoding="utf-8")
    # 못 읽은 까닭은 값 없이(글자 수·찾은 열쇠 이름만)
    assert "비었다" in ew.config_problem("") and "Variables" in ew.config_problem(None)
    why = ew.config_problem('{"apiKey": "AIzaSECRETVALUE"}')
    assert "AIzaSECRETVALUE" not in why and "apiKey" in why and "읽지 못함" in why


def test_app_google_sign_in_wiring():
    """앱 안 구글 로그인(update111): 웹뷰는 구글 창을 못 띄워 앱 플러그인 TTWAuth 가 폰의 계정 고르기(Credential Manager)로 id 토큰을 받는다.
    권한은 더하지 않고, 화면은 native.js 의 TTW_APP.googleSignIn 을 account.js 가 부른다"""
    java = ROOT / "app" / "android" / "app" / "src" / "main" / "java" / "com" / "ttwizard" / "app"
    plugin = (java / "AuthPlugin.java").read_text(encoding="utf-8")
    assert '@CapacitorPlugin(name = "TTWAuth")' in plugin and "permissions" not in plugin.split("@CapacitorPlugin")[1].split(")")[0]
    for m in ("signIn", "signOut"):
        assert f"public void {m}(PluginCall call)" in plugin
    assert "new GetSignInWithGoogleOption.Builder(clientId)" in plugin and "TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL" in plugin
    assert "GetCredentialCancellationException" in plugin and '"NO_ACCOUNT"' in plugin and '"NO_CONFIG"' in plugin
    activity = (java / "AppActivity.java").read_text(encoding="utf-8")
    assert activity.index("registerPlugin(AuthPlugin.class)") < activity.index("super.onCreate(savedInstanceState)")
    gradle = (ROOT / "app" / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
    for dep in ('"androidx.credentials:credentials:$androidxCredentialsVersion"', '"androidx.credentials:credentials-play-services-auth:$androidxCredentialsVersion"',
                '"com.google.android.libraries.identity.googleid:googleid:$googleIdVersion"'):
        assert f"implementation {dep}" in gradle
    native = (ROOT / "app" / "src" / "native.js").read_text(encoding="utf-8")
    assert "app.googleSignIn = function" in native and "app.googleSignOut = function" in native and 'pluginCall("TTWAuth", "signIn"' in native
    js = (ROOT / "web" / "js" / "account.js").read_text(encoding="utf-8")
    assert "app.googleSignIn({ clientId })" in js and "A.GoogleAuthProvider.credential(r.idToken)" in js


def test_sdk_only_after_sign_in():
    """Firebase SDK(gstatic)는 이 기기에서 로그인한 적이 있을 때만 받는다(update115, 법무 11/15): 표시가 없으면 ready·onUser 는 '로그인 안 함',
    sync 는 SIGNED_OUT, 로그아웃은 SDK 없이. 표시 전 판에서 로그인한 기기(Firebase 저장소에 로그인 사용자가 있음)는 이어 가고,
    저장소만 있고 사용자가 없으면(Firebase 를 켜기만 했거나 로그아웃한 기기) 받지 않는다(update116)"""
    if shutil.which("node") is None:
        pytest.skip("node 없음")
    run = subprocess.run(["node", str(ROOT / "tests" / "lazy_runner.mjs")], capture_output=True, text=True, encoding="utf-8", check=True)
    r = json.loads(run.stdout)
    assert r["available"] is True and r["ready"] is None and r["onUser"] == [None] and r["sync"] == "SIGNED_OUT"
    assert r["signOut"] == "ok" and r["markAfterSignOut"] is None
    assert r["readyEmpty"] is None and r["markEmpty"] is None
    assert r["readyOld"] == "OFFLINE" and r["markOld"] == "1"  # 받으려 했다(시험에는 네트워크가 없다)
