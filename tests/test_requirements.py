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
import same_courses as sc  # noqa: E402

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
    # 정보 탭 출처 줄의 날짜(문서 11/23, update145): 교과과정 해설·학과 누리집 기준일, 학년도, 스누지니 확인일(snugenie.CHECKED 와 같다)
    import snugenie
    assert idx["checked_on"] == "2026-11-12" and idx["data_year"] == 2025 and idx["snugenie_checked_on"] == snugenie.CHECKED == "2026-11-17"
    assert list(idx)[:4] == ["checked_on", "data_year", "snugenie_checked_on", "cohorts"]
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
    """동물생명공학전공: 2019~2020학번은 생화학 1·2(300.312·300.313), 2021학번부터 동물생화학 1·2.
    update127: 2021~2026 판은 2025학번 교양 개편으로 [2025, 2026]·[2021, 2024]로 나뉘고, 2025~ 쪽 교양 묶음 줄은 영역마다 줄로 나뉜다"""
    p = programs()["animal-biotech"]
    new, y26, mid, old = p["versions"]  # update135: 2026학년도 스누지니 전필 목록이 비어 2025·2026 을 나눔
    assert new["entry_years"] == [2025, 2025] and y26["entry_years"] == [2026, 2026] and mid["entry_years"] == [2021, 2024]
    assert old["entry_years"] == [2019, 2020] and new["split"] and y26["split"] and mid["split"] and "split" not in old
    codes = lambda v: {c["code"] for r in v["requirements"] if r["id"] == "animal-main-core" for c in r["courses"]}
    assert {"M1702.001000", "M1702.001100"} <= codes(new) == codes(mid) and not {"300.312", "300.313"} & codes(new)
    assert {"300.312", "300.313"} <= codes(old)
    ge = [r for r in new["requirements"] if r["type"] == "ge"]
    assert [r["id"] for r in ge] == ["ge-cals-natural", "ge-cals-natural-writing", "ge-cals-natural-foreign", "ge-cals-natural-math",
                                     "ge-cals-natural-science", "ge-cals-natural-keys", "ge-cals-natural-veritas"]
    assert all(r["auto"] == "rule_composite" for r in ge) and ge[0]["sum"] == {"of": "ge"} and ge[0]["min_credits"] == 36
    # 옛 학번 쪽: 교양 학점 합(학부대학 표 36)만. 2025학번 교양 글 줄은 뺀다(update135, 프론트엔드 11/17 '옛 판의 2025 교양 줄')
    assert [r["id"] for r in mid["requirements"] if r["type"] == "ge"] == ["ge-cals-natural-old-total"]
    total = next(r for r in mid["requirements"] if r["type"] == "ge")
    assert total["sum"] == {"of": "ge"} and total["min_credits"] == 36
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
    assert json.loads((tmp_path / "requirements" / "catalog.json").read_text(encoding="utf-8"))["depts"]
    for name in ("index.json", "common.json", "course_map.json", "ge_credits.json", "ge_areas.json", "lecture_lang.json", "programs/life-sciences.json"):
        text = (tmp_path / "requirements" / name).read_text(encoding="utf-8")
        assert "\n" not in text.strip() and json.loads(text)
    assert ew.export_requirements(tmp_path / "없음", tmp_path / "x") is None


# ---------------------------------------------------------------- 계산 (node)

