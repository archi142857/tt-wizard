"""캘린더 파일(.ics) 내보내기: 학기 기간 자료(data/calendar/terms.json)와 web/js/ics.js. node 가 없으면 계산 쪽은 건너뛴다."""

import json
import shutil
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CAL = ROOT / "data" / "calendar" / "terms.json"
sys.path.insert(0, str(ROOT / "scripts"))
import export_web as ew  # noqa: E402

node = pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")


def test_calendar_data():
    d = json.loads(CAL.read_text(encoding="utf-8"))
    t = d["terms"]["2026-2"]
    assert (t["start"], t["end"], t["makeup"]) == ("2026-09-01", "2026-12-14", ["2026-12-15", "2026-12-21"])
    days = {x["date"] for x in t["no_class"]}
    assert {"2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09"} <= days and "2026-09-28" not in days
    for term in d["terms"].values():
        assert date.fromisoformat(term["start"]) < date.fromisoformat(term["end"])
        assert all(term["start"] <= x["date"] <= term["end"] for x in term["no_class"])
        assert all(s in d["sources"] for s in term["src"])
    assert all(s["url"].startswith("https://") and s["accessed"] for s in d["sources"].values())


def test_export_calendar(tmp_path):
    assert ew.export_calendar(CAL, tmp_path / "calendar.json") == 1
    text = (tmp_path / "calendar.json").read_text(encoding="utf-8")
    assert "\n" not in text and json.loads(text)["terms"]["2026-2"]["end"] == "2026-12-14"
    assert ew.export_calendar(tmp_path / "없음.json", tmp_path / "x.json") is None


