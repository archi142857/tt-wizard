"""홈 화면 위젯(안드로이드, 10/30): 화면이 만드는 위젯 자료(web/js/timetables.js 의 widgetData), 앱이 그 자료를 읽고 시각마다 무엇을 보일지
(app/android/.../WidgetData.java), 위젯 자원(레이아웃·색·문구·매니페스트)이 서로 맞는지.

- 자료: node 로 tests/widgets_runner.mjs (node 가 없으면 건너뛴다). 걷는 시간·늦음이 동선 확인(engine.checkRoute)과 같은지도 본다.
- 앱 쪽 셈: javac·java 로 WidgetData 와 tests/widget_java(작은 org.json, WidgetCheck)를 돌린다(JDK 가 없으면 건너뛴다).
  같은 자료를 화면이 쓰고 앱이 읽으니 둘의 꼴이 맞는지도 여기서 본다.
- 자원: 파일만 읽는다(늘 돈다).
"""

import json
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
    assert d["keys"] == ["v", "colors", "home", "terms"] and d["v"] == 1 and d["colors"] == "item"
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
    assert d["cls"] == "cls" and d["odd"] == {"v": 1, "colors": "item", "home": "", "terms": []}  # 모르는 학기·빈 칸은 뺀다
    assert d["names"] == [["[생명과학 1]", "A-104"], ["[대학 글쓰기 1]", "B-303"]]  # 이름·강의실 표기는 화면이 준다


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
    assert st["noCampus"] == [None, None] and st["nothing"] == {"v": 1, "colors": "item", "home": "", "terms": []}


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
    assert r["bad"] == [None, None, None, None, None, 0]  # 깨진 자료는 읽지 않는다(날짜가 틀린 학기만 뺀다)
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
    # 누르면 여는 주소: 학기·요일(월 0 … 일 6). 화면이 route 를 읽으면 그 요일 동선 지도
    assert r["url"] == ["https://x/#tab=mine&sem=2026-2&route=4", "https://x/#tab=mine", "https://x/#tab=mine", "https://x/#tab=mine&sem=2027-W&route=0"]
    # 동선 지도 위젯(update71): 그날 구간(출발 지점 → 수업 → … → 출발 지점, 번호는 그날 차례, 돌아가는 길은 0)·핀·걷기 합
    assert r["legs"] == ["HOME>A:1", "A>B:2", "B>HOME:0"] and r["stops"] == ["A:1", "B:2"] and r["dayWalk"] == 12 + 20 + 30
    # 강의실 미정 수업은 자리를 옮기지 않고 번호만 센다, 같은 건물끼리는 걷지 않는다, 출발 지점을 모르면 그 두 구간이 없다, 출발 지점의 건물은 핀이 없다
    assert r["mixedLegs"] == [["H>X:1", "X>Y:4", "Y>H:0"], ["X>Y:4"], ["X>Y:4", "Y>X:0"]]
    assert r["mixedStops"] == [["X:1·3", "Y:4"], ["Y:4"]] and r["mixedWalk"] == 5 + 0 + 7 + 9
    t = r["tiny"]
    assert (t["areas"], t["lines"], t["contours"], t["where"], t["ab"]) == (1, 1, 1, 2, 3)  # 자리가 없는 건물은 뺀다
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
    assert (m["buildings"], m["roads"], m["contours"]) == (len(base["area"]["building"]), len(base["line"]["road"]), len(base["contour"]["index"]))
    assert m["where"] > 100 and m["lines"] == 4 and m["back"] == [False, False, False, True]
    assert sorted(int(n) for part in m["labels"].split("|") for n in part.split("·")) == [1, 2, 3]
    for x, y in m["spots"] + [m["home"]]:  # 핀(반지름 30 화소)이 그림 안: 가장자리 45, 아래는 출처 글 자리 65
        assert 44 <= x <= 756 and 44 <= y <= 266, (x, y)
    assert m["zoom"] <= 17 + 1e-9 and m["mpp"] > 0
    paths = json.loads((ROOT / "data" / "route_paths.json").read_text(encoding="utf-8"))["paths"]
    a, b = m["picks"].split("|")[:2]
    pts = _decode(paths[f"{a}|{b}"]) if f"{a}|{b}" in paths else _decode(paths[f"{b}|{a}"])[::-1]
    assert m["path"][0] == len(pts) and m["path"][1:] == pytest.approx([*pts[0], *pts[-1]], abs=1e-9)  # 앱 자료와 같은 길


def _tokens(css: str, start: str) -> dict:
    i = css.index(start)
    return dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", css[i:css.index("\n}", i)]))


def _resolve(tokens: dict, name: str, base: dict | None = None) -> str:
    value = tokens.get(name, (base or {}).get(name))
    while value and value.startswith("var(--"):
        ref = value[6:-1]
        value = tokens.get(ref, (base or {}).get(ref))
    return value.upper()