def _run(tmp_path, cases, data=REQ):
    (tmp_path / "cases.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    run = subprocess.run(["node", str(ROOT / "tests" / "requirements_runner.mjs"), str(data), str(tmp_path / "cases.json")],
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
    assert got[0] == [2019, 2020] and got[1] == [2026, 2026] and got[2] == "no_data" and got[3] == [2025, 2025]
    a, b, c = got[4]
    assert a == b and c == "458.201"  # 대학 글쓰기 1 옛 번호와 새 번호는 같은 과목


@node
def test_tidy_records(tmp_path):
    """디자인 124판: 같은 과목을 다시 들으면 앞 것은 묻지 않고 재수강으로 뺀다. 드랍(체크·옛 꼴·W)과 학사에 안 넣는 대학원 과목은 셈에서 뺀다."""
    r = lambda code, term, **kw: {"code": code, "credits": 3, "cls": "전선", "dept": "가", "term": term, **kw}
    got = _run(tmp_path, [{"kind": "tidy", "records": [
        r("X", "2025-1"), r("X", "2025-2"),
        r("Y", "2025-1", grade="F"), r("Y", "2026-1"),
        r("Z", "2025-2", dropped=True), r("W", "2025-2", status="dropped"), r("V", "2025-2", grade="W"),
        r("G", "2026-1", level="석사"), r("H", "2026-1", level="석사", toBachelor=True), r("U", "2026-1", grade="U"),
    ]}])[0]
    assert ["X", "2025-2", 3] in got["courses"] and ["Y", "2026-1", 3] in got["courses"] and ["H", "2026-1", 3] in got["courses"]
    assert ["U", "2026-1", 0] in got["courses"]
    assert got["replaced"] == [["X", "2025-1", "2025-2"], ["Y", "2025-1", "2026-1"]] and got["duplicates"] == [] and got["substituted"] == []
    assert {"Z", "W", "V"} <= {x[0] for x in got["dropped"] if x[1] == "dropped"} and ["G", "graduate_not_counted"] in got["dropped"]


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
    assert one["cbe-ge-total"] == {"state": "remaining", "reason": None, "have": 2, "missing": []}  # 교양 학점 합(update127): 글쓰기 두 과목
    assert "cbe-double" not in one and "cbe-minor" not in one  # 단일전공에는 복수·부전공 줄이 없다
    # update135: 스누지니 2025학년도 전필 목록과 같아 '확인'(남음), 2026학번은 그 해 목록이 비어 '부분' 그대로
    assert animal["animal-main-core"]["state"] == "remaining"


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


@node
def test_plan_term_for_preview(tmp_path):
    """작년 편람으로 짜기(update134)에 담을 과목: 요건 순으로, 줄마다 남은 만큼만(몇 중 몇·몇 학점), 학기 학점 상한 안에서,
    시간이 겹쳐 시간표가 안 나오는 과목은 건너뛴다. 상한 밖 과목은 학점을 세지 않는다."""
    c = lambda code, cr=3: {"code": code, "name": code, "credits": cr}
    req = lambda rid, typ, courses, n=None, cr=None, status="확인": {
        "id": rid, "type": typ, "applies_to": [], "text": rid, "min_count": n, "min_credits": cr, "courses": courses, "status": status, "src": []}
    prog = {"id": "t", "depts": ["가"], "code_prefixes": [], "exists_for": [2019, 2026], "versions": [{
        "entry_years": [2019, 2026], "basis": "입학 연도", "status": "확인", "src": [],
        "credits": {"grad": 130, "ge": 36, "single": 60, "parallel": 40, "double": 39, "minor": 21, "status": "확인", "src": []},
        "requirements": [req("core", "major_required", [c("A"), c("B"), c("C")], n=3),
                         req("pick", "major_choose", [c("P1"), c("P2"), c("P3")], n=1),
                         req("cred", "major_choose", [c("Q1"), c("Q2"), c("Q3")], cr=6),
                         req("unsure", "other", [c("M1")], cr=3, status="부분")]}]}
    at = lambda day, h: [[day, h * 60, h * 60 + 75, "301", ""]]
    nxt = [_course("A", [("001", "", at(0, 9))]), _course("B", [("001", "", at(0, 9))]),  # B 는 A 와 같은 때(분반 하나)
           _course("C", [("001", "", at(1, 9))]), _course("P1", [("001", "", at(2, 9))]), _course("P2", [("001", "", at(2, 11))]),
           _course("Q1", [("001", "", at(3, 9))]), _course("Q2", [("001", "", at(3, 11))]), _course("Q3", [("001", "", at(3, 13))]),
           _course("M1", [("001", "", at(4, 9))])]
    case = lambda **plan: {"kind": "suggest", "program": prog, "entryYear": 2025, "role": "single", "records": [], "courses": nxt, "plan": plan}
    full, capped, free = (x["plan"] for x in _run(tmp_path, [case(cap=30), case(cap=12), case(cap=12, exempt=["A", "C"])]))
    assert full == ["A", "C", "P1", "Q1", "Q2", "M1"]  # B 는 겹치고, P2 는 1과목·Q3 는 6학점이 이미 찼다. 아마 필요(M1)는 맨 뒤
    assert capped == ["A", "C", "P1", "Q1"]
    assert free == ["A", "C", "P1", "Q1", "Q2", "M1"]  # A·C 는 상한 밖이라 학점을 세지 않는다


# ---------------------------------------------------------------- 학과 목록 (update103, 디자인 121판)

def test_dept_catalog():
    """처음 화면의 대학 → 학과(부) → 전공 목록. 레포 자료만으로 다시 만들면 파일과 같다."""
    import dept_catalog as dc
    cat = dc.build(REQ, ri.HISTORY)
    assert cat == load("catalog.json")
    idx = load("index.json")["programs"]
    ids = [i for col in cat["colleges"] for u in col["units"] for i in u["programs"]] + [i for g in cat["others"] for i in g["programs"]]
    assert len(ids) == len(set(ids)) == len(cat["programs"]) == len([p for p in idx if p["unit"] not in dc.SKIP_UNITS])
    assert all("(" not in p["name"] and "(" not in p["short"] for p in cat["programs"].values())
    assert [c["name"] for c in cat["colleges"]][:3] == ["인문대학", "사회과학대학", "자연과학대학"]
    units = {u["name"]: u for col in cat["colleges"] for u in col["units"]}
    fa = units["식품·동물생명공학부"]
    assert fa["splits"] and fa["undecided"] and fa["ask_entry"] and "animal-biotech" in fa["programs"]
    assert units["물리·천문학부"]["splits"] and not units["물리·천문학부"]["undecided"]  # 입학 때 전공이 정해진다
    assert units["자유전공학부"]["multi_major"] and units["공과대학 광역"]["wide"]
    assert units["융합학습과학전공"]["ask_entry"]  # 판이 전공 진입 연도로 갈린다
    assert units["국사학과"]["exists_for"] == [2019, 2022]
    assert cat["programs"]["animal-biotech"]["short"] == "동물생명공학전공" and cat["programs"]["life-sciences"]["short"] == "생명과학부"
    assert [g["name"] for g in cat["others"]] == ["연합전공", "연계전공", "학생설계전공"]
    ai = next(p for p in cat["programs"].values() if p["short"] == "연합전공 인공지능")
    assert ai["college"] is None and ai["double"] and ai["version_key"] == "selection"
    m = cat["depts"]["식품·동물생명공학부"]
    assert len(m["units"]) == 1 and next(x for x in m["programs"] if x["id"] == "animal-biotech")["prefixes"] == ["5252.", "M1702."]
    assert cat["depts"]["생명과학부"]["programs"] == [{"id": "life-sciences", "prefixes": []}]


@node
def test_pick_version_for(tmp_path):
    """입학 연도·전공 진입 연도·선발 연도 가운데 판이 갈리는 기준으로 고른다."""
    ps = {p["program"]: p for p in programs().values()}
    vet = ps["수의학과(본과 4년)"]
    vet_years = {tuple(v["entry_years"]): v["basis"] for v in vet["versions"]}
    major_v = next(y for y, b in vet_years.items() if b.startswith("전공 진입"))
    sd = ps["학생설계전공(복수전공)"]["id"]
    got = _run(tmp_path, [
        {"kind": "pickfor", "program": sd, "who": {"entryYear": 2024, "selectionYear": 2021}},
        {"kind": "pickfor", "program": sd, "who": {"entryYear": 2024}},
        {"kind": "pickfor", "program": vet["id"], "who": {"entryYear": 2019, "majorEntryYear": major_v[0]}},
        {"kind": "pickfor", "program": "animal-biotech", "who": {"entryYear": 2020, "majorEntryYear": 2023}},
        # 전공 진입 칸을 없애 화면이 학번+1 을 주면 본과(예과 2년 뒤) 과정은 학번+2 로(update117). 학번+1 이 아닌 값은 그대로
        {"kind": "pickfor", "program": vet["id"], "who": {"entryYear": 2017, "majorEntryYear": 2018}},
        {"kind": "pickfor", "program": vet["id"], "who": {"entryYear": 2017, "majorEntryYear": 2020}},
    ])
    assert got[0] == [2019, 2021] and got[1] == [2022, 2026]
    assert tuple(got[2]) == major_v
    assert got[3] == [2019, 2020]  # 입학 연도로 갈리는 과정은 전공 진입 연도를 써도 입학 연도로
    assert got[4] == [2019, 2019] and got[5] == [2020, 2026]



# ---------------------------------------------------------------- 졸업 요건 탭 값 (update106, 디자인 124판)

def _pid(name):
    idx = json.loads((REQ / "index.json").read_text(encoding="utf-8"))
    return next(p["id"] for p in idx["programs"] if p["program"] == name)


@node
def test_shared_course_and_substitution(tmp_path):
    """들은 과목 하나가 셀 수 있는 줄 둘에 걸리면 두 줄 다 확인 필요(목록이 다른 줄 안에 다 들면 그대로), 대체 과목을 둘 다 들어도 확인 필요."""
    nuc = _pid("원자핵공학과")
    rec = lambda code, term="2025-1": {"code": code, "name": code, "credits": 3, "cls": "전필", "dept": "원자핵공학과", "term": term}
    sel1 = next(r for r in programs()["chem-bio-eng"]["versions"] if r["entry_years"] == [2021, 2023])
    old = next(x for x in sel1["requirements"] if x["id"] == "cbe-sel1")["courses"][0]
    bio = [c for c in _req("life-sciences", "bio-ge-bio", version=next(i for i, v in enumerate(programs()["life-sciences"]["versions"]) if v["entry_years"] == [2025, 2025]))["courses"]]
    got = _run(tmp_path, [
        {"kind": "evaluate", "program": nuc, "entryYear": 2025, "role": "single", "records": [rec("409.223")]},
        {"kind": "evaluate", "program": nuc, "entryYear": 2025, "role": "single", "records": [rec("409.201")]},
        {"kind": "evaluate", "program": "chem-bio-eng", "entryYear": 2022, "role": "single",
         "records": [rec(old["code"]), rec(old["alt_codes"][0], term="2025-2")]},
        {"kind": "evaluate", "program": "life-sciences", "entryYear": 2025, "role": "single",
         "records": [{**rec(c["code"]), "cls": "교양"} for c in bio]},
    ])
    shared, alone, sub, nested = got
    assert shared["nuc-core"]["state"] == "check" and shared["nuc-core"]["reason"] == "여러 요건에 걸린 과목"
    assert shared["nuc-lab"]["state"] == "check" and alone["nuc-core"]["state"] == "remaining" and alone["nuc-lab"]["state"] == "remaining"
    assert sub["cbe-sel1"] == {"state": "check", "reason": "대체 과목을 둘 다 들음", "have": 1, "missing": []}
    assert nested["bio-ge-bio"]["state"] != "check" and nested["bio-ge-science"]["state"] != "check"  # 과학 영역 안의 생물학: 같이 센다


@node
def test_taken_terms_and_labels(tmp_path):
    r = lambda code, term, **kw: {"code": code, "name": f"과목 {code}", "credits": 3, "cls": "전필", "term": term, **kw}
    cs = _pid("컴퓨터공학부")
    catalog = json.loads((REQ / "catalog.json").read_text(encoding="utf-8"))
    got = _run(tmp_path, [
        {"kind": "taken", "currentTerm": "2026-2", "records": [
            r("A", "2025-1", grade="F"), r("A", "2026-2"), r("B", "2025-1", dropped=True),
            {"code": "M", "name": "교류 과목", "credits": 1, "cls": "교양", "term": "2025-1", "manual": True}]},
        {"kind": "labels", "program": "animal-biotech", "entryYear": 2025, "terms": ["2026-2", "2026-S", "2026-W", "2027-1"],
         "src": ["s1", "s3", "s1"], "index": {"checked_on": "2026-11-12", "data_year": 2025},
         "semesters": {"list": [["2027-1", "semesters/2026-1.json", "2026-1"], ["2026-W", "courses.json"], ["2026-2", "semesters/2026-2.json"]]},
         "ask": ["2026-2", "2027-1"]},  # 2027-1 은 앱이 작년 편람으로 미리 짜려고 넣은 칸(셋째 칸): 편람이 아니다
        {"kind": "labels", "program": "life-sciences", "entryYear": 2025, "opts": {"role": "double", "selectionTerm": "2026-1"}},
        {"kind": "labels", "program": cs, "entryYear": 2022, "opts": {"newer": catalog["programs"][cs]["newer"], "role": "single"}},
        {"kind": "labels", "program": cs, "entryYear": 2022, "opts": {"role": "single"}},
    ])
    taken, animal, second, newer, plain = got
    assert taken["total"] == 4  # A 다시 들은 것 3 + 직접 넣은 1(F 였던 앞 A·드랍 B 는 뺀다)
    t26, t25 = taken["terms"]
    assert t26[:3] == ["2026-2", "2026년 2학기", "3학점 · 수강 중"] and t25[:3] == ["2025-1", "2025년 1학기", "1학점"]
    rows = {x[0] + str(i): x for i, x in enumerate(t25[3])}
    assert rows["A0"] == ["A", False, "retake", "전필 · 3학점 · 2026년 2학기에 재수강해서 빠짐"]
    assert rows["B1"][1:3] == [False, "dropped"] and rows["M2"] == ["M", True, None, "직접 추가 · 교양 · 1학점"]
    assert animal["terms"] == [["2026년 2학기", "2027-1", 4], ["2026년 여름학기", "2026-2", 3], ["2026년 겨울학기", "2027-1", 4],
                               ["2027년 1학기", "2027-2", 5]]
    assert animal["version"] == "2025학번 규정" and animal["choices"] == ["2025학번 규정"]  # 교양 개편(update127)·스누지니 목록(update135)으로 나뉜 판
    assert animal["link"].startswith("https://anibiotech.snu.ac.kr/")
    assert animal["sources"] == ["출처: 동물생명공학전공 졸업요건 학부과정(2022년도)",  # 쪽·표를 모르면 문서 이름만(디자인 127판)
                                 "출처: 서울대학교 2024 전공별 교과목(학사과정) · 79–80쪽"]
    assert animal["basis"] == "2025학년도 자료 · 11월 12일 기준" and animal["coursebook"] == [True, False]
    assert second["version"] == "2026년 1학기 선발"
    assert len(newer["choices"]) > 1 and newer["choices"][0] == plain["choices"][0] and len(plain["choices"]) == 1


@node
def test_grad_view(tmp_path):
    """요건 보기: 공통(졸업 학점·졸업 평점·주전공 교양 줄) → 주전공 → 복수전공, 줄마다 값·시트 글."""
    core = _req("chem-bio-eng", "cbe-core12")["courses"]
    records = [_rec(c) for c in core[:4]]
    got = _run(tmp_path, [
        {"kind": "view", "records": records, "picks": [
            {"program": "chem-bio-eng", "role": "single", "entryYear": 2025, "title": "화학생물공학부"}]},
        {"kind": "view", "records": [], "picks": [
            {"program": "animal-biotech", "role": "parallel", "entryYear": 2025, "title": "동물생명공학전공"},
            {"program": "life-sciences", "role": "double", "entryYear": 2025, "selectionTerm": "2026-1", "title": "생명과학부"}]},
        {"kind": "view", "records": [], "picks": [{"program": "animal-biotech", "role": "single", "entryYear": 2018}]},
    ])
    cbe, two, old = got
    common, main = cbe["bundles"]
    assert cbe["total"] == sum(c["credits"] for c in core[:4]) and common["kind"] == "common" and common["title"] == "공통"
    credits = common["rows"]["grad-credits"]
    assert credits["name"] == "졸업 학점" and credits["value"] == f"{130 - cbe['total']}학점 남음"
    assert credits["summary"] == f"130학점 중 {cbe['total']}학점 · {130 - cbe['total']}학점 남음" and credits["strong"] == credits["value"]
    assert credits["progress"] == {"have": cbe["total"], "need": 130, "unit": "학점"}  # 줄 앞 동그라미의 호(141판)
    gpa_row = common["rows"]["grad-gpa"]
    assert gpa_row["value"] == "확인 필요" and gpa_row["because"] == "성적을 다 넣지 않았어요." and gpa_row["progress"] is None
    assert "cbe-ge-total" in common["rows"] and "cbe-ge-total" not in main["rows"]  # 교양 줄은 공통으로
    row = main["rows"]["cbe-core12"]
    have = sum(c["credits"] for c in core[:4])
    # 12과목 33학점 가운데 4과목: 남은 8과목이 남은 학점을 채우니 과목으로(update129, 사용자 11/17 '3학점이면 강의 하나로 착각할 수 있으니까')
    assert main["label"] == "2025~2026학번 규정" and row["name"] == "전공필수" and row["value"] == "8과목 남음"
    assert row["aria"] == "전공필수, 8과목 남음" and row["meta"] == "화학생물공학부 · 2025~2026학번 규정"
    assert row["summary"] == "12과목 중 4과목 · 8과목 남음" and row["progress"] == {"have": 4, "need": 12, "unit": "과목"}
    assert have == 12  # 남은 학점(21)은 8과목으로 채워진다
    assert [x[1] for x in row["courses"]].count(True) == 4 and row["courses"][0][2] == f"{core[0]['credits']}학점 · 2025년 1학기"
    assert row["checked"] == "11월 12일 기준" and row["sources"]
    check = main["rows"]["cbe-core46-sum"]
    assert check["value"] == "확인 필요" and check["because"] == "2025학번 세부 규정이 공개 자료에 다 나오지 않았어요."
    assert check["progress"] is None  # 과목 목록이 없는 확인 필요 줄은 센 값이 없다
    _, animal, bio = two["bundles"]
    assert animal["title"] == "동물생명공학전공" and bio["label"] == "2026년 1학기 선발" and bio["title"] == "생명과학부"
    # update135: 규칙 설명 줄은 요건 줄이 아니라 묶음의 rules 로. 스누지니로 확인한 판 학점은 '전공 학점' 줄로 센다
    assert [x[0] for x in animal["rules"]] == ["animal-stat-once", "animal-rename"] and not {"animal-stat-once", "animal-rename"} & set(animal["rows"])
    assert list(animal["rows"])[:3] == ["major-total", "animal-main-core", "animal-thesis"]
    assert animal["rows"]["major-total"]["name"] == "전공 학점" and animal["rows"]["major-total"]["value"] == "48학점 남음"
    assert animal["rows"]["cals-foreign-lang-lectures"]["value"] == "확인 필요"  # 강의 언어 자료를 안 넘기면
    assert animal["rows"]["cals-foreign-lang-lectures"]["because"] == "강의 언어 정보를 불러오지 못해 외국어 진행 강좌를 계산하지 못했어요."
    assert all(b["kind"] == "program" for b in (animal, bio)) and two["missing"] == []
    assert old["missing"] == ["animal-biotech"] and len(old["bundles"]) == 1  # 2018학번은 자료 없음: 공통만


def test_code_lists_have_courses():
    """분야·갈래에 번호(codes)만 적힌 것도 과목 객체(이름·학점)를 함께 둔다(앱의 졸업 요건 체크박스, update120 fill_code_lists)."""
    n = 0
    for pid, prog in programs().items():
        for v in prog["versions"]:
            for r in v["requirements"]:
                e = r.get("extra") or {}
                for g in (e.get("groups") or []) + (e.get("paths") or []):
                    if g.get("codes") and not g.get("area"):  # 교양 영역 분야(update127: 옛 영어·권장과목★)는 번호만, 체크박스로 펼치지 않는다
                        n += 1
                        assert [c["code"] for c in g.get("courses") or []] == g["codes"], (pid, r["id"])
                        assert all(c.get("name") for c in g["courses"]), (pid, r["id"])
    assert n >= 60


@node
def test_group_and_path_rows(tmp_path):
    """분야 줄(extra.groups)·갈래 줄(extra.paths)을 체크한 과목으로 센다(사용자 11/16 '졸업요건은 체크박스로', 프론트엔드 요청 ①②④).
    다른 종류 줄(전필)이 센 과목은 겹침이라 엄격히는 빼고 세서, 그것만으로 채우면 '확인 필요'. 줄 기준이 목록 밖 과목까지 세면 목록 없는 조건."""
    core = [c["code"] for c in _req("life-sciences", "bio-core", 1)["courses"]]
    groups = _req("life-sciences", "bio-dist", 1)["extra"]["groups"]
    other = [[c for c in g["courses"] if c["code"] not in core] for g in groups]
    rec = lambda c, **kw: _rec(c, cls="전선", dept="생명과학부", **kw)
    core_recs = [rec(c) for c in _req("life-sciences", "bio-core", 1)["courses"][:4]]
    four = [other[0][0], other[0][1], other[1][0], other[2][0]]
    paths = _req("life-sciences", "bio-ge-math", 1)["extra"]["paths"]
    cbe = _req("chem-bio-eng", "cbe-eng-social-creative", -1)
    social, creative = (g["courses"] for g in cbe["extra"]["groups"])
    ids = ["bio-dist", "bio-ge-math", "bio-core"]
    got = _run(tmp_path, [
        {"kind": "rows", "program": "life-sciences", "entryYear": 2025, "ids": ids, "records": core_recs},
        {"kind": "rows", "program": "life-sciences", "entryYear": 2025, "ids": ids, "records": core_recs + [rec(c) for c in four]},
        {"kind": "rows", "program": "life-sciences", "entryYear": 2025, "ids": ids, "records":
            [{**rec(c), "term": None, "checked": True, "cls": ""} for c in four + paths[0]["courses"][:2]]},
        {"kind": "rows", "program": "life-sciences", "entryYear": 2025, "ids": ids, "records": [rec(c) for c in paths[0]["courses"]]},
        {"kind": "rows", "program": "chem-bio-eng", "entryYear": 2019, "ids": [cbe["id"]], "records": [rec(social[0])]},
        {"kind": "rows", "program": "chem-bio-eng", "entryYear": 2019, "ids": [cbe["id"]], "records": [rec(social[0]), rec(creative[0])]},
        {"kind": "rows", "program": "p-38d77850", "entryYear": 2025, "role": "minor", "ids": ["chem-minor"], "records":
            [rec(c) for g in _req("p-38d77850", "chem-minor", 1)["extra"]["groups"] for c in g["courses"]]},
    ])
    only_core, both, checked, math, one_social, two_social, minor = got
    d = only_core["bio-dist"]  # 전필로 센 4과목만: 두 분야는 겹침이라 확인 필요, 생물다양성은 1과목 남음
    assert d["state"] == "remaining" and d["value"] == "1과목 남음" and d["summary"] == "생물다양성 · 1과목 남음"
    assert [g[2:] for g in d["groups"]] == [["check", "확인 필요"], ["check", "확인 필요"], ["left", "1과목 남음"]]
    assert [g[:2] for g in d["groups"]] == [["분자세포생물학", "1과목 이상"], ["개체생물학", "1과목 이상"], ["생물다양성", "1과목 이상"]]
    assert d["progress"] == {"have": 2, "need": 3, "unit": "과목"}  # 값 글과 같은 단위: 분야마다 기준까지만 더함(남은 1과목 = 3 - 2)
    p = both["bio-dist"]["progress"]
    assert p["unit"] == "학점" and p["need"] == 12 and p["have"] >= 12  # 충족은 줄 학점
    assert both["bio-dist"]["state"] == "met" and both["bio-dist"]["value"] == "충족" and all(g[3] == "충족" for g in both["bio-dist"]["groups"])
    c = checked["bio-dist"]  # 체크한 과목(학기 없음)도 같은 기록으로 센다
    assert c["state"] == "met" and checked["bio-ge-math"]["value"] == "2과목 남음"
    assert checked["bio-ge-math"]["paths"][0] == [paths[0]["name"], "2과목 남음"] and checked["bio-ge-math"]["missing"] == [x["code"] for x in paths[0]["courses"][2:]]
    n0 = len(paths[0]["courses"])
    assert checked["bio-ge-math"]["progress"] == {"have": 2, "need": n0, "unit": "과목"}  # 남은 과목이 가장 적은 갈래
    m = math["bio-ge-math"]
    assert m["state"] == "met" and m["summary"] == paths[0]["name"] and m["paths"][1][1] == f"{len(paths[1]['courses'])}과목 남음"
    assert m["progress"] == {"have": n0, "need": n0, "unit": "과목"}
    s = one_social[cbe["id"]]
    assert s["state"] == "remaining" and s["value"] == "3학점 남음" and [g[3] for g in s["groups"]] == ["충족", "3학점 남음"]
    assert s["progress"] == {"have": 3, "need": 6, "unit": "학점"}
    assert two_social[cbe["id"]]["state"] == "met"
    assert minor["chem-minor"]["state"] == "check" and minor["chem-minor"]["reason"] == "과목 목록이 없는 조건"  # 21학점은 목록 밖 과목까지


@node
def test_checked_records_and_gpa_checks(tmp_path):
    """체크한 기록(학기·성적 없음): 같은 과목을 시간표로 들었으면 세지 않고, 시트 메타는 '3학점 · 체크', 교양 줄 과목은 교양 학점으로.
    졸업 평점은 성적을 다 넣지 않았어도 '전체·전공 평점 2.0 이상' 둘 다 켜면 충족(프론트엔드 요청 ③④⑤)."""
    core = _req("chem-bio-eng", "cbe-core12")["courses"]
    real = _rec(core[0])
    ticked = {"code": core[0]["code"], "name": core[0]["name"], "credits": core[0]["credits"], "cls": "", "term": None, "checked": True}
    only_tick = {**ticked, "code": core[1]["code"], "name": core[1]["name"], "credits": core[1]["credits"]}
    math = _req("life-sciences", "bio-ge-math", 1)["extra"]["paths"][0]["courses"][0]
    ge_tick = {"code": math["code"], "name": math["name"], "credits": math["credits"], "cls": "", "term": None, "checked": True}
    pick = [{"program": "chem-bio-eng", "role": "single", "entryYear": 2025, "title": "화학생물공학부"}]
    got = _run(tmp_path, [
        {"kind": "tidy", "records": [real, ticked]},
        {"kind": "rows", "program": "chem-bio-eng", "entryYear": 2025, "ids": ["cbe-core12"], "records": [real, ticked, only_tick]},
        {"kind": "view", "records": [], "picks": pick, "gpaChecks": {"all": True, "major": True}},
        {"kind": "view", "records": [], "picks": pick, "gpaChecks": {"all": True, "major": False}},
        {"kind": "view", "records": [ge_tick], "picks": [{"program": "life-sciences", "role": "single", "entryYear": 2025}]},
    ])
    tidy, rows, on, half, ge = got
    assert tidy["courses"] == [[core[0]["code"], "2025-1", core[0]["credits"]]] and tidy["replaced"] == [] and tidy["substituted"] == []
    metas = dict(rows["cbe-core12"]["courses"])
    assert metas[core[0]["code"]] == f"{core[0]['credits']}학점 · 2025년 1학기" and metas[core[1]["code"]] == f"{core[1]['credits']}학점 · 체크"
    assert on["bundles"][0]["rows"]["grad-gpa"]["value"] == "충족" and on["byChecks"] is True
    assert half["bundles"][0]["rows"]["grad-gpa"]["value"] == "확인 필요" and half["byChecks"] is False
    assert ge["ge"] == math["credits"] and ge["general"] == 0


@node
def test_row_checks_and_final_terms(tmp_path):
    """'이 요건을 채웠어요'(rowChecks, 프론트엔드 141판 ⑥): 과목 목록이 없는 확인 필요 줄만 충족(byChecks, 센 값 없음). 목록이 있는 줄·다른 묶음 열쇠·false 는 그대로.
    평점: finalTerms 면 학기 평점에서 재수강으로 빠진 앞 수강을 빼고, 직전 두 학기는 학사 규정대로 그 성적도 넣는다(2026-2 수강신청 안내)."""
    core = _req("chem-bio-eng", "cbe-core12")["courses"]
    pick = [{"program": "chem-bio-eng", "role": "single", "entryYear": 2025, "title": "화학생물공학부"}]
    ticks = {"common|cbe-ge-total": True, "chem-bio-eng|cbe-core46-sum": True, "chem-bio-eng|cbe-core12": True,
             "chem-bio-eng|cbe-life-respect": True, "common|cbe-ge-keys": False, "common|grad-gpa": True, "common|cbe-life-respect": True}
    r = lambda code, cr, grade, term, **kw: {"code": code, "credits": cr, "grade": grade, "term": term,
                                             "status": kw.pop("status", "taken"), "cls": "전선", **kw}
    records = [r("A", 3, "A+", "2025-1"), r("B", 3, "C+", "2025-1"), r("B", 3, "A0", "2025-2", status="retake"),
               r("C", 2, "F", "2025-2", status="failed"), r("E", 3, "B0", "2025-S")]
    got = _run(tmp_path, [
        {"kind": "view", "records": [_rec(c) for c in core[:2]], "picks": pick, "rowChecks": ticks},
        {"kind": "gpa", "records": records},
        {"kind": "gpa", "records": records, "finalTerms": True},
    ])
    view, plain, final = got
    common, main = view["bundles"]
    assert common["id"] == "common" and main["id"] == "chem-bio-eng"
    ge, sum46, life = common["rows"]["cbe-ge-total"], main["rows"]["cbe-core46-sum"], main["rows"]["cbe-life-respect"]
    assert life["value"] == "충족" and life["byChecks"] is True and life["progress"] is None and life["summary"] is None and life["because"] is None
    assert ge["value"] == "53학점 남음" and ge["byChecks"] is False  # 교양 학점은 이제 앱이 센다(update127) → 옛 체크는 쓰지 않는다
    assert sum46["value"] == "충족" and sum46["byChecks"] is True and sum46["aria"].endswith(", 충족")
    assert main["rows"]["cbe-core12"]["value"] != "충족" and main["rows"]["cbe-core12"]["byChecks"] is False  # 목록이 있는 줄은 과목 체크로
    assert common["rows"]["cbe-ge-keys"]["value"] == "3영역 남음"  # false 는 그대로(지성의 열쇠는 이제 영역으로 센다. 영역마다 3학점 = 1과목이라 '9학점' 말고 영역, update129)
    assert common["rows"]["grad-gpa"]["value"] == "확인 필요"  # 졸업 평점은 gpaChecks 로만
    assert plain["byTerm"]["2025-1"]["gpa"] == 3.3 and final["byTerm"]["2025-1"]["gpa"] == 4.3  # 학기 평점: 재수강으로 빠진 C+ 를 뺌
    assert final["byTerm"]["2025-2"] == plain["byTerm"]["2025-2"] and final["all"] == plain["all"]
    for g in (plain, final):  # 직전 두 학기는 두 번의 성적을 다 넣는다(계절 빼고)
        assert g["lastTwoRegular"]["terms"] == ["2025-1", "2025-2"] and g["lastTwoRegular"]["gpa"] == 2.89 and g["lastTwoRegular"]["retakes"] == 1


@node
def test_limit_line_fit_label_and_order(tmp_path):
    fits = [{"add": {"travel": 3.2, "late": 1.1, "days": 0}, "unknownRoom": False}, {"add": {"travel": 0, "late": 0, "days": 1}, "unknownRoom": False},
            {"add": {"travel": 2, "late": 0, "days": 0}, "unknownRoom": True}, {"add": {"travel": -1, "late": 0, "days": 0}, "unknownRoom": False}]
    sug = [{"course": {"id": "A"}, "strength": "need", "reasons": [{"name": "전공필수", "strength": "need"}]},
           {"course": {"id": "B"}, "strength": "maybe", "reasons": [{"name": "졸업 논문", "strength": "maybe"}]},
           {"course": {"id": "C"}, "strength": "choose", "reasons": [{"name": "지정 과목", "strength": "choose"}, {"name": "전공선택", "strength": "choose"}]}]
    fit = {"fits": [{"course": {"id": "A"}, "add": {"cost": 9, "days": 0, "travel": 9, "late": 0}}, {"course": {"id": "B"}, "add": {"cost": 0, "days": 0, "travel": 0, "late": 0}},
                    {"course": {"id": "C"}, "add": {"cost": 1, "days": 0, "travel": 1, "late": 0}}]}  # 덜 걷는 순은 화면의 '걷기 주 +n분'(engine.fitRank)
    who = {"college": "농업생명과학대학", "unit": "식품·동물생명공학부", "program": "동물생명공학전공", "entryYear": 2025}
    got = _run(tmp_path, [
        {"kind": "fitlabel", "fits": fits},
        {"kind": "rank", "suggestions": sug, "fit": fit},
        {"kind": "limitline", "who": who, "term": "2027-1", "credits": 15},
        {"kind": "limitline", "who": {**who, "gpaLastTwo": 3.5}, "term": "2027-1", "credits": 24},
        {"kind": "limitline", "who": {**who, "gpaLastTwo": 3.5}, "term": "2027-1", "credits": 15, "chosen": 18},
        {"kind": "limitline", "who": who, "term": "2026-S", "credits": 3},
        {"kind": "limitline", "who": who, "term": "2026-W", "credits": 9},
        {"kind": "limitline", "who": {"college": "자연과학대학", "unit": "생명과학부", "program": "생명과학부", "entryYear": 2026},
         "term": "2026-1", "credits": 0},
    ])
    labels, rank, base, plus, chosen, summer, winter, first = got
    assert labels == ["걷기 주 +4분", "등교 +1일", "강의실 미정", "걷기 주 +0분"]  # '들어감 · '은 뺐다(라이팅 11/23 B11)
    assert rank["req"] == ["A", "C", "B"] and rank["walk"] == ["C", "A", "B"]  # 아마 필요는 늘 아래
    assert rank["tags"] == ["전공필수", "확인 필요", "지정 과목"]  # 요건 줄 값과 같은 말(라이팅 11/23 B5)
    assert (base["value"], base["label"], base["rest"], base["over"]) == (18, "18학점까지", "3학점 남음", False)
    assert [c["label"] for c in base["choices"]] == ["18학점까지", "21학점까지"]
    assert (plus["value"], plus["rest"], plus["over"]) == (21, "3학점 넘음", True)
    assert (chosen["value"], chosen["rest"]) == (18, "3학점 남음")
    assert (summer["label"], summer["choices"], summer["rest"]) == ("9학점까지", [], "6학점 남음") and winter["rest"] == "3학점 넘음"
    assert first["value"] == 20 and [c["value"] for c in first["choices"]] == [18, 20, 21]  # 자연대 2024학번부터 첫 두 학기 20


@node
def test_row_names(tmp_path):
    got = _run(tmp_path, [{"kind": "rowname", "texts": [
        ["전공필수 15과목 46학점", "major_required"], ["동물생명공학논문연구 M1702.000400(3학점, 전선) — 졸업학기 이수 원칙", "thesis"],
        ["통계학개론 및 실습 500.301A 는 1·2학기 모두 열리며 한 번만 이수", "other"], ["1학년은 미대 공통 전선 10과목 중", "major_choose"],
        ["[2-1] 공학수학 1, [2-2] 공학수학 2", "major_required"], ["[과학] 물리학 영역(물리학·물리학 1·물리학 2)", "ge"],
        ["외국어진행강좌(대학영어 포함) 3과목 이상", "other"], ["", "double"], ["외국어진행 3과목(교양·전공·일선 무관)", "other"], ["영어진행강좌 2과목", "other"]]}])[0]
    assert got == ["전공필수", "동물생명공학논문연구", "통계학개론 및 실습", "지정 과목", "공학수학", "과학 물리학 영역", "외국어 진행 강좌", "복수전공",
                   "외국어 진행 강좌", "영어 진행 강좌"]  # 외국어진행강좌는 과정마다 띄어 쓴 한 이름(디자인 153판, update137)


@node
def test_row_names_tidy(tmp_path):
    """요건 줄 이름 정리(update117, 프론트엔드 11/15 '줄 이름 정리'): 자료의 이름이 먼저, 표 번호·따옴표·끝 토씨·줄임말·졸업 논문 학과 앞말,
    복수전공·부전공 전체 줄, 낱말에 붙은 숫자는 살림, 너무 짧은 앞말은 종류 이름이나 풀어 쓴 이름"""
    got = _run(tmp_path, [{"kind": "rowname", "texts": [
        ["생명과학학위논문연구(1학점, 전필)", "thesis"], ["전선 학점: 단일 47 이상, 병행·복수 26 이상", "major_elective"],
        ["복수전공: 전필 13(6중 4 + 학위논문연구) + 전선 26 이상", "double"], ["부전공: 전필 12(6중 4) + 전선 9 이상", "minor"],
        ["타 학부(과) 복수전공: 단일전공 교과목 중 48학점 이상", "double"], ["표 1 전공선택: 4과목(12학점) 이상", "distribution"],
        ["제2외국어 9학점(중급 1과목 포함)", "other"], ["베리타스 영역에서 1과목", "ge"], ["바이올린 전공은 졸업연주 2회", "other"],
        ["총 21학점 이상", "major_elective"], ["등록 12회 이상 16회까지", "other"], ["'대학원 세미나 과목' 6학점까지", "other"],
        ["교양 체육 과목은 졸업학점(130)에 넣지 않음", "other"], ["전필 중 3과목", "major_required"], ["전공필수 ?학점", "major_required"],
        ["학위논문연구 전에: 생명과학연구실습 2회", "other", "연구실습"], ["교과인증과정 「스마트팜」 12학점", "other"]]}])[0]
    assert got == ["학위논문연구", "전공선택 학점", "복수전공 전체 학점", "부전공 전체 학점", "복수전공 전체 학점", "전공선택",
                   "제2외국어", "베리타스 영역", "바이올린 전공", "전공선택", "등록 학기", "대학원 세미나 과목", "교양 체육 과목", "전공필수",
                   "전공필수", "연구실습", "교과인증과정 「스마트팜」"]


def test_row_names_in_data():
    """requirements_import.ROW_NAMES 의 이름이 그 과정의 판마다 같은 요건 id 에 들어 있다(생명과학부 '표'·'학위논문연구 전에'·'전공선택 필수' 줄)"""
    sys.path.insert(0, str(ROOT / "scripts"))
    import requirements_import as ri
    for (pid, rid), name in ri.ROW_NAMES.items():
        prog = json.loads((REQ / "programs" / f"{pid}.json").read_text(encoding="utf-8"))
        rows = [r for v in prog["versions"] for r in v["requirements"] if r["id"] == rid]
        assert rows and all(r.get("name") == name for r in rows), (pid, rid)
    life = json.loads((REQ / "programs" / "life-sciences.json").read_text(encoding="utf-8"))
    names = {r["id"]: r.get("name") for r in life["versions"][0]["requirements"]}
    assert names["bio-dist"] == "분야별 전공선택" and names["bio-research"] == "연구실습" and names["bio-labs"] == "전공실험·특수연구"


@node
def test_short_locator(tmp_path):
    """출처 줄의 짧은 위치(디자인 127판 '출처: 〈문서 이름〉 · 〈locator〉'): 조사 메모에서 쪽과 표만"""
    got = _run(tmp_path, [{"kind": "locator", "texts": [
        "p.120(PDF 12쪽)", "교양 이수규정 31쪽(PDF 24쪽) □ 미술대학", "Ⅵ 부전공·복수전공(PDF 21–22쪽)",
        "표 1 학사과정 졸업(수료) 이수학점 기준(p.9)·표 2 복수·부전공 이수학점 기준(p.10)", "제5조 제1호 [표2](입학년도별 영역 인정 전공과목)",
        "바이오시스템공학 트랙 A·B 표준 이수체계(p.80~81)", "번호 15", "2024학번 표 035.001", "학점 표·이수표준형태(별표 15과목)", "", None]}])[0]
    assert got == ["120쪽", "31쪽", "21–22쪽", "9쪽 표 1", "표 2", "80–81쪽", "", "", "", "", ""]


@node
def test_walk_order():
    """덜 걷는 순(디자인 128판): 걷기 주 +n분 → 등교 +n일 → 강의실 미정 → 줄 없음, 같은 값과 줄 없는 행은 원래 차례"""
    code = """
import { fitRank, byWalk } from "./web/js/engine.js";
const f = (travel, days = 0, unknownRoom = false) => ({ add: { travel, late: 0, days }, unknownRoom });
const rows = [["none", null], ["far", f(12.4)], ["day", f(1, 2)], ["room", f(0, 0, true)], ["near", f(3.2)], ["tie", f(2.6)], ["none2", null], ["day1", f(9, 1)]];
const fits = new Map(rows);
console.log(JSON.stringify({ order: byWalk(rows.map((r) => r[0]), (k) => fits.get(k)), ranks: rows.map((r) => fitRank(r[1])) }));
"""
    out = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    r = json.loads(out.stdout)
    assert r["order"] == ["near", "tie", "far", "day1", "day", "room", "none", "none2"]
    assert r["ranks"][1] == [0, 12] and r["ranks"][2] == [1, 2] and r["ranks"][3] == [2, 0] and r["ranks"][0] == [3, 0]


@node
def test_ge_areas_sums_and_conditions(tmp_path):
    """update127(사용자 11/16 '조사 안 된 것들 다 목록으로'): 교양은 영역(번호 앞자리)으로, 교양·전공 학점 합 줄, 조건부(TEPS 영어)·덧붙은 조건(권장과목★),
    학과의 평점 줄은 공통 졸업 평점 값, 갈래를 둘 채우는 과학 줄은 모자란 갈래 수만큼 남음."""
    g = lambda code, cr=3, term="2025-1": {"code": code, "name": code, "credits": cr, "cls": "교양", "term": term, "status": "taken"}
    picks = [{"program": "animal-biotech", "role": "parallel", "entryYear": 2025, "title": "동물생명공학전공"},
             {"program": "life-sciences", "role": "double", "entryYear": 2025, "title": "생명과학부"},
             {"program": "chem-bio-eng", "role": "double", "entryYear": 2025, "title": "화학생물공학부"}]
    base = [g("F11.101", 2), g("F22.101"), g("F22.102"), g("C10.101"), g("C20.101"), g("V10.101"), g("F31.111"), g("F31.112"),
            g("F35.103"), g("F35.103L", 1)]
    got = _run(tmp_path, [
        {"kind": "view", "picks": picks, "records": base},
        {"kind": "view", "picks": picks, "records": base + [g("F21.101"), g("C30.101"), g("F11.203", 2), g("F34.103"), g("F34.103L", 1)]},
    ])
    one, two = (dict((b["id"], b) for b in v["bundles"]) for v in got)
    c1, c2 = one["common"]["rows"], two["common"]["rows"]
    assert c1["ge-cals-natural"]["value"] == "9학점 남음" and c1["ge-cals-natural"]["progress"] == {"have": 27, "need": 36, "unit": "학점"}
    assert c1["ge-cals-natural-writing"]["value"] == "1과목 남음" and c2["ge-cals-natural-writing"]["value"] == "충족"
    foreign = c1["ge-cals-natural-foreign"]
    assert foreign["value"] == "확인 필요" and "TEPS 900점" in foreign["because"] and foreign["groups"] == [["외국어", "충족"], ["영어", "확인 필요"]]
    assert c2["ge-cals-natural-foreign"]["value"] == "충족"  # 대학영어 1 을 들으면 조건부 영어도 채움
    assert c1["ge-cals-natural-math"]["value"] == "충족"  # 생명과학을 위한 수학 1·2 짝
    assert c1["ge-cals-natural-science"]["value"] == "2과목 남음" and c2["ge-cals-natural-science"]["value"] == "충족"
    keys = c1["ge-cals-natural-keys"]  # 네 영역 중 셋: 둘을 들었으면 학점(3) 말고 영역(update129)
    assert keys["value"] == "1영역 남음" and keys["summary"] == "3영역 중 2영역 · 1영역 남음" and keys["progress"] == {"have": 2, "need": 3, "unit": "영역"}
    assert c2["ge-cals-natural-keys"]["value"] == "충족"
    assert c1["ge-cals-natural-veritas"]["value"] == "충족"
    bio = one["life-sciences"]["rows"]
    assert bio["bio-elective"]["value"] == "26학점 남음" and bio["bio-double"]["value"] == "39학점 남음"  # 복수전공: 전선 26·전체 39
    cbe = one["chem-bio-eng"]["rows"]
    assert cbe["cbe-gpa"]["value"] == "확인 필요" and cbe["cbe-gpa"]["because"] == "성적을 다 넣지 않았어요."  # 공통 졸업 평점과 같은 값


@node
def test_remaining_shows_binding_condition(tmp_path):
    """update129(사용자 11/17 '4분야 중 3분야를 수강해야 하는데 1분야만 수강했잖아… 3학점이면 강의 하나로 착각할 수 있으니까', '다른 것도 검토해봐'):
    학점만 보면 과목 수를 적게 짐작하는 조건(영역 수·분야마다 기준·덧붙은 조건)이 남으면 그 조건을, 학점이 더 많은 과목을 요구하면 둘 다 보인다."""
    g = lambda code, cr=3: {"code": code, "name": code, "credits": cr, "cls": "교양", "term": "2025-1", "status": "taken"}
    bio = [{"program": "animal-biotech", "role": "single", "entryYear": 2025, "title": "동물생명공학전공"}]
    hum = [{"program": "p-8af8eacd", "role": "single", "entryYear": 2025, "title": "t"}]
    got = _run(tmp_path, [
        {"kind": "view", "picks": bio, "records": [g("C40.101"), g("C40.102")]},  # 지성의 열쇠: 한 영역에서만 두 과목(사용자 그림)
        {"kind": "view", "picks": bio, "records": [g("C10.101", 2), g("C20.101", 2)]},  # 두 영역이지만 2학점짜리
        {"kind": "view", "picks": bio, "records": []},
        {"kind": "view", "picks": hum, "records": [g("F22.901"), g("F22.902")]},  # 제2외국어 초급 둘: 한 과목 더, 그것이 중급 이상
    ])
    one, two, none, lang = (dict((b["id"], b) for b in v["bundles"])["common"]["rows"] for v in got)
    k = one["ge-cals-natural-keys"]
    assert k["value"] == "2영역 남음" and k["summary"] == "3영역 중 1영역 · 2영역 남음" and k["strong"] == "2영역 남음"
    assert k["progress"] == {"have": 1, "need": 3, "unit": "영역"} and k["aria"].endswith(", 2영역 남음")
    assert [x[1] for x in k["groups"]] == ["0과목", "0과목", "0과목", "2과목"]
    k2 = two["ge-cals-natural-keys"]  # 영역은 하나만 남았지만 학점(5)은 그 한 과목으로 못 채운다
    assert k2["value"] == "1영역 · 5학점 남음" and k2["summary"] == "3영역 중 2영역 · 1영역 남음 · 9학점 중 4학점"
    assert k2["progress"] == {"have": 4, "need": 9, "unit": "학점"}
    assert none["ge-cals-natural-keys"]["value"] == "3영역 남음" and none["ge-cals-natural-keys"]["progress"] == {"have": 0, "need": 3, "unit": "영역"}
    s = lang["hum-ge25-2ndlang"]
    assert s["value"] == "1과목 남음" and s["summary"] == "제2외국어 · 1과목 남음 · 중급 이상 1과목 포함"


@node
def test_old_curriculum_areas_and_star(tmp_path):
    """옛 학번(2019~2024) 학문의 세계: 영역 번호 앞자리(041·L0545 …)로 세고, 새 번호로 들은 같은 과목은 대표 번호(2024 번호)로 옛 영역에 든다.
    권장과목(★)은 덧붙은 조건(also): 영역을 다 채워도 ★ 과목이 없으면 남음."""
    hit = None
    for pid, prog in programs().items():
        for v in prog["versions"]:
            if v["entry_years"][1] > 2024 or v["entry_years"][0] < 2021:
                continue
            for r in v["requirements"]:
                e = r.get("extra") or {}
                if r.get("auto") == "rule_world" and any(x.get("also") for x in e.get("groups") or []) and e.get("min_areas") == 4 and r.get("min_credits") == 12:
                    hit = (pid, v["entry_years"][1], r)
                    break
            if hit:
                break
        if hit:
            break
    assert hit, "학문의 세계 + 권장과목 줄"
    pid, year, row = hit
    roles = row.get("applies_to") or ["single"]
    star = next(x for x in row["extra"]["groups"] if x.get("also"))["codes"]
    assert len(star) == 44
    g = lambda code: {"code": code, "name": code, "credits": 3, "cls": "교양", "term": "2024-1", "status": "taken"}
    areas = [x["prefixes"][0] for x in row["extra"]["groups"] if x.get("prefixes")]
    plain = [g(f"{areas[i]}9{i}") for i in range(4)]  # 네 영역에 하나씩(★ 아님)
    star_new = {"code": "C10.107", "name": "도스토예프스키와 톨스토이", "credits": 3, "cls": "교양", "term": "2025-1", "status": "taken"}  # 041.035(★)의 새 번호
    pick = [{"program": pid, "role": roles[0], "entryYear": year, "title": "t"}]
    got = _run(tmp_path, [
        {"kind": "view", "picks": pick, "records": plain},
        {"kind": "view", "picks": pick, "records": plain + [star_new]},
    ])
    a = got[0]["bundles"][0]["rows"][row["id"]]
    b = got[1]["bundles"][0]["rows"][row["id"]]
    assert a["value"] == "1과목 남음" and a["summary"].startswith("권장과목 ")  # 분야 이름에 ★ 를 안 붙인다(디자인 update127 ⑧, update135)
    assert b["value"] == "충족"


def test_converted_rows_are_countable():
    """requirements_lists.apply 가 바꾼 줄은 모두 앱이 셀 수 있는 꼴이고(countable), 2025학번 판에서 '과목 목록이 없는 조건'인 교양 줄이 크게 줄었다."""
    import requirements_lists as rl
    n = 0
    no_list_ge_2025 = 0
    for pid, prog in programs().items():
        for v in prog["versions"]:
            for r in v["requirements"]:
                if r.get("auto"):
                    n += 1
                    assert rl.countable(r), (pid, r["id"])
                    for gr in (r.get("extra") or {}).get("groups") or []:
                        assert gr.get("prefixes") or gr.get("courses") or gr.get("codes") or gr.get("cond"), (pid, r["id"])
                if r["type"] == "ge" and v["entry_years"][0] <= 2025 <= v["entry_years"][1] and r["status"] == "확인" and not rl.countable(r):
                    no_list_ge_2025 += 1
    assert n >= 1500 and no_list_ge_2025 <= 80, (n, no_list_ge_2025)


@node
def test_area_lists_undecided_and_nearest(tmp_path):
    """update128(사용자 11/16 '영역이 나뉘면 영역 다 나눠줘야지… 최대한 정보를 다 넣어', '아예 없는 것도 있냐'):
    교양 영역 분야는 영역 과목 표(ge_areas.json)로 과목 목록을 시트에 주고(들은 것 먼저), 교양 학점 줄은 센 과목을 보이고,
    전공을 아직 안 정함(geOnly)은 공통만, 연합·연계전공은 선발 연도 판이 없으면 가까운 판(판 이름에 그 판)."""
    areas = json.loads((REQ / "ge_areas.json").read_text(encoding="utf-8"))["areas"]
    assert {"C10.", "C40.", "F21.", "V10.", "041.", "L0545.", "051."} <= set(areas) and sum(len(a["courses"]) for a in areas.values()) > 1000
    assert areas["C10."]["name"] == "문화 해석과 상상" and areas["F21."]["name"] == "영어"
    g = lambda code, cr=3: {"code": code, "name": code, "credits": cr, "cls": "교양", "term": "2025-1", "status": "taken"}
    picks = [{"program": "animal-biotech", "role": "single", "entryYear": 2025, "title": "동물생명공학전공"}]
    ai = next(pid for pid, p in programs().items() if p["unit"] == "연합전공" and p["program"] == "인공지능")
    got = _run(tmp_path, [
        {"kind": "view", "picks": picks, "records": [g("C20.101"), g("F11.101", 2)]},
        {"kind": "view", "picks": [{**picks[0], "geOnly": True}], "records": []},
        {"kind": "pickfor", "program": ai, "who": {"entryYear": 2021, "selectionYear": 2023}},
        {"kind": "labels", "program": ai, "entryYear": 2025, "opts": {"role": "double", "selectionTerm": "2023-1"}},
    ])
    view, ge_only, near, label = got
    keys = view["bundles"][0]["rows"]["ge-cals-natural-keys"]
    names = [x[0] for x in keys["groups"]]
    assert names == ["문화 해석과 상상", "역사적 탐구와 철학적 사유", "인간의 이해와 사회 분석", "과학적 사고와 응용"]
    lists = keys["groupCourses"]
    assert all(len(x) > 20 for x in lists) and lists[1][0] == "C20.101"  # 들은 과목이 그 영역 목록 맨 앞
    total = view["bundles"][0]["rows"]["ge-cals-natural"]
    assert [c[0] for c in total["courses"]] == ["C20.101", "F11.101"] or sorted(c[0] for c in total["courses"]) == ["C20.101", "F11.101"]
    assert [b["id"] for b in ge_only["bundles"]] == ["common"] and "ge-cals-natural" in ge_only["bundles"][0]["rows"]
    assert near == [2025, 2026]
    assert label["version"] == "2023년 1학기 선발 · 2025~2026년 선발 규정"


def test_ge_rows_split_by_entry_in_other_basis_versions():
    """update128: 전공 진입·교과 개편·졸업 시기로 고르는 판은 2025 앞뒤 학번이 같이 걸려 교양 줄을 입학 연도로 나눈다(줄의 entry_years).
    새 교양 줄 [2025, …]은 영역별로 셀 수 있게, 옛 학번 줄은 id 끝 '-old' · [2019, 2024] · 부분. 판 안 요건 id 는 겹치지 않는다"""
    tagged = 0
    for pid, p in programs().items():
        for v in p["versions"]:
            ids = [r["id"] for r in v["requirements"]]
            assert len(ids) == len(set(ids)), (pid, v["entry_years"])
            spans = {tuple(r["entry_years"]) for r in v["requirements"] if r.get("entry_years")}
            if not spans:
                continue
            tagged += 1
            assert spans == {(2025, max(v["entry_years"][1], 2026)), (2019, 2024)}, (pid, spans)
            assert not v["basis"].startswith("입학 연도"), pid  # 입학 연도 판은 판을 나눈다(split_new_ge)
            for r in v["requirements"]:
                if r.get("entry_years") == [2019, 2024] and r.get("auto") != "old_total":
                    assert r["id"].endswith("-old") and r["status"] == "부분", (pid, r["id"])
    assert tagged >= 4
    fd = programs()["p-e202bbef"]  # 식품생명공학전공(교과 개편 학기 판 2021~2026)
    ids = [r["id"] for r in fd["versions"][0]["requirements"] if r.get("entry_years") == [2025, 2026]]
    assert {"ge-cals-natural", "ge-cals-natural-keys", "ge-cals-natural-veritas"} <= set(ids)


@node
def test_ge_rows_follow_entry_year(tmp_path):
    """update128: 교양은 늘 입학 연도 규정. 교양 줄을 입학 연도로 나눈 판은 학번으로 거르고(rowsForEntry, 모르면 가장 새 학번 줄),
    더 새 판을 고른 주전공(응용생물학전공 2022학번이 현행 판)도 교양 줄은 학번으로 고른 자기 판(own)에서"""
    got = _run(tmp_path, [
        {"kind": "view", "picks": [{"program": "p-e202bbef", "role": "single", "entryYear": 2025}], "records": []},
        {"kind": "view", "picks": [{"program": "p-e202bbef", "role": "single", "entryYear": 2021}], "records": []},
        {"kind": "view", "picks": [{"program": "p-d65d42a1", "role": "single", "entryYear": 2022, "version": 0, "own": 2,
                                    "newer": {"mode": "latest", "entry_max": 2023, "roles": ["single", "parallel"]}}], "records": []},
        {"kind": "view", "picks": [{"program": "p-d65d42a1", "role": "single", "entryYear": 2022, "version": 0}], "records": []},
        {"kind": "rowsfor", "program": "p-e202bbef", "version": 0},
        {"kind": "rowsfor", "program": "p-e202bbef", "version": 0, "entryYear": 2023},
    ])
    new, old, chose, chose_no_own, unknown, y2023 = got
    rows = new["bundles"][0]["rows"]
    assert "ge-cals-natural-keys" in rows and not any(k.endswith("-old") or k.endswith("-old-total") for k in rows)
    assert [g[0] for g in rows["ge-cals-natural-keys"]["groups"]][:3] == ["문화 해석과 상상", "역사적 탐구와 철학적 사유", "인간의 이해와 사회 분석"]
    rows = old["bundles"][0]["rows"]
    # 옛 학번에는 교양 학점 합 줄만(2025학번 교양 글 줄 '-old' 는 update135 부터 뺀다)
    assert "ge-cals-natural-keys" not in rows and rows["ge-cals-natural-old-total"]["value"] == "36학점 남음" and "ge-cals-natural-old" not in rows
    rows = chose["bundles"][0]["rows"]
    assert "ge-cals-natural-keys" not in rows and "ge-cals-natural-old-total" in rows
    assert chose["bundles"][1]["label"] == "2025~2026학번 규정"  # 전공은 고른 판 그대로
    assert "ge-cals-natural-keys" in chose_no_own["bundles"][0]["rows"]  # own 을 안 주면 옛 동작(고른 판의 교양)
    assert "ge-cals-natural-keys" in unknown and "ge-cals-natural-old" not in unknown
    assert "ge-cals-natural-old-total" in y2023 and "ge-cals-natural-old" not in y2023 and "ge-cals-natural-keys" not in y2023


def test_lecture_lang_and_history_range():
    """update128(사용자 11/16 '수강편람 올라가있는 모든 학기 자료 다 업데이트'): 지난 편람은 편람에 올라 있는 모든 학기(2013-1~),
    외국어 강좌 표는 요건 학번이 들을 수 있었던 학기(2019-1~)마다. 강좌번호는 세 자리, 영어가 아니면 ':언어'"""
    import re
    hist = sorted(p.stem for p in (ROOT / "data" / "history").glob("*.json"))
    assert "2013-1" in hist and "2019-S" in hist and "2026-2" in hist and len(hist) >= 55
    lang = json.loads((REQ / "lecture_lang.json").read_text(encoding="utf-8"))["terms"]
    assert list(lang)[0] == "2019-1" and "2026-2" in lang and len(lang) >= 31
    for term, codes in lang.items():
        for code, secs in codes.items():
            for one in secs.split(" "):
                assert re.fullmatch(r"\d{3}(:[가-힣]+어)?", one), (term, code, one)
    assert all(len(lang[t]) > 300 for t in ("2019-1", "2025-2"))  # 정규 학기마다 외국어 강좌가 수백 과목


# ---------------------------------------------------------------- 이름·번호가 바뀐 과목(update131)

CODE = r"M\d{4}\.\d{6}|[A-Z]\d{4}\.\d{6}|[A-Z]\d{2}\.\d{3}[A-Z]?|\d{3,4}[A-Z]?\.\d{3,4}[A-Z]?"
WHY = {"이름 변경", "번호 변경", "대체 지정", "개편 대응"}


def test_same_course_pairs_are_one_to_one():
    """사용자 11/17 '통계 인공지능 개론 및 실습은 통계학개론 및 실습에서 이름이 바뀐 거라 … 이런 과목들도 다 확인': 학과 자료의 짝 + 편람에서 번호만 바뀐 짝.
    한 번호가 두 과목으로 나뉘거나 두 과목이 하나로 합쳐지면 넣지 않는다(합치면 따로 들은 두 과목이 재수강으로 보인다)"""
    import re
    hand = load("same_courses.json")["pairs"]
    assert all(re.fullmatch(CODE, x["old"]) and re.fullmatch(CODE, x["new"]) and x["why"] in WHY and all(x["names"]) and x["src"] for x in hand)
    got = sc.build()
    pairs = [tuple(r["codes"]) for r in got["same"]]
    assert ("500.301A", "M2179.007700") in pairs and ("5252.312", "M1702.000800") in pairs and ("300.313", "M2173.004700") in pairs
    assert ("370.1106", "M2175.012900") in pairs  # 약화학 1: 이름 그대로 번호만(편람)
    olds, news = [o for o, _ in pairs], [n for _, n in pairs]
    assert len(olds) == len(set(olds)) and len(news) == len(set(news)), "한 번호가 둘로 나뉘거나 둘이 하나로"
    assert all(r["why"] in WHY and len(r["codes"]) == 2 and all(r["names"]) for r in got["same"])
    # 지금 이름·마지막 개설
    assert got["now"]["500.301A"] == {"code": "M2179.007700", "name": "통계 인공지능 개론 및 실습"}
    assert "500.301A" not in got["ended"] and got["ended"]["5171.310"] == "2025-1"  # 공예·사료작물학: 대체 관계를 학과가 안 밝힘
    assert all(v["code"] != k and v["name"] for k, v in got["now"].items())
    # 교양 대응표와 이름이 같은 번호 변경(통계학 → F32.102)은 지금 이름에 안 나온다
    assert "033.019" not in got["now"]


def test_import_cleans_alt_codes():
    """조사 자료의 alt_codes '번호(설명)'·'번호 이름(학기~)'은 번호만, alias·note 의 옛 번호('구 …')는 alt_codes 로(11/17)"""
    import re
    prog = {"versions": [{"requirements": [{"id": "r", "courses": [
        {"code": "L0440.000600", "name": "대학 글쓰기 1", "alt_codes": ["F11.101(2025-1부터 개설 번호)", "F11.101"]},
        {"code": "M1774.001400", "name": "디자인요소와원리", "alt_codes": ["M3389.003500 디자인요소와원리(2024-1~)"]},
        {"code": "M1338.004000", "name": "조직행동론"},
        {"code": "X1", "name": "설명만", "alt_codes": ["내규 표기"]}]}]}]}
    old = ri.survey_old_codes({"courses": [{"code": "M1338.004000", "name": "조직행동론", "alias": ["251.209 조직행위론(구, 편람 2023-1까지)"]},
                                           {"code": "M1312.004100", "name": "커뮤니케이션 양적연구방법론", "note": "구 M1312.000900"},
                                           {"code": "M1312.003000", "name": "커뮤니케이션 이론", "note": "옛 번호 211.301 커뮤니케이션이론"}]})
    assert old == {"M1338.004000": {"251.209"}, "M1312.004100": {"M1312.000900"}, "M1312.003000": {"211.301"}}
    assert ri.clean_alts(prog, old) == 4
    cs = prog["versions"][0]["requirements"][0]["courses"]
    assert [c.get("alt_codes") for c in cs] == [["F11.101"], ["M3389.003500"], ["251.209"], None]
    for p in programs().values():  # 과정 파일의 alt_codes 는 모두 번호만
        for v in p["versions"]:
            for a in re.findall(r'"alt_codes": \[([^\]]*)\]', json.dumps(v, ensure_ascii=False)):
                assert all(re.fullmatch(CODE, x.strip().strip('"')) for x in a.split(",") if x.strip()), (p["id"], a)


def test_export_adds_same_courses(tmp_path):
    ew.export_requirements(REQ, tmp_path / "requirements")
    cm = json.loads((tmp_path / "requirements" / "course_map.json").read_text(encoding="utf-8"))
    assert cm["rows"] and cm["same"] and cm["now"] and cm["ended"] and cm["same_basis"]
    assert {"codes": ["500.301A", "M2179.007700"]}.items() <= next(r for r in cm["same"] if r["codes"][0] == "500.301A").items()
    assert "same" not in load("course_map.json")  # 레포 자료에는 안 쓴다(편람이 바뀔 때마다 웹으로 옮길 때 다시 센다)
    assert not (tmp_path / "requirements" / "same_courses.json").exists()


@node
def test_sheet_shows_renamed_and_ended_courses(tmp_path):
    """동물생명공학 2025학번: 전필 '통계학개론 및 실습'(500.301A)을 이름이 바뀐 '통계 인공지능 개론 및 실습'(M2179.007700)으로 들으면 체크되고,
    안 들었으면 지금 이름을 적는다. 더 안 열리는 과목은 마지막 개설 학기"""
    ew.export_requirements(REQ, tmp_path / "requirements")
    data = tmp_path / "requirements"
    ended = json.loads((data / "course_map.json").read_text(encoding="utf-8"))["ended"]
    # 마지막 개설만 붙는 과목이 있는 과정·줄 하나(작물생명과학 공예·사료작물학)
    crop = next(p for p in programs().values() if any(c["code"] == "5171.310" for v in p["versions"] for r in v["requirements"] for c in r["courses"]))
    crop_v = next(i for i, v in enumerate(crop["versions"]) if any(c["code"] == "5171.310" for r in v["requirements"] for c in r["courses"]))
    crop_r = next(r["id"] for r in crop["versions"][crop_v]["requirements"] if any(c["code"] == "5171.310" for c in r["courses"]))
    year = crop["versions"][crop_v]["entry_years"][0]
    took = {"code": "M2179.007700", "name": "통계 인공지능 개론 및 실습", "credits": 3, "cls": "전선", "dept": "농업생명과학대학", "term": "2026-2"}
    got = _run(tmp_path, [
        {"kind": "sheet", "program": "animal-biotech", "entryYear": 2025, "records": [took], "ids": ["animal-main-core"], "codes": ["500.301A"]},
        {"kind": "sheet", "program": "animal-biotech", "entryYear": 2025, "records": [], "ids": ["animal-main-core"], "codes": ["500.301A"]},
        {"kind": "sheet", "program": crop["id"], "entryYear": year, "records": [], "ids": [crop_r], "codes": ["5171.310"]},
        {"kind": "josa", "words": ["통계 인공지능 개론 및 실습", "물리학", "회화 1", "약품분석학(핵심)", "생화학 3", "Python"]},
    ], data=data)
    assert got[0]["animal-main-core"]["courses"] == [["500.301A", True, "3학점 · 2026년 2학기 · 통계 인공지능 개론 및 실습으로 수강"]]
    assert got[1]["animal-main-core"]["courses"] == [["500.301A", False, "3학점 · 지금은 통계 인공지능 개론 및 실습"]]
    assert got[2][crop_r]["courses"] == [["5171.310", False, f"3학점 · 마지막 개설 2025년 1학기"]] and ended["5171.310"] == "2025-1"
    assert got[3] == ["으로", "으로", "로", "으로", "으로", "로"]


# ---------------------------------------------------------------- 스누지니·규칙 설명·외국어진행강좌·전공 학점(update135)

import requirement_rules as rr  # noqa: E402
import requirements_lists as rl  # noqa: E402
import snugenie as sgn  # noqa: E402


def test_rule_rows_and_foreign_specs():
    """규칙 설명 줄(type 'rule')과 외국어진행강좌 글 읽기: 기준 수·전공 과목 수·뺄 과목·영어만, '권장'은 규칙 설명, 못 읽는 조건이 남으면 그대로"""
    spec = rr.foreign_spec
    assert spec("외국어진행강좌(대학영어 포함) 3과목 이상, 그중 1과목 이상은 전공 교과목") == {"lang": "any", "min_count": 3, "major_count": 1}
    assert spec("영어 진행 강좌 3과목 이상(주전공 과목 1과목 포함). 대학영어·고급영어 등 외국어 영역 영어 과목은 불인정") == {
        "lang": "영어", "min_count": 3, "major_count": 1, "exclude": ["대학영어", "고급영어"]}
    assert spec("외국어 진행 강좌 9학점 이상(전공 3학점 이상 포함; 전공 영어 진행 3 + 기타 외국어 진행 6)") == {
        "lang": "any", "min_credits": 9, "major_credits": 3}
    assert spec("외국어진행강좌 3과목 이상(서울대 개설 과목, 대학영어 같은 외국어 진행 교양 포함, 국외수학 불인정)") == {"lang": "any", "min_count": 3}
    assert spec("외국어 진행 강좌: 2024학번부터 주전공 1강좌 이상 포함 3과목 이상 '권장'(필수 아님)") == {"recommended": True}
    assert spec("외국어진행 3과목 이상, 그중 1과목은 기초러시아어회화·중급러시아어회화·고급러시아어 중 하나") is None
    assert spec("생명존중(자살예방) 교육 이수증 제출. 외국어 진행강좌 3과목(전공 1 포함) 수강 의무") is None
    rule = lambda rid, **kw: {"id": rid, "type": "other", "text": kw.pop("text", "설명"), "min_count": None, "min_credits": None, "courses": [], **kw}
    assert rr.is_rule("animal-biotech", rule("animal-stat-once")) and rr.is_rule("x", rule("cbe-overlap", text="다전공 겹쳐 인정(본부): 복수 9학점"))
    assert not rr.is_rule("p-76162784", rule("phys-elective", sum={"of": "major"}))  # 목록에서 갈랐어도 셀 수 있게 된 줄은 요건
    assert not rr.is_rule("x", rule("x-req", text="졸업논문 제출"))
    prog = {"id": "animal-biotech", "college": "농업생명과학대학", "sources": {"s1": {"title": "a", "locator": "b"}}, "versions": [{"entry_years": [2025, 2025], "requirements": [
        rule("animal-thesis", type="thesis", status="미확인", courses=[{"code": "M1702.000400", "name": "동물생명공학논문연구", "credits": 3}], src=["s1"]),
        rule("cals-foreign-lang-lectures", status="부분", min_count=3, text="외국어진행강좌(대학영어 포함) 3과목 이상, 그중 1과목 이상은 전공 교과목"),
        rule("animal-rename")]}]}
    done = rr.refine(prog)
    thesis, foreign, rename = prog["versions"][0]["requirements"]
    assert done == {"사실": 2, "외국어진행강좌": 1} and thesis["status"] == "확인" and thesis["min_count"] == 1 and "학칙" in thesis["text"]
    assert thesis["src"][0] == "s1" and prog["sources"][thesis["src"][1]]["title"].startswith("바이오시스템공학전공")
    assert foreign["status"] == "확인" and foreign["foreign"] == {"lang": "any", "min_count": 3, "major_count": 1}
    assert rr.mark_rules(prog) == 1 and rename["type"] == "rule" and thesis["type"] == "thesis"


def test_snugenie_confirms_and_splits():
    """스누지니 전필 목록과 같으면 '확인'(다른 학과 내규 전필은 견주지 않음), 목록이 빈 끝 학년도는 판을 나눠 '부분' 그대로, 다르면 보고서로"""
    c = lambda code, cr=3: {"code": code, "name": code, "credits": cr}
    core = {"id": "core", "type": "major_required", "applies_to": [], "text": "전공필수 3과목", "min_count": 3, "min_credits": None,
            "courses": [c("5252.201A"), c("5252.301"), c("500.301A", 4)], "status": "부분", "src": ["s1"]}
    prog = {"id": "animal-biotech", "program": "동물생명공학전공", "sources": {"s1": {"title": "학과", "locator": "x"}},
            "versions": [{"entry_years": [2025, 2026], "basis": "입학 연도", "credits": {"grad": 130, "ge": 36, "single": 48, "parallel": 48, "status": "부분"},
                          "requirements": [core]}]}
    sg = {"codes": {"animal-biotech": ["525B"]}, "log": [],
          "rules": {"525B": {"groups": [{"years": [2025], "text": "[이수규정]\n졸업(수료)학점- 130, 교양학점-36, 단일전공 이수-48, 다른 전공 병행이수-48"},
                                        {"years": [2026], "text": sgn.NONE}]}},
          "subjects": {"525B": {"jp": {"2025": ["5252.201A", "5252.301"], "2026": []}}}}
    own = lambda code: code.startswith("5252.")
    done = sgn.apply(prog, sg, sgn.Same(), own)
    y25, y26 = prog["versions"]
    assert done == {"판 나눔": 1, "전필 줄 확인": 1, "학점 확인": 1}
    assert y25["entry_years"] == [2025, 2025] and y26["entry_years"] == [2026, 2026]
    assert y25["requirements"][0]["status"] == "확인" and y26["requirements"][0]["status"] == "부분"
    key = y25["requirements"][0]["src"][-1]
    assert prog["sources"][key]["title"] == "서울대학교 스누지니 전공 탐색 졸업이수규정, 전공 교과목(2025학년도, 2026-11-17 확인)"
    assert y25["credits"]["status"] == "확인" and y26["credits"]["status"] == "부분"
    # 스누지니 전필에 앱 줄에 없는 과목이 있으면 그대로 두고 보고서에
    prog2 = {"id": "animal-biotech", "program": "동물생명공학전공", "sources": {},
             "versions": [{"entry_years": [2025, 2025], "basis": "입학 연도", "credits": {}, "requirements": [dict(core, courses=core["courses"][:2], min_count=2)]}]}
    sg["subjects"]["525B"]["jp"]["2025"] = ["5252.201A", "5252.301", "5252.410"]
    assert sgn.apply(prog2, sg, sgn.Same(), own) == {} and prog2["versions"][0]["requirements"][0]["status"] == "부분"
    assert "5252.410" in sgn.report(sg) and "전필 목록이 달라 그대로 둔 줄" in sgn.report(sg)


def test_major_totals_and_old_ge():
    """판 학점이 '확인'인데 전공 전체 학점 줄이 없으면 '전공 학점' 줄(단일·병행). 옛 학번 판의 2025학번 교양 글 줄은 교양 학점 합 줄이 서면 뺀다"""
    v = lambda reqs, status="확인": {"entry_years": [2025, 2025], "credits": {"single": 48, "parallel": 39, "status": status, "src": ["s1"]}, "requirements": reqs}
    prog = {"id": "x", "depts": ["가"], "versions": [v([]), v([], "부분"), v([{"id": "s", "sum": {"of": "major", "by_role": {"single": 60}}}])]}
    assert rl.add_major_totals(prog) == 1
    row = prog["versions"][0]["requirements"][0]
    assert row["name"] == "전공 학점" and row["sum"] == {"of": "major", "by_role": {"single": 48, "parallel": 39}} and row["applies_to"] == ["single", "parallel"]
    assert row["text"] == "전공 48학점 이상(단일전공). 다른 전공과 함께 이수하면 주전공 39학점 이상" and row["status"] == "확인"
    assert rl.add_major_totals({"id": "y", "depts": [], "versions": [v([])]}) == 0  # 학과를 모르면 전공 과목을 못 가린다
    old = {"entry_years": [2021, 2024], "requirements": [{"id": "ge-x", "type": "ge", "text": "교양: 학문의 토대 … 지성의 열쇠 9학점", "src": []}]}
    rl.old_ge(old, {"table": {"k": {str(y): 36 for y in range(2019, 2027)}}}, "k")
    assert [r["id"] for r in old["requirements"]] == ["ge-x-old-total"]


@node
def test_foreign_taught_and_rule_rows(tmp_path):
    """외국어진행강좌: 그 학기 그 분반이 외국어로 진행됐으면 센다(전공 과목 수 따로, 대학영어 같은 뺄 과목은 빼고, 분반을 모르는 체크 과목이 있으면 확인 필요).
    규칙 설명 줄은 요건 줄에서 빠지고 묶음의 rules 로"""
    c = lambda code, cr=3: {"code": code, "name": code, "credits": cr}
    prog = {"id": "t", "program": "가", "depts": ["가"], "code_prefixes": ["T."], "exists_for": [2019, 2026], "sources": {"s1": {"title": "학과 내규", "locator": "1쪽"}},
            "versions": [{"entry_years": [2019, 2026], "basis": "입학 연도", "status": "확인", "src": [],
                          "credits": {"grad": 130, "ge": 36, "single": 48, "parallel": 48, "double": 39, "minor": 21, "status": "확인", "src": []},
                          "requirements": [
                              {"id": "fl", "type": "other", "applies_to": [], "text": "외국어진행강좌 3과목 이상, 그중 1과목 이상은 전공", "min_count": 3, "min_credits": None,
                               "courses": [], "status": "확인", "src": [], "foreign": {"lang": "any", "min_count": 3, "major_count": 1, "exclude": ["대학영어"]}},
                              {"id": "rule1", "type": "rule", "applies_to": [], "text": "다전공 겹쳐 인정: 복수 9학점", "min_count": None, "min_credits": None,
                               "courses": [], "status": "확인", "src": ["s1"]}]}]}
    lang = {"terms": {"2025-1": {"T.101": "001", "G.200": "002:중국어", "E.100": "001 002"}, "2025-2": {"T.102": "001"}}}
    rec = lambda code, no, term="2025-1", **kw: {"code": code, "name": kw.pop("name", code), "credits": 3, "cls": kw.pop("cls", "전선"), "dept": kw.pop("dept", "가"),
                                                 "term": term, "no": no, **kw}
    base = [rec("T.101", "001"), rec("G.200", "002", cls="교양", dept="나"), rec("E.100", "001", cls="교양", dept="나", name="대학영어 2")]
    cases = [base, base + [rec("X.1", "001", cls="교양", dept="나"), rec("G.300", "001", term="2025-2", cls="교양", dept="나")],
             base + [rec("H.1", "003", cls="교양", dept="나")] + [{"code": "Q.9", "name": "Q", "credits": 3, "cls": "", "term": None, "checked": True}],
             [rec("G.200", "002", cls="교양", dept="나"), rec("T.101", "002"), rec("T.102", "001", term="2025-2", cls="교양", dept="나")],
             [rec("G.200", "002", cls="교양", dept="나"), rec("E.100", "002", cls="교양", dept="나"), rec("T.101", "002"),
              rec("T.102", "001", term="2025-2", cls="교양", dept="나")]]
    got = _run(tmp_path, [{"kind": "view", "picks": [{"program": prog, "role": "single", "entryYear": 2025}], "records": r, "lectureLang": lang} for r in cases]
               + [{"kind": "view", "picks": [{"program": prog, "role": "single", "entryYear": 2025}], "records": base}])
    two, still_two, unknown, short_major, no_major, no_data = (g["bundles"][1] for g in got)
    assert two["rows"]["fl"]["value"] == "1과목 남음" and two["rows"]["fl"]["progress"] == {"have": 2, "need": 3, "unit": "과목"}  # 대학영어는 뺀다
    assert [x[0] for x in two["rows"]["fl"]["courses"]] == ["T.101", "G.200"]
    assert still_two["rows"]["fl"]["value"] == "1과목 남음"  # 한국어 강좌·외국어 강좌가 아닌 분반은 안 센다
    assert unknown["rows"]["fl"]["value"] == "확인 필요" and "분반을 모르는 과목 1개" in unknown["rows"]["fl"]["because"]
    # T.101 002 분반은 한국어, T.102 는 교양으로 들음: 값은 과목 수만, 전공 조건은 시트 상태 칸 끝에(디자인 153판, update137)
    assert short_major["rows"]["fl"]["value"] == "1과목 남음" and short_major["rows"]["fl"]["summary"] == "3과목 중 2과목 · 1과목 남음 · 전공 1과목 포함"
    assert no_major["rows"]["fl"]["value"] == "전공 1과목 남음" and no_major["rows"]["fl"]["summary"] == "3과목 중 3과목 · 전공 1과목 남음"  # 3과목이지만 전공 외국어 강좌가 없다
    assert two["rows"]["fl"]["summary"] == "3과목 중 2과목 · 1과목 남음" and two["rows"]["fl"]["name"] == "외국어 진행 강좌"
    assert no_data["rows"]["fl"]["value"] == "확인 필요"  # 강의 언어 자료가 없으면
    assert "rule1" not in two["rows"] and two["rules"] == [["rule1", "다전공 겹쳐 인정", ["출처: 학과 내규 · 1쪽"]]]




def test_animal_biotech_2025_from_snugenie():
    """사용자 11/17 '우리 과처럼 졸업 요건 모르는 건 스누지니든 뭐든 활용해서 알아내라': 2025학번 판은 스누지니 전필 목록·졸업 학점이 학과 자료와 같아
    전공필수·판 학점을 확인으로, 졸업논문(학칙·단과대 지침)·외국어진행강좌(단과대 공통)도 확인. 2026학년도는 스누지니 전필 목록이 비어 '부분' 그대로"""
    p = programs()["animal-biotech"]
    new, y26 = p["versions"][:2]
    rows = {r["id"]: r for r in new["requirements"]}
    title = lambda r: [p["sources"][k]["title"] for k in r["src"]]
    assert new["credits"]["status"] == "확인" and y26["credits"]["status"] == "부분"
    for rid in ("animal-main-core", "animal-thesis", "cals-foreign-lang-lectures", "major-total"):
        assert rows[rid]["status"] == "확인", rid
    assert "서울대학교 스누지니 전공 탐색 졸업이수규정, 전공 교과목(2025학년도, 2026-11-17 확인)" in title(rows["animal-main-core"])
    assert rows["major-total"]["sum"] == {"of": "major", "by_role": {"single": 48, "parallel": 48}}
    assert rows["animal-thesis"]["min_count"] == 1 and "M1702.000400" in rows["animal-thesis"]["text"]
    assert rows["cals-foreign-lang-lectures"]["foreign"] == {"lang": "any", "min_count": 3, "major_count": 1}
    assert rows["animal-rename"]["type"] == rows["animal-stat-once"]["type"] == "rule"
    assert next(r for r in y26["requirements"] if r["id"] == "animal-main-core")["status"] == "부분" and "major-total" not in {r["id"] for r in y26["requirements"]}
    # 스누지니 출처는 학교 자료 이름과 확인한 날만(원문·연락처는 앱에 안 넣는다)
    for pid, q in programs().items():
        for s in q["sources"].values():
            if "스누지니" in s["title"]:
                assert s["url"] == "https://snugenie.snu.ac.kr" and set(s) <= {"title", "url", "locator", "accessed"}, pid


# ---------------------------------------------------------------- 복수전공 줄의 졸업논문(update137)

def test_double_thesis_rows():
    """사용자 11/17 '화생공은 졸업논문 작성 이게 과목이 따로 없던데, 이런 건 체크박스로 두면 좋을 듯'(프론트엔드 요청): 복수전공 줄에 묶인 졸업논문은
    따로 졸업논문 줄(type thesis, applies_to double)로. 과목이 없으면 목록 없이, 과목이 있으면 그 목록. 복수전공 줄은 과목·학점만 남는다"""
    ps = programs()
    for v in ps["chem-bio-eng"]["versions"]:
        rows = {r["id"]: r for r in v["requirements"]}
        t = rows["cbe-double-thesis"]
        assert (t["type"], t["applies_to"], t["courses"], t["status"], t["name"]) == ("thesis", ["double"], [], "확인", "졸업논문")
        assert "졸업논문" not in rows["cbe-double"]["text"] and rows["cbe-double"]["min_count"] in (13, 14)
    cf = {r["id"]: r for r in ps["p-db64f2a8"]["versions"][0]["requirements"]}
    assert [c["code"] for c in cf["cf-double-thesis"]["courses"]] == ["M2808.003100"] and cf["cf-double-thesis"]["min_count"] == 1
    assert cf["cf-double"]["courses"] == [] and cf["cf-double"]["sum"] == {"of": "major"} and cf["cf-double"]["min_credits"] == 39
    assert all("musicology-double-thesis" in {r["id"] for r in v["requirements"]} for v in ps["p-8bc02fbf"]["versions"])
    piano = {tuple(v["entry_years"]): {r["id"] for r in v["requirements"]} for v in ps["p-085d9249"]["versions"]}
    assert "piano-double-recitals" in piano[(2021, 2022)] and "piano-double-recitals" not in piano[(2019, 2020)]  # 2021학번부터
    # 복수전공에 걸린 졸업논문 줄이 이미 있는 과정은 그대로(생명과학부 bio-thesis 는 double 에도 걸린다)
    assert not any(r["id"].endswith("-double-thesis") for v in ps["life-sciences"]["versions"] for r in v["requirements"])


@node
def test_double_thesis_check_box(tmp_path):
    """졸업논문 줄은 과목 목록이 없어 확인 필요이고, 시트의 '이 요건을 채웠어요'(rowChecks)를 켜면 충족"""
    pick = [{"program": "animal-biotech", "role": "parallel", "entryYear": 2025, "title": "동물생명공학전공"},
            {"program": "chem-bio-eng", "role": "double", "entryYear": 2025, "selectionTerm": "2026-2", "title": "화학생물공학부"}]
    got = _run(tmp_path, [{"kind": "view", "records": [], "picks": pick},
                          {"kind": "view", "records": [], "picks": pick, "rowChecks": {"chem-bio-eng|cbe-double-thesis": True}}])
    before, after = (g["bundles"][2]["rows"]["cbe-double-thesis"] for g in got)
    assert before["name"] == "졸업논문" and before["value"] == "확인 필요" and before["progress"] is None
    assert after["value"] == "충족" and after["byChecks"] is True
    assert got[0]["bundles"][2]["rows"]["cbe-double"]["value"] == "14과목 남음"


def test_teps_thresholds_in_data():
    """update148: 조건부 영어 분야(cond 에 TEPS)는 경계를 읽을 수 있으면 teps_max(New TEPS, 이 점수 이하이면 필요)를 cond 바로 뒤에 단다.
    예전 TEPS 만 적힌 글(900점 이하)은 학교 수강 기준표의 같은 구간(525). 인문대 2019~2024학번 '점수에 따라 1~2과목'은 경계가 공개 자료에 없어 달지 않는다."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import requirements_lists as rl
    seen = {}
    for prog in programs().values():
        for v in prog["versions"]:
            for r in v["requirements"]:
                for g in (r.get("extra") or {}).get("groups") or []:
                    if "TEPS" not in (g.get("cond") or ""):
                        assert "teps_max" not in g
                        continue
                    want = rl.teps_max(g["cond"])
                    assert g.get("teps_max") == want, (prog["id"], r["id"], g["cond"])
                    if want is not None:
                        keys = list(g)
                        assert keys[keys.index("cond") + 1] == "teps_max"
                    seen[want] = seen.get(want, 0) + 1
    assert seen[525] >= 300 and seen[452] >= 20 and seen[None] >= 60 and set(seen) == {525, 452, None}
    assert rl.teps_max("입학 때 TEPS 900점 이하였다면 영어 1과목이 더 필요해요.") == 525
    assert rl.teps_max("입학 때 TEPS 점수에 따라 영어 2과목이 필요할 수 있어요.") is None


@node
def test_teps_resolves_english(tmp_path):
    """update148(사용자 11/23 '텝스 점수도 받아야 한다. 이거에 따라서 영어 들어야 하는 게 달라지네'): 입학 때 TEPS 구간으로 조건부 영어를 푼다.
    New TEPS 267·386·452·525(예전 TEPS 550·700·800·900)가 구간 경계(2026학년도 학부 신입생 특별시험 안내). 경계 이하이면 영어 분야가 덧붙은 조건(겹쳐 셈),
    넘으면 빠진다(update151 부터 시트에는 '필수 아님'으로 남는다). 시트에 teps {band, english, basic, path}. 점수를 모르거나 경계가 없는 판(인문대 2019~2024학번)은 그대로 조건부."""
    g = lambda code, cr=3: {"code": code, "name": code, "credits": cr, "cls": "교양", "term": "2025-1", "status": "taken"}
    bio = [{"program": "animal-biotech", "role": "parallel", "entryYear": 2025, "title": "동물생명공학전공"}]
    hum = [{"program": "p-0ec7f3f7", "role": "single", "entryYear": 2025, "title": "인문"}]
    hum22 = [{"program": "p-0ec7f3f7", "role": "single", "entryYear": 2022, "title": "인문"}]
    two = [g("F22.101"), g("F22.102")]  # 영어가 아닌 외국어 둘
    cases = ([{"kind": "view", "picks": bio, "records": two, "teps": t} for t in (None, 4, 3)]
             + [{"kind": "view", "picks": bio, "records": two + [g("F21.101")], "teps": 2}]
             + [{"kind": "view", "picks": hum, "records": [g("F21.101")], "teps": t} for t in (3, 2, 0)]
             + [{"kind": "view", "picks": hum22, "records": [g("L0441.000600")], "teps": 1}]
             + [{"kind": "teps", "scores": [[0, "new"], [267, "new"], [268, "new"], [386, "new"], [387, "new"], [452, "new"], [453, "new"], [525, "new"],
                                            [526, "new"], [600, "new"], [601, "new"], [-1, "new"], ["480", "new"], [480.5, "new"], [550, "old"], [551, "old"],
                                            [900, "old"], [901, "old"], [990, "old"], [5, "old"], [300, "toeic"]],
                 "paths": [[0, 1], [1, 2], [2, 2], [3, 1], [4, 0], [5, 1]]}])
    got = _run(tmp_path, cases)
    rows = [{k: x for b in v["bundles"] for k, x in b["rows"].items()} for v in got[:-1]]
    unknown, high, mid, took = (r["ge-cals-natural-foreign"] for r in rows[:4])
    assert unknown["value"] == "확인 필요" and unknown["cond"] and unknown["teps"] is None
    assert high["value"] == "충족" and high["groups"] == [["외국어", "충족"], ["영어", ""]] and high["teps"] == {"band": 4, "english": 0, "basic": False, "path": []}
    assert mid["value"] == "1과목 남음" and mid["summary"] == "영어 · 1과목 남음" and mid["groups"] == [["외국어", "충족"], ["영어", "1과목 남음"]]
    assert mid["teps"]["path"] == ["고급영어"] and not mid["cond"]
    assert took["value"] == "충족" and took["teps"]["path"] == ["대학영어 2"]  # 영어 과목은 외국어 2과목에도 같이 센다
    one, two_need, basic = (r["hum-ge25-english"] for r in rows[4:7])
    assert one["value"] == "충족" and one["teps"]["english"] == 1  # 인문대 2025~: 453 이상이면 1과목
    assert two_need["value"] == "1과목 남음" and two_need["teps"] == {"band": 2, "english": 2, "basic": False, "path": ["대학영어 2", "고급영어"]}
    assert basic["teps"] == {"band": 0, "english": 2, "basic": True, "path": ["대학영어 1", "대학영어 2"]}  # 기초영어를 먼저(영어 요건엔 안 셈)
    old = rows[7]["hum-ge-english"]
    assert old["value"] == "확인 필요" and old["cond"] and old["teps"] is None and "점수에 따라" in old["because"]
    # update151(디자인 162판: TEPS 칸은 그 분야 머리와 조건 글 아래): 점수로 풀 수 있는 분야는 점수와 상관없이 teps 상태가 있고(모름 ask, 필요 on,
    # 필요 없음 off), off 분야도 시트에 남아 분야 차례가 자료와 같다(머리 조건 '필수 아님', 값 글은 비움). 경계가 없는 인문대 2019~2024학번은 칸을 두지 않는다
    assert unknown["tepsGroups"] == [["외국어", None, "2과목 이상"], ["영어", "ask", "1과목 이상"]]
    assert high["tepsGroups"][1] == ["영어", "off", "필수 아님"] and mid["tepsGroups"][1] == ["영어", "on", "1과목 이상"]
    assert one["tepsGroups"] == [["영어", None, "1과목 이상"], ["영어 2과목", "off", "필수 아님"]] and one["groups"][1] == ["영어 2과목", ""]
    assert two_need["tepsGroups"][1] == ["영어 2과목", "on", "2과목 이상"] and basic["tepsGroups"][1][1] == "on"
    assert old["tepsGroups"] == [["영어", None, "1과목 이상"], ["영어 2과목", None, "2과목 이상"]]
    for row, (pid, rid) in ((high, ("animal-biotech", "ge-cals-natural-foreign")), (one, ("p-0ec7f3f7", "hum-ge25-english"))):
        raw = [x for v in programs()[pid]["versions"] for x in v["requirements"] if x["id"] == rid][0]
        assert [g[0] for g in row["tepsGroups"]] == [g["name"] for g in raw["extra"]["groups"]]
    t = got[-1]
    assert t["bands"] == [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, None, None, 3, None, 0, 1, 3, 4, 4, None, None]
    assert [p and p["path"] for p in t["paths"]] == [["대학영어 1"], ["대학영어 1", "대학영어 2"], ["대학영어 2", "고급영어"], ["고급영어"], [], None]
    assert t["paths"][0]["basic"] is True and t["paths"][4]["basic"] is False


@node
def test_teps_values_match_progress(tmp_path):
    """update151(프론트엔드 11/23 '미술사학전공 2025 영어 줄 상태 칸이 0 / 1과목인데 값은 1영역 남음'): 영역 하나만 남으면 값도 과목·학점으로
    (영역 둘 이상이 한 과목씩 남을 때만 '2영역 남음'). TEPS 로 필요해진 영어 분야는 늘어난 기준이라 다른 조건보다 더 남으면 값·센 값을 그 분야로"""
    g = lambda code, cr=3: {"code": code, "name": code, "credits": cr, "cls": "교양", "term": "2025-1", "status": "taken"}
    hum = [{"program": "p-0ec7f3f7", "role": "single", "entryYear": 2025, "title": "인문"}]
    bio = [{"program": "animal-biotech", "role": "parallel", "entryYear": 2025, "title": "동물생명공학전공"}]
    cases = ([{"kind": "view", "picks": hum, "records": [], "teps": t} for t in (None, 2)]
             + [{"kind": "view", "picks": hum, "records": [g("F21.101")], "teps": 2}]
             + [{"kind": "view", "picks": bio, "records": [g("F22.101"), g("F22.102")], "teps": 3}, {"kind": "view", "picks": bio, "records": [], "teps": 3}])
    got = _run(tmp_path, cases)
    rows = [{k: x for b in v["bundles"] for k, x in b["rows"].items()} for v in got]
    unknown, low, one, mid, none = rows[0]["hum-ge25-english"], rows[1]["hum-ge25-english"], rows[2]["hum-ge25-english"], \
        rows[3]["ge-cals-natural-foreign"], rows[4]["ge-cals-natural-foreign"]
    assert unknown["value"] == "1과목 남음" and unknown["progress"] == {"have": 0, "need": 1, "unit": "과목"} and unknown["summary"] == "영어 · 1과목 남음"
    assert low["value"] == "2과목 남음" and low["progress"] == {"have": 0, "need": 2, "unit": "과목"} and low["summary"] == "영어 2과목 · 2과목 남음"
    assert one["value"] == "1과목 남음" and one["progress"] == {"have": 1, "need": 2, "unit": "과목"}
    assert mid["value"] == "1과목 남음" and mid["progress"] == {"have": 0, "need": 1, "unit": "과목"}  # 전에는 '6 / 6학점'에 '1과목 남음'
    assert none["value"] == "2과목 남음" and none["summary"] == "외국어 · 2과목 남음 · 영어 1과목 포함"  # 영어는 외국어 2과목에 같이 센다


@node
def test_screen_text_from_data(tmp_path):
    """update150(라이팅 11/23 B15~B17): 자료에서 오는 화면 글. 줄 이름 '수학 짝'은 학교 문서에 없는 말이라 '수학',
    출처 제목의 '누리집'은 '홈페이지', 조사하며 적은 메모(접근 실패·본문 못 엶·스캔본·1차 열람·WebFetch)는 제목에서 떼어 memo 로(앱은 쓰지 않는다)"""
    got = _run(tmp_path, [{"kind": "rowname", "texts": [["수학 짝 (1)·(2)·(3) 중 택 1(연습 과목은 같은 학기에 함께)", "ge", None]]}])
    assert got == [["수학"]]
    memos = set()
    for prog in programs().values():
        for s in (prog.get("sources") or {}).values():
            assert "누리집" not in s["title"] and not ri.MEMO_WORDS.search(s["title"]), s["title"]
            if "memo" in s:
                memos.add(s["memo"])
                assert list(s).index("memo") == list(s).index("title") + 1
    assert memos == {m for _, m in ri.SOURCE_MEMOS.values()}
    prog = json.loads(json.dumps(programs()["animal-biotech"]))
    assert ri.clean_sources(prog) == 0  # 이미 다듬은 자료는 그대로(다시 가져와도 같다)
    raw = {"id": "x", "sources": {"s1": {"title": "윤리교육과 누리집(접근 실패: robots 차단)", "url": "u"}, "s2": {"title": "학과 누리집 졸업요건", "url": "v"}}}
    assert ri.clean_sources(raw) == 2 and raw["sources"]["s1"] == {"title": "윤리교육과 홈페이지", "memo": "접근 실패: robots 차단", "url": "u"}
    assert raw["sources"]["s2"]["title"] == "학과 홈페이지 졸업요건"
    # update152(라이팅 11/24 ②③): 수강편람에서 온 출처는 `서울대학교 수강편람`으로 시작하고 범위는 괄호에, `백엔드`·`수집`·`TT Wizard`·`data/history` 없이.
    # 스누지니 출처의 '졸업이수규정, 전공 교과목'은 쉼표(정보 화면 F51 과 같게). 다시 가져와도 같은 제목이 되게 가져오기(clean_sources)에 넣었다
    for prog in programs().values():
        for s in (prog.get("sources") or {}).values():
            t = s["title"]
            assert not any(w in t for w in ("백엔드", "수집", "TT Wizard", "data/history", "졸업이수규정·전공 교과목")), t
            assert "졸업이수규정·전공 교과목" not in (s.get("locator") or ""), s
            if "수강편람" in t and "기초교양 수강편람" not in t:
                assert t.startswith("서울대학교 수강편람"), t
    assert set(ri.COURSEBOOK_TITLES.values()) <= {ri.clean_title(t) for t in ri.COURSEBOOK_TITLES}
    raw = {"id": "y", "sources": {"s1": {"title": "수강편람 자료(백엔드 수집) 2025-1", "locator": "두 과목 전필"},
                                  "s2": {"title": "서울대학교 스누지니 전공 탐색 졸업이수규정·전공 교과목(2024학년도, 2026-11-17 확인)",
                                         "locator": "2024학년도 졸업이수규정·전공 교과목(전필) 목록"}}}
    assert ri.clean_sources(raw) == 2 and raw["sources"]["s1"]["title"] == "서울대학교 수강편람(2025년 1학기)"
    assert raw["sources"]["s2"] == {"title": "서울대학교 스누지니 전공 탐색 졸업이수규정, 전공 교과목(2024학년도, 2026-11-17 확인)",
                                    "locator": "2024학년도 졸업이수규정, 전공 교과목(전필) 목록"}
