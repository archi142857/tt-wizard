"""저장한 시간표(web/js/timetables.js)와 동선 확인(engine.checkRoute). node 가 없으면 건너뛴다.

이름·대표, 항목 넣기(겹침을 묻고 덮어쓰기, 같은 과목은 바꿔 넣기, 색), 탐색 결과 저장(같은 비용·경로, '저장됨'),
편람과 맞추기(바뀜·사라짐·사용자가 정한 수업), 기기에 두기(어긋난 것 버리기, 새 판 지키기)를 tests/timetables_runner.mjs 로 돌려 본다.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import export_web as ew  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")


@pytest.fixture(scope="module")
def out(tmp_path_factory):
    web = tmp_path_factory.mktemp("tt") / "web"
    assert ew.main(["--data", str(ROOT / "data" / "sample"), "-o", str(web)]) == 0
    run = subprocess.run(["node", str(ROOT / "tests" / "timetables_runner.mjs"), str(web / "courses.json"), str(web / "campus.json")],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(run.stdout)


def test_titles_and_primary(out):
    t = out["titles"]
    assert t["names"] == ["내 시간표", "내 시간표 (1)", "내 시간표 (2)", "내 시간표 (3)"]  # 겹치면 번호, 복사본은 늘 번호
    assert t["primary"] == [True, False, False, False]  # 학기의 첫 시간표가 대표, 복사본은 대표를 옮기지 않는다
    assert t["problems"] == ["empty", "duplicate", "duplicate", None]
    assert t["rename"] == "duplicate" and t["renamed"] == "가을 계획"
    assert t["long"] == [30, True]  # 번호를 붙여도 30자 안
    assert t["full"] and t["primaryAfterDelete"] == 1 and t["setPrimary"] == [False, False, False, True]


def test_add_items(out):
    i = out["items"]
    assert i["askOverlap"] == ["A-001"] and i["askUnchanged"]  # 겹치면 넣지 않고 무엇과 겹치는지 알린다
    assert i["forced"] == ["C-001", "B-001"] and i["forcedColor"] == 0  # 덮어쓰면 겹친 것을 빼고, 빈 가장 작은 색
    assert i["swapped"] == ["C-001", "A-002"] and i["swappedColor"] == 0  # 같은 과목 다른 분반은 바꿔 넣고 색은 그대로
    assert i["colors"] == [0, 1, 2] and i["clashCustom"] == ["C-001"]  # 직접 넣은 일정도 겹침을 본다
    assert i["customTitle"] == "동아리" and i["customMeetings"] == [[5, 600, 720, "", ""]]  # 요일이 어긋난 수업은 버린다
    assert i["credits"] == 4 and i["removed"] == ["A-001", "C-001"]
    assert i["updated"]["title"] == "동아리 방" and i["updated"]["memo"] == "메모" and i["cleared"] is False
    assert i["updatedAt"] == "2026-10-22T10:00:00.000Z"


def test_saved_search_result_matches_search(out):
    f = out["fromSearch"]
    assert f["keys"] == f["rankedKeys"] and f["source"] == "search" and f["from"] == {"home": "919", "mode": "slope"}
    assert f["cost"][0] == f["cost"][1] and f["legs"]  # 저장한 뒤 동선 확인하기 = 탐색 결과 그대로
    assert f["overlaps"] == [] and f["saved"] is True and f["other"] is None
    assert f["own"] == [[1, 660, 735, "301", ""], [3, 660, 735, "301", ""]]  # 사용자가 정한 강의실은 own 으로
    assert f["alts"] == ["M1101.000100-999"] and f["ownUsed"] == ["301", "301"]
    assert out["overlapPairs"] == [[0, 1]]


def test_reconcile_with_coursebook(out):
    r = out["reconcile"]
    base = r["base"]
    assert r["same"] == [["same", base]]
    assert r["changed"] == [["changed", [b + 30 for b in base]]]  # 편람을 따르고 '편람 바뀜'
    assert r["own"] == [["changed", [b + 60 for b in base]]]  # 사용자가 정한 수업은 그대로, 바뀐 것만 알린다
    assert r["gone"] == [["gone", base]]  # 편람에서 사라지면 적어 둔 값
    assert r["ack"] == [["same", [b + 30 for b in base]]] and r["ackSame"]
    key = r["movedOverlap"][0]
    assert len(key) == 1 and r["movedOverlap"] == [key, [], key]  # 겹침은 지금 편람 기준으로 본다(byId 를 줄 때)


def test_storage(out):
    s = out["storage"]
    assert s["same"] and s["newerKept"] and s["notArray"] == []
    assert s["ids"][1:] == ["tz", "ok", "dup"]  # 모양이 어긋난 시간표는 버린다
    ok = s["ok"]
    assert ok["title"] == "시간표" and [it.get("custom") for it in ok["items"]] == ["c1", None]
    assert ok["items"][0]["meetings"] == [[1, 600, 700, "301", ""]] and ok["items"][1]["base"] == []
    assert len(s["primaries"]) == 1  # 대표는 하나만
