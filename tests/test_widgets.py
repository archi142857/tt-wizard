"""홈 화면 위젯(안드로이드, 10/30): 화면이 만드는 위젯 자료(web/js/timetables.js 의 widgetData), 앱이 그 자료를 읽고 시각마다 무엇을 보일지
(app/android/.../WidgetData.java), 위젯 자원(레이아웃·색·문구·매니페스트)이 서로 맞는지.

- 자료: node 로 tests/widgets_runner.mjs (node 가 없으면 건너뛴다). 걷는 시간·늦음이 동선 확인(engine.checkRoute)과 같은지도 본다.
- 앱 쪽 셈: javac·java 로 WidgetData 와 tests/widget_java(작은 org.json, WidgetCheck)를 돌린다(JDK 가 없으면 건너뛴다).
  같은 자료를 화면이 쓰고 앱이 읽으니 둘의 꼴이 맞는지도 여기서 본다.
- 자원: 파일만 읽는다(늘 돈다).
"""

import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_app  # noqa: E402
import export_web as ew  # noqa: E402
import widget_themes as wt  # noqa: E402

ANDROID = ROOT / "app" / "android" / "app" / "src" / "main"
JAVA = ANDROID / "java" / "com" / "ttwizard" / "app"
RES = ANDROID / "res"


