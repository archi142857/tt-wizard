"""졸업 요건 자료(data/requirements/)가 바른 꼴인지, 계산(web/js/requirements.js)이 학교 규칙대로 도는지. node 가 없으면 계산 쪽은 건너뛴다."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "data" / "requirements"
sys.path.insert(0, str(ROOT / "scripts"))
import export_web as ew  # noqa: E402
import requirements_import as ri  # noqa: E402

STATUS = {"확인", "부분", "미확인", "충돌"}
PILOTS = ("animal-biotech", "life-sciences", "chem-bio-eng")


def load(name):
    return json.loads((REQ / name).read_text(encoding="utf-8"))


def programs():
    return {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted((REQ / "programs").glob("*.json"))}


# ---------------------------------------------------------------- 자료 꼴

def test_index_lists_every_program_once():
    idx = load("index.json")
    ids = [p["id"] for p in idx["programs"]]
    assert len(ids) == len(set(ids)) and len(ids) >= 150
    assert idx["cohorts"] == [2019, 2026]
    have = {p["id"] for p in idx["programs"] if p["data"]}
    assert have == set(programs()) == set(ids) and set(PILOTS) <= have  # update101: 모든 과정
    for p in idx["programs"]:
        assert p["college"] and p["unit"] and p["program"] and p["kind"] in ("major", "multi")
        assert p["exists_for"] is None or p["exists_for"][0] <= p["exists_for"][1]  # 1차에만 있는 다전공은 모름
        assert p["version_key"] in ("entry", "selection")
    # 학부 안에서 나뉘는 구조가 목록에 있다(예: 식품·동물생명공학부 → 두 전공)
    split = next(p for p in idx["programs"] if p["program"] == "동물생명공학전공")
    assert "동물생명공학" in "·".join(split["splits_into"]) and split["data"]


def test_programs_cover_cohorts_and_reference_sources():
    for pid, p in programs().items():
        span = p["exists_for"] or [min(v["entry_years"][0] for v in p["versions"]), max(v["entry_years"][1] for v in p["versions"])]
        lo, hi = max(2019, span[0]), min(2026, span[1])
        seen = {}
        for v in p["versions"]:
            a, b = v["entry_years"]
            for y in range(a, b + 1):
                seen[y] = seen.get(y, 0) + 1
            assert v["status"] in STATUS and v["credits"]["status"] in STATUS
            ids = [r["id"] for r in v["requirements"]]
            assert len(ids) == len(set(ids)), (pid, v["entry_years"])
            for r in v["requirements"]:
                assert r["status"] in STATUS and r["type"] and isinstance(r["courses"], list)
                assert all(s in p["sources"] for s in r["src"]), (pid, r["id"])
                for c in r["courses"]:
                    assert c["code"] and isinstance(c["code"], str)
            for k in ("grad", "ge", "single", "parallel", "double", "minor"):
                assert v["credits"][k] is None or isinstance(v["credits"][k], int)
        assert all(seen.get(y) == 1 for y in range(lo, hi + 1)), (pid, seen)
        assert all(s.get("url", "").startswith("http") or s.get("repo") for s in p["sources"].values())


def test_ge_credits_match_official_table():
    """판마다 교양 학점 = 학부대학 해마다 교양 이수규정의 '교양 N학점 이상'(2019~2026). 표에 없는 학번·과정(다전공, 본과)은 건너뛴다."""
    table = load("ge_credits.json")["table"]
    checked = 0
    for pid, p in programs().items():
        if p["ge_key"] is None:
            assert p["kind"] == "multi" or p["program"].startswith(("수의학과", "의학과", "공과대학 광역", "학부대학 광역", "융합학습", "혁신공유")) \
                or "편입" in p["program"], pid
            continue
        row = table[p["ge_key"]]
        for v in p["versions"]:
            for y in range(v["entry_years"][0], v["entry_years"][1] + 1):
                if str(y) in row and v["credits"]["ge"] is not None:
                    assert v["credits"]["ge"] == row[str(y)], (pid, p["program"], y)
                    checked += 1
    assert checked >= 700


def test_common_rules():
    c = load("common.json")
    assert c["grade_points"]["A+"] == 4.3 and c["grade_points"]["F"] == 0
    assert c["graduation"] == {"credits_min": 130, "ge_min": 36, "major_min": 39, "gpa_min": 2.0, "major_gpa_min": 2.0}
    t = c["term_limit"]
    assert t["default"] == 18 and t["plus"]["limit"] == 21 and t["warning_limit"] == 15
    assert {"E51.101", "F31.101"} <= set(t["exempt_codes"])
    assert c["seasonal"] == {"summer": 9, "winter": 6} and c["multi_overlap"]["max_courses"] == 3
    assert all(r["status"] in STATUS for r in c["rules"])


def test_course_map_pairs_old_and_new_numbers():
    rows = load("course_map.json")["rows"]
    assert len(rows) > 500
    writing = next(r for r in rows if r.get("2024", {}).get("code") == "L0440.000600")
    assert writing["2025"]["code"] == "F11.101" and writing["2026"]["code"] == "F11.101"


def test_animal_biotech_cohorts():
    """동물생명공학전공: 2019~2020학번은 생화학 1·2(300.312·300.313), 2021학번부터 동물생화학 1·2."""
    p = programs()["animal-biotech"]
    new, old = p["versions"]
    assert new["entry_years"] == [2021, 2026] and old["entry_years"] == [2019, 2020]
    codes = lambda v: {c["code"] for r in v["requirements"] if r["id"] == "animal-main-core" for c in r["courses"]}
    assert {"M1702.001000", "M1702.001100"} <= codes(new) and not {"300.312", "300.313"} & codes(new)
    assert {"300.312", "300.313"} <= codes(old)
    assert p["depts"] == ["식품·동물생명공학부"] and p["code_prefixes"] == ["5252.", "M1702."]


def test_derived_depts_match_pilots():
    """시범 셋은 손으로 적은 학과·번호 앞자리, 나머지는 지난 편람에서 유도한다. 유도한 값이 손으로 적은 것과 같아야 한다."""
    ps = programs()
    got = ri.derive_depts(list(ps.values()), ri.course_depts(ri.HISTORY))
    for pid in PILOTS:
        assert got[pid] == (ps[pid]["depts"], ps[pid]["code_prefixes"]), pid
    food = next(p for p in ps.values() if p["program"] == "식품생명공학전공")
    assert food["depts"] == ["식품·동물생명공학부"] and {"5251.", "M1701."} <= set(food["code_prefixes"])
    assert not {"5252.", "M1702."} & set(food["code_prefixes"])
    assert all(not p["depts"] for p in ps.values() if p["kind"] == "multi")
    assert sum(bool(p["depts"]) for p in ps.values() if p["kind"] == "major") >= 100


def test_selection_and_single_round_programs():
    """선발 시기로 판이 갈리는 다전공, 1차에만 있는 연합·연계전공, 2차에만 있는 옛 학과."""
    ps = {p["program"]: p for p in programs().values()}
    sd = ps["학생설계전공(복수전공)"]
    assert sd["version_key"] == "selection" and sorted(v["entry_years"] for v in sd["versions"]) == [[2019, 2021], [2022, 2026]]
    ai = next(p for p in programs().values() if p["unit"] == "연합전공" and p["program"] == "인공지능")
    assert ai["kind"] == "multi" and ai["version_key"] == "selection" and ai["exists_for"] is None
    assert [v["entry_years"] for v in ai["versions"]] == [[2025, 2026]] and ai["versions"][0]["requirements"]
    old = ps["국사학과"]
    assert old["exists_for"] == [2019, 2022] and old["versions"][0]["requirements"] and old["version_key"] == "entry"


# ---------------------------------------------------------------- 가져오기(차이 적용)

def test_apply_diff_and_cover():
    warn = []
    newer = [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}, {"id": "c", "text": "C"}]
    got = ri.apply_diff(newer, {"replace": [{"id": "b", "text": "B0"}, {"id": "z", "text": "Z"}], "remove": ["c", "q"],
                                "add": [{"id": "d", "text": "D"}]}, warn, "t")
    assert [r["id"] for r in got] == ["a", "b", "z", "d"] and got[1]["text"] == "B0"
    assert len(warn) == 2  # 위 판에 없는 z 를 바꾸려 함, 없는 q 를 빼려 함
    warn = []
    ri.check_cover([{"entry_years": [2021, 2026]}, {"entry_years": [2019, 2019]}], [2019, 2026], "t", warn)
    assert warn and "2020" in warn[0]


def test_export_requirements(tmp_path):
    n = ew.export_requirements(REQ, tmp_path / "requirements")
    assert n == (len(load("index.json")["programs"]), len(programs()))
    for name in ("index.json", "common.json", "course_map.json", "ge_credits.json", "programs/life-sciences.json"):
        text = (tmp_path / "requirements" / name).read_text(encoding="utf-8")
        assert "\n" not in text.strip() and json.loads(text)
    assert ew.export_requirements(tmp_path / "없음", tmp_path / "x") is None


# ---------------------------------------------------------------- 계산 (node)

def _run(tmp_path, cases):
    (tmp_path / "cases.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    run = subprocess.run(["node", str(ROOT / "tests" / "requirements_runner.mjs"), str(REQ), str(tmp_path / "cases.json")],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(run.stdout)


def _req(pid, rid, version=0):
    v = programs()[pid]["versions"][version]
    return next(r for r in v["requirements"] if r["id"] == rid)


def _rec(c, term="2025-1", **kw):
    return {"code": c["code"], "name": c["name"], "credits": c["credits"], "cls": "전필", "dept": "화학생물공학부",
            "term": term, "status": "taken", **kw}


node = pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")


@node
def test_pick_version_and_same_course(tmp_path):
    got = _run(tmp_path, [
        {"kind": "pick", "program": "animal-biotech", "entryYear": 2020},
        {"kind": "pick", "program": "animal-biotech", "entryYear": 2026},
        {"kind": "pick", "program": "animal-biotech", "entryYear": 2018},
        {"kind": "pick", "program": "life-sciences", "entryYear": 2025},
        {"kind": "same", "codes": ["L0440.000600", "F11.101", "458.201"]},
    ])
    assert got[0] == [2019, 2020] and got[1] == [2021, 2026] and got[2] == "no_data" and got[3] == [2025, 2025]
    a, b, c = got[4]
    assert a == b and c == "458.201"  # 대학 글쓰기 1 옛 번호와 새 번호는 같은 과목


@node
def test_tidy_records(tmp_path):
    """재수강은 옛 수강을 빼고, 표시 없이 두 번이면 확인 필요, W·드랍·학사에 안 넣는 대학원 과목은 셈에서 뺀다."""
    r = lambda code, term, **kw: {"code": code, "credits": 3, "cls": "전선", "dept": "가", "term": term, "status": "taken", **kw}
    got = _run(tmp_path, [{"kind": "tidy", "records": [
        r("X", "2025-1"), r("X", "2025-2"),
        r("Y", "2025-1", status="failed", grade="F"), r("Y", "2026-1", status="retake"),
        r("Z", "2025-2", status="dropped"),
        r("G", "2026-1", level="석사"), r("H", "2026-1", level="석사", toBachelor=True),
    ]}])[0]
    assert ["X", "2025-2", 3] in got["courses"] and ["Y", "2026-1", 3] in got["courses"] and ["H", "2026-1", 3] in got["courses"]
    assert got["replaced"] == [["Y", "2025-1"]] and got["duplicates"] == [["X", "X"]]
    assert ["Z", "W"] in got["dropped"] and ["G", "graduate_not_counted"] in got["dropped"]


@node
def test_evaluate_chem_bio(tmp_path):
    """화학생물공학부 2025학번 단일전공: 확인된 줄만 충족·남음, 나머지는 확인 필요와 까닭."""
    core = _req("chem-bio-eng", "cbe-core12")["courses"]
    sel1 = _req("chem-bio-eng", "cbe-sel1")["courses"]
    sel2 = _req("chem-bio-eng", "cbe-sel2")["courses"]
    writing = _req("chem-bio-eng", "cbe-ge-writing")["courses"]
    records = [_rec(c) for c in core] + [_rec(c) for c in sel1[:2]] + [_rec(sel2[0])] + [_rec(c, cls="교양") for c in writing]
    records[0]["status"] = "failed"  # 첫 전필은 F → 학점 없음
    got = _run(tmp_path, [
        {"kind": "evaluate", "program": "chem-bio-eng", "entryYear": 2025, "role": "single", "records": records},
        {"kind": "evaluate", "program": "chem-bio-eng", "entryYear": 2025, "role": "single",
         "records": records + [_rec(core[0], term="2025-2", status="retake")]},
        {"kind": "evaluate", "program": "animal-biotech", "entryYear": 2025, "role": "single", "records": []},
    ])
    one, two, animal = got
    assert one["cbe-core12"]["state"] == "remaining" and one["cbe-core12"]["missing"] == [core[0]["code"]]
    assert two["cbe-core12"]["state"] == "met" and two["cbe-core12"]["have"] == 12
    assert one["cbe-sel1"]["state"] == "remaining" and len(one["cbe-sel1"]["missing"]) == 3
    assert one["cbe-sel2"]["state"] == "met" and one["cbe-ge-writing"]["state"] == "met"
    assert one["cbe-eng-intro"]["state"] == "remaining"
    assert one["cbe-core46-sum"]["state"] == "check" and one["cbe-core46-sum"]["reason"] == "자료 부분"
    assert one["cbe-ge-total"] == {"state": "check", "reason": "과목 목록이 없는 조건", "have": 0, "missing": []}
    assert "cbe-double" not in one and "cbe-minor" not in one  # 단일전공에는 복수·부전공 줄이 없다
    assert animal["animal-main-core"]["state"] == "check" and animal["animal-main-core"]["reason"] == "자료 부분"


@node
def test_credit_buckets_and_overlap(tmp_path):
    """교양·전공(과정마다)·교직·일반선택으로 나누고, 두 전공에 걸린 과목 수를 센다(부전공과는 겹쳐 인정 없음)."""
    def prog(pid, dept, codes):
        return {"id": pid, "depts": [dept], "code_prefixes": [], "exists_for": [2019, 2026],
                "versions": [{"entry_years": [2019, 2026], "credits": {"grad": 130},
                              "requirements": [{"id": "r", "type": "major_required", "courses": [{"code": c} for c in codes]}]}]}
    p1, p2 = prog("P1", "가학과", ["A.1"]), prog("P2", "나학과", ["B.1", "S.1"])
    c = lambda code, cls, dept, cr=3: {"code": code, "credits": cr, "cls": cls, "dept": dept, "term": "2025-1", "status": "taken"}
    records = [c("G.1", "교양", "학부대학"), c("A.1", "전필", "가학과"), c("B.1", "전선", "나학과"),
               c("S.1", "전선", "가학과"), c("T.1", "교직", "사범대학", 2), c("Z.1", "전선", "다학과"),
               {**c("X.1", "전선", "외국대학", 70), "source": "exchange"}]
    got = _run(tmp_path, [
        {"kind": "credits", "picks": [{"program": p1, "entryYear": 2025, "role": "parallel"},
                                      {"program": p2, "entryYear": 2025, "role": "double"}], "records": records},
        {"kind": "credits", "picks": [{"program": p1, "entryYear": 2025, "role": "parallel"},
                                      {"program": p2, "entryYear": 2025, "role": "minor"}], "records": records[:-1]},
    ])
    d, m = got
    assert d["ge"] == 3 and d["teaching"] == 2 and d["general"] == 3 + 70 and d["majors"] == {"P1": 6, "P2": 6}
    assert d["shared"] == ["S.1"] and d["overlap"] == {"count": 1, "limit": 3, "over": False, "minor": False}
    assert d["total"] == 3 + 3 + 3 + 3 + 2 + 3 + 70 and d["outsideOver"] is True  # 다른 학교 학점은 졸업학점의 1/2 까지
    assert m["minorShared"] == ["S.1"] and m["overlap"]["minor"] is True


@node
def test_major_course_rule(tmp_path):
    """같은 학부라도 번호 앞자리로 전공을 가른다(식품·동물생명공학부: 5252·M1702 = 동물생명공학)."""
    c = lambda code, cls="전선", dept="식품·동물생명공학부": {"code": code, "cls": cls, "dept": dept}
    got = _run(tmp_path, [{"kind": "major", "program": "animal-biotech", "entryYear": 2025,
                            "courses": [c("5252.411"), c("M1702.000500"), c("5251.304", "전필"), c("5252.411", "교양"),
                                        c("500.301A", "전필", "농업생명과학대학")]}]
                     )[0]
    assert got == [True, True, False, False, True]  # 농생대 공통 통계학개론 및 실습은 요건 목록에 있어서 전공


@node
def test_gpa_rules(tmp_path):
    """A+ 4.3 … F 0. S·U·W 와 다른 학교 학점은 평점에서 빼고, 재수강은 나중 성적. 학기 평점은 조정 전, 계절 제외."""
    r = lambda code, cr, grade, term, **kw: {"code": code, "credits": cr, "grade": grade, "term": term,
                                             "status": kw.pop("status", "taken"), "cls": "전선", **kw}
    records = [r("A", 3, "A+", "2025-1"), r("B", 3, "C+", "2025-1"), r("B", 3, "A0", "2025-2", status="retake"),
               r("C", 2, "F", "2025-2", status="failed"), r("D", 1, "S", "2025-2"), r("E", 3, "B0", "2025-S"),
               r("F", 3, "A+", "2025-2", source="exchange"), r("G", 3, "W", "2025-2", status="dropped")]
    got = _run(tmp_path, [{"kind": "gpa", "records": records, "majorCodes": ["A", "B"]},
                          {"kind": "gpa", "records": records[:1]}])
    g, single = got
    assert g["all"] == {"gpa": 3.08, "credits": 11, "points": 33.9}
    assert g["major"] == {"gpa": 4.15, "credits": 6, "points": 24.9}
    assert g["byTerm"]["2025-1"]["gpa"] == 3.3 and g["byTerm"]["2025-S"]["gpa"] == 3.0 and g["byTerm"]["2025-2"]["gpa"] == 2.4
    assert g["lastTwoRegular"]["terms"] == ["2025-1", "2025-2"] and g["lastTwoRegular"]["gpa"] == 2.89
    assert g["graduation"] == {"all": True, "major": True, "complete": True} and g["ungraded"] == 0
    assert single["all"]["gpa"] == 4.3 and single["major"] is None


@node
def test_grade_needed_and_term_limits(tmp_path):
    w = lambda **kw: {"kind": "limit", "who": kw}
    got = _run(tmp_path, [
        {"kind": "need", "current": {"credits": 60, "points": 210}, "planned": 18, "target": 3.6},
        {"kind": "need", "current": {"credits": 60, "points": 210}, "planned": 18, "target": 4.2},
        w(college="자연과학대학", unit="생명과학부", program="생명과학부", entryYear=2024, term=1),
        w(college="자연과학대학", unit="생명과학부", program="생명과학부", entryYear=2023, term=1),
        w(college="공과대학", unit="화학생물공학부", program="화학생물공학부", entryYear=2021, term=2),
        w(college="공과대학", unit="화학생물공학부", program="화학생물공학부", entryYear=2021, term=3),
        w(college="공과대학", unit="공과대학 광역", program="공과대학 광역", entryYear=2023, term=1),
        w(college="공과대학", unit="공과대학 광역", program="공과대학 광역", entryYear=2023, term=2),
        w(college="사범대학", unit="수학교육과", program="수학교육과", entryYear=2025, term=2),
        w(college="사범대학", unit="수학교육과", program="수학교육과", entryYear=2024, term=1),
        w(college="농업생명과학대학", unit="식품·동물생명공학부", program="동물생명공학전공", entryYear=2025, term=1),
        w(college="농업생명과학대학", unit="식품·동물생명공학부", program="동물생명공학전공", entryYear=2025, term=3, gpaLastTwo=3.5),
        w(college="농업생명과학대학", unit="식품·동물생명공학부", program="동물생명공학전공", entryYear=2025, term=3, gpaLastTwo=3.5, warning=True),
        w(college="의과대학", unit="의예과", program="의예과(예과 2년)", entryYear=2025, term=1, gpaLastTwo=4.0),
        w(college="수의과대학", unit="수의학과", program="수의학과(본과 4년)", entryYear=2020, term=5),
        w(college="간호대학", unit="간호학과", program="간호학과", entryYear=2025, term=3, gpaLastTwo=3.4),
        w(college="학부대학", unit="자유전공학부(학부대학)", program="자유전공학부(기존 전공을 주전공으로)", entryYear=2025, term=1),
        {"kind": "limit", "who": {"college": "인문대학", "unit": "국어국문학과", "program": "국어국문학과", "entryYear": 2025, "term": 1},
         "courses": [{"code": "F11.101", "credits": 2}, {"code": "E51.101", "credits": 1}, {"code": "X", "credits": 16}]},
    ])
    assert got[0] == {"need": 3.93, "reachable": True} and got[1]["reachable"] is False
    limits = [g["limit"] for g in got[2:-1]]
    assert limits == [20, 18, 19, 18, 22, 19, 19, 18, 18, 21, 15, 23, 25, 21, 20]
    assert got[-1]["within"] == {"credits": 18, "ok": True}  # 신입생세미나(E51.101)는 상한 밖


# ---------------------------------------------------------------- 다음 학기 추천·빈 자리 (update101)

def _course(cid, sections, program="학사", cls="전필"):
    """편람 꼴(parseCourses): [번호, 이름, 학과, 학점, 교과구분, 이수과정, [[분반, 교수, 상태, [[요일, 시작, 끝, 건물, 강의실]]]]]"""
    return [cid, cid, "가", 3, cls, program, [[no, "", status, meets] for no, status, meets in sections]]


@node
def test_gap_fit(tmp_path):
    """대표 시간표(월 9:00~10:15, 301동)에 겹치지 않고 들어가는 과목과 늘어나는 걷는 분·지각·학교 오는 요일."""
    table = {"H|301": 5, "301|302": 7, "301|83": 15, "H|302": 6, "H|83": 12}
    base = [_course("BASE", [("001", "", [[0, 540, 615, "301", ""]])])]
    cands = [
        _course("A", [("001", "", [[0, 540, 615, "302", ""]]), ("002", "", [[2, 600, 675, "83", ""]])]),  # 001 은 겹침 → 수요일 분반
        _course("B", [("001", "", [[0, 630, 705, "302", ""]])]),   # 바로 뒤, 7분 걸어 8분 남음
        _course("C", [("001", "", [[0, 620, 700, "83", ""]])]),    # 15분 걸리는데 쉬는 시간 5분 → 지각 10분
        _course("D", [("001", "", [])]),                           # 시간 없음
        _course("E", [("001", "", [[1, 540, 615, "", ""]])]),      # 강의실 미정
        _course("F", [("001", "폐강대상", [[3, 540, 615, "301", ""]])]),
        _course("G", [("001", "", [[4, 540, 615, "301", ""]])], program="석사"),
        _course("BASE", [("002", "", [[4, 540, 615, "301", ""]])]),  # 이미 시간표에 있는 과목
    ]
    got = _run(tmp_path, [{"kind": "gapfit", "base": base, "courses": cands, "table": table, "home": "H"},
                          {"kind": "gapfit", "base": base, "courses": cands, "table": table, "home": "H", "rules": {"freeDays": [2]}}])
    g, free_wed = got
    assert g["base"] == {"cost": 10, "travel": 10, "late": 0, "days": 1} and g["blocked"] == 0
    assert [f[0] for f in g["fits"]] == ["E", "B", "F", "A", "C"]
    fits = {f[0]: f for f in g["fits"]}
    assert fits["B"][2] == {"cost": 8, "travel": 8, "late": 0, "days": 0}
    assert fits["C"][2] == {"cost": 42, "travel": 22, "late": 10, "days": 0}
    assert fits["A"][1] == "002" and fits["A"][2]["days"] == 1
    assert fits["E"][3] is True and fits["F"][4] is True
    assert "A" not in [f[0] for f in free_wed["fits"]] and free_wed["blocked"] == 1  # 수요일 공강이면 A 는 못 넣는다


@node
def test_suggest_next_courses(tmp_path):
    """남은 과목을 다 들어야 하는 줄은 need, 몇 중 몇은 choose, 확인 필요 줄의 목록 과목은 maybe. 들은 과목·요건에 없는 과목은 빠지고,
    새 번호로 열린 과목은 같은 과목으로 찾는다. 차례는 강도 → 시간표에 들어가는지 → 늘어나는 비용."""
    c = lambda code, cr=3, **kw: {"code": code, "name": code, "credits": cr, **kw}
    req = lambda rid, typ, courses, n=None, cr=None, status="확인": {
        "id": rid, "type": typ, "applies_to": [], "text": rid, "min_count": n, "min_credits": cr, "courses": courses, "status": status, "src": []}
    prog = {"id": "t", "depts": ["가"], "code_prefixes": [], "exists_for": [2019, 2026], "versions": [{
        "entry_years": [2019, 2026], "basis": "입학 연도", "status": "확인", "src": [],
        "credits": {"grad": 130, "ge": 36, "single": 60, "parallel": 40, "double": 39, "minor": 21, "status": "확인", "src": []},
        "requirements": [req("need", "major_required", [c("N1"), c("N2")], n=2),
                         req("pick", "major_choose", [c("P1"), c("P2", alt_codes=["P2NEW"]), c("P3")], n=1),
                         req("unsure", "other", [c("M1"), c("M2")], cr=6, status="부분"),
                         req("cred", "major_choose", [c("C1"), c("C2")], cr=6)]}]}
    mon = lambda h, b="301": [[0, h * 60, h * 60 + 75, b, ""]]
    nxt = [_course("N1", [("001", "", mon(9))]), _course("N2", [("001", "", mon(13, "83"))]), _course("P2NEW", [("001", "", mon(11))]),
           _course("M1", [("001", "", mon(15))]), _course("C1", [("001", "", mon(10, "301"))]), _course("X", [("001", "", mon(16))])]
    rec = {"code": "N1", "name": "N1", "credits": 3, "cls": "전필", "dept": "가", "term": "2025-1", "status": "taken"}
    base = [_course("BASE", [("001", "", mon(8, "301"))])]
    core = _req("chem-bio-eng", "cbe-core12")["courses"]
    sel1 = _req("chem-bio-eng", "cbe-sel1")["courses"]
    real = [_rec(x) for x in core[1:]]
    got = _run(tmp_path, [
        {"kind": "suggest", "program": prog, "entryYear": 2025, "role": "single", "records": [rec], "courses": nxt,
         "fit": True, "base": base, "table": {"H|301": 5, "301|83": 15, "H|83": 12}},
        {"kind": "suggest", "program": "chem-bio-eng", "entryYear": 2025, "role": "single", "records": real,
         "courses": [_course(core[0]["code"], [("001", "", mon(9))]), _course(sel1[0]["code"], [("001", "", mon(11))]),
                     _course(core[1]["code"], [("001", "", mon(13))])]},
    ])
    syn, cbe = got
    assert {x[0]: x[1] for x in syn["suggestions"]} == {"N2": "need", "C1": "need", "P2NEW": "choose", "M1": "maybe"}
    assert [x[0] for x in syn["ranked"]] == ["C1", "N2", "P2NEW", "M1"]  # C1 은 301동 바로 다음이라 N2(83동)보다 덜 걷는다
    assert all(x[2] is not None for x in syn["ranked"])
    s = {x[0]: x[1] for x in cbe["suggestions"]}
    assert s == {core[0]["code"]: "need", sel1[0]["code"]: "choose"}  # 들은 전필(core[1])은 없다
