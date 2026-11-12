"""졸업 요건 조사 자료(공유 폴더) → data/requirements/ (앱이 쓰는 꼴).

  python scripts/requirements_import.py --round1 <졸업_요건_2025학번.json> --round2 <졸업_요건_학번별.json> \
      --ge-table <교양_학점_학번별.json> --course-map <교양_과목_대응표_2024-2026.csv> --common <학사_공통_규정.json>

조사 자료는 레포 밖(공유 폴더)에 둔다. 1차(2025학번)는 과정마다 요건 전체, 2차(2019~2026학번)는 같은 규정이 걸리는
학번끼리 묶은 판과 '바로 위 판과 다른 것'(replace·remove·add)만 담는다. 이 스크립트는
  1. 판마다 요건을 전부 펼치고(가장 새 판 = 1차 요건 또는 그 판의 요건, 옛 판 = 위 판에 차이를 차례로 적용),
  2. 출처를 과정마다 한 표(sources)로 모아 요건은 번호(src)로 가리키게 하고,
  3. 과정 목록(index.json)과 고른 과정의 파일(programs/<id>.json)을 쓴다.
처음 판(update100)은 시범 세 과정만 파일로 쓴다(--programs). 나머지는 목록에만 있고 data: false.
형식은 docs/requirements.md. 표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "requirements"
LO, HI = 2019, 2026
STATUS = ("확인", "부분", "미확인", "충돌")
CORE = ("id", "type", "applies_to", "text", "min_count", "min_credits", "courses", "status", "note")

# 시범 과정: (조사 묶음, 학과(부), 과정) → 앱 id 와 편람에서 전공 과목을 알아보는 법
PILOTS = {
    ("agr", "식품·동물생명공학부", "동물생명공학전공"): {
        "id": "animal-biotech", "depts": ["식품·동물생명공학부"], "code_prefixes": ["5252.", "M1702."], "ge_key": "농업생명과학대학 자연계"},
    ("nat", "생명과학부", "생명과학부"): {
        "id": "life-sciences", "depts": ["생명과학부"], "code_prefixes": [], "ge_key": "자연과학대학"},
    ("eng2", "화학생물공학부", "화학생물공학부"): {
        "id": "chem-bio-eng", "depts": ["화학생물공학부"], "code_prefixes": [], "ge_key": "공과대학 화학생물공학부"},
}


# 1차와 2차에서 학과(부)·과정 이름을 다르게 적은 것: 2차 이름 → 1차 이름
ALIAS = {
    ("prof", "수의과대학", "수의예과(예과 2년)"): ("prof", "수의예과", "수의예과(예과 2년)"),
    ("prof", "수의과대학", "수의학과(본과 4년)"): ("prof", "수의학과", "수의학과(본과 4년)"),
    ("prof", "약학대학", "약학과(6년제)"): ("prof", "약학계열(6년제)", "약학과(6년제)"),
    ("prof", "약학대학", "제약학과(6년제)"): ("prof", "약학계열(6년제)", "제약학과(6년제)"),
    ("prof", "의과대학", "의예과(예과 2년)"): ("prof", "의예과", "의예과(예과 2년)"),
    ("prof", "의과대학", "의학과(본과 4년)"): ("prof", "의학과", "의학과(본과 4년)"),
    ("prof", "치의학대학원", "치의학과 학사과정(학사·전문석사 통합과정 3년)"):
        ("prof", "치의학과(학사·전문석사 통합과정의 학사과정)", "치의학과 학사과정(통합과정 3년)"),
    ("snuc", "학부대학", "광역(전공 선택 전 공통)"): ("snuc", "학부대학 광역", "학부대학 광역(전공 선택 전 공통)"),
    ("snuc", "학부대학 자유전공학부", "자유전공학부(기존 전공을 주전공으로)"):
        ("snuc", "자유전공학부(학부대학)", "자유전공학부(기존 전공을 주전공으로)"),
    ("snuc", "학부대학 자유전공학부", "학생설계전공(자유전공학부 주전공)"):
        ("snuc", "자유전공학부(학부대학)", "학생설계전공(자유전공학부 주전공)"),
    ("snuc", "학생설계전공", "학생설계전공(복수전공)"): ("snuc", "학생설계전공(복수전공)", "학생설계전공(복수전공)"),
}
RULE_ONLY = "(유형 공통 규칙)"  # 2차의 연합·연계 유형 규칙: 고르는 과정이 아니라 목록에 넣지 않는다


def pid(agent: str, unit: str, program: str) -> str:
    """시범이 아닌 과정의 id: 이름에서 만든 짧은 해시(이름이 그대로면 그대로)."""
    key = (agent, unit, program)
    if key in PILOTS:
        return PILOTS[key]["id"]
    return "p-" + hashlib.sha1("|".join(key).encode("utf-8")).hexdigest()[:8]


class Sources:
    """과정 하나의 출처 표. 같은 (title, url, locator) 는 한 번만."""

    def __init__(self) -> None:
        self.table: dict[str, dict] = {}
        self.seen: dict[tuple, str] = {}

    def ref(self, items) -> list[str]:
        out = []
        for s in items or []:
            if not isinstance(s, dict):
                continue
            k = (s.get("title") or "", s.get("url") or "", s.get("locator") or "")
            if k not in self.seen:
                sid = f"s{len(self.table) + 1}"
                self.seen[k] = sid
                d = {kk: s[kk] for kk in ("title", "url", "locator", "accessed") if s.get(kk)}
                if str(d.get("url", "")).startswith("레포 "):  # 우리 레포 자료(수강편람 모음 등)는 주소 대신 경로
                    d["repo"] = d.pop("url")[3:].strip()
                self.table[sid] = d
            if self.seen[k] not in out:
                out.append(self.seen[k])
        return out


def norm_courses(cs) -> list[dict]:
    out = []
    for c in cs if isinstance(cs, list) else []:
        if not isinstance(c, dict) or not c.get("code"):
            continue
        d = {"code": str(c["code"]).strip(), "name": c.get("name") or "", "credits": c.get("credits")}
        alt = c.get("alt_codes")
        if isinstance(alt, list) and alt:
            d["alt_codes"] = [str(a).strip() for a in alt if a]
        out.append(d)
    return out


def norm_req(r: dict, src: Sources) -> dict:
    d = {"id": r.get("id"), "type": r.get("type") or "other",
         "applies_to": r.get("applies_to") if isinstance(r.get("applies_to"), list) else [],
         "text": r.get("text") or "", "min_count": r.get("min_count"), "min_credits": r.get("min_credits"),
         "courses": norm_courses(r.get("courses")),
         "status": r.get("status") if r.get("status") in STATUS else "미확인",
         "src": src.ref(r.get("sources"))}
    if r.get("note"):
        d["note"] = r["note"]
    extra = {k: v for k, v in r.items() if k not in CORE and k != "sources"}
    if extra:
        d["extra"] = extra
    return d


def apply_diff(newer: list[dict], diff: dict, warn: list[str], label: str) -> list[dict]:
    """바로 위(더 새) 판의 요건에 차이를 적용한다. 차례는 위 판을 따르고, 더한 요건은 끝에."""
    reqs = [dict(r) for r in newer]
    pos = {r["id"]: i for i, r in enumerate(reqs)}
    for r in diff.get("replace") or []:
        if r["id"] in pos:
            reqs[pos[r["id"]]] = r
        else:
            warn.append(f"{label}: 바꿀 요건 {r['id']} 가 위 판에 없어 더함")
            pos[r["id"]] = len(reqs)
            reqs.append(r)
    gone = set(diff.get("remove") or [])
    for g in gone - set(pos):
        warn.append(f"{label}: 뺄 요건 {g} 가 위 판에 없음")
    reqs = [r for r in reqs if r["id"] not in gone]
    have = {r["id"] for r in reqs}
    for r in diff.get("add") or []:
        if r["id"] in have:
            warn.append(f"{label}: 더할 요건 {r['id']} 가 이미 있어 바꿈")
            reqs = [r if x["id"] == r["id"] else x for x in reqs]
        else:
            reqs.append(r)
            have.add(r["id"])
    return reqs


def expand(p2: dict, round1_reqs: list[dict], src: Sources, warn: list[str]) -> list[dict]:
    """2차 과정의 판들을 요건 전체를 가진 판으로 펼친다(새 판부터)."""
    versions = sorted(p2.get("versions") or [], key=lambda v: -(v.get("entry_years") or [0])[0])
    out, newer = [], None
    for v in versions:
        ey = v.get("entry_years")
        label = f"{p2.get('program')} {ey}"
        if newer is None:
            raw = round1_reqs if v.get("requirements_same_as_round1") or not v.get("requirements") else v["requirements"]
            reqs = [norm_req(r, src) for r in raw]
        else:
            diff = v.get("diff_from_newer") or {}
            nd = {k: [norm_req(r, src) for r in diff.get(k) or []] for k in ("replace", "add")}
            nd["remove"] = list(diff.get("remove") or [])
            reqs = apply_diff(newer, nd, warn, label)
            if v.get("requirements"):          # 옛 판인데 요건 전체를 적은 경우는 그것을 쓴다
                reqs = [norm_req(r, src) for r in v["requirements"]]
        cr = v.get("credits") or {}
        credits = {k: cr.get(k) for k in ("grad", "ge", "single", "parallel", "double", "minor")}
        credits["status"] = cr.get("status") if cr.get("status") in STATUS else v.get("status") if v.get("status") in STATUS else "미확인"
        credits["src"] = src.ref(cr.get("sources"))
        ver = {"entry_years": ey, "basis": v.get("basis") or "입학 연도", "credits": credits,
               "status": v.get("status") if v.get("status") in STATUS else "미확인", "src": src.ref(v.get("sources")),
               "requirements": reqs}
        diff_text = (v.get("diff_from_newer") or {}).get("text")
        if diff_text:
            ver["changed"] = diff_text
        if v.get("note"):
            ver["note"] = v["note"]
        out.append(ver)
        newer = reqs
    return out


def check_cover(versions: list[dict], exists: list[int], label: str, warn: list[str]) -> None:
    lo, hi = max(LO, exists[0]), min(HI, exists[1])
    seen: dict[int, int] = {}
    for v in versions:
        a, b = v["entry_years"]
        for y in range(max(a, LO), min(b, HI) + 1):
            seen[y] = seen.get(y, 0) + 1
    gaps = [y for y in range(lo, hi + 1) if not seen.get(y)]
    over = [y for y in range(lo, hi + 1) if seen.get(y, 0) > 1]
    if gaps or over:
        warn.append(f"{label}: 빈 학번 {gaps} 겹친 학번 {over}")


def build_program(p1: dict, p2: dict, meta: dict, checked: str) -> tuple[dict, list[str]]:
    warn: list[str] = []
    src = Sources()
    versions = expand(p2, p1.get("requirements") or [], src, warn)
    ex = p2.get("exists_for") if isinstance(p2.get("exists_for"), list) else [LO, HI]
    check_cover(versions, ex, p2.get("program"), warn)
    struct = p1.get("structure") or {}
    asks = []
    for a in (p2.get("ask_department") or []) + (p1.get("ask_department") or []):
        a = a if isinstance(a, str) else json.dumps(a, ensure_ascii=False)
        if a not in asks:
            asks.append(a)
    prog = {
        "id": meta["id"], "college": p1.get("college"), "unit": p1.get("unit"), "program": p1.get("program"),
        "depts": meta["depts"], "code_prefixes": meta["code_prefixes"], "ge_key": meta.get("ge_key"),
        "exists_for": ex, "predecessor": p2.get("predecessor"),
        "structure": {k: struct.get(k) for k in ("splits_into", "when", "status") if struct.get(k)},
        "versions": versions,
        "change_points": [{k: c.get(k) for k in ("entry_year", "basis", "what", "status") if c.get(k) is not None}
                          for c in p2.get("change_points") or [] if isinstance(c, dict)],
        "ask_department": asks,
        "sources": src.table,
        "checked_on": checked,
    }
    return prog, warn


def read_ge_table(path: Path) -> dict:
    """교양_학점_학번별 표(백엔드가 학부대학 해마다 이수규정에서 뽑은 것). csv 면 행 이름 → {학번: 학점}."""
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    rows = list(csv.reader(path.open(encoding="utf-8-sig")))
    head = rows[0]
    years = [int(h[:4]) for h in head[1:] if h[:4].isdigit()]
    table = {}
    for r in rows[1:]:
        if not r or not r[0] or r[0].startswith("출처"):
            continue
        table[r[0]] = {str(y): int(v) for y, v in zip(years, r[1:]) if v.strip().isdigit()}
    return {"source": "학부대학, 해마다 단과대학별 교양 이수규정(2019~2024 liberaledu, 2025·2026 대학별 공통교육과정 이수규정)의 '교양 N학점 이상'",
            "urls": ["https://snuc.snu.ac.kr/wp-content/uploads/sites/305/2025/04/liberaledu_2019.pdf",
                     "https://snuc.snu.ac.kr/wp-content/uploads/sites/305/2025/12/liberaledu_2023_2.pdf",
                     "https://snuc.snu.ac.kr/wp-content/uploads/sites/305/2025/12/liberaledu_2024_2.pdf",
                     "https://snuc.snu.ac.kr/wp-content/uploads/sites/305/2026/01/2026학년도-시행-공통교육과정-대학별-이수규정.pdf"],
            "accessed": "2026-11-12", "note": "2019 공대는 이것과 따로 사회성·창의성 6학점", "table": table}


def read_course_map(path: Path) -> dict:
    """학교 교양 영역·과목 대응표(2024 → 2025 → 2026)에서 번호 짝과 영역만 뽑는다."""
    rows = list(csv.reader(path.open(encoding="utf-8-sig")))
    out = []
    for r in rows:
        if len(r) < 14 or not r[2] or r[2] == "교과목번호":
            continue
        row = {}
        for year, (a, s, c, n) in (("2024", (0, 1, 2, 3)), ("2025", (5, 6, 7, 8)), ("2026", (10, 11, 12, 13))):
            if r[c].strip():
                row[year] = {"code": r[c].strip(), "name": r[n].strip(), "area": r[a].strip(), "sub": r[s].strip()}
        if "2026" in row and r[9].strip():
            row["2026"]["top"] = r[9].strip()
        if r[4].strip():
            row["note"] = r[4].strip()
        if len(row) >= 2:
            out.append(row)
    return {"source": {"title": "인문대학 공지 '공통교육과정 교과목 영역 인정 기준 안내'(2026-08-07) 붙임 교과목 비교표",
                       "url": "https://humanities.snu.ac.kr/community/notice?md=v&bbsidx=3951", "accessed": "2026-11-12"},
            "note": "옛 학번이 입학 뒤 새로 생긴 교양 과목을 들으면 영역은 입학 연도 규정으로 판정한다(2026-2 기초교양 수강편람). 이 표는 번호 짝과 영역만 옮겼다.",
            "rows": out}


def common_rules(path: Path) -> dict:
    """학사_공통_규정.json → 앱 계산에 쓰는 값만 꼴을 맞춰 담는다(규칙 원문 요약과 출처는 함께 둔다)."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "checked_on": data["basis"]["checked_on"],
        "grade_points": {"A+": 4.3, "A0": 4.0, "A-": 3.7, "B+": 3.3, "B0": 3.0, "B-": 2.7, "C+": 2.3, "C0": 2.0, "C-": 1.7,
                         "D+": 1.3, "D0": 1.0, "D-": 0.7, "F": 0.0},
        "pass_grades": ["S"], "no_credit_grades": ["F", "U"], "excluded_from_gpa": ["S", "U", "W", "I"],
        "graduation": {"credits_min": 130, "ge_min": 36, "major_min": 39, "gpa_min": 2.0, "major_gpa_min": 2.0},
        "retake": {"max_grade_from_2015": "A0", "eligible_max": "C+", "later_grade_counts": True,
                   "except_units": ["수의과대학", "의과대학"]},
        "transfer_credit_ratio_max": 0.5,
        "seasonal": {"summer": 9, "winter": 6},
        "multi_overlap": {"max_courses": 3, "from": "2026-03-01", "old_rule": {"shared_credits": 9, "other_dept_credits": 3},
                          "no_overlap": ["minor", "linked", "designed"]},
        "term_limit": {
            "default": 18,
            "units": [
                {"match": ["간호대학"], "limit": 19},
                {"match": ["수의예과"], "limit": 19},
                {"match": ["약학대학"], "entry_max": 2016, "limit": 20},
                {"match": ["약학대학"], "entry_min": 2017, "limit": 21},
                {"match": ["치의학"], "limit": 21},
                {"match": ["의예과"], "limit": 23},
                {"match": ["수의학과"], "entry_min": 2022, "year": "program", "limit": 25},
                {"match": ["의학과"], "limit": 26},
            ],
            "first_terms": [
                {"match": ["학부대학", "자유전공학부"], "terms": 2, "limit": 20},
                {"match": ["자연과학대학"], "entry_min": 2024, "terms": 2, "limit": 20},
                {"match": ["공과대학 광역"], "entry_min": 2023, "terms": 1, "limit": 22},
                {"match": ["공과대학"], "entry_min": 2021, "terms": 2, "limit": 19},
                {"match": ["사범대학"], "entry_min": 2025, "terms": 2, "limit": 19},
                {"match": ["첨단융합학부"], "terms": 2, "limit": 20},
            ],
            "plus": {"base_max": 20, "gpa_min": 3.3, "limit": 21, "note": "직전 2개 정규학기 평점평균(계절 제외, 재이수 조정 전)"},
            "warning_limit": 15,
            "exempt_codes": ["E11.108", "E31.102", "E51.101", "E51.102", "E52.101", "E52.102", "F31.101", "F33.101", "F34.101", "F35.101"],
        },
        "rules": [{k: r[k] for k in ("id", "topic", "rule", "status") if k in r} for r in data["rules"]],
        "sources": data["sources"],
        "note": "학칙 원문(rule.snu.ac.kr)은 robots 로 막혀 보지 않았다. 학교 학사 안내·2026-2 기초교양 수강편람·2024 교과과정 해설의 인용으로 정리했다. "
                "학기당 상한은 수강편람(2026-2) 값(학교 '수강' 페이지는 옛 값). 학사경고 15학점은 학과 안내 인용(부분).",
    }