@pytest.fixture(scope="module")
def made(tmp_path_factory):
    """sample 자료로 campus.json 을 만들고 node 로 위젯 자료를 만든다: (결과, 자료 파일)"""
    if shutil.which("node") is None:
        pytest.skip("node 없음")
    tmp = tmp_path_factory.mktemp("widgets")
    web = tmp / "web"
    assert ew.main(["--data", str(ROOT / "data" / "sample"), "-o", str(web)]) == 0
    data = tmp / "widgets.json"
    run = subprocess.run(["node", str(ROOT / "tests" / "widgets_runner.mjs"), str(web / "campus.json"), str(data)],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(run.stdout), data


def test_terms_and_semesters(made):
    t = made[0]["terms"]
    assert t["dates"][:5] == [{"from": "2026-03-01", "to": "2026-06-21"}, {"from": "2026-06-22", "to": "2026-08-31"},
                              {"from": "2026-09-01", "to": "2026-12-21"}, {"from": "2026-12-22", "to": "2027-02-28"},
                              {"from": "2027-12-22", "to": "2028-02-29"}]  # 겨울학기는 다음 해 2월 끝날(윤년이면 29일)
    assert t["dates"][5:] == [None, None]
    assert t["labels"] == ["2026년 1학기", "2026년 여름학기", "2026년 2학기", "2026년 겨울학기", ""]
    # 끝나지 않은 학기를 시작 차례로 셋까지(같은 학기는 한 번)
    assert t["pick"] == ["2026-2", "2026-W", "2027-1"]
    assert t["pickWinter"] == ["2026-W", "2027-1"] and t["pickLastDay"] == ["2026-2", "2026-W"]


def test_widget_data_shape(made):
    d = made[0]["data"]
    assert d["keys"] == ["v", "colors", "home", "scheme", "themeOff", "terms"] and d["v"] == 1 and d["colors"] == "item"
    assert d["same"]  # 같은 시간표면 같은 글(만든 시각을 넣지 않아 앱 연결·앱이 같은 자료를 거른다)
    assert d["terms"] == [["2026-2", "2026년 2학기", "시간표 1", "2026-09-01", "2026-12-21", 1, [2, 0, 2, 0, 1, 0, 0]],
                          ["2027-1", "2027년 1학기", "봄", "2027-03-01", "2027-06-21", 0, [0, 1, 0, 0, 0, 0, 0]]]
    # 그날 첫 위치 확정 수업은 출발 지점에서(나설 시각을 셀 수 있다), 다음은 앞 수업에서. 쉬는 15분에 20분을 걸으면 5분 늦음
    assert d["monday"] == [["생명과학 1", "A동 104호", 570, 645, 1, "etc", 12, "home", 0],
                           ["대학 글쓰기 1", "B동 303호", 660, 735, 2, "etc", 20, "class", 5]]
    assert d["friday"] == [[1, 12, "home"]]  # 색 번호는 0~7
    assert d["home"] == "HOME" and d["buildings"] == ["A", "B"]  # 동선 지도 위젯이 길을 그릴 건물 id 와 출발·도착 지점
    assert d["back"] == [None, 30]  # 그날 마지막 위치 확정 수업에만 돌아가는 분(B → HOME)
    assert d["noMinutes"] == [[None, 0], [None, 0]]  # 이동시간을 모르면 걷기를 적지 않는다
    assert d["cls"] == "cls" and d["odd"] == {"v": 1, "colors": "item", "home": "", "scheme": "system", "themeOff": "", "terms": []}  # 모르는 학기·빈 칸은 뺀다
    assert d["names"] == [["[생명과학 1]", "A-104"], ["[대학 글쓰기 1]", "B-303"]]  # 이름·강의실 표기는 화면이 준다
    # 수업을 누르면 앱이 여는 항목 시트(update77): 학기마다 대표 시간표 id, 수업마다 그 항목의 열쇠(T.itemKey)
    assert d["ids"] == [True, True] and d["keysMatch"] == [["생명과학 1"], ["대학 글쓰기 1"]] and all(d["itemKeys"])
    # 앱 테마(update78): 고른 라이트·다크(그 밖은 기본 = 기기 설정)와 그 해에 끈 이벤트 테마('<테마>-<해>'·'<테마>-test', 그 밖은 "")
    assert d["theme"] == ["system", ""]
    assert d["themes"] == [["light", "xmas-2026"], ["dark", "xmas-test"], ["system", ""], ["system", ""], ["system", ""], ["system", ""], ["dark", ""]]


def test_walking_matches_route_check(made):
    """위젯의 걷는 분·늦음 = 동선 확인(engine.checkRoute)의 경로(반올림). 강의실 미정 수업은 자리를 옮기지 않고 쉬는 시간을 보탠다"""
    e = made[0]["engine"]
    assert e["buildings"] and e["same"], (e["fromEngine"], e["fromWidget"])
    assert any(row[3] > 0 for row in e["fromWidget"]) and any(row[2] is None for row in e["fromWidget"])  # 늦는 수업·미정 수업이 다 들어 있다
    assert e["back"][0] == e["back"][1] and len(e["back"][0]) == 2  # 돌아가는 길도 동선 확인과 같다(동선 지도 위젯의 걷기 합)


def test_widget_data_from_device_store(made):
    """앱 연결이 기기에 둔 값만으로 만드는 자료(widgetDataFromStore) = 같은 대표 시간표로 widgetData 를 부른 것.
    대표가 아닌 시간표·끝난 학기는 빼고, 모르는 출발 지점은 자료의 첫 출발 후보, 이동 기준은 둔 값(flat)"""
    st = made[0]["store"]
    assert st["same"] and st["sems"] == [["2099-2", "대표"]] and all(isinstance(w, int) for w in st["walks"])
    assert st["noCampus"] == [None, None] and st["nothing"] == {"v": 1, "colors": "item", "home": "", "scheme": "system", "themeOff": "", "terms": []}
    assert st["theme"] == ["dark", "xmas-2099"]  # 테마 탭에서 고른 것·그 해에 끈 이벤트 테마(update78)


@pytest.mark.skipif(shutil.which("javac") is None or shutil.which("java") is None, reason="JDK 없음")
def test_app_reads_widget_data(made, tmp_path):
    """앱의 WidgetData 가 화면이 만든 자료를 읽고, 시각마다 다음 수업·다시 그릴 때·오늘 행·주간 격자를 맞게 고른다(2026-10-26 은 월요일)"""
    out = tmp_path / "classes"
    sources = [JAVA / "WidgetData.java", JAVA / "RouteMap.java", *sorted((ROOT / "tests" / "widget_java").rglob("*.java"))]
    subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(out), *map(str, sources)], check=True, capture_output=True)
    real = tmp_path / "web"  # 앱에 넣는 실제 자료(바탕·길·건물): 동선 지도 위젯
    assert ew.main(["--data", str(ROOT / "data"), "-o", str(real)]) == 0
    run = subprocess.run(["java", "-cp", str(out), "com.ttwizard.app.WidgetCheck", str(made[1]),
                          *(str(real / f) for f in ("basemap.json", "campus.json", "routes.json"))], check=True, capture_output=True)
    r = json.loads(run.stdout.decode("utf-8"))
    assert r["terms"] == 2 and r["colors"] == "item"
    assert r["first"] == {"sem": "2026-2", "label": "2026년 2학기", "title": "시간표 1", "from": 20260901, "to": 20261221,
                          "untimed": 1, "monday": 2, "place": "A동 104호"}
    n = r["next"]
    # 월요일 아침: 첫 수업과 나설 시각(9:30 − 걷기 12분)
    assert n["monMorning"] == {"sem": "2026-2", "kind": "today", "name": "생명과학 1", "start": "09:30", "day": 20261026, "ahead": 0,
                               "current": None, "leave": "09:18", "walk": 12, "late": 0}
    # 첫 수업 중: 다음 수업(앞 수업에서 걸어서 5분 늦음)
    assert (n["monFirst"]["kind"], n["monFirst"]["name"], n["monFirst"]["current"], n["monFirst"]["leave"], n["monFirst"]["late"]) == (
        "today", "대학 글쓰기 1", "생명과학 1", None, 5)
    assert (n["monLast"]["kind"], n["monLast"]["current"]) == ("now", "대학 글쓰기 1")  # 오늘 마지막 수업 중
    assert (n["monAfter"]["kind"], n["monAfter"]["day"], n["monAfter"]["ahead"]) == ("later", 20261028, 2)  # 화요일은 비어서 수요일
    assert (n["friEvening"]["day"], n["friEvening"]["ahead"], n["sunday"]["ahead"]) == (20261102, 3, 1)
    # 학기가 끝난 뒤(겨울)는 다음 학기의 첫 수업, 개강 전(8월)은 그 학기의 첫 수업 날
    assert (n["winter"]["sem"], n["winter"]["day"], n["winter"]["ahead"], n["winter"]["leave"]) == ("2027-1", 20270302, 67, "09:48")
    assert (n["summer"]["sem"], n["summer"]["day"], n["summer"]["ahead"]) == ("2026-2", 20260902, 13)
    assert n["lastDay"] == {"sem": "2026-2", "next": None}  # 학기 끝날의 수업이 끝나면 보일 수업이 없다
    # 다시 그릴 때: 오늘 남은 수업의 시작·끝, 없으면 다음 날 0시
    assert r["change"] == ["2026-10-26 09:30", "2026-10-26 10:45", "2026-10-27 00:00", "2026-12-26 00:00"]
    # 오늘 수업 행(수업 다섯, 행 셋): 안 끝난 것부터, 넘치면 '외 n개' 자리를 남기고, 남는 자리는 끝난 수업으로 채운다
    assert r["rows"] == [[0, 2], [2, 5], [2, 5], [2, 5], [0, 1], [0, 2]]
    # 주간 격자: 월~금, 수업이 있는 시간만(9시~15시), 겹치는 수업은 나란히
    assert r["grid"] == {"days": 5, "hours": [9, 15], "lane": [0, 1, 2, 0], "lanes": [3, 3, 3, 1]}
    # 오늘 열의 지금 줄(update98, 사용자 11/12): 보이는 시각 [9시, 15시) 안, 학기 안의 보이는 요일만(수업이 없는 화요일도). 토요일·학기 뒤·개강 전은 없다
    assert r["nowLine"] == [-1, 540, 575, 899, -1, -1, -1, -1]
    # 다음 알람: 주간 시간표가 놓였으면 줄이 보이기 시작할 때(9시)와 보이는 동안 10분마다(끝 15시에 지운다), 다 그릴 때는 nextChange 그대로.
    # 놓이지 않았으면 nextChange 에만 울린다
    assert r["tick"] == [["2026-10-26 09:00", "2026-10-26 09:30", "2026-10-26 09:30", True],
                         ["2026-10-26 09:30", "2026-10-26 09:30", "2026-10-26 09:30", True],
                         ["2026-10-26 09:40", "2026-10-26 10:45", "2026-10-26 10:45", True],
                         ["2026-10-26 10:45", "2026-10-26 10:45", "2026-10-26 10:45", True],
                         ["2026-10-26 15:00", "2026-10-27 00:00", "2026-10-27 00:00", True],
                         ["2026-10-27 00:00", "2026-10-27 00:00", "2026-10-27 00:00", True],
                         ["2026-11-01 00:00", "2026-11-01 00:00", "2026-11-01 00:00", True],
                         ["2026-12-26 00:00", "2026-12-26 00:00", "2026-12-26 00:00", True]]
    assert r["bad"] == [None, None, None, None, None, 0]
    # 돌아가는 길을 오른쪽으로 7 비키기(app.js offsetPoints 와 같은 셈): 꺾인 곳은 이등분선 쪽, 되돌아가면 다음 변 쪽, 0.5 안의 점은 하나로
    assert r["offset"] == [[0, 7, 3, 7, 3, 10], [0, 7, 10, -7, 0, -7], [0, 7, 10, 7], [5, 5]]  # 깨진 자료는 읽지 않는다(날짜가 틀린 학기만 뺀다)
    # 과목명 끝 번호(~ 는 U+00A0): 앞 낱말과 번호가 한 줄에 들 때만 붙이고, 세 자리 숫자·번호만 있는 글은 그대로(web/js/app.js 의 glueTail 과 같다)
    assert r["glue"] == ["대학 글쓰기~1", "대학 글쓰기 1", "화학", "수학 100", "English~II", "Data Science~A", "수학 및 연습~\u2161", "1",
                         "물리학실험~2"]
    assert r["asked"] == "글쓰기 1"  # 폭은 앞 낱말과 번호로 잰다
    # 다음 수업 위젯의 큰 줄(update70): 첫 수업은 '09:18 출발'·걷기 12분, 앞 수업에서는 '걷기 20분'·'A동에서'·5분 늦음,
    # 마지막 수업 중이면 '12:15 끝', 학기가 끝난 뒤 다음 학기 첫 수업도 나설 시각, 걷기를 모르면 '10:00 시작'
    h = r["hero"]
    assert h["monMorning"] == {"kind": "leave", "at": "09:18", "walk": 12, "from": "", "late": 0}
    assert h["monFirst"] == {"kind": "walk", "at": None, "walk": 20, "from": "A동", "late": 5}
    assert h["monLast"] == {"kind": "end", "at": "12:15", "walk": -1, "from": "", "late": 0}
    assert (h["winter"]["kind"], h["winter"]["at"]) == ("leave", "09:48")
    assert h["unknown"] == {"kind": "start", "at": "10:00", "walk": -1, "from": "", "late": 0}
    assert r["buildings"] == "HOME|A|B"  # 건물 id 와 출발·도착 지점을 읽는다(동선 지도 위젯)
    # 수업을 누르면 여는 주소(update77): 화면이 만든 시간표 id·항목 열쇠를 그대로 읽고, 열쇠·id 가 주소에 못 넣는 글이면 뺀다(열쇠가 없으면 내 시간표)
    assert r["keys"] == [made[0]["data"]["ttId"], *made[0]["data"]["itemKeys"]]
    assert r["itemUrl"] == ["https://x/#tab=mine&sem=2026-2&tt=t1x&item=c123", "https://x/#tab=mine&sem=2026-2&item=L0440.000600-001",
                            "https://x/#tab=mine&sem=2026-2", "https://x/#tab=mine", "https://x/#tab=mine&sem=2026-2&item=k1"]
    # 다음 수업 위젯의 줄(update77 출발 시각 블록, 높이 dp·글자 크기): {과목명 두 줄, 강의실, 블록 안 아래 줄, 시각, 작은 블록}.
    # 빼는 차례는 과목명 둘째 줄 → 강의실 → 블록 안 아래 줄 → 시각, 그래도 모자라면 블록을 줄인다(블록 아래 여백이 좌우와 같은 12 로 남게)
    assert r["nextRows"] == ["11110", "01110", "00110", "00010", "00001", "00001", "00010", "01110"]
    # 머리 띠(update78·79): 띠는 16·f + 12(28)로 두므로 보통 그대로이고, 아주 큰 글꼴로 띠가 그보다 높아지면 그만큼만 기준을 올린다(낮으면 그대로)
    assert r["nextRowsBand"] == ["01110", "00110", "01110", "01110", "11110"]
    # 띠 위아래 여백(update79, 디자인 108판): 띠 = 16·f + 12. 안드로이드 13 이상 한글 띠 글(19 안팎)은 4.6, 기본 글꼴 줄(15.2)은 6.4, 3 아래로는 안 줄인다
    assert r["bandPad"] == [4.6, 6.4, 3.0, 4.2]
    assert r["bigPart"] == [[0, 5], [3, 5], None]  # 큰 줄에서 크게 쓸 수: '10:18 출발'의 10:18, '걷기 12분'의 12
    # 큰 줄은 말줄임하지 않는다(update78, 디자인 106판): 32(작은 블록 26)가 들면 그것, 아니면 26, 그래도 넘치면 0.5씩 줄여 드는 크기(적어도 12).
    # 작은 블록은 높이 한도 아래로도(update79, 디자인 108판: 블록 아래 12 를 지킨다): 한도 24.3 → 24, 폭도 모자라면 22.5, 한도가 12 아래면 12.
    # 낱말은 수의 반이되 12 아래로는 안 내려서(수가 24 아래면 낱말 12) 폭을 그 크기로 다시 잰다: 폭 70 에 18
    assert r["heroSize"] == [32, 26, 22.5, 26, 12, 32, 24, 22.5, 12, 18]
    assert r["wordScale"] == [0.5, 0.5, 0.75]
    # 블록 아래 줄 {아래 글, 지각}: 둘이 들면 둘 다, 넘치면 '25동에서'를 빼고 '5분 지각'만, 그것도 넘치면 줄째
    assert r["heroLine"] == ["11", "01", "00", "10", "00", "01", "00"]
    # 오늘 수업 행 아래 줄: 넘치면 '걷기 n분' → '10:18 출발' 차례로 덩이째 뺀다. 강의실은 남기고(넘치면 끝이 줄어든다), 강의실이 없으면 줄이 없다
    assert r["rowSub"] == ["26동 104호 · 10:18 출발 · 걷기 12분", "26동 104호 · 10:18 출발", "26동 104호", "26동 104호", "10:18 출발", "", "1동 303호", ""]
    # 위젯 테마(update78, 0 기본·1 라이트·2 다크·3 크리스마스): 11/30 23:59, 12/1 0:00, 12/31 23:59, 1/1 0:00, 이듬해 12/15.
    # 크리스마스 기간(12월 한 달, 기기 날짜)이면 고른 라이트·다크보다 앞서고, 그 해에 끈 것(xmas-2026)은 그 해에만 꺼진다. 모르는 고르기는 기본
    assert r["theme"] == ["system:03303", "light:13313", "dark:22223", "system:03303"]
    assert r["themes"] == "1:xmas/12-01/12-31"
    # 주간 격자의 칸 자리: 머리·시각 칸 16, 월~금, 9~15시. 그림(화소)과 누르는 칸(dp)이 같은 셈이라 배율만큼 같다
    assert r["boxes"] == [[17.5, 38.75, 71.3, 92.25], [17.5, 104.75, 71.3, 158.25], [35.0, 209.5, 142.6, 316.5]]
    assert r["weekFont"] == [0.85, 1.0, 1.3]
    # 누르면 여는 주소: 학기·요일(월 0 … 일 6). 화면이 route 를 읽으면 그 요일 동선 지도
    assert r["url"] == ["https://x/#tab=mine&sem=2026-2&route=4", "https://x/#tab=mine", "https://x/#tab=mine", "https://x/#tab=mine&sem=2027-W&route=0"]
    # 동선 지도 위젯(update71): 그날 구간(출발 지점 → 수업 → … → 출발 지점, 번호는 그날 차례, 돌아가는 길은 0)·핀·걷기 합
    assert r["legs"] == ["HOME>A:1", "A>B:2", "B>HOME:0"] and r["stops"] == ["A:1", "B:2"] and r["dayWalk"] == 12 + 20 + 30
    # 강의실 미정 수업은 자리를 옮기지 않고 번호만 센다, 같은 건물끼리는 걷지 않는다, 출발 지점을 모르면 그 두 구간이 없다, 출발 지점의 건물은 핀이 없다
    assert r["mixedLegs"] == [["H>X:1", "X>Y:4", "Y>H:0"], ["X>Y:4"], ["X>Y:4", "Y>X:0"]]
    assert r["mixedStops"] == [["X:1·3", "Y:4"], ["Y:4"]] and r["mixedWalk"] == 5 + 0 + 7 + 9
    t = r["tiny"]
    assert (t["areas"], t["lines"], t["where"], t["ab"]) == (1, 1, 2, 3)  # 자리가 없는 건물은 뺀다
    assert "contours" not in t  # 위젯은 등고선을 읽지도 그리지도 않는다(update88)
    assert t["abFirst"] == pytest.approx([38.5, -120.2]) and t["baFirst"] == pytest.approx([43.252, -126.453])  # 한쪽 방향 길은 거꾸로
    assert t["straight"] is None and t["noC"] is None  # 길도 자리도 모르면 그리지 않는다
    assert t["fit"] == pytest.approx([350, 100, 45]) and t["capped"] == pytest.approx([1000, 100, 45])  # 여백 안 가운데, 배율 한도
    _check_real_map(r["real"])


