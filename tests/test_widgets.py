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
    assert d["keys"] == ["v", "colors", "terms"] and d["v"] == 1 and d["colors"] == "item"
    assert d["same"]  # 같은 시간표면 같은 글(만든 시각을 넣지 않아 앱 연결·앱이 같은 자료를 거른다)
    assert d["terms"] == [["2026-2", "2026년 2학기", "시간표 1", "2026-09-01", "2026-12-21", 1, [2, 0, 2, 0, 1, 0, 0]],
                          ["2027-1", "2027년 1학기", "봄", "2027-03-01", "2027-06-21", 0, [0, 1, 0, 0, 0, 0, 0]]]
    # 그날 첫 위치 확정 수업은 출발 지점에서(나설 시각을 셀 수 있다), 다음은 앞 수업에서. 쉬는 15분에 20분을 걸으면 5분 늦음
    assert d["monday"] == [["생명과학 1", "A동 104호", 570, 645, 1, "etc", 12, "home", 0],
                           ["대학 글쓰기 1", "B동 303호", 660, 735, 2, "etc", 20, "class", 5]]
    assert d["friday"] == [[1, 12, "home"]]  # 색 번호는 0~7
    assert d["noMinutes"] == [[None, 0], [None, 0]]  # 이동시간을 모르면 걷기를 적지 않는다
    assert d["cls"] == "cls" and d["odd"] == {"v": 1, "colors": "item", "terms": []}  # 모르는 학기·빈 칸은 뺀다
    assert d["names"] == [["[생명과학 1]", "A-104"], ["[대학 글쓰기 1]", "B-303"]]  # 이름·강의실 표기는 화면이 준다


def test_walking_matches_route_check(made):
    """위젯의 걷는 분·늦음 = 동선 확인(engine.checkRoute)의 경로(반올림). 강의실 미정 수업은 자리를 옮기지 않고 쉬는 시간을 보탠다"""
    e = made[0]["engine"]
    assert e["buildings"] and e["same"], (e["fromEngine"], e["fromWidget"])
    assert any(row[3] > 0 for row in e["fromWidget"]) and any(row[2] is None for row in e["fromWidget"])  # 늦는 수업·미정 수업이 다 들어 있다


def test_widget_data_from_device_store(made):
    """앱 연결이 기기에 둔 값만으로 만드는 자료(widgetDataFromStore) = 같은 대표 시간표로 widgetData 를 부른 것.
    대표가 아닌 시간표·끝난 학기는 빼고, 모르는 출발 지점은 자료의 첫 출발 후보, 이동 기준은 둔 값(flat)"""
    st = made[0]["store"]
    assert st["same"] and st["sems"] == [["2099-2", "대표"]] and all(isinstance(w, int) for w in st["walks"])
    assert st["noCampus"] == [None, None] and st["nothing"] == {"v": 1, "colors": "item", "terms": []}


@pytest.mark.skipif(shutil.which("javac") is None or shutil.which("java") is None, reason="JDK 없음")
def test_app_reads_widget_data(made, tmp_path):
    """앱의 WidgetData 가 화면이 만든 자료를 읽고, 시각마다 다음 수업·다시 그릴 때·오늘 행·주간 격자를 맞게 고른다(2026-10-26 은 월요일)"""
    out = tmp_path / "classes"
    sources = [JAVA / "WidgetData.java", *sorted((ROOT / "tests" / "widget_java").rglob("*.java"))]
    subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(out), *map(str, sources)], check=True, capture_output=True)
    run = subprocess.run(["java", "-cp", str(out), "com.ttwizard.app.WidgetCheck", str(made[1])], check=True, capture_output=True)
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


def test_widget_resources_and_manifest():
    """매니페스트의 위젯 셋과 다시 그리는 받는 곳, 위젯 정보, 자바가 쓰는 자원(R.*)이 다 있고, 정확한 알람·부팅 권한은 쓰지 않는다"""
    manifest = (ANDROID / "AndroidManifest.xml").read_text(encoding="utf-8")
    for cls, info in (("NextClassWidget", "widget_next_info"), ("TodayWidget", "widget_today_info"), ("WeekWidget", "widget_week_info")):
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
    """주간 격자는 라이트·다크 두 장을 늘 넣고 layout(-night) 판이 한 장을 보인다(코드는 두 그림의 보이기를 건드리지 않는다)"""
    day = (RES / "layout" / "widget_week.xml").read_text(encoding="utf-8")
    night = (RES / "layout-night" / "widget_week.xml").read_text(encoding="utf-8")
    vis = lambda xml, vid: re.search(rf'android:id="@\+id/{vid}".*?android:visibility="(\w+)"', xml, re.S).group(1)  # noqa: E731
    assert (vis(day, "w_grid_light"), vis(day, "w_grid_dark")) == ("visible", "gone")
    assert (vis(night, "w_grid_light"), vis(night, "w_grid_dark")) == ("gone", "visible")
    strip = lambda xml: re.sub(r"<!--.*?-->|android:visibility=\"\w+\"", "", xml, flags=re.S)  # noqa: E731
    assert strip(day) == strip(night)
    views = (JAVA / "WidgetViews.java").read_text(encoding="utf-8")
    assert not re.search(r"setViewVisibility\(R\.id\.w_grid_(light|dark)", views)


def _visibility(xml: str, vid: str) -> str:
    tag = re.search(rf'<[\w.]+\s[^<>]*android:id="@\+id/{vid}"[^<>]*>', xml).group(0)
    m = re.search(r'android:visibility="(\w+)"', tag)
    return m.group(1) if m else "visible"


def test_widget_views_reset_what_they_change():
    """런처는 같은 레이아웃이면 전에 펼친 화면 위에 바꿈만 다시 얹으므로(update69) 위젯마다 그릴 때 바꾸는 보이기를 다 처음 모양으로 되돌린다.
    되돌리는 목록은 레이아웃 XML 의 처음 보이기와 같고, 그리는 코드가 보이기를 바꾸는 것은 모두 목록에 있다"""
    views = (JAVA / "WidgetViews.java").read_text(encoding="utf-8")
    for kind, layout in (("NEXT", "widget_next"), ("TODAY", "widget_today"), ("WEEK", "widget_week")):
        ids = {k: re.findall(r"R\.id\.(\w+)", re.search(rf"static final int\[\] {kind}_{k} = \{{(.*?)\}};", views).group(1))
               for k in ("SHOWN", "HIDDEN")}
        for folder in ("layout", "layout-night"):
            path = RES / folder / f"{layout}.xml"
            if path.exists():
                xml = path.read_text(encoding="utf-8")
                assert [_visibility(xml, v) for v in ids["SHOWN"]] == ["visible"] * len(ids["SHOWN"]), (folder, layout)
                assert [_visibility(xml, v) for v in ids["HIDDEN"]] == ["gone"] * len(ids["HIDDEN"]), (folder, layout)
        start = views.index(f"static RemoteViews {kind.lower()}(")
        body = views[start:views.index("\n    }\n", start)]
        assert body.index(f"reset(v, {kind}_SHOWN, {kind}_HIDDEN);") < body.index("setOnClickPendingIntent")
        changed = set(re.findall(r"setViewVisibility\(R\.id\.(\w+)", body))
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