def test_widget_colors_follow_web_tokens():
    """위젯 색(values·values-night 의 widget_*, 주간 격자 그림의 색)이 웹 화면의 기본 테마 토큰(라이트·다크)과 같다"""
    css = (ROOT / "web" / "style.css").read_text(encoding="utf-8")
    light = _tokens(css, ":root, .mini.is-light, .mini.is-xmas {")
    dark = _tokens(css, ':root[data-scheme="dark"]:not([data-theme]) {')
    names = {"bg": "card", "text": "text", "text2": "text2", "text3": "text3", "line": "line", "accent": "accent-text",
             "accent_weak": "accent-weak", "danger": "danger"}
    names.update({f"mark_item{i}": f"item-{i}-dot" for i in range(8)})
    names.update({f"mark_{k}": f"cls-{k}" for k in ("req", "elec", "gen", "etc")})
    names.update({f"fill_item{i}": f"item-{i}" for i in range(8)})
    # 동선 지도 위젯의 미리 보기 그림(update71)
    names.update({"map_land": "map-land", "map_green": "map-green", "map_road": "map-road", "map_road_line": "map-road-line",
                  "map_building": "map-building", "route": "route", "pin": "accent", "on_pin": "on-color", "home": "home", "on_home": "on-home"})
    for folder, tokens, base in (("values", light, None), ("values-night", dark, light)):
        colors = dict(re.findall(r'<color name="widget_(\w+)">(#[0-9A-Fa-f]{6})</color>', (RES / folder / "colors.xml").read_text(encoding="utf-8")))
        assert colors.keys() == names.keys(), folder
        for res, token in names.items():
            assert colors[res].upper() == _resolve(tokens, token, base), (folder, res, token)
    java = (JAVA / "WeekBitmap.java").read_text(encoding="utf-8")
    for name, tokens, base in (("LIGHT", light, None), ("DARK", dark, light)):
        body = re.search(rf"static final Ink {name} = new Ink\((.*?)\);", java, re.S).group(1)
        got = ["#" + x[4:] for x in re.findall(r"0xFF[0-9A-F]{6}", body)]
        want = [_resolve(tokens, k, base) for k in ("text", "text2", "text3", "line", "accent-text", "accent-weak")]
        want += [_resolve(tokens, f"item-{i}", base) for i in range(8)] + [_resolve(tokens, f"cls-{k}-bg", base) for k in ("req", "elec", "gen", "etc")]
        assert got == want, name
    # 동선 지도 그림(DayMapBitmap)의 색: TOKENS 차례의 웹 토큰 값(라이트·다크), 출처 글 바탕은 card 90%
    java = (JAVA / "DayMapBitmap.java").read_text(encoding="utf-8")
    order = re.findall(r'"([a-z-]+)"', re.search(r"static final String\[\] TOKENS = \{(.*?)\};", java, re.S).group(1))
    assert "map-building" in order and "route" in order
    for name, tokens, base in (("LIGHT", light, None), ("DARK", dark, light)):
        body = re.search(rf"static final int\[\] {name} = \{{(.*?)\}};", java, re.S).group(1)
        got = ["#" + x[4:] for x in re.findall(r"0xFF[0-9A-F]{6}", body)]
        assert got == [_resolve(tokens, k, base) for k in order], name
    for folder, tokens, base in (("values", light, None), ("values-night", dark, light)):
        attr = re.search(r'<color name="widget_attr_bg">#E6([0-9A-Fa-f]{6})</color>', (RES / folder / "colors.xml").read_text(encoding="utf-8"))
        assert attr and "#" + attr.group(1).upper() == _resolve(tokens, "card", base), folder


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
        for folder in ("layout", "layout-night"):
            path = RES / folder / f"{layout}.xml"
            if path.exists():
                xml = _with_includes(path.read_text(encoding="utf-8"), RES / folder)
                assert [_visibility(xml, v) for v in ids["SHOWN"]] == ["visible"] * len(ids["SHOWN"]), (folder, layout)
                assert [_visibility(xml, v) for v in ids["HIDDEN"]] == ["gone"] * len(ids["HIDDEN"]), (folder, layout)
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
    assert json.loads(run.stdout) == [
        {"tab": "mine", "sem": "2026-2", "route": 4}, {"tab": "mine", "sem": None, "route": None}, {"tab": "mine", "sem": "2027-W", "route": 0},
        None, {"tab": "mine", "sem": None, "route": None}, None, None, {"tab": None, "sem": None, "route": 6}]
    # 요일이 있으면 지도로 가는 길이 이어져 있다(대표 시간표가 없거나 못 열면 그 탭)
    assert "if (await routeDay(nav.route, nav.sem)) return;" in app and "goMine(() => routeTt(t, { day }));" in app
    assert 'afterResult = day === null ? snack : toMap;' in app and 'go("map");' in app