def _decode(s: str, prec: int = 5) -> list:
    """Google polyline → [(위도, 경도)] (engine.js decodePolyline 과 같은 셈)"""
    out, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                res |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]
        lon += vals[1]
        out.append((lat / 10 ** prec, lon / 10 ** prec))
    return out


def _check_real_map(m: dict) -> None:
    """실제 자료로 읽은 바탕·길과 그날 지도의 짜임: 정문 → 건물 셋 → 정문을 4×2 그림(800×330 화소, dp 2.5)에"""
    base = json.loads((ROOT / "data" / "basemap.json").read_text(encoding="utf-8"))
    # 등고선은 바탕 자료에 없고(2026-11-03, 높이 자료는 PC 에만) 위젯도 그리지 않는다(update88)
    assert "contour" not in base and "contours" not in m
    assert (m["buildings"], m["roads"]) == (len(base["area"]["building"]), len(base["line"]["road"]))
    assert m["where"] > 100 and m["lines"] == 4 and m["back"] == [False, False, False, True]
    assert sorted(int(n) for part in m["labels"].split("|") for n in part.split("·")) == [1, 2, 3]
    for x, y in m["spots"] + [m["home"]]:  # 핀(반지름 30 화소)이 그림 안: 가장자리 45, 아래는 출처 글 자리 65
        assert 44 <= x <= 756 and 44 <= y <= 266, (x, y)
    assert m["zoom"] <= 17 + 1e-9 and m["mpp"] > 0
    paths = json.loads((ROOT / "data" / "route_paths.json").read_text(encoding="utf-8"))["paths"]
    a, b = m["picks"].split("|")[:2]
    pts = _decode(paths[f"{a}|{b}"]) if f"{a}|{b}" in paths else _decode(paths[f"{b}|{a}"])[::-1]
    assert m["path"][0] == len(pts) and m["path"][1:] == pytest.approx([*pts[0], *pts[-1]], abs=1e-9)  # 앱 자료와 같은 길
    # 그린 선(update73): 수업 가는 길은 그대로, 돌아가는 길은 첫 점이 진행 방향 오른쪽으로 7 × dp(2.5) 비킨다
    dp, pins = 2.5, [tuple(xy) for xy in m["spots"]] + [tuple(m["home"])]
    for (x0, y0, x1, y1, dx, dy, lx, ly, n), back in zip(m["drawn"], m["back"]):
        if not back:
            assert (dx, dy) == pytest.approx((x0, y0), abs=1e-3)
            continue
        assert math.hypot(dx - x0, dy - y0) == pytest.approx(7 * dp, abs=1e-2)
        assert (x1 - x0) * (dy - y0) - (y1 - y0) * (dx - x0) > 0  # 화면 좌표(y 아래)에서 오른쪽
    # 선 끝과 핀을 잇는 점선: 그린 선의 끝에서 핀 가운데까지, 2 × dp 넘게 떨어진 것만, 한 핀에 닿는 선 끝은 10 × dp 안에 둘이 없다
    ends, kept = [], []
    for (x0, y0, x1, y1, dx, dy, lx, ly, n), stubs in zip(m["drawn"], m["stubs"]):
        for sx, sy, px, py in stubs:
            assert (sx, sy) in [pytest.approx((dx, dy), abs=1e-3), pytest.approx((lx, ly), abs=1e-3)]
            assert any((px, py) == pytest.approx(pin, abs=1e-3) for pin in pins)
            assert math.hypot(px - sx, py - sy) >= 2 * dp
            assert not any((px, py) == pytest.approx(k[:2], abs=1e-3) and math.hypot(k[2] - sx, k[3] - sy) <= 10 * dp for k in kept)
            kept.append((px, py, sx, sy))
    assert kept, "길이 문 앞에서 끝나면 점선이 있다"