def _run(tmp_path, cases):
    (tmp_path / "cases.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    run = subprocess.run(["node", str(ROOT / "tests" / "ics_runner.mjs"), str(CAL), str(tmp_path / "cases.json")],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(run.stdout)


def _unfold(text):
    """RFC 5545 줄 풀기: CRLF + 공백으로 이어진 줄을 붙인다"""
    assert text.endswith("\r\n") and "\n" not in text.replace("\r\n", "")
    lines = []
    for raw in text.split("\r\n")[:-1]:
        assert len(raw.encode("utf-8")) <= 75, raw
        if raw.startswith(" "):
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _events(lines):
    evs, cur = [], None
    for ln in lines:
        if ln == "BEGIN:VEVENT":
            cur = {}
        elif ln == "END:VEVENT":
            evs.append(cur)
            cur = None
        elif cur is not None:
            k, v = ln.split(":", 1)
            cur[k.split(";")[0]] = v
    return evs


def _occurrences(ev):
    """DTSTART 부터 UNTIL(UTC, 한국 시각 +9)까지 매주, EXDATE 를 뺀 날짜들"""
    first = date(int(ev["DTSTART"][:4]), int(ev["DTSTART"][4:6]), int(ev["DTSTART"][6:8]))
    until = ev["RRULE"].split("UNTIL=")[1]
    last = date(int(until[:4]), int(until[4:6]), int(until[6:8]))  # T145959Z = 그날 23:59:59 KST
    ex = {date(int(x[:4]), int(x[4:6]), int(x[6:8])) for x in ev.get("EXDATE", "").split(",") if x}
    out, d = [], first
    while d <= last:
        if d not in ex:
            out.append(d)
        d += timedelta(days=7)
    return out


def _course(cid, name, sections):
    return [cid, name, "가", 3, "전필", "학사", [[no, "", "", meets] for no, meets in sections]]


@node
def test_build_ics_for_fall_2026(tmp_path):
    """2026-2학기: 월(10/5 대체공휴일 빠짐 14번), 화(9/1 첫날부터 15번), 목(9/24 추석 빠짐 14번), 금(9/25·10/9 빠짐 13번)."""
    courses = [
        _course("458.201", "물리화학 1", [("001", [[0, 540, 615, "302", "105"], [2, 540, 615, "302", "105"]])]),
        _course("M1702.001000", "동물생화학 1; 실험, 이론", [("002", [[1, 600, 675, "200", "B101"], [3, 600, 675, "", ""]])]),
        _course("F11.101", "대학 글쓰기 1", [("011", [[4, 780, 890, "83", "강당"]])]),
        _course("X.1", "시간 없음", [("001", [])]),
    ]
    items = [{"key": "my-1", "title": "동아리 모임", "meetings": [{"day": 4, "start": 1140, "end": 1260, "place": "학생회관"}]}]
    got = _run(tmp_path, [{"kind": "build", "term": "2026-2", "courses": courses, "items": items},
                          {"kind": "build", "term": "2027-1", "courses": courses}])
    r, none = got
    assert none == {"error": "no_term"}
    lines = _unfold(r["text"])
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-1] == "END:VCALENDAR" and "VERSION:2.0" in lines
    assert "BEGIN:VTIMEZONE" in lines and "TZID:Asia/Seoul" in lines and "X-WR-CALNAME:TT Wizard 2026-2" in lines
    evs = _events(lines)
    assert r["events"] == 6 == len(evs)
    by = {(e["SUMMARY"], e["DTSTART"][:8]): e for e in evs}
    mon = by[("물리화학 1", "20260907")]
    wed = by[("물리화학 1", "20260902")]
    tue = by[("동물생화학 1\; 실험\\, 이론", "20260901")]
    thu = by[("동물생화학 1\; 실험\\, 이론", "20260903")]
    fri = by[("대학 글쓰기 1", "20260904")]
    club = by[("동아리 모임", "20260904")]
    assert mon["DTSTART"] == "20260907T090000" and mon["DTEND"] == "20260907T101500" and mon["LOCATION"] == "302동 105호"
    assert len(_occurrences(mon)) == 14 and date(2026, 10, 5) not in _occurrences(mon)
    assert len(_occurrences(wed)) == 15 and len(_occurrences(tue)) == 15
    assert len(_occurrences(thu)) == 14 and date(2026, 9, 24) not in _occurrences(thu) and "LOCATION" not in thu
    assert len(_occurrences(fri)) == 13 and fri["LOCATION"] == "83동 강당" and fri["DESCRIPTION"] == "F11.101 · 011분반"
    assert club["LOCATION"] == "학생회관" and club["DTSTART"].endswith("T190000")
    assert all(e["RRULE"] == "FREQ=WEEKLY;UNTIL=20261214T145959Z" for e in evs)
    assert len({e["UID"] for e in evs}) == 6 and all(e["UID"].endswith("@ttwizard.app") for e in evs)
    assert all(_occurrences(e)[-1] <= date(2026, 12, 14) for e in evs)  # 보강 기간(12/15~21)은 들어가지 않는다
    try:
        import icalendar  # 있으면 남의 해석기로도 읽어 본다
    except ImportError:
        return
    cal = icalendar.Calendar.from_ical(r["text"])
    assert len([c for c in cal.walk("VEVENT")]) == 6


@node
def test_text_helpers(tmp_path):
    long = "SUMMARY:" + "가" * 40
    got = _run(tmp_path, [{"kind": "text", "values": ["a,b;c\\d\ne"], "lines": [long, "SHORT:x"],
                           "places": [{"building": "301", "room": "118"}, {"building": "83", "room": "강당"}, {"building": "500"}, {}],
                           "term": "2026-2", "title": "시간표/1"}])[0]
    assert got["esc"] == ["a\\,b\;c\\\\d\\ne"]
    parts = got["fold"][0].split("\r\n")
    assert all(len(p.encode("utf-8")) <= 75 for p in parts) and parts[1].startswith(" ") and "".join(p.lstrip(" ") if i else p for i, p in enumerate(parts)) == long
    assert got["fold"][1] == "SHORT:x"
    assert got["place"] == ["301동 118호", "83동 강당", "500동", ""]
    assert got["file"] == "TT Wizard 2026-2 시간표_1.ics"
