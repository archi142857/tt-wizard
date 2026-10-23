"""저장한 시간표(web/js/timetables.js)와 동선 확인(engine.checkRoute). node 가 없으면 건너뛴다.

이름·대표('시간표 n'), 항목 넣기(겹침을 묻고 덮어쓰기·뺀 항목, 같은 과목은 바꿔 넣기, 색 여덟 가지), 탐색 결과 저장(같은 비용·경로, '저장됨'),
편람과 맞추기(바뀜·사라짐(과목째/분반만)·사용자가 정한 수업·항목 하나만 본 것으로), 기기에 두기(어긋난 것 버리기, 새 판 지키기)를
tests/timetables_runner.mjs 로 돌려 본다.
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
    assert t["names"] == ["내 시간표", "내 시간표 (2)", "내 시간표 (3)", "내 시간표 (4)"]  # 겹치면 (2)부터 번호, 복사본은 늘 번호(디자인 규칙)
    assert t["primary"] == [True, False, False, False]  # 학기의 첫 시간표가 대표, 복사본은 대표를 옮기지 않는다
    assert t["problems"] == ["empty", "duplicate", None, None]  # '내 시간표 (2)' 는 있고, 그 시간표 자신의 이름은 겹침이 아니다
    assert t["rename"] == "duplicate" and t["renamed"] == "가을 계획"
    assert t["long"] == [30, True]  # 번호를 붙여도 30자 안
    assert t["full"] and t["primaryAfterDelete"] == 1 and t["setPrimary"] == [False, False, False, True]
    assert t["plain"] == ["시간표 1", "시간표 3"]  # 이름을 안 주면(빈칸뿐이어도) '시간표 n'
    assert t["nextTitle"] == ["시간표 1", "시간표 2", "시간표 1", "시간표 2"]  # 비는 가장 작은 번호
    assert t["plainCopy"] == "시간표 1 (2)"  # 복사본은 '이름 (2)'부터


def test_add_items(out):
    i = out["items"]
    assert i["askOverlap"] == ["A-001"] and i["askUnchanged"] and i["askRemoved"] == []  # 겹치면 넣지 않고 무엇과 겹치는지 알린다
    assert i["forced"] == ["C-001", "B-001"] and i["forcedColor"] == 0  # 덮어쓰면 겹친 것을 빼고, 빈 가장 작은 색
    assert i["forcedOverlaps"] == [] and i["forcedRemoved"] == ["A-001"]  # 뺀 항목이 같이 온다(되돌리기)
    assert i["forcedUndo"] == ["A-001", "C-001"]  # 받은 시간표는 그대로라 되돌리기는 그것을 다시 쓰면 된다
    assert i["swapped"] == ["C-001", "A-002"] and i["swappedColor"] == 0  # 같은 과목 다른 분반은 바꿔 넣고 색은 그대로
    assert i["swappedRemoved"] == ["A-001"]
    assert i["colors"] == [0, 1, 2] and i["clashCustom"] == ["C-001"]  # 직접 넣은 일정도 겹침을 본다
    assert i["customTitle"] == "동아리" and i["customMeetings"] == [[5, 600, 720, "", ""]]  # 요일이 어긋난 수업은 버린다
    assert i["credits"] == 4 and i["removed"] == ["A-001", "C-001"]
    assert i["updated"]["title"] == "동아리 방" and i["updated"]["memo"] == "메모" and i["cleared"] is False
    assert i["updatedAt"] == "2026-10-22T10:00:00.000Z"
    assert i["colorsMany"] == [0, 1, 2, 3, 4, 5, 6, 7, 0, 1]  # 여덟 가지를 다 쓰면 가장 적게 쓰인 색
    assert i["colorsGap"] == 3  # 빈 색(지운 항목의 색)이 생기면 그 색


def test_saved_search_result_matches_search(out):
    f = out["fromSearch"]
    assert f["keys"] == f["rankedKeys"] and f["source"] == "search" and f["from"] == {"home": "919", "mode": "slope"}
    assert f["cost"][0] == f["cost"][1] and f["legs"]  # 저장한 뒤 동선 확인하기 = 탐색 결과 그대로
    assert f["overlaps"] == [] and f["saved"] is True and f["other"] is None
    assert f["colors"] == list(range(len(f["keys"])))
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
    assert r["ack"] == [["same", [b + 30 for b in base]]] == r["ackOpts"] and r["ackSame"]
    key = r["movedOverlap"][0]
    assert len(key) == 1 and r["movedOverlap"] == [key, [], key]  # 겹침은 지금 편람 기준으로 본다(byId 를 줄 때)


def test_acknowledge_one_item_and_missing(out):
    r = out["reconcile2"]
    # 항목 시트를 닫을 때: 그 항목만 본 것으로, 나머지는 '편람 바뀜' 그대로
    assert [k for k, *_ in r["one"]][:2] == ["A-001", "B-001"]
    assert [s for _, s, _ in r["one"]] == ["same", "changed", "custom"] and r["oneSameObj"]
    assert [m for *_, m in r["none"]] == [None, None, None]
    assert [(s, m) for _, s, m in r["noCourse"]][:2] == [("same", None), ("gone", "course")]  # '없는 과목'
    assert [(s, m) for _, s, m in r["noSection"]][:2] == [("gone", "section"), ("same", None)]  # '없는 분반'


def test_storage(out):
    s = out["storage"]
    assert s["same"] and s["newerKept"] and s["notArray"] == []
    assert s["ids"][1:] == ["tz", "ok", "dup"]  # 모양이 어긋난 시간표는 버린다
    ok = s["ok"]
    assert ok["title"] == "시간표" and [it.get("custom") for it in ok["items"]] == ["c1", None]
    assert ok["items"][0]["color"] == 1 and "color" not in ok["items"][1]  # 색은 0~7 로(9 → 1), 음수는 버린다
    assert ok["items"][0]["meetings"] == [[1, 600, 700, "301", ""]] and ok["items"][1]["base"] == []
    assert len(s["primaries"]) == 1  # 대표는 하나만
    assert all(s["has"])  # 이 판이 읽는 시간표가 있나(첫 탭) = parseList 가 _newer 가 아닌 것을 하나라도 살리나
    assert s["colorMode"] == ["cls", "item", "item", "item", "item", "item"]  # 칸 색은 처음 '항목마다'
    assert s["keys"] == {"list": "timetables", "current": "timetable", "color": "timetableColor", "open": "openSem"}


def test_image_file_carries_timetable(out):
    """시간표 이미지(PNG) 파일 안의 iTXt 조각에 시간표 자료를 넣고 다시 읽는다(사용자 10/23: 그림이 아니라 파일 자체에. OCR 아님)."""
    i = out["image"]
    assert i["types"] == ["IHDR", "tEXt", "iTXt", "IDAT", "iTXt", "IEND"] and i["crcBad"] == []  # 우리 조각은 IEND 바로 앞, CRC 도 맞다
    assert i["foreignKept"] and i["sameAsBefore"]  # 다른 조각과 그림은 그대로
    assert i["payloadKeys"] == ["app", "v", "sem", "title", "items"] and i["memoGone"] and i["items"]  # 메모는 넣지 않는다
    b = i["back"]
    assert b == {"sem": "2026-2", "title": "내 시간표 ✓", "primary": True, "source": "manual", "items": True, "newCustomId": True}
    assert i["againOne"] == 2 and i["againTitle"] == "다시"  # 다시 넣으면 우리 조각을 바꾼다(남의 iTXt 하나 + 우리 것 하나)
    assert i["problems"] == ["no-data", "jpeg", "not-png", "broken", "broken", "newer", "not-png"]
    assert i["notPng"] and i["full"] and i["dup"] == "내 시간표 ✓ (2)"
    e = i["evil"]  # 어긋난 자료는 기기에서 읽을 때와 같은 규칙으로 다듬는다
    assert e["title"] == "가" * 26 + " (2)" and [it.get("title") for it in e["items"]] == ["일정"]
    assert e["items"][0]["meetings"] == [[2, 600, 660, "71", ""]] and e["items"][0]["color"] == 4


def test_image_file_opens_in_other_programs(out):
    """우리가 고친 PNG 를 다른 프로그램(Pillow)도 그대로 연다: 그림은 1×1 그대로, iTXt 열쇠 TTWizard 의 글이 JSON 이다."""
    PIL = pytest.importorskip("PIL.Image")
    import base64
    import io
    im = PIL.open(io.BytesIO(base64.b64decode(out["image"]["pngBase64"])))
    im.load()
    assert im.size == (1, 1) and im.mode == "RGBA"
    payload = json.loads(im.text["TTWizard"])
    assert payload["app"] == "ttwizard" and payload["v"] == 1 and payload["title"] == "내 시간표 ✓"
    assert im.text["Comment"] == "다른 프로그램이 넣은 글" and im.text["Software"] == "paint"