def _tokens(css: str, start: str) -> dict:
    i = css.index(start)
    return dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", css[i:css.index("\n}", i)]))


def _resolve(tokens: dict, name: str, base: dict | None = None) -> str:
    value = tokens.get(name, (base or {}).get(name))
    while value and value.startswith("var(--"):
        ref = value[6:-1]
        value = tokens.get(ref, (base or {}).get(ref))
    return value.upper()


XMAS = 'html[data-theme="xmas"], .mini.is-xmas {'  # 크리스마스 블록(없는 토큰은 라이트 값)


def _java_colors(body: str) -> list[str]:
    """자바 색 표의 값들(#RRGGBB). all(n, 0xFF…) 는 n 번"""
    out = []
    for m in re.finditer(r"all\((\d+), 0xFF([0-9A-F]{6})\)|0xFF([0-9A-F]{6})", body):
        out += ["#" + m.group(2)] * int(m.group(1)) if m.group(1) else ["#" + m.group(3)]
    return out


def test_widget_colors_follow_web_tokens():
    """위젯 색이 웹 화면의 테마 토큰과 같다: 기본(기기 설정) 판의 values·values-night 의 widget_*, 앱 테마 한 벌(update78)의 widget_*_light·_dark·_xmas,
    주간 격자·동선 지도 그림의 색(LIGHT·DARK·XMAS). 크리스마스는 그 블록에 없는 토큰이 라이트 값이다(바탕 지도 등)"""
    css = (ROOT / "web" / "style.css").read_text(encoding="utf-8")
    light = _tokens(css, ":root, .mini.is-light, .mini.is-xmas {")
    dark = _tokens(css, ':root[data-scheme="dark"]:not([data-theme]) {')
    xmas = _tokens(css, XMAS)
    names = wt.COLOR_TOKENS
    assert {"band", "on_band", "on_band3"} <= names.keys()  # 머리 띠(update78): bg, on-bg-heading, on-bg-text3
    for folder, tokens, base in (("values", light, None), ("values-night", dark, light)):
        colors = dict(re.findall(r'<color name="widget_(\w+)">(#[0-9A-Fa-f]{6})</color>', (RES / folder / "colors.xml").read_text(encoding="utf-8")))
        assert colors.keys() == names.keys(), folder
        for res, token in names.items():
            assert colors[res].upper() == _resolve(tokens, token, base), (folder, res, token)
    # 앱 테마 한 벌의 색(scripts/widget_themes.py 가 만든 values/widget_themes.xml): 그 한 벌이 쓰는 이름마다 같은 토큰 값, 출처 글 바탕은 card 90%
    made = dict(re.findall(r'<color name="widget_(\w+)">(#[0-9A-Fa-f]{6,8})</color>', (RES / "values" / "widget_themes.xml").read_text(encoding="utf-8")))
    for theme, tokens, base in (("light", light, None), ("dark", dark, light), ("xmas", xmas, light)):
        mine = {k[: -len(theme) - 1]: v for k, v in made.items() if k.endswith(f"_{theme}")}
        assert {"bg", "text", "text2", "text3", "accent", "accent_weak", "danger", "band", "on_band", "on_band3", "attr_bg"} <= mine.keys(), theme
        for res, value in mine.items():
            want = "#E6" + _resolve(tokens, "card", base)[1:] if res == "attr_bg" else _resolve(tokens, names[res], base)
            assert value.upper() == want, (theme, res)
    assert made["band_xmas"] == "#103924" and made["on_band_xmas"] == "#FFFFFF" and made["accent_xmas"] == "#0D6F44"  # 디자인 106판 '크리스마스 한 벌'
    java = (JAVA / "WeekBitmap.java").read_text(encoding="utf-8")
    for name, tokens, base in (("LIGHT", light, None), ("DARK", dark, light), ("XMAS", xmas, light)):
        body = re.search(rf"static final Ink {name} = new Ink\((.*?)\);", java, re.S).group(1)
        want = [_resolve(tokens, k, base) for k in ("text3", "line", "accent-text", "accent-weak", "danger")]  # danger: 지금 줄(update98)
        want += [_resolve(tokens, f"item-{i}", base) for i in range(8)] + [_resolve(tokens, f"cls-{k}-bg", base) for k in ("req", "elec", "gen", "etc")]
        # 칸 위 글자색(칸마다, 디자인 106판: 크리스마스의 짙은 칸은 흰 글자)
        want += [_resolve(tokens, f"item-{i}-fg", base) for i in range(8)] + [_resolve(tokens, f"item-{i}-fg2", base) for i in range(8)]
        want += [_resolve(tokens, f"cls-{k}-fg", base) for k in ("req", "elec", "gen", "etc")]
        want += [_resolve(tokens, f"cls-{k}-fg2", base) for k in ("req", "elec", "gen", "etc")]
        assert _java_colors(body) == want, name
    # 동선 지도 그림(DayMapBitmap)의 색: TOKENS 차례의 웹 토큰 값(라이트·다크·크리스마스), 출처 글 바탕은 card 90%
    java = (JAVA / "DayMapBitmap.java").read_text(encoding="utf-8")
    order = re.findall(r'"([a-z-]+)"', re.search(r"static final String\[\] TOKENS = \{(.*?)\};", java, re.S).group(1))
    assert "map-building" in order and "route" in order and not [k for k in order if "contour" in k]  # 등고선 색은 쓰지 않는다(update88)
    # 이름 붙인 차례(LAND = 0, …)가 그 토큰을 가리킨다: 표에서 하나를 빼고 넣을 때 번호가 밀리지 않게
    consts = dict((k, int(v)) for k, v in re.findall(r"\b([A-Z_]+) = (\d+)", re.search(r"private static final int LAND = 0,(.*?);", java, re.S).group(0)))
    named = {"LAND": "map-land", "CAMPUS": "map-campus", "CAMPUS_LINE": "map-campus-line", "GREEN": "map-green", "PARK": "map-park",
             "GRASS": "map-grass", "PITCH": "map-pitch", "WATER": "map-water", "WALK": "map-walk-area", "ROAD": "map-road", "ROAD_LINE": "map-road-line",
             "ROAD_SECONDARY": "map-road-secondary", "ROAD_PRIMARY": "map-road-primary", "ROAD_TRUNK": "map-road-trunk", "PED": "map-ped",
             "PED_LINE": "map-ped-line", "BUILDING": "map-building", "BUILDING_LINE": "map-building-line", "ROUTE": "route", "ROUTE_HOME": "route-home",
             "CARD": "card", "ACCENT": "accent", "ON_COLOR": "on-color", "HOME": "home", "ON_HOME": "on-home"}
    assert consts.keys() == named.keys() and {k: order[i] for k, i in consts.items()} == named
    for k in ("ROAD_SECONDARY", "ROAD_PRIMARY", "ROAD_TRUNK"):  # 테두리 색은 그 바로 뒤(ink[ROAD_x + 1])
        assert order[consts[k] + 1] == named[k] + "-line", k
    for name, tokens, base in (("LIGHT", light, None), ("DARK", dark, light), ("XMAS", xmas, light)):
        body = re.search(rf"static final int\[\] {name} = \{{(.*?)\}};", java, re.S).group(1)
        got = ["#" + x[4:] for x in re.findall(r"0xFF[0-9A-F]{6}", body)]
        assert got == [_resolve(tokens, k, base) for k in order], name
    for folder, tokens, base in (("values", light, None), ("values-night", dark, light)):
        attr = re.search(r'<color name="widget_attr_bg">#E6([0-9A-Fa-f]{6})</color>', (RES / folder / "colors.xml").read_text(encoding="utf-8"))
        assert attr and "#" + attr.group(1).upper() == _resolve(tokens, "card", base), folder


