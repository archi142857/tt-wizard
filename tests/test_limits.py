"""수강 제한 알림: 비고 읽기(scripts/course_limits.py), 일정표, 웹 자료(export_web.export_limits), 태그 고르기(web/js/limits.js).

비고 사례는 2026-2 수강편람 비고에서 옮겨 온 글이다(개인 메일 주소는 꾸민 것). node 가 없으면 태그 쪽은 건너뛴다.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import course_limits as cl  # noqa: E402
import export_web as ew  # noqa: E402

CATALOG = cl.load_catalog()
DEPTS = {
    "생명과학부": "자연과학대학", "물리·천문학부": "자연과학대학", "통계학과": "자연과학대학", "수리과학부": "자연과학대학",
    "경제학부": "사회과학대학", "사회학과": "사회과학대학", "소비자아동학부": "생활과학대학", "의류학과": "생활과학대학",
    "전기·정보공학부": "공과대학", "컴퓨터공학부": "공과대학", "재료공학부": "공과대학", "화학생물공학부": "공과대학",
    "산업공학과": "공과대학", "에너지자원공학과": "공과대학", "약학대학": "약학대학", "국악과": "음악대학", "음악학과": "음악대학", "사범대학": "사범대학",
    "체육교육과": "사범대학", "식품·동물생명공학부": "농업생명과학대학", "첨단융합학부": "첨단융합학부", "학부대학": "학부대학",
}
NAMES = cl.Names(DEPTS, CATALOG)


def pid(name):
    return next(k for k, p in CATALOG["programs"].items() if p["name"] == name)


def uid(name):
    return next(u["id"] for col in CATALOG["colleges"] for u in col["units"] if u["name"] == name)


def parse(remark, dept="생명과학부", term="2026-2"):
    return cl.parse_limit(remark, dept, NAMES, term)


def brief(lim):
    """단계 → (구간, 대상 글) 목록"""
    out = []
    for s in lim["stages"]:
        span = ("days", *s["days"]) if s.get("days") else ("change",) if s.get("change") else \
            ("dates", *s["dates"]) if s.get("dates") else ("rest",) if s.get("rest") else ("always",)
        out.append((span, s.get("until") or s["text"]))
    return out


# ---------------------------------------------------------------- 비고 읽기

def test_mark_none_and_masked_note():
    assert parse("®") == {"kind": "mark"}
    assert parse("ⓔ") is None and parse("") is None and parse("수업 관련 문의: 학부 사무실") is None
    lim = parse("정원 외 신청 및 수업 관련 문의: 홍길동 조교(gildong.hong@gmail.com) / 담당교원에게 정원 외 신청 문의할 경우 승인되지 않습니다. / "
                "수강신청 4일차까지 생명과학부 주전공생만 수강신청가능 / 5일차~6일차에는 생명과학부 주전공 및 제2전공자 수강신청 가능 / "
                "수강신청 변경기간에 수강반 해제")
    assert lim["kind"] == "rule" and "@" not in json.dumps(lim, ensure_ascii=False)
    assert cl.MASK in lim["note"] and "홍길동 조교" in lim["note"]  # 사람 이름은 그대로, 메일만 가림(법무 11/13)
    assert brief(lim) == [(("days", 1, 4), "4일차까지 생명과학부 주전공만"), (("days", 5, 6), "6일차까지 생명과학부만"),
                          (("change",), "누구나")]
    main, anyone = lim["stages"][0]["allow"]["who"][0], lim["stages"][1]["allow"]["who"][0]
    assert main["role"] == "main" and anyone["role"] == "any" and main["units"] == [uid("생명과학부")]


def test_others_barred_college_and_grades():
    lim = parse("®타과생 수강금지", dept="화학생물공학부")
    assert brief(lim) == [(("always",), "화학생물공학부만")]
    lim = parse("®약대 학생만 수강 가능", dept="약학대학")
    w = lim["stages"][0]["allow"]["who"][0]
    assert w["college"] and w["role"] == "main" and brief(lim) == [(("always",), "약학대학만")]
    lim = parse("®사범대학 1학년, 2학년 외 수강불가", dept="사범대학")
    assert lim["stages"][0]["allow"]["grades"] == [1, 2] and brief(lim) == [(("always",), "사범대학 1, 2학년만")]
    lim = parse("재료공학부 주전공, 복수전공, 부전공 3~4학년만 수강신청 가능", dept="재료공학부")
    a = lim["stages"][0]["allow"]
    assert a["grades"] == [3, 4] and a["who"][0]["role"] == "any"
    lim = parse("수강신청 4일차까지 전 대학 1학년 학생만 수강신청 가능하며, 수강신청 5일차부터는 전 대학 전 학년 수강신청 가능", dept="수리과학부")
    assert brief(lim) == [(("days", 1, 4), "4일차까지 1학년만"), (("days", 5, None), "누구나")]
    assert lim["stages"][1]["through_change"] is True


def test_dates_and_except_lists():
    lim = parse("®8/4~8/7 통계학과를 제외한 자연대 소속 1학년만 수강신청 가능 / 8/10~8/11 통계학과를 제외한 자연대 소속 전체 학년 "
                "수강신청 가능 / 수강신청 변경기간에는 통계학과 학생을 제외한 모든 학생 수강신청 가능", dept="통계학과")
    assert brief(lim) == [(("dates", "2026-08-04", "2026-08-07"), "8월 7일까지 자연과학대학 1학년만, 통계학과 제외"),
                          (("dates", "2026-08-10", "2026-08-11"), "8월 11일까지 자연과학대학만, 통계학과 제외"),
                          (("change",), "통계학과 제외")]
    # 'A, B, C를 제외한' 은 셋 다 제외(앞의 둘을 받는 쪽으로 읽으면 다른 학생에게 잘못 '수강 제한'이 붙는다)
    lim = parse("수강신청 1~4일차까지는 의대, 공대,첨단융합학부를 제외한 1학년만 수강신청 가능")
    a = lim["stages"][0]["allow"]
    assert "who" not in a and [e["name"] for e in a["except"]] == ["의과대학", "공과대학", "첨단융합학부"]
    # 자유전공학부 전체가 아니라 '자유전공학부 통계학 주전공' 만
    lim = parse("®통계학과, 자유전공학부 통계학 주전공 학생 수강 불가", dept="통계학과")
    assert [e["name"] for e in lim["stages"][0]["allow"]["except"]] == ["통계학과"]


def test_programs_free_major_and_overlapping_days():
    lim = parse("전공생 우선수강 -수강신청 1~4일차에는 소비자학 주전공생만, 5~6일차에는 소비자학 주전공생/다전공생만, "
                "수강신청변경기간에는 수강반 해제", dept="소비자아동학부")
    assert brief(lim) == [(("days", 1, 4), "4일차까지 소비자학 주전공만"), (("days", 5, 6), "6일차까지 소비자학전공만"),
                          (("change",), "누구나")]
    assert lim["stages"][0]["allow"]["who"][0]["programs"] == [pid("소비자학전공")]
    lim = parse("(수강신청 1~4일) 컴퓨터공학부 주전공(자유전공학부(컴공 주전공) 포함)만 신청 가능 (수강신청 5일차부터) 컴퓨터공학부 "
                "주전공, 컴퓨터공학부 복수전공, 부전공만 신청가능 (수강신청 6일차부터) 전체 학생 신청 가능 (정원내 신청가능)",
                dept="컴퓨터공학부")
    assert brief(lim) == [(("days", 1, 4), "4일차까지 컴퓨터공학부 주전공만"), (("days", 5, None), "컴퓨터공학부만"),
                          (("days", 6, None), "누구나")]
    lim = parse("®첨단융합학부 / 선착순 1일차까지 1학년만 수강신청 가능", dept="물리·천문학부")
    assert brief(lim) == [(("days", 1, 1), "1일차까지 첨단융합학부 1학년만"), (("rest",), "첨단융합학부만")]
    lim = parse("1-4일차: 사회학주전공(사회과학대학 사회학과 및 자유전공학부 소속),복수전공,부전공자 / 5‧6일차: 재학생 전체 수강가능",
                dept="사회학과")
    assert brief(lim) == [(("days", 1, 4), "4일차까지 사회학과만"), (("days", 5, 6), "누구나")]


@pytest.mark.parametrize("remark", [
    "®음대생 수강 불허(국악과만 수강 가능)",  # 막는 말과 받는 말이 섞임
    "4학년 수강불허",  # 학년을 막음
    "<외국인 유학생반>: 글로벌인재특별전형 1유형으로 입학한 학생과 교환 학생만 수강 가능",
    "영화로 보는 뇌과학과 인간/온라인 인터뷰로 수강생 별도 선발(수강신청 시스템에서 신청하지 않음) / 1학년만 수강",
    "®6학기 이상 이수자 수강 가능",
    "(수강신청 1~4일차) 융합데이터과학 주전공+제2전공만 수강신청 가능 (수강신청 1~4일차) 첨단융합학부 주전공+제2전공만 수강신청 가능",
    "®건축학과 제2전공 학생은 5~6일차에 수강신청 가능, 타과생 정원외신청",
])
def test_unsure_remarks_stay_notes(remark):
    lim = parse(remark, dept="음악학과")
    assert lim["kind"] == "note" and lim["note"] == cl.LEAD.sub("", remark).strip()


def test_negatives():
    assert brief(parse("® 음대생 수강불가", dept="국악과")) == [(("always",), "음악대학 제외")]
    lim = parse("®수리과학부 주전공 및 제2전공 수강불허(수리과학부 진입예정자 수강시 전공 불인정)", dept="수리과학부")
    e = lim["stages"][0]["allow"]["except"]
    assert len(e) == 1 and e[0]["role"] == "any" and brief(lim) == [(("always",), "수리과학부 제외")]


# ---------------------------------------------------------------- 일정표

def test_schedule_from_rows():
    rows = [{"type": "장바구니 신청", "start": "2026-07-28", "end": "2026-07-30"},
            {"type": "선착순수강신청", "start": "2026-08-04", "end": "2026-08-07"},
            {"type": "선착순수강신청", "start": "2026-08-10", "end": "2026-08-11"},
            {"type": "신입생 선착순수강신청", "start": "2026-08-20", "end": "2026-08-20"},
            {"type": "수강신청변경", "start": "2026-08-31", "end": "2026-09-04"}]
    s = cl.schedule_of(rows)
    assert s["days"] == {"1": "2026-08-04", "2": "2026-08-05", "3": "2026-08-06", "4": "2026-08-07",
                         "5": "2026-08-10", "6": "2026-08-11"} and s["change"] == ["2026-08-31", "2026-09-04"]
    # 줄마다 하루씩(SNUTT 예시 꼴), 주말은 세지 않는다, 일차가 적혀 있으면 그대로
    one = [{"type": f"선착순수강신청({n}일차)", "start": d, "end": d} for n, d in ((1, "2027-02-01"), (2, "2027-02-02"))]
    assert cl.schedule_of(one)["days"] == {"1": "2027-02-01", "2": "2027-02-02"}
    assert cl.schedule_of([{"type": "선착순수강신청", "start": "2027-02-05", "end": "2027-02-09"}])["days"] == \
        {"1": "2027-02-05", "2": "2027-02-08", "3": "2027-02-09"}
    assert cl.schedule_of([{"type": "수강취소(개강전)", "start": "2026-12-11", "end": "2026-12-21"}]) is None


def test_update_registration_keeps_old_rows(tmp_path):
    path = tmp_path / "registration.json"
    w1 = [{"type": "선착순수강신청", "start": "2026-08-04", "end": "2026-08-07"}]
    w2 = [{"type": "수강신청변경", "start": "2026-08-31", "end": "2026-09-04"}]
    assert cl.update_registration("2026-2", w1, "2026-08-01", path)
    assert cl.update_registration("2026-2", w2, "2026-08-20", path)  # 첫 화면에서 지난 줄이 빠져도 남긴다
    assert not cl.update_registration("2026-2", w2, "2026-08-20", path) and not cl.update_registration("2026-2", [], "x", path)
    data = json.loads(path.read_text(encoding="utf-8"))
    t = data["terms"]["2026-2"]
    assert len(t["rows"]) == 2 and t["collected"] == "2026-08-20" and data["source"] == "서울대학교 수강신청 사이트"


def test_build_shares_rules_and_skips_graduate():
    rows = [{"id": "C1", "no": "001", "college": "자연과학대학", "dept": "생명과학부", "program": "학사", "remark": "®타과생 수강불허"},
            {"id": "C1", "no": "002", "college": "자연과학대학", "dept": "생명과학부", "program": "학사", "remark": "®타과생 수강불허"},
            {"id": "C1", "no": "003", "college": "자연과학대학", "dept": "생명과학부", "program": "학사", "remark": "®"},
            {"id": "C2", "no": "001", "college": "자연과학대학", "dept": "생명과학부", "program": "석사", "remark": "®"},
            {"id": "C3", "no": "001", "college": "자연과학대학", "dept": "생명과학부", "program": "학사", "remark": ""}]
    data = cl.build(rows, "2026-2", "2026-10-12T14:54+09:00", CATALOG)
    assert data["sections"] == {"C1-001": 0, "C1-002": 0, "C1-003": 1} and len(data["rules"]) == 2
    assert data["counts"] == {"rule": 2, "mark": 1, "note": 0} and data["site"] == "https://sugang.snu.ac.kr"
    assert cl.stamp_of(Path("2026-2_2026-10-12_1454.xls")) == "2026-10-12T14:54+09:00"


def test_repo_limits_files():
    """레포의 data/limits/<학기>.json: 개인 메일이 없고 꼴이 맞다"""
    files = sorted((ROOT / "data" / "limits").glob("*.json"))
    assert files
    for f in files:
        text = f.read_text(encoding="utf-8")
        assert "@" not in text
        data = json.loads(text)
        assert data["term"] == f.stem and data["read_at"] and data["rules"]
        assert all(0 <= i < len(data["rules"]) for i in data["sections"].values())
        for r in data["rules"]:
            assert r["kind"] in ("rule", "mark", "note")
            for s in r.get("stages", []):
                assert s["text"] and (s["allow"] is None or isinstance(s["allow"], dict))


def test_export_limits(tmp_path):
    data = tmp_path / "data"
    (data / "limits").mkdir(parents=True)
    rows = [{"id": "C1", "no": "001", "college": "자연과학대학", "dept": "생명과학부", "program": "학사",
             "remark": "수강신청 4일차까지 1학년만 수강신청 가능 / 수강신청 5일차부터 전학년 수강신청 가능"}]
    (data / "limits" / "2026-2.json").write_text(json.dumps(cl.build(rows, "2026-2", None, CATALOG)), encoding="utf-8")
    cl.update_registration("2026-2", [{"type": "선착순수강신청", "start": "2026-08-04", "end": "2026-08-11"},
                                      {"type": "수강신청변경", "start": "2026-08-31", "end": "2026-09-04"}], "2026-08-01",
                           data / "registration.json")
    out = tmp_path / "limits.json"
    got = ew.export_limits(data, out, "2026-2")
    web = json.loads(out.read_text(encoding="utf-8"))
    assert got and web["schedule"]["days"]["5"] == "2026-08-10" and web["schedule"]["collected"] == "2026-08-01"
    assert web["schedule_source"] == "서울대학교 수강신청 사이트" and web["schedule_url"] == "https://sugang.snu.ac.kr"
    assert "\n" not in out.read_text(encoding="utf-8")
    assert ew.export_limits(data, out, "2026-W") is None and not out.exists()  # 지금 학기 규칙이 없으면 옛 파일도 지운다


# ---------------------------------------------------------------- 태그 고르기 (node)

node = pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")
SCHEDULE = {"days": {"1": "2026-08-04", "2": "2026-08-05", "3": "2026-08-06", "4": "2026-08-07", "5": "2026-08-10",
                     "6": "2026-08-11"}, "change": ["2026-08-31", "2026-09-04"], "collected": "2026-08-01"}


def _run(tmp_path, cases):
    for c in cases:
        c.setdefault("catalog", CATALOG)
    (tmp_path / "cases.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    run = subprocess.run(["node", str(ROOT / "tests" / "limits_runner.mjs"), str(tmp_path / "cases.json")],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(run.stdout)


def me(name="동물생명공학전공", year=2025, grade=2, others=()):
    return {"major": {"id": pid(name), "entry": year}, "others": list(others), "year": year, "grade": grade}


@node
def test_date_tag_with_and_without_schedule(tmp_path):
    rule = parse("수강신청 4일차까지 전 대학 1학년 학생만 수강신청 가능하며, 수강신청 5일차부터는 전 대학 전 학년 수강신청 가능", "수리과학부")
    got = _run(tmp_path, [
        {"kind": "tag", "rule": rule, "profile": me(), "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": rule, "profile": me(), "today": "2026-08-09", "schedule": SCHEDULE},  # 4일차 뒤 주말
        {"kind": "tag", "rule": rule, "profile": me(), "today": "2026-08-10", "schedule": SCHEDULE},  # 여는 날엔 태그 없음
        {"kind": "tag", "rule": rule, "profile": me(), "today": "2026-08-01"},  # 일정표가 없으면 일차로
        {"kind": "tag", "rule": rule, "profile": me(grade=1, year=2026), "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": rule, "profile": {**me(), "grade": None}, "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": rule, "profile": None, "today": "2026-08-01"},
    ])
    assert [g["tag"] for g in got] == ["date", "date", None, "date", None, None, None]
    assert got[0]["label"] == "8월 10일부터" and got[0]["text"] == "4일차까지 1학년만" and got[0]["opens"] == "2026-08-10"
    assert got[3]["label"] == "5일차부터"
    assert got[5]["note"] == rule["note"] and got[6]["note"] == rule["note"]  # 학년·학과를 모르면 원문
    assert got[4]["note"] is None and got[2]["note"] is None


@node
def test_limit_year_mark_and_change(tmp_path):
    only = parse("®타과생 수강금지", "화학생물공학부")
    year = parse("®에너지자원공학과 2026학번만 수강 가능", "화학생물공학부")
    staged = parse("수강신청 4일차까지 생명과학부 주전공생만 수강신청가능 / 5일차~6일차에는 생명과학부 주전공 및 제2전공자 수강신청 가능 / "
                   "수강신청 변경기간에 수강반 해제")
    bio = me("생명과학부", 2026, 1)
    second = me(others=[{"kind": "double", "id": pid("생명과학부"), "term": "2026-1"}])
    got = _run(tmp_path, [
        {"kind": "tag", "rule": only, "profile": me()},
        {"kind": "tag", "rule": only, "profile": me("화학생물공학부")},
        {"kind": "tag", "rule": year, "profile": me("에너지자원공학과")},
        {"kind": "tag", "rule": {"kind": "mark"}, "profile": me()},
        {"kind": "tag", "rule": staged, "profile": second, "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": staged, "profile": me(), "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": staged, "profile": me(), "today": "2026-08-01"},
        {"kind": "tag", "rule": staged, "profile": bio, "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": staged, "profile": me(), "today": "2026-09-30", "schedule": SCHEDULE},  # 변경기간 뒤: 마지막 단계
    ])
    assert (got[0]["tag"], got[0]["label"], got[0]["text"]) == ("limit", "수강 제한", "화학생물공학부만")
    assert got[1]["tag"] is None
    assert (got[2]["tag"], got[2]["label"], got[2]["text"]) == ("year", "학번 제한", "에너지자원공학과 2026학번만")
    assert (got[3]["tag"], got[3]["label"], got[3]["text"]) == ("mark", "수강반 제한", None)
    assert (got[4]["label"], got[4]["text"]) == ("8월 10일부터", "4일차까지 생명과학부 주전공만")  # 제2전공은 5일차부터
    assert (got[5]["label"], got[5]["text"]) == ("8월 31일부터", "4일차까지 생명과학부 주전공만")  # 다른 학과는 변경기간부터
    assert got[6]["label"] == "변경기간부터" and got[7]["tag"] is None and got[8]["tag"] is None


@node
def test_overlap_except_programs_and_free_major(tmp_path):
    cs = parse("(수강신청 1~4일) 컴퓨터공학부 주전공(자유전공학부(컴공 주전공) 포함)만 신청 가능 (수강신청 5일차부터) 컴퓨터공학부 "
               "주전공, 컴퓨터공학부 복수전공, 부전공만 신청가능 (수강신청 6일차부터) 전체 학생 신청 가능", "컴퓨터공학부")
    neg = parse("® 음대생 수강불가", "국악과")
    prog = parse("전공생 우선수강 -수강신청 1~4일차에는 소비자학 주전공생만, 5~6일차에는 소비자학 주전공생/다전공생만, "
                 "수강신청변경기간에는 수강반 해제", "소비자아동학부")
    free = {"major": {"id": pid("자유전공학부"), "entry": 2025}, "year": 2025, "grade": 2,
            "others": [{"kind": "major", "id": pid("컴퓨터공학부"), "term": "2026-1"}]}
    undecided = {"major": {"id": uid("소비자아동학부"), "entry": 2026}, "others": [], "year": 2026, "grade": 1}
    got = _run(tmp_path, [
        {"kind": "tag", "rule": cs, "profile": me(), "today": "2026-08-11", "schedule": SCHEDULE},  # 6일차: '6일차부터'가 이김
        {"kind": "tag", "rule": cs, "profile": me(), "today": "2026-08-10", "schedule": SCHEDULE},
        {"kind": "tag", "rule": cs, "profile": free, "today": "2026-08-01", "schedule": SCHEDULE},  # 자유전공학부의 주전공
        {"kind": "tag", "rule": neg, "profile": me("성악과")},
        {"kind": "tag", "rule": neg, "profile": me()},
        {"kind": "tag", "rule": prog, "profile": undecided, "today": "2026-08-01", "schedule": SCHEDULE},  # 전공 미정 → 원문
        {"kind": "tag", "rule": prog, "profile": me("소비자학전공"), "today": "2026-08-01", "schedule": SCHEDULE},
    ])
    assert got[0]["tag"] is None and (got[1]["label"], got[1]["text"]) == ("8월 11일부터", "컴퓨터공학부만")
    assert got[2]["tag"] is None
    assert (got[3]["tag"], got[3]["text"]) == ("limit", "음악대학 제외") and got[4]["tag"] is None
    assert got[5]["tag"] is None and got[5]["note"] == prog["note"] and got[6]["tag"] is None


@node
def test_dates_rule_course_tag_and_texts(tmp_path):
    rule = parse("®8/4~8/7 통계학과를 제외한 자연대 소속 1학년만 수강신청 가능 / 8/10~8/11 통계학과를 제외한 자연대 소속 전체 학년 "
                 "수강신청 가능 / 수강신청 변경기간에는 통계학과 학생을 제외한 모든 학생 수강신청 가능", "통계학과")
    limit = {"tag": "limit", "label": "수강 제한", "opens": None}
    d1 = {"tag": "date", "label": "8월 10일부터", "opens": "2026-08-10"}
    d2 = {"tag": "date", "label": "8월 31일부터", "opens": "2026-08-31"}
    data = {"term": "2026-2", "read_at": "2026-08-04T09:00+09:00", "rules": [rule], "sections": {"326.211-001": 0},
            "schedule": SCHEDULE, "schedule_source": "서울대학교 수강신청 사이트"}
    got = _run(tmp_path, [
        {"kind": "tag", "rule": rule, "profile": me("물리학전공"), "today": "2026-08-01", "schedule": SCHEDULE},
        {"kind": "tag", "rule": rule, "profile": me("물리학전공"), "today": "2026-08-10", "schedule": SCHEDULE},
        {"kind": "tag", "rule": rule, "profile": me(), "today": "2026-08-05"},
        {"kind": "tag", "rule": rule, "profile": me("통계학과"), "today": "2026-08-05", "schedule": SCHEDULE},
        {"kind": "course", "results": [limit, d2, d1]},
        {"kind": "course", "results": [limit, {"tag": "year", "label": "학번 제한"}]},
        {"kind": "course", "results": [{"tag": "year"}, {"tag": "year"}]},
        {"kind": "course", "results": [limit, {"tag": None}]},
        {"kind": "course", "results": [limit, {"tag": "mark"}]},
        {"kind": "lookup", "data": data, "course": "326.211", "section": "001"},
        {"kind": "lookup", "data": data, "course": "326.211", "section": "001", "term": "2026-W"},
        {"kind": "text", "data": data, "results": [d1]},
        {"kind": "text", "data": {}, "results": [limit]},
        {"kind": "today", "now": "2026-08-03T15:30:00Z"},
    ])
    assert (got[0]["label"], got[0]["text"]) == ("8월 10일부터", "8월 7일까지 자연과학대학 1학년만, 통계학과 제외")
    assert got[1]["tag"] is None
    assert (got[2]["label"], got[2]["text"]) == ("변경기간부터", "8월 7일까지 자연과학대학 1학년만, 통계학과 제외")
    assert (got[3]["tag"], got[3]["text"]) == ("limit", "8월 7일까지 자연과학대학 1학년만, 통계학과 제외")
    assert got[4] == {"tag": "date", "label": "8월 10일부터"} and got[5] == {"tag": "limit", "label": "수강 제한"}
    assert got[6] == {"tag": "year", "label": "학번 제한"} and got[7] is None and got[8] is None
    assert got[9] == rule and got[10] is None
    assert got[11] == {"source": "수강편람 비고 · 8월 4일 09:00 기준", "schedule": "서울대학교 수강신청 사이트(8월 1일 기준)",
                       "notice": "수강 제한이 있을 수 있고 날짜는 바뀔 수 있어요. 신청 전에 수강신청 사이트에서 확인해 주세요."}
    assert got[12] == {"source": "수강편람 비고", "schedule": None,
                       "notice": "수강 제한이 있을 수 있어요. 신청 전에 수강신청 사이트에서 확인해 주세요."}
    assert got[13] == "2026-08-04"
