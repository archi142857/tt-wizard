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
    """친구에게: 대표 시간표의 강좌(정한 시간·강의실)와 직접 넣은 일정의 제목·시간만. 숨긴 항목·메모·일정 장소·보이기 끈 시간표는 안 보인다"""
    assert r["items"] == [{"course": "881.007", "no": "001", "name": "881.007 과목", "color": 2,
                           "meetings": [{"day": 1, "start": 600, "end": 675, "building": "25", "room": "102"}]},
                          {"title": "알바", "meetings": [{"day": 4, "start": 1080, "end": 1200, "building": "", "room": ""}]}]
    assert r["copies"]["2027-1"] is None and r["copies"]["2026-W"] is None
    assert r["copies"]["2026-2"]["title"] == "대표" and "memo" not in json.dumps(r["copies"], ensure_ascii=False)


def test_account_module_surface():
    js = (ROOT / "web" / "js" / "account.js").read_text(encoding="utf-8")
    for name in ("available", "ready", "onUser", "signIn", "signOut", "deleteAccount", "sync", "profile", "setNick", "friends",
                 "request", "accept", "decline", "cancel", "unfriend", "block", "unblock", "friendTimetables", "publish", "inviteLink", "reportLink"):
        assert re.search(rf"export (?:async function|function|const) {name}\b", js), name
    assert re.search(r'SDK_URL = "https://www\.gstatic\.com/firebasejs/\d+\.\d+\.\d+"', js)  # 판을 고정
    assert 'import FIREBASE from "./firebase-config.js"' in js
    assert (ROOT / "web" / "js" / "firebase-config.js").read_text(encoding="utf-8").rstrip().endswith("export default null;")  # 저장소에는 값이 없다


def test_firestore_rules():
    rules = (ROOT / "firebase" / "firestore.rules").read_text(encoding="utf-8")
    assert "rules_version = '2';" in rules and "allow read, write: if true" not in rules
    assert re.search(r"match /users/\{uid\} \{\s*allow read, write: if isMe\(uid\);", rules)
    assert "allow read: if isMe(uid) || (signedIn() && friends(request.auth.uid, uid));" in rules  # 친구 사본은 친구만
    assert "!exists(/databases/$(database)/documents/blocks/$(request.resource.data.to)/list/$(request.auth.uid))" in rules  # 막은 사람은 요청 못 함
    assert "resource.data.to == request.auth.uid && resource.data.state == 'pending'" in rules  # 받은 사람만 수락
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
    for wf in ("pages.yml", "app.yml", "release.yml"):
        assert "FIREBASE_WEB_CONFIG: ${{ vars.FIREBASE_WEB_CONFIG }}" in (ROOT / ".github" / "workflows" / wf).read_text(encoding="utf-8"), wf