def test_widget_follows_app_theme():
    """위젯 넷이 앱 테마를 따른다(update78, 11/2 사용자: "색깔이 테마에 맞춰서 바뀌게 색을 넣어줘. 나머지 위젯들도 마찬가지임", 디자인 106판 '테마').
    기본이면 기기 라이트·다크(손으로 쓴 layout(-night)), 라이트·다크를 골랐으면 그 한 벌, 크리스마스 기간이면 그 한 벌(scripts/widget_themes.py 가 만든 판).
    이벤트 테마의 기간은 앱(app.js THEMES, index.html 머리의 스크립트)과 같고 저장 이름도 같다"""
    assert wt.main(["--check"]) == 0  # 한 벌 판이 손으로 쓴 판·style.css 와 맞다(아니면 python scripts/widget_themes.py 로 다시 만든다)
    java = (JAVA / "WidgetData.java").read_text(encoding="utf-8")
    periods = re.findall(r'\{ "(\w+)", "(\d\d-\d\d)", "(\d\d-\d\d)" \}', re.search(r"static final String\[\]\[\] THEMES = \{(.*?)\};", java, re.S).group(1))
    app = (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")
    in_app = re.findall(r'\["(\w+)", "[^"]*", "(\d\d-\d\d)", "(\d\d-\d\d)"', re.search(r"^const THEMES = \[(.*)\];$", app, re.M).group(1))
    assert periods == in_app == [("xmas", "12-01", "12-31")]  # 테마를 더하면 그 한 벌의 자원·WidgetData.theme 도 더한다
    head = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    for tid, start, end in periods:
        assert f'(k<"{start}"||k>"{end}")' in head and f'"{tid}-"+d.getFullYear()' in head and f'dataset.theme="{tid}"' in head
    # 저장 이름: 앱이 두는 ttw.scheme("light"·"dark", 기본은 지움)·ttw.themeOff('<테마>-<해>')를 위젯 자료가 그대로 읽는다
    assert 'store.set("scheme", v)' in app and 'store.set("themeOff", season.event)' in app
    assert 'event: `${t[0]}-${forced ? "test" : now.getFullYear()}`' in app
    tt = (ROOT / "web" / "js" / "timetables.js").read_text(encoding="utf-8")
    assert 'scheme: get("scheme"), themeOff: get("themeOff")' in tt
    assert dict(re.findall(r"static final int (DEVICE|LIGHT|DARK|XMAS) = (\d);", java)) == {"DEVICE": "0", "LIGHT": "1", "DARK": "2", "XMAS": "3"}
    # WidgetViews 는 한 벌마다 다른 레이아웃을 고른다(같은 레이아웃이면 런처가 전 화면 위에 바꿈만 얹어 색이 남는다). 그 차례가 DEVICE·LIGHT·DARK·XMAS
    views = (JAVA / "WidgetViews.java").read_text(encoding="utf-8")
    for res, name in (("layout", "widget_next"), ("layout", "widget_today"), ("layout", "widget_week"), ("layout", "widget_map"),
                      ("layout", "widget_today_row"), ("layout", "widget_today_row_past"), ("drawable", "widget_ic_route")):
        assert re.search(rf"R\.{res}\.{name}, R\.{res}\.{name}_light, R\.{res}\.{name}_dark, R\.{res}\.{name}_xmas\b", views), name
    for table, names in (("ITEM_MARKS", [f"widget_mark_item{i}" for i in range(8)]), ("CLS_MARKS", [f"widget_mark_{k}" for k in ("req", "elec", "gen", "etc")])):
        rows = re.findall(r"\{([^{}]*)\}", re.search(rf"static final int\[\]\[\] {table} = \{{(.*?)\n    \}};", views, re.S).group(1))
        got = [re.findall(r"R\.drawable\.(\w+)", row) for row in rows]
        assert got == [names, *([f"{n}_{t}" for n in names] for t in ("light", "dark", "xmas"))], table
    assert "theme == WidgetData.DEVICE" in views and "WeekBitmap.ink(theme)" in views and "DayMapBitmap.ink(theme)" in views
    # 한 벌 판은 손으로 쓴 라이트 판을 옮긴 것이라 주간·동선 지도는 _light 그림만 보인다(코드가 그 한 장만 그린다)
    for layout, pic in (("widget_week", "w_grid"), ("widget_map", "w_map")):
        for theme in ("light", "dark", "xmas"):
            xml = (RES / "layout" / f"{layout}_{theme}.xml").read_text(encoding="utf-8")
            assert (_visibility(xml, f"{pic}_light"), _visibility(xml, f"{pic}_dark")) == ("visible", "gone"), (layout, theme)
            assert "@color/widget_" not in re.sub(rf"@color/widget_\w+_{theme}\b", "", xml), (layout, theme)  # 기기 다크 모드를 따르는 색이 남지 않았다
    # 위젯 고르는 화면의 미리 보기는 앱 테마를 모르니 기기 라이트·다크 그대로(한 벌 판이 없다)
    assert not list(RES.glob("layout/widget_*_preview_*.xml"))


def test_widget_xml_names_resolve():
    """위젯 레이아웃·그림·스타일 XML 이 가리키는 자원(@color·@drawable·@style·@layout·@string)이 다 있다: 빌드(aapt)가 잡을 이름 틀림을 클라우드에서 먼저 잡는다.
    한 벌 판(update78)은 원본의 이름에 꼬리를 단 것이라 하나라도 빠지면 여기서 걸린다"""
    have = {k: _res_names(k) for k in ("layout", "drawable", "color", "string")}
    have["style"] = set(re.findall(r'<style name="([\w.]+)"', "\n".join(p.read_text(encoding="utf-8") for p in RES.glob("values*/*.xml"))))
    files = [*RES.glob("layout*/widget_*.xml"), *RES.glob("drawable*/widget_*.xml"), RES / "values" / "widget_styles.xml", RES / "values" / "widget_themes.xml"]
    bad = [(p.name, kind, name) for p in files for kind, name in re.findall(r"@(color|drawable|style|layout|string)/([\w.]+)", p.read_text(encoding="utf-8"))
           if name not in have[kind]]
    assert len(files) > 100 and not bad, bad


def test_map_preview_art():
    """위젯 고르는 화면의 동선 지도 미리 보기 그림(update79, 디자인 108판. 사용자 11/2 "그 지도 위젯 미리보기 화면도 '샤' 모양으로 만들어 줘"): Play 그래픽 이미지와
    같은 길(집 → 1 → 2, 기둥과 왼팔 끝 5, 가로대 둘 끝 4·3)을 지어낸 지도에 경로 선과 핀으로만 그린다. 그림에 글자가 없고 스크린리더에 읽히지 않으며, 그림·파일 이름에서
    학교의 장소 이름으로 부르지 않는다. 광고·유료 테마 전에 바꿀 지어낸 길 판(update71 그림)을 남겨 둔다(법무 10/22 조건)"""
    art = (RES / "drawable" / "widget_map_preview_art.xml").read_text(encoding="utf-8")
    plain = (RES / "drawable" / "widget_map_preview_art_plain.xml").read_text(encoding="utf-8")
    assert "<vector" in art and "<vector" in plain and "<text" not in art
    assert art.count('android:fillColor="@color/widget_pin"') == 5 and art.count('android:fillColor="@color/widget_home"') == 1  # 수업 핀 다섯과 집
    assert plain.count('android:fillColor="@color/widget_pin"') == 2  # 지어낸 길 판: 집 → 1 → 2
    assert "정문" not in art + plain and not [p.name for p in RES.rglob("*") if "gate" in p.name.lower()]
    layout = (RES / "layout" / "widget_map_preview.xml").read_text(encoding="utf-8")
    tag = re.search(r'<ImageView[^>]*@drawable/widget_map_preview_art"[^>]*/>', layout).group(0)
    assert 'android:importantForAccessibility="no"' in tag


def _attrs(el) -> dict:
    return {k.split("}")[-1]: v for k, v in el.attrib.items()}


def test_widget_header_band_and_ripples():
    """머리 띠(update78, 디자인 106판 '머리 띠'·'모양'): 위젯 넷(과 한 벌 판·미리 보기)의 맨 위에 그 테마 bg 띠(위 모서리 16, 아래 곧게, 선 없음),
    위아래 6, 좌우는 몸과 같게(12, 주간·동선 지도 10). 제목 13 굵게 on-bg-heading, 오른쪽 흐린 글 12 on-bg-text3. 몸은 띠 아래 6(다음 수업은 0, 과목명 위 4)·
    좌우·아래 12(10). 다음 수업의 항목 색 점 8 에는 card 1 테두리. 누르는 곳(수업 줄·행·주간 칸)에는 눌림 물결"""
    import xml.etree.ElementTree as ET
    for layout, pad, top in (("widget_next", 12, 0), ("widget_today", 12, 6), ("widget_week", 10, 6), ("widget_map", 10, 6)):
        paths = [RES / "layout" / f"{layout}.xml", RES / "layout" / f"{layout}_preview.xml", *(RES / "layout" / f"{layout}_{t}.xml" for t in ("light", "dark", "xmas"))]
        if (RES / "layout-night" / f"{layout}.xml").exists():
            paths.append(RES / "layout-night" / f"{layout}.xml")
        for path in paths:
            root = ET.parse(path).getroot()
            assert not any(k.startswith("padding") for k in _attrs(root)), path.name  # 여백은 띠와 몸이 따로
            band, body = list(root)
            a, b = _attrs(band), _attrs(body)
            assert re.fullmatch(r"@drawable/widget_band(_light|_dark|_xmas)?", a["background"]), path.name
            assert (a["paddingStart"], a["paddingEnd"], a["paddingTop"], a["paddingBottom"]) == (f"{pad}dp", f"{pad}dp", "6dp", "6dp"), path.name
            assert (b["paddingStart"], b["paddingEnd"], b.get("paddingTop", "0dp"), b["paddingBottom"]) == (f"{pad}dp", f"{pad}dp", f"{top}dp", f"{pad}dp"), path.name
            styles = [_attrs(t).get("style", "") for t in band.iter() if t.tag == "TextView"]
            assert re.fullmatch(r"@style/TTWWidget\.BandTitle(\.\w+)?", styles[0]) and all(re.fullmatch(r"@style/TTWWidget\.BandText(\.\w+)?", x) for x in styles[1:]), path.name
            if layout == "widget_next":
                dot = [_attrs(t) for t in band.iter() if t.tag == "ImageView"][0]
                assert (dot["layout_width"], dot["padding"], dot["layout_marginStart"]) == ("10dp", "1dp", "-1dp")  # 점 8 + 둘레 1(점 자리는 그대로)
                assert re.fullmatch(r"@drawable/widget_dot_ring(_\w+)?", dot["background"])
                lecture = [_attrs(t) for t in root.iter() if _attrs(t).get("id") == "@+id/w_lecture"]
                assert path.name.endswith("_preview.xml") or lecture[0]["background"] == "?android:attr/selectableItemBackground"
    styles = (RES / "values" / "widget_styles.xml").read_text(encoding="utf-8")
    title = re.search(r'<style name="TTWWidget.BandTitle">(.*?)</style>', styles, re.S).group(1)
    text = re.search(r'<style name="TTWWidget.BandText">(.*?)</style>', styles, re.S).group(1)
    assert ">13sp<" in title and ">bold<" in title and "@color/widget_on_band<" in title
    assert ">12sp<" in text and "bold" not in text and "@color/widget_on_band3<" in text
    band = (RES / "drawable" / "widget_band.xml").read_text(encoding="utf-8")
    assert 'android:color="@color/widget_band"' in band and 'topLeftRadius="16dp"' in band and 'bottomLeftRadius="0dp"' in band
    assert 'android:color="@color/widget_bg"' in (RES / "drawable" / "widget_dot_ring.xml").read_text(encoding="utf-8")  # card 테두리
    # 큰 줄은 말줄임하지 않는다(코드가 폭에 맞춰 줄인다)
    assert "ellipsize" not in re.search(r'<style name="TTWWidget.Hero">(.*?)</style>', styles, re.S).group(1)
    # 눌림 물결(디자인 106판: 한 위젯에 누르는 곳이 여럿이라 어디가 눌렸는지 보여야 한다)
    for name, vid in (("widget_today_row", "r_root"), ("widget_today_row_past", "r_root"), ("widget_week_hit", "w_hit")):
        el = [_attrs(t) for t in ET.parse(RES / "layout" / f"{name}.xml").getroot().iter() if _attrs(t).get("id") == f"@+id/{vid}"][0]
        assert el["background"] == "?android:attr/selectableItemBackground", name


def test_widget_resources_and_manifest():
    """매니페스트의 위젯 셋과 다시 그리는 받는 곳, 위젯 정보, 자바가 쓰는 자원(R.*)이 다 있고, 정확한 알람·부팅 권한은 쓰지 않는다"""
    manifest = (ANDROID / "AndroidManifest.xml").read_text(encoding="utf-8")
    for cls, info in (("NextClassWidget", "widget_next_info"), ("TodayWidget", "widget_today_info"), ("WeekWidget", "widget_week_info"),
                      ("DayMapWidget", "widget_map_info")):
        block = re.search(rf'<receiver\s+android:name="\.{cls}"(.*?)</receiver>', manifest, re.S).group(1)
        assert 'android:exported="false"' in block and "android.appwidget.action.APPWIDGET_UPDATE" in block
        assert f'android:resource="@xml/{info}"' in block and (JAVA / f"{cls}.java").exists()
        xml = (RES / "xml" / f"{info}.xml").read_text(encoding="utf-8")
        for ref in re.findall(r'@(layout|string)/(\w+)', xml):
            assert ref[1] in _res_names(ref[0]), (info, ref)
        assert int(re.search(r'updatePeriodMillis="(\d+)"', xml).group(1)) >= 30 * 60 * 1000  # 안드로이드가 받는 가장 짧은 값 이상
    updater = re.search(r'<receiver\s+android:name="\.WidgetUpdater"(.*?)</receiver>', manifest, re.S).group(1)
    assert 'android:exported="false"' in updater
    assert set(re.findall(r'<action android:name="([^"]+)"', updater)) == {
        "android.intent.action.TIME_SET", "android.intent.action.TIMEZONE_CHANGED", "android.intent.action.MY_PACKAGE_REPLACED"}
    # 법무: 수업 시각 맞춤은 부정확 알람으로(정확한 알람·부팅 권한 없음)
    for perm in ("SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM", "RECEIVE_BOOT_COMPLETED"):
        assert perm not in manifest
    java = "\n".join(p.read_text(encoding="utf-8") for p in JAVA.glob("*.java"))
    assert "setExact" not in java and "setAlarmClock" not in java and "AlarmManager.RTC," in java
    # 자바가 쓰는 자원이 다 있다(빌드 전에 이름 틀림을 잡는다)
    for kind, name in set(re.findall(r"(?<!android\.)\bR\.(layout|id|string|array|drawable|color)\.(\w+)", java)):  # android.R 은 기기 것
        assert name in _res_names(kind), (kind, name)
    main = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
    assert main.index("registerPlugin(WidgetPlugin.class)") < main.index("super.onCreate(savedInstanceState)")
    assert '@CapacitorPlugin(name = "TTWWidget")' in (JAVA / "WidgetPlugin.java").read_text(encoding="utf-8")
    # 위젯을 누르면 여는 주소: 웹 앱 주소 + '#tab=mine'(화면이 내 시간표로 간다)
    url = re.search(r'OPEN_URL = "([^"]+)"', java).group(1)
    assert url == build_app.REMOTE + "#tab=mine"


def test_week_layouts_pick_light_or_dark_picture():
    """주간 격자·동선 지도(update71)는 라이트·다크 두 장을 늘 넣고 layout(-night) 판이 한 장을 보인다(코드는 두 그림의 보이기를 건드리지 않는다)"""
    views = (JAVA / "WidgetViews.java").read_text(encoding="utf-8")
    for layout, pic in (("widget_week", "w_grid"), ("widget_map", "w_map")):
        day = (RES / "layout" / f"{layout}.xml").read_text(encoding="utf-8")
        night = (RES / "layout-night" / f"{layout}.xml").read_text(encoding="utf-8")
        vis = lambda xml, vid: re.search(rf'android:id="@\+id/{vid}".*?android:visibility="(\w+)"', xml, re.S).group(1)  # noqa: E731
        assert (vis(day, f"{pic}_light"), vis(day, f"{pic}_dark")) == ("visible", "gone"), layout
        assert (vis(night, f"{pic}_light"), vis(night, f"{pic}_dark")) == ("gone", "visible"), layout
        strip = lambda xml: re.sub(r"<!--.*?-->|android:visibility=\"\w+\"", "", xml, flags=re.S)  # noqa: E731
        assert strip(day) == strip(night), layout
        assert not re.search(rf"setViewVisibility\(R\.id\.{pic}_(light|dark)", views)
    # 동선 지도에는 출처(수치지형도·OpenStreetMap)를 지도 위에 늘 둔다(법무: 지도에 출처 표기)
    day = (RES / "layout" / "widget_map.xml").read_text(encoding="utf-8")
    assert 'android:id="@+id/w_attr"' in day and "@string/w_map_attr" in day and "w_attr" not in re.sub(r"(?s).*static RemoteViews map\(", "", views).split("\n    }\n")[0]
    strings = (RES / "values" / "strings.xml").read_text(encoding="utf-8")
    assert '<string name="w_map_attr">© 국토지리정보원 · © OpenStreetMap</string>' in strings


def test_week_now_line():
    """주간 시간표 오늘 열의 지금 줄(update98, 사용자 11/12 "현재 시간이 해당하는 날에 가로 막대로", "빨간색(처럼 보색)으로 통일", "모양도 걍 평평하게"):
    칸 위에 테마의 빨강(danger) 2 굵기 평평한 줄(점·테두리 없음).
    줄이 보이는 동안 10분마다 부정확 알람으로 다시 그리되 그때는 주간 시간표만(위젯 넷은 nextChange 에). 언제 무엇을 그릴지는 test_app_reads_widget_data 가 본다"""
    week = (JAVA / "WeekBitmap.java").read_text(encoding="utf-8")
    body = re.search(r"static Bitmap draw\(.*?\n    }\n", week, re.S).group(0)
    line = body[body.index("WidgetData.nowLine(t, now)"):]
    assert body.index("drawText(canvas, box") < body.index("WidgetData.nowLine(t, now)")  # 칸 위에
    line = line[:line.index("return bmp;")]
    assert "fill.setColor(ink.danger);" in line and "g.y(nowMin)" in line and "canvas.drawRect(x0, y - dp, x0 + colW, y + dp, fill);" in line
    assert "drawCircle" not in line and "accent" not in line  # 평평하게(점·둘레 없이), 빨강으로 통일
    data = (JAVA / "WidgetData.java").read_text(encoding="utf-8")
    assert "static final int NOW_STEP = 10;" in data
    updater = (JAVA / "WidgetUpdater.java").read_text(encoding="utf-8")
    assert "d.nextTick(now, ids(c, WEEK).length > 0)" in updater and "tick.putExtra(EXTRA_FULL_AT, at[1])" in updater
    assert "alarms.setWindow(AlarmManager.RTC, at[0], WINDOW_MS, pi)" in updater
    receive = re.search(r"public void onReceive\(.*?\n    }\n", updater, re.S).group(0)
    assert "ACTION_TICK.equals(intent.getAction())" in receive and "refreshWeek(context)" in receive and "refreshAll(context)" in receive
    week_only = re.search(r"static void refreshWeek\(.*?\n    }\n", updater, re.S).group(0)
    assert "render(c, m, ids(c, WEEK), WEEK, d, now)" in week_only and "schedule(c, d, now)" in week_only


def _visibility(xml: str, vid: str) -> str:
    tag = re.search(rf'<[\w.]+\s[^<>]*android:id="@\+id/{vid}"[^<>]*>', xml).group(0)
    m = re.search(r'android:visibility="(\w+)"', tag)
    return m.group(1) if m else "visible"


def _with_includes(xml: str, folder: Path) -> str:
    """<include layout="@layout/x"> 가 넣는 레이아웃도 붙인다(빈 상태 widget_empty). 넣는 쪽의 id·보이기가 넣은 뿌리의 것을 대신한다"""
    for name in re.findall(r'<include[^<>]*layout="@layout/(\w+)"', xml):
        path = folder / f"{name}.xml" if (folder / f"{name}.xml").exists() else RES / "layout" / f"{name}.xml"
        xml += "\n" + path.read_text(encoding="utf-8")
    return xml


def test_widget_views_reset_what_they_change():
    """런처는 같은 레이아웃이면 전에 펼친 화면 위에 바꿈만 다시 얹으므로(update69) 위젯마다 그릴 때 바꾸는 보이기를 다 처음 모양으로 되돌린다.
    되돌리는 목록은 레이아웃 XML 의 처음 보이기와 같고, 그리는 코드가 보이기를 바꾸는 것은 모두 목록에 있다"""
    views = (JAVA / "WidgetViews.java").read_text(encoding="utf-8")
    for kind, layout in (("NEXT", "widget_next"), ("TODAY", "widget_today"), ("WEEK", "widget_week"), ("MAP", "widget_map")):
        ids = {k: re.findall(r"R\.id\.(\w+)", re.search(rf"static final int\[\] {kind}_{k} = \{{(.*?)\}};", views).group(1))
               for k in ("SHOWN", "HIDDEN")}
        for path in (RES / "layout" / f"{layout}.xml", RES / "layout-night" / f"{layout}.xml", *(RES / "layout" / f"{layout}_{t}.xml" for t in ("light", "dark", "xmas"))):
            if path.exists():  # 기본 판(layout·layout-night)과 앱 테마 한 벌 판(update78)
                xml = _with_includes(path.read_text(encoding="utf-8"), path.parent)
                assert [_visibility(xml, v) for v in ids["SHOWN"]] == ["visible"] * len(ids["SHOWN"]), path.name
                assert [_visibility(xml, v) for v in ids["HIDDEN"]] == ["gone"] * len(ids["HIDDEN"]), path.name
        start = views.index(f"static RemoteViews {kind.lower()}(")
        body = views[start:views.index("\n    }\n", start)]
        assert body.index(f"reset(v, {kind}_SHOWN, {kind}_HIDDEN);") < body.index("setOnClickPendingIntent")
        changed = set(re.findall(r"setViewVisibility\(R\.id\.(\w+)", body))
        if "empty(v, " in body:  # 빈 상태 도우미가 바꾸는 것(widget_empty)
            start_e = views.index("private static void empty(")
            changed |= set(re.findall(r"setViewVisibility\(R\.id\.(\w+)", views[start_e:views.index("\n    }\n", start_e)]))
        for group in re.findall(r"for \(int id : new int\[\] \{(.*?)\}\) v\.setViewVisibility\(id", body):
            changed |= set(re.findall(r"R\.id\.(\w+)", group))
        assert changed and changed <= set(ids["SHOWN"]) | set(ids["HIDDEN"]), (kind, changed)



def test_map_attribution_reads_on_any_map():
    """동선 지도 위젯 오른쪽 아래 출처 글(text2, card 90% 바탕)이 지도 그림의 어느 색 위에서도 4.5:1 이상(법무 10/31: 작은 위젯·다크에서도 읽혀야 한다.
    OSM 표기 지침이 크기·대비를 본다). 지도 색은 DayMapBitmap 의 LIGHT·DARK·XMAS 전부(핀·길 색 포함)"""
    java = (JAVA / "DayMapBitmap.java").read_text(encoding="utf-8")

    def lum(c: int) -> float:
        ch = [((c >> k) & 255) / 255 for k in (16, 8, 0)]
        r, g, b = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in ch]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    themes = dict(re.findall(r'<color name="(\w+)">#([0-9A-Fa-f]{6,8})</color>', (RES / "values" / "widget_themes.xml").read_text(encoding="utf-8")))
    for folder, table in (("values", "LIGHT"), ("values-night", "DARK"), ("xmas", "XMAS")):  # 크리스마스 한 벌(update78)은 widget_themes.xml 의 _xmas
        if folder == "xmas":
            colors = {k[: -len("_xmas")]: v for k, v in themes.items() if k.endswith("_xmas")}
        else:
            colors = dict(re.findall(r'<color name="(\w+)">#([0-9A-Fa-f]{6,8})</color>', (RES / folder / "colors.xml").read_text(encoding="utf-8")))
        text, bg = int(colors["widget_text2"][-6:], 16), colors["widget_attr_bg"]
        alpha, card = int(bg[:2], 16) / 255, int(bg[-6:], 16)
        base = [int(v, 16) & 0xFFFFFF for v in re.findall(r"0x([0-9A-F]{8})", java[java.index(f"int[] {table} = {{"):java.index("};", java.index(f"int[] {table} = {{"))])]
        assert len(base) > 20
        for m in base:
            mixed = 0
            for k in (16, 8, 0):
                mixed |= round(alpha * ((card >> k) & 255) + (1 - alpha) * ((m >> k) & 255)) << k
            hi, lo = sorted((lum(text), lum(mixed)), reverse=True)
            assert (hi + 0.05) / (lo + 0.05) >= 4.5, (folder, hex(m))