SNUC_COLLEGE = {"학부대학 광역": "학부대학", "자유전공학부(학부대학)": "학부대학", "첨단융합학부": "첨단융합학부",
                "혁신공유학부": "혁신공유학부", "연합전공": "다전공", "연계전공": "다전공", "학생설계전공(복수전공)": "다전공",
                "학생설계전공": "다전공", "학부대학": "학부대학", "학부대학 자유전공학부": "학부대학"}


def index_entry(p1: dict | None, p2: dict | None, agent: str, data_ids: set[str]) -> dict:
    unit = (p1 or p2).get("unit")
    program = (p1 or {}).get("program") or (p2 or {}).get("program")
    i = pid(agent, unit, program)
    struct = (p1 or {}).get("structure") or {}
    vs = (p2 or {}).get("versions") or []
    college = (p1 or {}).get("college") or (p2 or {}).get("college")
    if agent == "snuc":
        college = SNUC_COLLEGE.get(unit, college)
    return {"id": i, "college": college, "unit": unit, "program": program,
            "unit_kind": (p1 or {}).get("unit_kind"),
            "exists_for": (p2 or {}).get("exists_for") or [LO, HI],
            "predecessor": (p2 or {}).get("predecessor"),
            "splits_into": struct.get("splits_into") or [], "splits_when": struct.get("when"),
            "versions": [v.get("entry_years") for v in vs if v.get("entry_years")],
            "data": i in data_ids}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round1", required=True)
    ap.add_argument("--round2", required=True)
    ap.add_argument("--ge-table", required=True)
    ap.add_argument("--course-map", required=True)
    ap.add_argument("--common", required=True)
    ap.add_argument("--programs", default="pilots", help="pilots(기본) 또는 all")
    ap.add_argument("-o", "--output", default=str(OUT))
    args = ap.parse_args(argv)
    out = Path(args.output)
    (out / "programs").mkdir(parents=True, exist_ok=True)
    r1 = json.loads(Path(args.round1).read_text(encoding="utf-8"))
    r2 = json.loads(Path(args.round2).read_text(encoding="utf-8"))
    checked = r2["basis"].get("checked_on", "")
    one = {(p["agent"], p["unit"], p["program"]): p for p in r1["programs"]}
    two = {}
    for p in r2["programs"]:
        k = (p["agent"], p.get("unit"), p.get("program"))
        two[ALIAS.get(k, k)] = p
    pick = set(PILOTS) if args.programs == "pilots" else set(two)
    written, warns = set(), {}
    for key in sorted(pick):
        p1, p2 = one.get(key), two.get(key)
        if not p1 or not p2:
            warns[str(key)] = ["1차나 2차 자료에 없음"]
            continue
        meta = PILOTS.get(key) or {"id": pid(*key), "depts": [], "code_prefixes": []}
        prog, w = build_program(p1, p2, meta, checked)
        (out / "programs" / f"{prog['id']}.json").write_text(json.dumps(prog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written.add(prog["id"])
        if w:
            warns[prog["id"]] = w
    keys = [k for k in dict.fromkeys(list(one) + list(two)) if RULE_ONLY not in (k[2] or "")]
    index = [index_entry(one.get(k), two.get(k), k[0], written) for k in keys]
    (out / "index.json").write_text(json.dumps({"checked_on": checked, "cohorts": [LO, HI], "programs": index},
                                               ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "ge_credits.json").write_text(json.dumps(read_ge_table(Path(args.ge_table)), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "course_map.json").write_text(json.dumps(read_course_map(Path(args.course_map)), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    common = common_rules(Path(args.common))
    (out / "common.json").write_text(json.dumps(common, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"과정 파일 {len(written)}개, 목록 {len(index)}개 → {out}")
    for k, w in warns.items():
        for x in w:
            print(f"  ! {k}: {x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
