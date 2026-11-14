"""폰 알림(update109, 법무 11/13, 디자인 '폰 알림' 01·02): 편람 알림 자료(web/data/notify.json), 앱의 수업 알림·편람 알림 셈
(ClassAlerts·BookNews 를 javac 로 돌림), 안드로이드 연결(매니페스트·권한·채널·자원)과 native.js 의 TTW_APP.notify.
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

import build_app  # noqa: E402
import export_web as ew  # noqa: E402

ANDROID = ROOT / "app" / "android" / "app" / "src" / "main"
JAVA = ANDROID / "java" / "com" / "ttwizard" / "app"
RES = ANDROID / "res"


def _change(data: Path, stem: str, body: dict) -> None:
    (data / "changes").mkdir(parents=True, exist_ok=True)
    (data / "changes" / f"{stem}.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")


def test_notify_export(tmp_path):
    """바뀜 파일 → 학기·기준 시각·화면 꼴 글. 강의실만·시간만·둘 다·빠짐, 호실 표기만 바뀐 것은 뺀다. 30일 넘은 것과 학기를 모르는 것도 뺀다"""
    data = tmp_path / "data"
    m = lambda d, s, e, b, r: [d, s, e, b, r]  # noqa: E731
    _change(data, "2026-11-13_0008", {"term": "2026-2", "created": [], "deleted": ["X.100-001"], "updated": [
        {"key": "A.1-001", "fields": ["meetings"], "before": {"meetings": [m(0, 540, 615, "81", "81-101"), m(2, 540, 615, "81", "81-101")]},
         "after": {"meetings": [m(0, 540, 615, "83", "83-201"), m(2, 540, 615, "83", "83-201")]}},
        {"key": "B.2-001", "fields": ["meetings"], "before": {"meetings": [m(1, 600, 675, "25", "25-102")]},
         "after": {"meetings": [m(3, 630, 705, "25", "25-102")]}},
        {"key": "C.3-001", "fields": ["meetings", "instructor"], "before": {"meetings": [m(1, 600, 675, "25", "25-102")]},
         "after": {"meetings": [m(4, 780, 855, "301", "301-118(무선랜제공)")]}},
        {"key": "D.4-001", "fields": ["meetings"], "before": {"meetings": [m(1, 600, 675, "2", "2-110(무선랜제공)")]},
         "after": {"meetings": [m(1, 600, 675, "2", "2-110")]}},  # 화면에는 같은 '2동 110호'
        {"key": "E.5-001", "fields": ["instructor"], "before": {"instructor": "가"}, "after": {"instructor": "나"}},
        {"key": "F.6-001", "fields": ["meetings"], "before": {"meetings": []}, "after": {"meetings": [m(0, 540, 615, "", "")]}},
    ]})
    _change(data, "2026-11-05_1541", {"created": [], "deleted": ["Y.200-001"], "updated": []})  # 학기는 stats.csv 의 같은 분 줄
    _change(data, "2026-10-01_1200", {"term": "2026-2", "created": [], "deleted": ["Z.300-001"], "updated": []})  # 30일 넘음
    _change(data, "2026-11-06_1539", {"created": [], "deleted": ["W.400-001"], "updated": []})  # 학기를 모름
    (data / "stats.csv").write_text("timestamp,semester\n2026-11-05T15:41+09:00,2026-W\n", encoding="utf-8")
    out = tmp_path / "notify.json"
    n = ew.export_notify(data, out, [["2026-W", "courses.json"], ["2026-2", "semesters/2026-2.json"]], today="2026-11-14")
    assert json.loads(out.read_text(encoding="utf-8")) == n and "\n" not in out.read_text(encoding="utf-8")
    assert n["v"] == 1 and n["terms"] == [{"id": "2026-W", "name": "2026년 겨울학기"}, {"id": "2026-2", "name": "2026년 2학기"}]
    assert [(c["id"], c["term"], c["basis"]) for c in n["changes"]] == [
        ("2026-11-05_1541", "2026-W", "수강편람 11월 5일 15:41 기준"), ("2026-11-13_0008", "2026-2", "수강편람 11월 13일 00:08 기준")]
    assert n["changes"][0]["sections"] == {"Y.200-001": {"what": "빠짐"}}
    assert n["changes"][1]["sections"] == {
        "A.1-001": {"what": "강의실", "now": "83동 201호", "was": "81동 101호"},
        "B.2-001": {"what": "시간", "now": "목 10:30–11:45", "was": "화 10:00–11:15"},
        "C.3-001": {"what": "시간과 강의실", "now": "금 13:00–14:15 301동 118호", "was": "화 10:00–11:15 25동 102호"},
        "F.6-001": {"what": "시간", "now": "월 09:00–10:15", "was": "시간 미정"},
        "X.100-001": {"what": "빠짐"},
    }
    assert ew.term_name("2027-S") == "2027년 여름학기" and ew.place_text("38", "38-B105(무선랜제공)") == "38동 B105호"
    assert ew.place_text("", "") == "" and ew.place_text("71", "") == "71동" and ew.place_text("71", "71-강당") == "71동 강당"
    assert ew.meetings_text([m(0, 540, 615, "83", "83-201"), m(2, 540, 615, "83", "83-201"), m(4, 600, 650, "83", "83-201")]) == (
        "월·수 09:00–10:15 83동 201호, 금 10:00–10:50 83동 201호")


def test_sync_records_term():
    """sync.py 가 바뀜 파일에 그 학기를 적는다(편람 알림이 어느 학기 바뀜인지 안다)"""
    src = (ROOT / "scripts" / "sync.py").read_text(encoding="utf-8")
    assert 'd["term"] = cb.label' in src
    assert src.index('d["term"] = cb.label') < src.index('(CHANGES / f"{stamp}.json").write_text')


@pytest.mark.skipif(shutil.which("javac") is None or shutil.which("java") is None or shutil.which("node") is None, reason="JDK·node 없음")
def test_alerts_and_book_news(tmp_path):
    """앱의 수업 알림(출발 시각 lead 분 전, 위젯과 같은 걷기·지각, 학사 일정의 수업 없는 날·종강)과 편람 알림(처음엔 알리지 않음, 새 학기, 바뀜 하나·여럿·빠짐)"""
    web = tmp_path / "web"
    assert ew.main(["--data", str(ROOT / "data" / "sample"), "-o", str(web)]) == 0
    data = tmp_path / "widgets.json"
    subprocess.run(["node", str(ROOT / "tests" / "widgets_runner.mjs"), str(web / "campus.json"), str(data)],
                   capture_output=True, text=True, encoding="utf-8", check=True)
    out = tmp_path / "classes"
    sources = [JAVA / n for n in ("WidgetData.java", "RouteMap.java", "ClassAlerts.java", "BookNews.java")]
    sources += sorted((ROOT / "tests" / "widget_java").rglob("*.java"))
    subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(out), *map(str, sources)], check=True, capture_output=True)
    run = subprocess.run(["java", "-cp", str(out), "com.ttwizard.app.NotifyCheck", str(data)], check=True, capture_output=True)
    r = json.loads(run.stdout.decode("utf-8"))
    url = build_app.REMOTE + "#tab=mine&sem=2026-2&tt="
    item = lambda u: re.fullmatch(re.escape(url) + r"[A-Za-z0-9._-]+&item=[A-Za-z0-9._-]+", u) is not None  # noqa: E731  id·열쇠는 만들 때마다 다르다
    assert r["leads"] == [0, 5, 10, 15, 30] and r["lead7"] == 10
    # 월요일 아침: 첫 수업은 출발·도착 지점에서 걷기 12분 → 09:18 출발, 10분 전 알림
    [first] = r["monMorning"]
    assert (first["at"], first["depart"], first["title"], first["text"]) == ("2026-10-26 09:08", "2026-10-26 09:18", "09:18 출발 · 생명과학 1",
                                                                          "09:30 A동 104호 · 걷기 12분") and item(first["url"])
    # 앞 수업에서 걸어서 5분 늦음: 앞 수업이 끝나는 10:45 가 출발
    assert [(a["at"], a["title"], a["text"]) for a in r["afterFirst"]] == [
        ("2026-10-26 10:35", "10:45 출발 · 대학 글쓰기 1", "11:00 B동 303호 · 걷기 20분 · 5분 지각")]
    assert r["dueLate"] == r["afterFirst"] and r["dueStale"] == []  # 알람이 늦어도 출발 뒤 5분까지만
    assert r["holiday"][0]["at"] == "2026-10-28 09:08" and r["termOver"] == []  # 수업 없는 날·종강 뒤
    assert r["leadZero"][0]["at"] == "2026-10-26 09:18"
    assert (r["noRoom"][0]["at"], r["noRoom"][0]["text"]) == ("2027-03-02 09:33", "10:00 A동 · 걷기 12분")
    # 편람 알림
    assert [(w.split("|")[0], w.split("|")[2]) for w in r["watch"]] == [("2026-2", "생명과학 1"), ("2026-2", "대학 글쓰기 1"), ("2026-2", "통계학"),
                                                                       ("2027-1", "물리학 1")]
    assert r["first"] == {"notes": [], "seen": "2026-11-13_0008", "terms": ["2027-1", "2026-2"]}
    term_note, change = r["one"]["notes"]
    assert term_note == {"title": "2027년 여름학기 수강편람이 나왔어요", "text": "", "url": build_app.REMOTE + "#tab=mine&sem=2027-S"}
    assert (change["title"], change["text"]) == ("대학 글쓰기 1 강의실이 바뀌었어요",
                                                 "C동 101호, 전에는 B동 303호 · 수강편람 11월 20일 09:00 기준. 수업 공지도 확인해 주세요") and item(change["url"])
    assert r["one"]["seen"] == "2026-11-20_0900" and r["one"]["terms"] == ["2027-1", "2026-2", "2027-S"]
    assert r["many"]["notes"] == [{"title": "담은 과목 2개가 바뀌었어요", "text": "대학 글쓰기 1 · 통계학 · 수강편람 11월 22일 10:00 기준. 수업 공지도 확인해 주세요",
                                   "url": build_app.REMOTE + "#tab=mine&sem=2026-2"}]
    assert r["gone"]["notes"][0]["title"] == "통계학 분반이 수강편람에서 빠졌어요" and r["bad"] is None


def test_android_notify_wiring():
    """권한은 알림 하나(정확한 알람·부팅 없음), 받는 곳은 밖에서 못 부름, 플러그인 등록, 다시 거는 곳, 채널 둘·잠금 화면 공개 판·자원"""
    manifest = (ANDROID / "AndroidManifest.xml").read_text(encoding="utf-8")
    assert '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />' in manifest
    for perm in ("SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM", "RECEIVE_BOOT_COMPLETED"):
        assert perm not in manifest
    assert '<receiver android:name=".NotifyReceiver" android:exported="false" />' in manifest
    app = (JAVA / "AppActivity.java").read_text(encoding="utf-8")
    assert app.index("registerPlugin(NotifyPlugin.class)") < app.index("super.onCreate(savedInstanceState)")
    plugin = (JAVA / "NotifyPlugin.java").read_text(encoding="utf-8")
    assert '@CapacitorPlugin(name = "TTWNotify"' in plugin and "Manifest.permission.POST_NOTIFICATIONS" in plugin
    for m in ("state", "request", "settings", "update"):
        assert f"public void {m}(PluginCall call)" in plugin
    assert "Settings.ACTION_APP_NOTIFICATION_SETTINGS" in plugin and "@PermissionCallback" in plugin
    n = (JAVA / "Notifier.java").read_text(encoding="utf-8")
    assert 'CLASS = "class"' in n and 'BOOK = "book"' in n
    assert "setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP" in n and "setWindow(AlarmManager.RTC" in n and "setExact" not in n
    assert "setVisibility(NotificationCompat.VISIBILITY_PRIVATE)" in n and ".setPublicVersion(pub)" in n
    assert "R.drawable.ic_stat_tt" in n and "R.color.notify_accent" in n
    assert re.search(r'NOTIFY_URL = "([^"]+)"', n).group(1) == build_app.REMOTE + "data/notify.json"
    assert re.search(r'OPEN_URL = "([^"]+)"', (JAVA / "ClassAlerts.java").read_text(encoding="utf-8")).group(1) == (
        re.search(r'OPEN_URL = "([^"]+)"', (JAVA / "WidgetViews.java").read_text(encoding="utf-8")).group(1))
    assert "Notifier.rearm(getContext())" in (JAVA / "WidgetPlugin.java").read_text(encoding="utf-8")
    assert "Notifier.rearm(context)" in (JAVA / "WidgetUpdater.java").read_text(encoding="utf-8")
    receiver = (JAVA / "NotifyReceiver.java").read_text(encoding="utf-8")
    assert "goAsync()" in receiver and "pending.finish()" in receiver
    strings = (RES / "values" / "strings.xml").read_text(encoding="utf-8")
    want = {"notify_class": "수업 알림", "notify_class_public": "곧 출발 시각", "notify_book": "편람 알림", "notify_book_public": "수강편람 소식"}
    for k, v in want.items():
        assert f'<string name="{k}">{v}</string>' in strings
    assert '<color name="notify_accent">#415FEC</color>' in (RES / "values" / "colors.xml").read_text(encoding="utf-8")
    assert not any("notify_accent" in p.read_text(encoding="utf-8") for p in RES.glob("values-night*/*.xml"))  # 테마와 상관없이
    from PIL import Image
    for d, px in (("mdpi", 24), ("hdpi", 36), ("xhdpi", 48), ("xxhdpi", 72), ("xxxhdpi", 96)):
        im = Image.open(RES / f"drawable-{d}" / "ic_stat_tt.png").convert("RGBA")
        assert im.size == (px, px)
        assert {p[:3] for p in im.getdata() if p[3]} == {(255, 255, 255)}  # 흰 단색(안드로이드가 모양만 쓴다)


def test_native_bridge_notify():
    """TTW_APP.notify 넷과 고를 수 있는 시각(앱의 ClassAlerts.LEADS 와 같다), 위젯 자료를 넘긴 뒤 학사 일정을 넘김"""
    js = (ROOT / "app" / "src" / "native.js").read_text(encoding="utf-8")
    block = js[js.index("if (plugins.TTWNotify) {"):]
    for name in ("state:", "request:", "settings:", "set:"):
        assert name in block
    leads = re.search(r"LEADS: \[([^\]]+)\]", block).group(1)
    java = re.search(r"LEADS = \{ ([^}]+) \}", (JAVA / "ClassAlerts.java").read_text(encoding="utf-8")).group(1)
    assert [int(x) for x in leads.split(",")] == [int(x) for x in java.split(",")]
    assert "app.notifyPeriods(data)" in js and 'import("./ics.js")' in block and 'nativeFetch("data/calendar.json")' in block