def _res_names(kind: str) -> set[str]:
    if kind == "layout":
        return {p.stem for p in RES.glob("layout*/*.xml")}
    if kind == "drawable":
        return {p.name.split(".")[0] for p in RES.glob("drawable*/*")}
    if kind == "xml":
        return {p.stem for p in (RES / "xml").glob("*.xml")}
    text = "\n".join(p.read_text(encoding="utf-8") for p in RES.glob("values*/*.xml"))
    if kind == "id":
        return set(re.findall(r'@\+id/(\w+)', "\n".join(p.read_text(encoding="utf-8") for p in RES.glob("layout*/*.xml"))))
    if kind == "string":
        return set(re.findall(r'<string name="(\w+)"', text))
    if kind == "array":
        return set(re.findall(r'<string-array name="(\w+)"', text))
    if kind == "color":
        return set(re.findall(r'<color name="(\w+)"', text))
    raise AssertionError(kind)


@pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")
def test_widget_url_opens_day_map():
    """위젯을 누르면 여는 주소(WidgetData.openUrl)를 화면(web/js/app.js 의 navOf)이 같은 뜻으로 읽는다: 학기와 요일(월 0 … 일 6).
    요일이 있으면 그 요일 동선 지도(goNav → routeDay → 동선 확인하기 → 전체 화면 지도, update72)"""
    app = (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")
    tabs = re.search(r"^const TABS = \[.*?\];", app, re.M).group(0)
    nav = re.search(r"^function navOf\(url\) \{.*?^\}", app, re.M | re.S).group(0)
    urls = ["https://x/#tab=mine&sem=2026-2&route=4", "https://x/#tab=mine", "https://x/#tab=mine&sem=2027-W&route=0",
            "https://x/#route=7", "https://x/#tab=mine&route=-1", "https://x/#t=AbC_1", "https://x/", "https://x/#sem=2026-9&route=6"]
    js = f"{tabs}\n{nav}\nconsole.log(JSON.stringify({json.dumps(urls)}.map(navOf)));"
    run = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    no = {"tt": None, "item": None}
    assert json.loads(run.stdout) == [
        {"tab": "mine", "sem": "2026-2", "route": 4, **no}, {"tab": "mine", "sem": None, "route": None, **no},
        {"tab": "mine", "sem": "2027-W", "route": 0, **no}, None, {"tab": "mine", "sem": None, "route": None, **no}, None, None,
        {"tab": None, "sem": None, "route": 6, **no}]
    # 요일이 있으면 지도로 가는 길이 이어져 있다(대표 시간표가 없거나 못 열면 그 탭)
    assert "if (await routeDay(nav.route, nav.sem)) return;" in app and "goMine(() => routeTt(t, { day }));" in app
    assert 'afterResult = day === null ? snack : toMap;' in app and 'go("map");' in app


@pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")
def test_widget_item_url_opens_item_sheet():
    """위젯에서 수업을 누르면 여는 주소(WidgetData.itemUrl, update77)를 화면(navOf)이 같은 뜻으로 읽는다: 학기·시간표 id·항목 열쇠.
    goNav 는 itemNav 로 그 시간표(없으면 대표)를 내 시간표에 띄우고 항목 시트(openItem)를 연다"""
    app = (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")
    tabs = re.search(r"^const TABS = \[.*?\];", app, re.M).group(0)
    nav = re.search(r"^function navOf\(url\) \{.*?^\}", app, re.M | re.S).group(0)
    urls = ["https://x/#tab=mine&sem=2026-2&tt=t1x&item=c123", "https://x/#tab=mine&sem=2026-2&item=L0440.000600-001",
            "https://x/#tab=mine&sem=2026-2&tt=a%26b&item=x%20y", "https://x/#item=" + "a" * 65, "https://x/#item=k1"]
    js = f"{tabs}\n{nav}\nconsole.log(JSON.stringify({json.dumps(urls)}.map(navOf)));"
    run = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    assert json.loads(run.stdout) == [
        {"tab": "mine", "sem": "2026-2", "route": None, "tt": "t1x", "item": "c123"},
        {"tab": "mine", "sem": "2026-2", "route": None, "tt": None, "item": "L0440.000600-001"},
        {"tab": "mine", "sem": "2026-2", "route": None, "tt": None, "item": None},  # 주소에 못 넣는 글은 버린다(내 시간표만)
        None, {"tab": None, "sem": None, "route": None, "tt": None, "item": "k1"}]
    # 앱이 쓰는 열쇠 꼴(WidgetData.safeKey)과 화면이 받는 꼴이 같다
    java = (JAVA / "WidgetData.java").read_text(encoding="utf-8")
    assert 's.matches("[A-Za-z0-9._-]{1,64}")' in java and "/^[A-Za-z0-9._-]{1,64}$/" in nav
    # 항목 시트로 가는 길: 시간표(tt, 없으면 대표)를 띄우고 openItem. 못 열면 그 탭(내 시간표)
    assert "if (await itemNav(nav)) return;" in app and "openItem(nav.item, null);" in app
    assert "list.find((x) => x.id === nav.tt) || list.find((x) => x.primary)" in app
    # 위젯 쪽: 다음 수업의 수업 줄, 오늘 수업의 행, 주간 시간표의 칸(안드로이드 12 이상)이 그 수업의 주소를 연다
    views = (JAVA / "WidgetViews.java").read_text(encoding="utf-8")
    for call in ("v.setOnClickPendingIntent(R.id.w_lecture, openItem(c, t, l));", "r.setOnClickPendingIntent(R.id.r_root, openItem(c, t, l));",
                 "hit.setOnClickPendingIntent(R.id.w_hit, openItem(c, t, l));"):
        assert call in views
    # 자바의 열쇠 꼴 확인: 주소에 넣는 열쇠는 timetables.js itemKey('교과목번호-강좌번호', 직접 넣은 일정 id)가 다 들어간다
    tt = (ROOT / "web" / "js" / "timetables.js").read_text(encoding="utf-8")
    assert "export const itemKey = (it) => (it.custom ? it.custom : `${it.course}-${it.no}`);" in tt
