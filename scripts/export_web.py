"""웹 화면(web/)이 읽는 자료를 만든다: data/ → web/data/.

  python scripts/export_web.py
  python -m http.server 8000 -d web      # 그다음 브라우저에서 http://localhost:8000

출력 (화면과 알고리즘을 잇는 유일한 접점이라 형식을 바꾸면 web/js/ 도 같이 바꾼다)
  web/data/courses.json  과목 → 분반 → 수업(요일, 시작·끝 분, 동, 호실). 논문 과목은 뺀다
  web/data/campus.json   이동시간 행렬(평지 data/travel.csv, 경사 반영 data/travel_slope.csv: 둘 다 우리 경로), 건물 이름·좌표, 출발 후보, 갱신 시각
  web/data/routes.json   지도에 그릴 경로 모양(data/route_paths.json 그대로. 없으면 화면이 직선으로 잇는다)
  web/data/basemap.json  바탕 지도(data/basemap.json 그대로. scripts/basemap.py 가 만든다. 형식은 docs/basemap.md)
  web/data/semesters.json, semesters/<학기>.json
                         학기 선택: 지난 학기 편람(data/history/<학기>.json, 이미 courses.json 형식)과 목록.
                         지금 학기는 courses.json. data/history/ 는 build_history.py(처음 한 번)와 sync.py(학기가 바뀔 때)가 채운다
  web/data/calendar.json 학기 기간·수업 없는 날(data/calendar/terms.json, 캘린더 파일 내보내기 web/js/ics.js, docs/calendar.md)
  web/data/requirements/ 졸업 요건 미리 보기·성적 계산(data/requirements/ 를 줄 바꿈 없이 그대로. 형식은 docs/requirements.md,
                         계산은 web/js/requirements.js). 과정 파일은 고른 과정만 화면이 받는다
  web/data/limits.json   수강 제한 알림: 지금 학기의 분반 규칙(data/limits/<학기>.json, sync.py 가 편람 비고에서 만든다) +
                         그 학기 수강신청 일정표(data/registration.json 의 줄 → 일차별 날짜·변경기간). 계산은 web/js/limits.js,
                         형식은 docs/limits.md. 지금 학기 규칙이 없으면 만들지 않는다
  web/data/notify.json   편람 알림(앱의 폰 알림, update109): 편람이 있는 학기 목록과 최근 30일의 분반 바뀜(data/changes/ 의 시간·강의실 바뀜과
                         빠진 분반, 글은 화면 꼴로). 앱이 가끔 받아 대표 시간표의 과목과 견준다(docs/app.md '폰 알림')

배포(GitHub Actions)에서는 --stamp 를 더 붙여 web/index.html·js/app.js·js/search-worker.js 가 부르는 스타일·스크립트 주소에
?v=<내용 해시> 를 붙인다. GitHub Pages 는 파일을 10분 동안 다시 묻지 않고 쓰게 해서, 주소가 그대로면 배포 직후 새로고침한
화면에 옛 스크립트가 붙는다(새 화면 + 옛 동작). 로컬에서는 붙이지 않는다(붙이면 그 파일들이 바뀐다).

표준 라이브러리만 쓴다(GitHub Actions 에서 따로 설치 없이 돈다).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

from common import console_safe, read_rows

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ttwizard.models import Meeting, merge_duplicate_meetings  # noqa: E402

DATA = ROOT / "data"
OUT = ROOT / "web" / "data"
# 출발·도착 조건의 차례(화면에 이 차례로 나온다: 정문 · 기숙사 · 다른 건물). 기숙사 항목의 동은 화면이 처음 고르는 동이다.
# 같은 이름이 둘이면 자료에 있는 첫 것만 쓴다: 919A 가 없는 자료(data/sample)는 예전처럼 919 한 점
HOMES = [("GATE", "정문"), ("919A", "기숙사"), ("919", "기숙사")]
STAND_IN = {"71-1": "71"}  # 좌표가 없는 지점 → 지도에 대신 찍을 건물(slope_travel.ALIASES 와 같게. 71-1동은 이제 좌표가 있어 쓰이지 않는다)
SKIP_CLASSIFICATION = {"논문"}  # 논문연구 등: 수업 시간이 없어 시간표와 무관


def room_no(room: str) -> str:
    """'38-B105(무선랜제공)' → 'B105', '220-1-201' → '201', '083-302' → '302'."""
    r = re.sub(r"\(.*?\)", "", room or "").strip()
    return r.rsplit("-", 1)[1] if "-" in r else r


def export_courses(lectures: Path) -> dict:
    return courses_from_rows(json.loads(lectures.read_text(encoding="utf-8")))


def courses_from_rows(data: list[dict]) -> dict:
    """lectures.json 형식(분반 목록) → 웹 화면 courses.json 형식(과목 → 분반 → 수업)."""
    courses: dict[str, list] = {}
    for d in data:
        if d.get("classification", "") in SKIP_CLASSIFICATION:
            continue
        meetings = merge_duplicate_meetings(Meeting(**m) for m in d["meetings"])
        c = courses.get(d["course_id"])
        if c is None:
            c = courses[d["course_id"]] = [d["course_id"], d["course_name"], d.get("department", ""),
                                            d.get("credit", 0), d.get("classification", ""), d.get("program", ""), []]
        c[6].append([d["section_no"], d.get("instructor", ""), "" if d.get("status", "설강") == "설강" else d["status"],
                     [[m.day, m.start, m.end, m.building, room_no(m.room)] for m in meetings]])
    for c in courses.values():
        c[6].sort(key=lambda s: s[0])
    return {"fields": {"course": ["id", "name", "dept", "credit", "cls", "program", "sections"],
                       "section": ["no", "instructor", "status", "meetings"],
                       "meeting": ["day", "start", "end", "building", "room"]},
            "courses": sorted(courses.values(), key=lambda c: (c[1], c[0]))}


def read_travel(path: Path) -> dict[tuple[str, str], float]:
    return {(r["from"].strip(), r["to"].strip()): float(r["minutes"]) for r in read_rows(path)}


# 캠퍼스맵이 몇 동을 '관악 223동[우석경제관]' 꼴로 적는다. 화면(지도의 건물 이름, 건물 고르기의 '223동 …')에는 대괄호 안만 쓴다(update85, 11/3
# 사용자: 확대하면 건물 이름이 다 보이게 → 이름이 지도에 많이 나온다). 원본 목록(campus_buildings.csv 등)은 받은 그대로 둔다
CAMPUS_NAME = re.compile(r"^관악\s*[0-9A-Za-z-]+동\s*\[(.+)\]$")


def display_name(name: str) -> str:
    """건물 이름 → 화면에 쓰는 이름: 끝의 괄호 덧말을 빼고, '관악 N동[이름]' 은 대괄호 안만"""
    name = re.sub(r"\s*\(.*\)$", "", name.strip())
    m = CAMPUS_NAME.match(name)
    return m.group(1).strip() if m else name


# 지도 건물 이름을 두 줄로 나눌 자리(디자인 117판 '지도 건물 이름', 11/3). 화면은 폭 120px 를 넘는 이름을 가운데에 가까운 띄어쓰기에서 나누는데,
# 띄어쓰기가 없는 다섯 동은 여기 적은 자리("\n")에서 나눈다. campus.json buildings 의 넷째 값. 줄바꿈을 빼면 화면 이름(display_name)과 같아야
# 화면이 쓴다(이름이 바뀌어 어긋나면 넷째 값을 넣지 않고, tests/test_web.py 가 알린다). 말줄임·짧게 지은 이름은 쓰지 않는다
NAME_BREAKS = {
    "83": "인문사회계\n멀티미디어강의동",
    "84": "근대법학교육\n100주년기념관",
    "105-1": "창업보육센터및\n유전공학연구소",
    "312": "정밀기계연구소\n실험연구동",
    "314": "차세대자동차\n신기술연구소",
}


def export_campus(data: Path) -> dict:
    flat = read_travel(data / "travel.csv")
    slope = read_travel(data / "travel_slope.csv")
    ids = sorted({a for a, _ in flat} | {b for _, b in flat} | {a for a, _ in slope} | {b for _, b in slope},
                 key=lambda b: (not b[0].isdigit(), [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", b)]))

    def dense(table):
        if not table:
            return None
        return [[0 if a == b else (round(table[(a, b)], 2) if (a, b) in table else None) for b in ids] for a in ids]

    # 이름은 캠퍼스맵 목록을 먼저, 좌표는 알고리즘이 쓰는 buildings.csv 를 가장 앞세운다(없는 쌍의 추정에 쓰는 좌표).
    # 마법 지도용 목록은 GATE 처럼 다른 데 없는 지점(근사 좌표)만, 기숙사 동 목록은 좌표는 캠퍼스맵에 없는 동(901동, 919A~D)만 채우고
    # 이름은 가장 앞선다(확인해 고친 이름: 캠퍼스맵은 학부생활관인 906동을 대학원 생활관으로 적는다)
    files = ["campus_buildings.csv", "buildings_elevation.csv", "buildings.csv", "buildings_for_magicmap.csv", "dorm_buildings.csv"]
    names, coords = {}, {}
    for path in ["dorm_buildings.csv"] + files[:-1]:
        for r in read_rows(data / path):
            if r.get("name"):
                names.setdefault(r["building"].strip(), display_name(r["name"]))
    for path in reversed(files):  # 뒤에 읽는 쪽이 우선
        for r in read_rows(data / path):
            if r.get("lat") and r.get("lon"):
                coords[r["building"].strip()] = (round(float(r["lat"]), 6), round(float(r["lon"]), 6))
    for b, other in STAND_IN.items():
        if b not in coords and other in coords:
            coords[b] = coords[other]
    buildings = {b: [names.get(b, ""), *coords[b]] if b in coords else [names.get(b, ""), None, None]
                 for b in sorted(set(names) | set(coords) | set(ids))}
    for b, split in NAME_BREAKS.items():  # [이름, 위도, 경도, 두 줄로 나눈 이름]
        if b in buildings and split.replace("\n", "") == buildings[b][0]:
            buildings[b].append(split)
    state = json.loads((data / "sync_state.json").read_text(encoding="utf-8")) if (data / "sync_state.json").exists() else {}
    homes = {}
    for b, label in HOMES:
        if b in buildings:
            homes.setdefault(label, b)
    return {
        "ids": ids,
        "flat": dense(flat),
        "slope": dense(slope),
        "buildings": buildings,
        "homes": [[b, label] for label, b in homes.items()],
        # 기숙사 동 [동, 종류(학부·대학원·글로벌·가족·BK)]. ids 에 있으면 이동시간이 있다. 919 는 ids 에 없다: 919A~D 네 동이 대신하고,
        # 이 줄은 화면이 919 를 건물 번호로 그리지 않게 남긴다(캠퍼스맵 목록에는 919 한 점이 있다)
        "dorms": [[r["building"].strip(), (r.get("kind") or "").strip()] for r in read_rows(data / "dorm_buildings.csv")
                  if r["building"].strip() in buildings],
        "estimate": {"walk_kmh": 4.0, "detour": 1.35, "default_minutes": 15.0},  # ttwizard/travel.py 와 같은 값
        "meta": {"semester": state.get("lectures_semester") or state.get("semester", ""), "updated": state.get("last_fetch", "")},
    }


TERMS = "1S2W"  # 1학기, 여름, 2학기, 겨울 순


def semester_key(label: str) -> tuple[int, int]:
    """'2026-2' → (2026, 2). 형식이 다르면 맨 뒤로."""
    m = re.fullmatch(r"(\d{4})-([12SW])", label or "")
    return (int(m.group(1)), TERMS.index(m.group(2))) if m else (-1, -1)


def current_semester(data: Path) -> str:
    """lectures.json 이 담고 있는 학기. 새 학기를 감지하고 아직 받기 전에는 state['semester'] 와 다를 수 있다."""
    path = data / "sync_state.json"
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return state.get("lectures_semester") or state.get("semester", "")


def export_semesters(data: Path, out: Path, current: str) -> list[list[str]]:
    """지난 학기(data/history/<학기>.json) → out/semesters/, 목록 → out/semesters.json. 최신 학기가 앞."""
    items = [[current, "courses.json"]]
    history = data / "history"
    for path in sorted(history.glob("*.json")) if history.exists() else []:
        label = path.stem
        if label == current or semester_key(label) == (-1, -1):
            continue
        (out / "semesters").mkdir(exist_ok=True)
        shutil.copyfile(path, out / "semesters" / path.name)
        items.append([label, f"semesters/{path.name}"])
    items.sort(key=lambda it: semester_key(it[0]), reverse=True)
    (out / "semesters.json").write_text(json.dumps({"current": current, "list": items}, ensure_ascii=False,
                                                   separators=(",", ":")), encoding="utf-8")
    return items


WEB = ROOT / "web"
# 주소에 판(?v=)을 붙일 곳: 파일 → 그 안에서 부르는 주소
STAMP_REFS = {
    "index.html": ("style.css", "js/app.js"),
    "js/app.js": ("./engine.js", "./search-worker.js", "./search.js", "./timetables.js"),
    "js/search-worker.js": ("./engine.js",),
}
# 아직 안 부를 수도 있는 주소(0곳이면 건너뛴다): 탐색 워커·과목 검색(search.js)·저장한 시간표(timetables.js)는 화면이 붙이기 전까지 app.js 에 없다
STAMP_OPTIONAL = {("js/app.js", "./search-worker.js"), ("js/app.js", "./search.js"), ("js/app.js", "./timetables.js")}
STAMP_FILES = ("style.css", "js/app.js", "js/engine.js", "js/search-worker.js", "js/search.js", "js/timetables.js")  # 이 파일들 내용이 바뀌면 판이 바뀐다


def export_requirements(src: Path, out: Path) -> tuple[int, int] | None:
    """졸업 요건 자료를 줄 바꿈 없이 옮긴다: index.json, common.json, course_map.json, ge_credits.json, programs/<id>.json"""
    if not (src / "index.json").exists():
        return None
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    (out / "programs").mkdir(parents=True, exist_ok=True)
    for name in ("index.json", "catalog.json", "common.json", "course_map.json", "ge_credits.json"):
        if (src / name).exists():
            data = json.loads((src / name).read_text(encoding="utf-8"))
            (out / name).write_text(json.dumps(data, **compact), encoding="utf-8")
    files = sorted((src / "programs").glob("*.json"))
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        (out / "programs" / f.name).write_text(json.dumps(data, **compact), encoding="utf-8")
    index = json.loads((src / "index.json").read_text(encoding="utf-8"))
    return len(index["programs"]), len(files)


def export_limits(data: Path, out: Path, term: str, calendar: Path | None = None) -> dict | None:
    """지금 학기 수강 제한 규칙 + 일정표 → web/data/limits.json(줄 바꿈 없이). 규칙이 없으면 옛 파일을 지우고 None"""
    import course_limits as cl  # 표준 라이브러리만 쓰는 쪽(엑셀을 읽는 함수는 부르지 않는다)

    src = data / "limits" / f"{term}.json"
    if not term or not src.exists():
        if out.exists():
            out.unlink()
        return None
    limits = json.loads(src.read_text(encoding="utf-8"))
    holidays: set[str] = set()
    if calendar and calendar.exists():
        for t in (json.loads(calendar.read_text(encoding="utf-8")).get("terms") or {}).values():
            holidays.update(d["date"] for d in t.get("no_class", []))
    reg_path = data / "registration.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {}
    t = (reg.get("terms") or {}).get(term)
    schedule = cl.schedule_of(t["rows"], holidays) if t else None
    if schedule is not None:
        schedule["collected"] = t.get("collected")
    limits["schedule"] = schedule
    limits["schedule_source"] = reg.get("source", "서울대학교 수강신청 사이트")
    limits["schedule_url"] = reg.get("url", cl.SITE)
    out.write_text(json.dumps(limits, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return limits


NOTIFY_DAYS = 30  # 편람 알림 자료에 남기는 바뀜(앱은 마지막으로 본 바뀜 뒤 것만 알린다)
NOTIFY_TERMS = 6  # 편람 알림 자료의 학기 목록(새 학기가 나왔는지 보는 데 쓴다)
DAY_KO = "월화수목금토일"
TERM_NAMES = {"1": "1학기", "S": "여름학기", "2": "2학기", "W": "겨울학기"}


def term_name(label: str) -> str:
    """'2027-1' → '2027년 1학기'(web/js/timetables.js termLabel 과 같다)"""
    y, _, k = str(label).partition("-")
    return f"{y}년 {TERM_NAMES[k]}" if k in TERM_NAMES else str(label)


def place_text(building: str, room: str) -> str:
    """화면 강의실 꼴(web/js/ics.js placeOf): 301동 118호, 호수가 글이면 '301동 강당', 강의실이 없으면 '301동', 동도 없으면 """""
    if not building:
        return ""
    r = room_no(room)
    if not r:
        return f"{building}동"
    return f"{building}동 {r}호" if re.match(r"[A-Za-z]?\d", r) else f"{building}동 {r}"


def _hm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def meetings_text(meetings: list, *, time: bool = True, place: bool = True) -> str:
    """수업들 → '월·수 10:30–11:45 83동 201호'. 같은 시각·같은 곳은 요일을 묶는다. time=False 면 곳만('83동 201호 · 81동 101호').
    수업이 없으면 '시간 미정', 곳이 없으면 '강의실 미정'"""
    if not time:
        places = []
        for m in meetings:
            p = place_text(m[3], m[4])
            if p and p not in places:
                places.append(p)
        return " · ".join(places) or "강의실 미정"
    if not meetings:
        return "시간 미정"
    groups: list[list] = []
    for day, start, end, building, room in sorted(meetings, key=lambda m: (m[1], m[2], m[0])):
        key = (start, end, place_text(building, room) if place else "")
        for g in groups:
            if g[0] == key:
                g[1].append(day)
                break
        else:
            groups.append([key, [day]])
    groups.sort(key=lambda g: (min(g[1]), g[0][0]))
    return ", ".join(f"{'·'.join(DAY_KO[d] for d in sorted(days))} {_hm(s)}–{_hm(e)}{' ' + p if p else ''}" for (s, e, p), days in groups)


def section_change(before: list, after: list) -> dict | None:
    """분반 하나의 수업 바뀜 → {what: 시간|강의실|시간과 강의실, now, was}. 화면에 보이는 곳·시각이 같으면(호실 표기만 바뀜) None"""
    times = lambda ms: sorted((m[0], m[1], m[2]) for m in ms)  # noqa: E731
    places = lambda ms: sorted({place_text(m[3], m[4]) for m in ms} - {""})  # noqa: E731  곳이 없는 수업은 곳 바뀜으로 치지 않는다
    t, p = times(before) != times(after), places(before) != places(after)
    if t and p:
        return {"what": "시간과 강의실", "now": meetings_text(after), "was": meetings_text(before)}
    if t:
        return {"what": "시간", "now": meetings_text(after, place=False), "was": meetings_text(before, place=False)}
    if p:
        return {"what": "강의실", "now": meetings_text(after, time=False), "was": meetings_text(before, time=False)}
    return None


def export_notify(data: Path, out: Path, semesters: list, today: str | None = None) -> dict:
    """편람 알림 자료 → web/data/notify.json(줄 바꿈 없이). 바뀜 파일의 학기는 파일 안 term(sync.py update109 부터), 없으면 같은 분의 stats.csv 줄"""
    from datetime import date, timedelta

    stats: dict[str, str] = {}
    stats_path = data / "stats.csv"
    if stats_path.exists():
        for row in read_rows(stats_path):
            ts = (row.get("timestamp") or "")[:16]
            if ts:
                stats[ts] = row.get("semester") or ""
    since = (date.fromisoformat(today) if today else date.today()) - timedelta(days=NOTIFY_DAYS)
    changes = []
    for f in sorted((data / "changes").glob("*.json")):
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})", f.stem)
        if not m or date(int(m[1]), int(m[2]), int(m[3])) < since:
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        term = d.get("term") or stats.get(f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}", "")
        if not term:
            continue
        sections = {}
        for u in d.get("updated") or []:
            if "meetings" in (u.get("fields") or []):
                c = section_change(u["before"]["meetings"], u["after"]["meetings"])
                if c:
                    sections[u["key"]] = c
        for key in d.get("deleted") or []:
            sections[key] = {"what": "빠짐"}
        if sections:
            changes.append({"id": f.stem, "term": term, "basis": f"수강편람 {int(m[2])}월 {int(m[3])}일 {m[4]}:{m[5]} 기준",
                            "sections": sections})
    terms = [{"id": label, "name": term_name(label)} for label, _ in semesters[:NOTIFY_TERMS] if label]
    notify = {"v": 1, "terms": terms, "changes": changes}
    out.write_text(json.dumps(notify, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return notify


FIREBASE_KEYS = ("apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "googleClientId")


def write_firebase_config(raw: str | None, path: Path) -> bool:
    """로그인(update110): GitHub 변수 FIREBASE_WEB_CONFIG(JSON, 콘솔의 웹 앱 구성 + googleClientId)로 web/js/firebase-config.js 를 채운다.
    값이 없거나 깨졌으면 손대지 않는다(저장소의 null 그대로 → 로그인이 숨는다). 저장소에는 이 값을 넣지 않는다(사용자 규칙: 키는 저장소 밖)"""
    if not raw:
        return False
    text = re.sub(r"^\s*(?:const|let|var)\s+\w+\s*=\s*", "", raw.strip()).rstrip(";").strip()  # 콘솔의 'const firebaseConfig = {…};' 를 그대로 붙여도 된다
    try:
        cfg = json.loads(text)
    except json.JSONDecodeError:
        try:  # 따옴표 없는 열쇠(JS 꼴) → JSON
            cfg = json.loads(re.sub(r",\s*}", "}", re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', text)))
        except json.JSONDecodeError:
            return False
    if not isinstance(cfg, dict) or not cfg.get("apiKey") or not cfg.get("projectId"):
        return False
    keep = {k: str(cfg[k]) for k in FIREBASE_KEYS if cfg.get(k)}
    path.write_text("// 배포 때 export_web.py 가 GitHub 변수 FIREBASE_WEB_CONFIG 로 쓴 파일(저장소에는 null)\n"
                    f"export default {json.dumps(keep, ensure_ascii=False)};\n", encoding="utf-8")
    return True


def export_calendar(src: Path, out: Path) -> int | None:
    """학기 기간·수업 없는 날(data/calendar/terms.json) → web/data/calendar.json(줄 바꿈 없이). 학기 수를 돌려준다"""
    if not src.exists():
        return None
    data = json.loads(src.read_text(encoding="utf-8"))
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(data.get("terms") or {})


def stamp_assets(web: Path = WEB) -> str:
    """index.html·app.js·search-worker.js 가 부르는 스타일·스크립트 주소에 ?v=<STAMP_FILES 내용 해시 8자리> 를 붙인다.

    여러 번 해도 같다(이미 붙은 ?v= 는 빼고 해시한 뒤 바꿔 쓴다). 줄바꿈은 건드리지 않는다. 판을 돌려준다.
    """
    h = hashlib.sha256()
    for name in STAMP_FILES:
        h.update(re.sub(rb"\?v=[0-9a-f]+", b"", (web / name).read_bytes()))
    v = h.hexdigest()[:8]
    for name, refs in STAMP_REFS.items():
        path = web / name
        text = path.read_bytes().decode("utf-8")
        for ref in refs:
            text, n = re.subn(rf'(["\']){re.escape(ref)}(?:\?v=[0-9a-f]+)?\1', rf"\g<1>{ref}?v={v}\g<1>", text)
            if n != 1 and not (n == 0 and (name, ref) in STAMP_OPTIONAL):
                raise SystemExit(f"{path}: '{ref}' 을 부르는 곳이 {n}곳이다(한 곳이어야 판을 붙인다)")
        path.write_bytes(text.encode("utf-8"))
    return v


def main(argv: list[str] | None = None) -> int:
    console_safe()
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(DATA))
    ap.add_argument("-o", "--output", default=str(OUT))
    ap.add_argument("--requirements", default=str(DATA / "requirements"), help="졸업 요건 자료 폴더(없으면 건너뛴다)")
    ap.add_argument("--calendar", default=str(DATA / "calendar" / "terms.json"), help="학기 기간 자료(없으면 건너뛴다)")
    ap.add_argument("--stamp", action="store_true",
                    help="배포용: web/index.html·js/*.js 의 스타일·스크립트 주소에 ?v=<내용 해시> 를 붙인다(파일이 바뀐다)")
    args = ap.parse_args(argv)
    data, out = Path(args.data), Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    courses = export_courses(data / "lectures.json")
    campus = export_campus(data)
    courses["meta"] = campus["meta"]
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    (out / "courses.json").write_text(json.dumps(courses, **compact), encoding="utf-8")
    (out / "campus.json").write_text(json.dumps(campus, **compact), encoding="utf-8")
    routes = data / "route_paths.json"
    if routes.exists():
        shutil.copyfile(routes, out / "routes.json")
    else:
        (out / "routes.json").write_text('{"ids":[],"paths":{}}', encoding="utf-8")
    basemap = data / "basemap.json"
    if basemap.exists():
        shutil.copyfile(basemap, out / "basemap.json")
    semesters = export_semesters(data, out, campus["meta"]["semester"])
    reqs = export_requirements(Path(args.requirements), out / "requirements")
    terms = export_calendar(Path(args.calendar), out / "calendar.json")
    limits = export_limits(data, out / "limits.json", campus["meta"]["semester"], Path(args.calendar))
    notify = export_notify(data, out / "notify.json", semesters)
    firebase = write_firebase_config(os.environ.get("FIREBASE_WEB_CONFIG"), WEB / "js" / "firebase-config.js")

    n_sec = sum(len(c[6]) for c in courses["courses"])
    print(f"저장: {out}")
    print(f"  courses.json  과목 {len(courses['courses']):,}개 · 분반 {n_sec:,}개"
          f" ({(out / 'courses.json').stat().st_size / 1e6:.2f} MB)")
    print(f"  campus.json   지점 {len(campus['ids'])}개 · 평지 {'있음' if campus['flat'] else '없음'}"
          f" · 경사 반영 {'있음' if campus['slope'] else '없음'} · 건물 {len(campus['buildings'])}개")
    print(f"  routes.json   {'data/route_paths.json 복사' if routes.exists() else '없음 → 직선으로 표시'}")
    print(f"  basemap.json  {f'data/basemap.json 복사 ({basemap.stat().st_size / 1e3:.0f} KB)' if basemap.exists() else '없음'}")
    print(f"  semesters.json 학기 {len(semesters)}개 ({semesters[0][0] or '학기 모름'}"
          f"{' ~ ' + semesters[-1][0] if len(semesters) > 1 else ''})")
    print(f"  requirements/  {f'과정 목록 {reqs[0]}개 · 과정 파일 {reqs[1]}개' if reqs else '없음'}")
    print(f"  calendar.json  {f'학기 {terms}개' if terms else '없음'}")
    if limits:
        c = limits.get("counts", {})
        sched = limits.get("schedule") or {}
        print(f"  limits.json    {limits['term']} 규칙 {c.get('rule', 0)} · 기호만 {c.get('mark', 0)} · 원문 {c.get('note', 0)}"
              f" · 일정표 {'일차 ' + str(len(sched.get('days', {}))) + '일' if sched.get('days') else '없음'}"
              f"{' · 변경기간 ' + '~'.join(sched['change']) if sched.get('change') else ''}")
    else:
        print("  limits.json    없음(지금 학기 규칙이 없다)")
    print(f"  firebase-config.js {'GitHub 변수로 채움' if firebase else '그대로(로그인 숨김)'}")
    print(f"  notify.json    학기 {len(notify['terms'])}개 · 바뀜 {len(notify['changes'])}번(최근 {NOTIFY_DAYS}일)")
    if args.stamp:
        print(f"  화면 파일 주소에 판 ?v={stamp_assets()} 를 붙임 (index.html, js/app.js, js/search-worker.js)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
